import crypto from 'crypto';
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { commerceRepository } from '../database/repositories/CommerceRepository';
import {
  CommerceMembership,
  CommerceMembershipStatus,
  CommercePointsConsumeInput,
  CommercePointsLedgerItem,
  CommerceTransactionSyncInput,
} from '../models/Commerce';
import { ValidationError } from '../utils/errors';

const PRODUCT_CATALOG: Record<string, { type: 'membership' | 'points'; tier?: string; points?: number }> = {
  'com.zhizhi.membership.monthly': { type: 'membership', tier: 'monthly' },
  'com.zhizhi.membership.yearly': { type: 'membership', tier: 'yearly' },
  'com.zhizhi.points.small': { type: 'points', points: 60 },
  'com.zhizhi.points.medium': { type: 'points', points: 180 },
  'com.zhizhi.points.large': { type: 'points', points: 360 },
};

type DecodedTransaction = Record<string, any> & {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  appAccountToken?: string;
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  environment?: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} 不能为空`);
  }
  return value.trim();
}

function toIsoFromMillis(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

function decodeBase64UrlJson(value: string): any {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function decodeUnsignedJwsPayload(signedTransactionInfo: string): DecodedTransaction {
  const parts = signedTransactionInfo.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new ValidationError('signed_transaction_info 必须是 JWS Compact 格式');
  }

  try {
    return decodeBase64UrlJson(parts[1]) as DecodedTransaction;
  } catch {
    throw new ValidationError('signed_transaction_info payload 无法解析');
  }
}

function configuredVerifier(): SignedDataVerifier | null {
  const roots = (process.env.APPLE_IAP_ROOT_CERTIFICATES_BASE64 || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Buffer.from(item, 'base64'));
  const bundleId = process.env.APPLE_IAP_BUNDLE_ID;
  if (!roots.length || !bundleId) return null;

  const envValue = (process.env.APPLE_IAP_ENVIRONMENT || 'Sandbox').toLowerCase();
  const environment =
    envValue === 'production' ? Environment.PRODUCTION :
    envValue === 'xcode' ? Environment.XCODE :
    envValue === 'localtesting' || envValue === 'local_testing' ? Environment.LOCAL_TESTING :
    Environment.SANDBOX;
  const appAppleId = process.env.APPLE_IAP_APP_APPLE_ID
    ? Number(process.env.APPLE_IAP_APP_APPLE_ID)
    : undefined;

  return new SignedDataVerifier(roots, true, environment, bundleId, appAppleId);
}

async function verifyOrDecodeTransaction(signedTransactionInfo: string): Promise<{
  payload: DecodedTransaction;
  source: string;
}> {
  const verifier = configuredVerifier();
  if (verifier) {
    try {
      const payload = await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
      return { payload: payload as DecodedTransaction, source: 'apple_server_library' };
    } catch (error) {
      if (process.env.APPLE_IAP_REQUIRE_SIGNED_VERIFICATION === 'true') {
        throw new ValidationError('Apple 交易签名校验失败');
      }
      console.warn('[Commerce] Apple JWS verification failed, falling back to local decode:', error);
    }
  } else if (process.env.APPLE_IAP_REQUIRE_SIGNED_VERIFICATION === 'true') {
    throw new ValidationError('缺少 Apple IAP 服务端校验配置');
  }

  return {
    payload: decodeUnsignedJwsPayload(signedTransactionInfo),
    source: 'decoded_jws_unverified',
  };
}

function validateDecodedTransaction(input: CommerceTransactionSyncInput, decoded: DecodedTransaction) {
  if (!decoded.transactionId || !decoded.productId) {
    throw new ValidationError('signed_transaction_info 缺少 transactionId 或 productId');
  }
  if (decoded.transactionId !== input.transaction_id) {
    throw new ValidationError('transaction_id 与 signed_transaction_info 不一致');
  }
  if (decoded.originalTransactionId && decoded.originalTransactionId !== input.original_transaction_id) {
    throw new ValidationError('original_transaction_id 与 signed_transaction_info 不一致');
  }
  if (decoded.productId !== input.product_id) {
    throw new ValidationError('product_id 与 signed_transaction_info 不一致');
  }
  if (decoded.appAccountToken && decoded.appAccountToken.toLowerCase() !== input.app_account_token.toLowerCase()) {
    throw new ValidationError('app_account_token 与 signed_transaction_info 不一致');
  }
}

function membershipStatus(decoded: DecodedTransaction): CommerceMembershipStatus {
  if (decoded.revocationDate) return 'revoked';
  const expiresAt = toIsoFromMillis(decoded.expiresDate);
  if (!expiresAt) return 'active';
  return new Date(expiresAt).getTime() > Date.now() ? 'active' : 'inactive';
}

function formatMembership(record: CommerceMembership | null) {
  if (!record) return null;
  return {
    status: record.status,
    tier: record.tier,
    product_id: record.product_id,
    original_transaction_id: record.original_transaction_id,
    expires_at: record.expires_at,
    environment: record.environment,
    will_auto_renew: record.will_auto_renew,
    grace_period_expires_at: record.grace_period_expires_at,
  };
}

function formatLedgerItem(item: CommercePointsLedgerItem) {
  return {
    id: item.id,
    type: item.type,
    delta: item.delta,
    balance_after: item.balance_after,
    source: item.source,
    source_id: item.source_id,
    created_at: item.created_at,
  };
}

async function currentStatus(userId: string, appAccountToken?: string) {
  const account = appAccountToken
    ? await commerceRepository.upsertAccountToken(userId, appAccountToken)
    : await commerceRepository.findAccountByUser(userId)
      || await commerceRepository.upsertAccountToken(userId, crypto.randomUUID());
  const membership = await commerceRepository.getLatestMembership(userId);
  const points = await commerceRepository.getPointsBalance(userId);

  return {
    membership: formatMembership(membership),
    points: {
      balance: points.balance,
      updated_at: points.updated_at,
    },
    store: {
      app_account_token: account.app_account_token,
    },
  };
}

export async function getCommerceStatus(userId: string) {
  return currentStatus(userId);
}

export async function syncCommerceTransaction(userId: string, rawInput: any) {
  const input: CommerceTransactionSyncInput = {
    transaction_id: requiredString(rawInput?.transaction_id, 'transaction_id'),
    original_transaction_id: requiredString(rawInput?.original_transaction_id, 'original_transaction_id'),
    product_id: requiredString(rawInput?.product_id, 'product_id'),
    purchase_date: requiredString(rawInput?.purchase_date, 'purchase_date'),
    app_account_token: requiredString(rawInput?.app_account_token, 'app_account_token'),
    signed_transaction_info: requiredString(rawInput?.signed_transaction_info, 'signed_transaction_info'),
  };

  if (!isUuid(input.app_account_token)) {
    throw new ValidationError('app_account_token 必须是 UUID');
  }

  const catalogItem = PRODUCT_CATALOG[input.product_id];
  if (!catalogItem) {
    throw new ValidationError('不支持的商品 ID');
  }

  const existing = await commerceRepository.findTransactionById(input.transaction_id);
  if (existing) {
    const status = await currentStatus(userId, input.app_account_token);
    return {
      accepted: true,
      duplicate: true,
      membership: status.membership,
      points: catalogItem.type === 'points'
        ? { delta: null, balance: status.points.balance, ledger_entry_id: null }
        : null,
    };
  }

  const { payload, source } = await verifyOrDecodeTransaction(input.signed_transaction_info);
  validateDecodedTransaction(input, payload);

  await commerceRepository.upsertAccountToken(userId, input.app_account_token);
  await commerceRepository.createTransaction({
    transaction_id: input.transaction_id,
    original_transaction_id: input.original_transaction_id,
    user_id: userId,
    product_id: input.product_id,
    product_type: catalogItem.type,
    app_account_token: input.app_account_token,
    purchase_date: input.purchase_date,
    environment: payload.environment || null,
    signed_transaction_info: input.signed_transaction_info,
    verification_source: source,
    raw_payload: payload,
  });

  if (catalogItem.type === 'membership') {
    const membership = await commerceRepository.upsertMembership({
      user_id: userId,
      status: membershipStatus(payload),
      tier: catalogItem.tier || null,
      product_id: input.product_id,
      original_transaction_id: input.original_transaction_id,
      transaction_id: input.transaction_id,
      expires_at: toIsoFromMillis(payload.expiresDate),
      environment: payload.environment || null,
      will_auto_renew: false,
      grace_period_expires_at: null,
      revoked_at: toIsoFromMillis(payload.revocationDate),
      raw_transaction: payload,
    });

    return {
      accepted: true,
      duplicate: false,
      membership: formatMembership(membership),
      points: null,
    };
  }

  if (payload.revocationDate) {
    throw new ValidationError('已撤销的积分交易不能入账');
  }

  const ledger = await commerceRepository.applyPointsDelta({
    userId,
    type: 'purchase',
    delta: catalogItem.points || 0,
    source: 'storekit_transaction',
    sourceId: input.transaction_id,
    idempotencyKey: `purchase:${input.transaction_id}`,
    metadata: {
      product_id: input.product_id,
      original_transaction_id: input.original_transaction_id,
    },
  });

  return {
    accepted: true,
    duplicate: false,
    membership: null,
    points: {
      delta: ledger.delta,
      balance: ledger.balance_after,
      ledger_entry_id: ledger.id,
    },
  };
}

export async function listCommercePointsLedger(userId: string, rawQuery: Record<string, any>) {
  const page = Math.max(1, Number(rawQuery.page || 1));
  const pageSize = Math.min(50, Math.max(1, Number(rawQuery.page_size || 20)));
  const { items, total } = await commerceRepository.listPointsLedger(userId, page, pageSize);

  return {
    items: items.map(formatLedgerItem),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  };
}

export async function consumeCommercePoints(userId: string, rawInput: any) {
  const input: CommercePointsConsumeInput = {
    amount: Number(rawInput?.amount),
    reason: requiredString(rawInput?.reason, 'reason'),
    idempotency_key: requiredString(rawInput?.idempotency_key, 'idempotency_key'),
  };

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new ValidationError('amount 必须是正整数');
  }

  try {
    const ledger = await commerceRepository.applyPointsDelta({
      userId,
      type: 'consume',
      delta: -input.amount,
      source: 'app_consume',
      sourceId: input.reason,
      idempotencyKey: `consume:${input.idempotency_key}`,
      metadata: { reason: input.reason },
    });

    return {
      consumed: ledger.delta < 0,
      balance: ledger.balance_after,
      ledger_entry_id: ledger.id,
    };
  } catch (error: any) {
    if (String(error?.message || '').includes('INSUFFICIENT_POINTS')) {
      throw new ValidationError('积分余额不足', { code: 'INSUFFICIENT_POINTS' });
    }
    throw error;
  }
}

