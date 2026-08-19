import crypto from 'crypto';
import {
  AutoRenewStatus,
  Environment,
  JWSRenewalInfoDecodedPayload,
  ResponseBodyV2DecodedPayload,
  SignedDataVerifier,
} from '@apple/app-store-server-library';
import { commerceRepository } from '../database/repositories/CommerceRepository';
import {
  CommerceMembership,
  CommerceMembershipStatus,
  CommercePointsConsumeInput,
  CommercePointsLedgerItem,
  CommerceTransactionSyncInput,
} from '../models/Commerce';
import { ServiceUnavailableError, ValidationError } from '../utils/errors';

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
  signedDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  environment?: string;
};

export type CommerceNotificationEnvironment = 'Production' | 'Sandbox';

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

function decodeUnsignedJwsPayload<T = DecodedTransaction>(signedData: string, field = 'signed_transaction_info'): T {
  const parts = signedData.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new ValidationError(`${field} 必须是 JWS Compact 格式`);
  }

  try {
    return decodeBase64UrlJson(parts[1]) as T;
  } catch {
    throw new ValidationError(`${field} payload 无法解析`);
  }
}

function configuredEnvironment(): Environment {
  const envValue = (process.env.APPLE_IAP_ENVIRONMENT || 'Sandbox').toLowerCase();
  return envValue === 'production' ? Environment.PRODUCTION
    : envValue === 'xcode' ? Environment.XCODE
    : envValue === 'localtesting' || envValue === 'local_testing' ? Environment.LOCAL_TESTING
    : Environment.SANDBOX;
}

function configuredVerifier(environment = configuredEnvironment()): SignedDataVerifier | null {
  const roots = (process.env.APPLE_IAP_ROOT_CERTIFICATES_BASE64 || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Buffer.from(item, 'base64'));
  const bundleId = process.env.APPLE_IAP_BUNDLE_ID;
  if (!roots.length || !bundleId) return null;

  const appAppleId = process.env.APPLE_IAP_APP_APPLE_ID
    ? Number(process.env.APPLE_IAP_APP_APPLE_ID)
    : undefined;

  return new SignedDataVerifier(roots, true, environment, bundleId, appAppleId);
}

function requiresSignedVerification(): boolean {
  return process.env.APPLE_IAP_REQUIRE_SIGNED_VERIFICATION === 'true'
    || process.env.NODE_ENV === 'production'
    || process.env.VERCEL_ENV === 'production';
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

function canDeliverSandboxTransaction(userId: string): boolean {
  if (!isProductionRuntime()) return true;
  if (process.env.COMMERCE_SANDBOX_DELIVERY_ENABLED !== 'true') return false;

  const allowedUserIds = new Set(
    (process.env.COMMERCE_SANDBOX_TEST_USER_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return allowedUserIds.has(userId);
}

async function verifyOrDecodeTransaction(
  signedTransactionInfo: string,
  explicitEnvironment?: Environment,
): Promise<{
  payload: DecodedTransaction;
  source: string;
}> {
  const configured = configuredEnvironment();
  const environments = explicitEnvironment
    ? [explicitEnvironment]
    : configured === Environment.PRODUCTION
      ? [Environment.PRODUCTION, Environment.SANDBOX]
      : [configured];
  let hasVerifier = false;
  let lastVerificationError: unknown = null;

  for (const environment of environments) {
    const verifier = configuredVerifier(environment);
    if (!verifier) continue;
    hasVerifier = true;
    try {
      const payload = await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
      return {
        payload: payload as DecodedTransaction,
        source: `apple_server_library:${environment}`,
      };
    } catch (error) {
      lastVerificationError = error;
    }
  }

  if (requiresSignedVerification()) {
    if (!hasVerifier) {
      throw new ValidationError('缺少 Apple IAP 服务端校验配置');
    }
    throw new ValidationError('Apple 交易签名校验失败');
  }
  if (lastVerificationError) {
    console.warn('[Commerce] Apple JWS verification failed, falling back to local decode:', lastVerificationError);
  }

  return {
    payload: decodeUnsignedJwsPayload(signedTransactionInfo),
    source: 'decoded_jws_unverified',
  };
}

async function verifyOrDecodeNotification(
  signedPayload: string,
  environment: Environment,
): Promise<ResponseBodyV2DecodedPayload> {
  const verifier = configuredVerifier(environment);
  if (verifier) {
    try {
      return await verifier.verifyAndDecodeNotification(signedPayload);
    } catch (error) {
      if (requiresSignedVerification()) {
        throw new ValidationError('Apple Server Notification 签名校验失败');
      }
      console.warn('[Commerce] Apple notification verification failed, falling back to local decode:', error);
    }
  } else if (requiresSignedVerification()) {
    throw new ValidationError('缺少 Apple IAP 服务端校验配置');
  }

  return decodeUnsignedJwsPayload<ResponseBodyV2DecodedPayload>(signedPayload, 'signedPayload');
}

async function verifyOrDecodeRenewalInfo(
  signedRenewalInfo: string,
  environment: Environment,
): Promise<JWSRenewalInfoDecodedPayload> {
  const verifier = configuredVerifier(environment);
  if (verifier) {
    try {
      return await verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo);
    } catch (error) {
      if (requiresSignedVerification()) {
        throw new ValidationError('Apple 续订信息签名校验失败');
      }
      console.warn('[Commerce] Apple renewal verification failed, falling back to local decode:', error);
    }
  } else if (requiresSignedVerification()) {
    throw new ValidationError('缺少 Apple IAP 服务端校验配置');
  }

  return decodeUnsignedJwsPayload<JWSRenewalInfoDecodedPayload>(signedRenewalInfo, 'signedRenewalInfo');
}

function validateDecodedTransaction(input: CommerceTransactionSyncInput, decoded: DecodedTransaction) {
  if (!decoded.transactionId || !decoded.originalTransactionId || !decoded.productId) {
    throw new ValidationError('signed_transaction_info 缺少交易标识或商品标识');
  }
  if (decoded.transactionId !== input.transaction_id) {
    throw new ValidationError('transaction_id 与 signed_transaction_info 不一致');
  }
  if (decoded.originalTransactionId !== input.original_transaction_id) {
    throw new ValidationError('original_transaction_id 与 signed_transaction_info 不一致');
  }
  if (decoded.productId !== input.product_id) {
    throw new ValidationError('product_id 与 signed_transaction_info 不一致');
  }
  if (!decoded.appAccountToken) {
    throw new ValidationError('signed_transaction_info 缺少 appAccountToken');
  }
  if (decoded.appAccountToken.toLowerCase() !== input.app_account_token.toLowerCase()) {
    throw new ValidationError('app_account_token 与 signed_transaction_info 不一致');
  }
  if (!toIsoFromMillis(decoded.purchaseDate)) {
    throw new ValidationError('signed_transaction_info 缺少有效 purchaseDate');
  }
}

function membershipStatus(
  decoded: DecodedTransaction,
  renewalInfo?: JWSRenewalInfoDecodedPayload | null,
): CommerceMembershipStatus {
  if (decoded.revocationDate) return 'revoked';

  const gracePeriodExpiresAt = toIsoFromMillis(renewalInfo?.gracePeriodExpiresDate);
  if (gracePeriodExpiresAt && new Date(gracePeriodExpiresAt).getTime() > Date.now()) {
    return 'grace_period';
  }
  if (renewalInfo?.isInBillingRetryPeriod) return 'billing_retry';

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

async function currentStatus(userId: string) {
  const account = await commerceRepository.findAccountByUser(userId)
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
      purchases_enabled: process.env.COMMERCE_PURCHASES_ENABLED === 'true',
    },
  };
}

export async function getCommerceStatus(userId: string) {
  return currentStatus(userId);
}

async function deliverCommerceTransaction(input: CommerceTransactionSyncInput, userId: string, options: {
  decoded: DecodedTransaction;
  source: string;
  renewalInfo?: JWSRenewalInfoDecodedPayload | null;
}) {
  const { decoded, source, renewalInfo } = options;
  if (String(decoded.environment || '').toLowerCase() === 'sandbox'
      && !canDeliverSandboxTransaction(userId)) {
    throw new ValidationError('Sandbox 交易只允许显式配置的测试账号');
  }
  const catalogItem = PRODUCT_CATALOG[input.product_id];
  if (!catalogItem) {
    throw new ValidationError('不支持的商品 ID');
  }

  validateDecodedTransaction(input, decoded);

  const purchaseDate = toIsoFromMillis(decoded.purchaseDate)!;
  const revokedAt = toIsoFromMillis(decoded.revocationDate);
  const processed = await commerceRepository.processTransaction({
    transaction_id: input.transaction_id,
    original_transaction_id: input.original_transaction_id,
    user_id: userId,
    product_id: input.product_id,
    product_type: catalogItem.type,
    app_account_token: input.app_account_token,
    purchase_date: purchaseDate,
    environment: decoded.environment || null,
    signed_transaction_info: input.signed_transaction_info,
    verification_source: source,
    raw_payload: decoded,
    membership_status: catalogItem.type === 'membership' ? membershipStatus(decoded, renewalInfo) : null,
    membership_tier: catalogItem.type === 'membership' ? catalogItem.tier || null : null,
    expires_at: catalogItem.type === 'membership' ? toIsoFromMillis(decoded.expiresDate) : null,
    revoked_at: catalogItem.type === 'membership' ? revokedAt : null,
    will_auto_renew: catalogItem.type === 'membership'
      ? renewalInfo?.autoRenewStatus === AutoRenewStatus.ON
      : false,
    grace_period_expires_at: catalogItem.type === 'membership'
      ? toIsoFromMillis(renewalInfo?.gracePeriodExpiresDate)
      : null,
    points_delta: catalogItem.type === 'points'
      ? (revokedAt ? -(catalogItem.points || 0) : catalogItem.points || 0)
      : null,
  });

  if (catalogItem.type === 'membership') {
    return {
      accepted: true,
      duplicate: processed.duplicate,
      membership: formatMembership(processed.membership),
      points: null,
    };
  }

  if (!processed.points) {
    throw new Error('积分交易处理完成但缺少账本结果');
  }

  return {
    accepted: true,
    duplicate: processed.duplicate,
    membership: null,
    points: {
      delta: processed.duplicate && !revokedAt ? null : processed.points.delta,
      balance: processed.points.balance_after,
      ledger_entry_id: processed.points.id,
    },
  };
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

  const { payload, source } = await verifyOrDecodeTransaction(input.signed_transaction_info);
  return deliverCommerceTransaction(input, userId, { decoded: payload, source });
}

function notificationEnvironment(value: CommerceNotificationEnvironment): Environment {
  return value === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX;
}

async function resolveNotificationIdentity(decoded: DecodedTransaction): Promise<{
  userId: string;
  appAccountToken: string;
}> {
  if (decoded.appAccountToken) {
    const account = await commerceRepository.findAccountByToken(decoded.appAccountToken);
    if (account) {
      return { userId: account.user_id, appAccountToken: account.app_account_token };
    }
  }

  if (decoded.transactionId) {
    const transaction = await commerceRepository.findTransactionById(decoded.transactionId);
    if (transaction) {
      return { userId: transaction.user_id, appAccountToken: transaction.app_account_token };
    }
  }

  if (decoded.originalTransactionId) {
    const transaction = await commerceRepository.findTransactionByOriginalId(decoded.originalTransactionId);
    if (transaction) {
      return { userId: transaction.user_id, appAccountToken: transaction.app_account_token };
    }
  }

  throw new ServiceUnavailableError('暂时无法把 Apple 通知关联到用户，等待客户端首次同步', {
    code: 'COMMERCE_NOTIFICATION_USER_UNRESOLVED',
  });
}

export async function processAppStoreNotification(
  rawInput: any,
  expectedEnvironment: CommerceNotificationEnvironment,
) {
  const signedPayload = requiredString(rawInput?.signedPayload, 'signedPayload');
  const environment = notificationEnvironment(expectedEnvironment);
  const notification = await verifyOrDecodeNotification(signedPayload, environment);
  const notificationType = String(notification.notificationType || 'UNKNOWN');
  const subtype = notification.subtype ? String(notification.subtype) : null;
  const notificationUUID = notification.notificationUUID || null;
  const actualEnvironment = notification.data?.environment
    ? String(notification.data.environment).toLowerCase()
    : null;

  if (actualEnvironment && actualEnvironment !== expectedEnvironment.toLowerCase()) {
    throw new ValidationError('Apple 通知环境与接收端点不一致');
  }

  if (notificationType === 'TEST') {
    return {
      accepted: true,
      ignored: true,
      notification_uuid: notificationUUID,
      notification_type: notificationType,
      subtype,
    };
  }

  if (notificationType === 'CONSUMPTION_REQUEST') {
    return {
      accepted: true,
      ignored: true,
      notification_uuid: notificationUUID,
      notification_type: notificationType,
      subtype,
      reason: 'consumption_request_requires_separate_refund_decision_flow',
    };
  }

  const signedTransactionInfo = notification.data?.signedTransactionInfo;
  if (!signedTransactionInfo) {
    return {
      accepted: true,
      ignored: true,
      notification_uuid: notificationUUID,
      notification_type: notificationType,
      subtype,
      reason: 'notification_has_no_transaction',
    };
  }

  const { payload: decoded, source } = await verifyOrDecodeTransaction(
    signedTransactionInfo,
    environment,
  );
  const renewalInfo = notification.data?.signedRenewalInfo
    ? await verifyOrDecodeRenewalInfo(notification.data.signedRenewalInfo, environment)
    : null;

  const identity = await resolveNotificationIdentity(decoded);
  const notificationContext = {
    signedDate: notification.signedDate || null,
    notificationUUID,
    notificationType,
    subtype,
  };
  const decodedWithAccountToken: DecodedTransaction = {
    ...decoded,
    appAccountToken: decoded.appAccountToken || identity.appAccountToken,
    notificationContext,
  };
  const input: CommerceTransactionSyncInput = {
    transaction_id: requiredString(decoded.transactionId, 'transactionId'),
    original_transaction_id: requiredString(decoded.originalTransactionId, 'originalTransactionId'),
    product_id: requiredString(decoded.productId, 'productId'),
    purchase_date: requiredString(toIsoFromMillis(decoded.purchaseDate), 'purchaseDate'),
    app_account_token: identity.appAccountToken,
    signed_transaction_info: signedTransactionInfo,
  };
  if (!isUuid(input.app_account_token)) {
    throw new ValidationError('Apple 通知中的 appAccountToken 必须是 UUID');
  }

  const delivery = await deliverCommerceTransaction(input, identity.userId, {
    decoded: decodedWithAccountToken,
    source: `apple_server_notification:${source}`,
    renewalInfo,
  });

  return {
    accepted: true,
    ignored: false,
    notification_uuid: notificationUUID,
    notification_type: notificationType,
    subtype,
    duplicate: delivery.duplicate,
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
    if (String(error?.message || '').includes('POINTS_REFUND_DEBT')) {
      throw new ValidationError('退款积分尚未结清，暂不能使用积分', { code: 'POINTS_REFUND_DEBT' });
    }
    throw error;
  }
}
