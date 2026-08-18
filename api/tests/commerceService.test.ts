import 'dotenv/config';
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const commerceService = require('../src/services/commerceService');
const { commerceRepository } = require('../src/database/repositories/CommerceRepository');

type AsyncFn = (...args: any[]) => Promise<any>;

const originalMethods: Record<string, AsyncFn> = {
  findAccountByUser: commerceRepository.findAccountByUser.bind(commerceRepository),
  upsertAccountToken: commerceRepository.upsertAccountToken.bind(commerceRepository),
  getLatestMembership: commerceRepository.getLatestMembership.bind(commerceRepository),
  getPointsBalance: commerceRepository.getPointsBalance.bind(commerceRepository),
  processTransaction: commerceRepository.processTransaction.bind(commerceRepository),
  applyPointsDelta: commerceRepository.applyPointsDelta.bind(commerceRepository),
  listPointsLedger: commerceRepository.listPointsLedger.bind(commerceRepository),
};

function restoreRepository() {
  for (const [name, fn] of Object.entries(originalMethods)) {
    commerceRepository[name] = fn;
  }
}

function fakeJws(payload: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

function transactionPayload(overrides: Record<string, any> = {}) {
  return {
    transactionId: 'tx-1',
    originalTransactionId: 'tx-1',
    productId: 'com.zhizhi.points.small',
    appAccountToken: '11111111-1111-4111-8111-111111111111',
    purchaseDate: Date.parse('2026-05-03T00:00:00.000Z'),
    environment: 'Xcode',
    ...overrides,
  };
}

function syncInput(payload: Record<string, any>) {
  return {
    transaction_id: payload.transactionId,
    original_transaction_id: payload.originalTransactionId,
    product_id: payload.productId,
    purchase_date: '1999-01-01T00:00:00.000Z',
    app_account_token: payload.appAccountToken,
    signed_transaction_info: fakeJws(payload),
  };
}

async function run(name: string, fn: () => Promise<void>) {
  try {
    restoreRepository();
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  } finally {
    restoreRepository();
  }
}

async function main() {
  await run('status returns a stable server app account token and zero points', async () => {
    commerceRepository.findAccountByUser = async () => null;
    commerceRepository.upsertAccountToken = async (userId: string, token: string) => ({
      user_id: userId,
      app_account_token: token,
      created_at: '2026-05-03T00:00:00.000Z',
      updated_at: '2026-05-03T00:00:00.000Z',
    });
    commerceRepository.getLatestMembership = async () => null;
    commerceRepository.getPointsBalance = async () => ({ balance: 0, updated_at: null });

    const status = await commerceService.getCommerceStatus('user-1');

    assert.equal(status.membership, null);
    assert.equal(status.points.balance, 0);
    assert.match(status.store.app_account_token, /^[0-9a-f-]{36}$/i);
    assert.equal(status.store.purchases_enabled, false);
  });

  await run('purchase activation is an explicit server-side switch', async () => {
    const previous = process.env.COMMERCE_PURCHASES_ENABLED;
    process.env.COMMERCE_PURCHASES_ENABLED = 'true';
    commerceRepository.findAccountByUser = async () => ({
      user_id: 'user-1',
      app_account_token: '11111111-1111-4111-8111-111111111111',
      created_at: '2026-05-03T00:00:00.000Z',
      updated_at: '2026-05-03T00:00:00.000Z',
    });
    commerceRepository.getLatestMembership = async () => null;
    commerceRepository.getPointsBalance = async () => ({ balance: 0, updated_at: null });

    try {
      const status = await commerceService.getCommerceStatus('user-1');
      assert.equal(status.store.purchases_enabled, true);
    } finally {
      if (previous === undefined) delete process.env.COMMERCE_PURCHASES_ENABLED;
      else process.env.COMMERCE_PURCHASES_ENABLED = previous;
    }
  });

  await run('verified points purchase uses signed purchase date and one atomic repository call', async () => {
    const payload = transactionPayload({ transactionId: 'tx-points-1', originalTransactionId: 'tx-points-1' });
    let received: any = null;
    commerceRepository.processTransaction = async (input: any) => {
      received = input;
      return {
        duplicate: false,
        membership: null,
        points: { id: 'ledger-1', delta: 60, balance_after: 60 },
      };
    };

    const result = await commerceService.syncCommerceTransaction('user-1', syncInput(payload));

    assert.equal(result.accepted, true);
    assert.equal(result.duplicate, false);
    assert.equal(result.points.delta, 60);
    assert.equal(received.purchase_date, '2026-05-03T00:00:00.000Z');
    assert.equal(received.points_delta, 60);
    assert.equal(received.verification_source, 'decoded_jws_unverified');
  });

  await run('duplicate points purchase returns current balance without delivering twice', async () => {
    const payload = transactionPayload({ transactionId: 'tx-existing', originalTransactionId: 'tx-existing' });
    commerceRepository.processTransaction = async () => ({
      duplicate: true,
      membership: null,
      points: { id: 'ledger-existing', delta: 60, balance_after: 60 },
    });

    const result = await commerceService.syncCommerceTransaction('user-1', syncInput(payload));

    assert.equal(result.duplicate, true);
    assert.equal(result.points.delta, null);
    assert.equal(result.points.balance, 60);
  });

  await run('membership purchase updates entitlement through the atomic repository path', async () => {
    const expiresDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const payload = transactionPayload({
      transactionId: 'tx-membership-1',
      originalTransactionId: 'tx-membership-1',
      productId: 'com.zhizhi.membership.monthly',
      expiresDate,
    });
    let received: any = null;
    commerceRepository.processTransaction = async (input: any) => {
      received = input;
      return {
        duplicate: false,
        membership: {
          status: input.membership_status,
          tier: input.membership_tier,
          product_id: input.product_id,
          original_transaction_id: input.original_transaction_id,
          expires_at: input.expires_at,
          environment: input.environment,
          will_auto_renew: false,
          grace_period_expires_at: null,
        },
        points: null,
      };
    };

    const result = await commerceService.syncCommerceTransaction('user-1', syncInput(payload));

    assert.equal(result.membership.status, 'active');
    assert.equal(result.membership.tier, 'monthly');
    assert.equal(received.points_delta, null);
    assert.equal(received.membership_status, 'active');
  });

  await run('revoked consumable produces an idempotent negative points delivery', async () => {
    const payload = transactionPayload({
      transactionId: 'tx-refund-1',
      originalTransactionId: 'tx-refund-1',
      revocationDate: Date.parse('2026-05-04T00:00:00.000Z'),
    });
    let received: any = null;
    commerceRepository.processTransaction = async (input: any) => {
      received = input;
      return {
        duplicate: true,
        membership: null,
        points: { id: 'ledger-refund', delta: -60, balance_after: 0 },
      };
    };

    const result = await commerceService.syncCommerceTransaction('user-1', syncInput(payload));

    assert.equal(received.points_delta, -60);
    assert.equal(result.points.delta, -60);
    assert.equal(result.points.balance, 0);
  });

  await run('transaction identity fields are required before any entitlement write', async () => {
    const signedPayload = transactionPayload({ appAccountToken: undefined });
    const inputPayload = {
      ...signedPayload,
      appAccountToken: '11111111-1111-4111-8111-111111111111',
    };
    const input = syncInput(inputPayload);
    input.signed_transaction_info = fakeJws(signedPayload);
    commerceRepository.processTransaction = async () => {
      throw new Error('must not be called');
    };

    await assert.rejects(
      commerceService.syncCommerceTransaction('user-1', input),
      /signed_transaction_info 缺少 appAccountToken/,
    );
  });

  await run('production fails closed when Apple verification is not configured', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousRoots = process.env.APPLE_IAP_ROOT_CERTIFICATES_BASE64;
    const previousBundle = process.env.APPLE_IAP_BUNDLE_ID;
    process.env.NODE_ENV = 'production';
    delete process.env.APPLE_IAP_ROOT_CERTIFICATES_BASE64;
    delete process.env.APPLE_IAP_BUNDLE_ID;

    try {
      await assert.rejects(
        commerceService.syncCommerceTransaction('user-1', syncInput(transactionPayload())),
        /缺少 Apple IAP 服务端校验配置/,
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousRoots === undefined) delete process.env.APPLE_IAP_ROOT_CERTIFICATES_BASE64;
      else process.env.APPLE_IAP_ROOT_CERTIFICATES_BASE64 = previousRoots;
      if (previousBundle === undefined) delete process.env.APPLE_IAP_BUNDLE_ID;
      else process.env.APPLE_IAP_BUNDLE_ID = previousBundle;
    }
  });

  await run('commerce migration makes delivery atomic and closes public RPC execution', async () => {
    const migrationPath = path.resolve(__dirname, '../../supabase/migrations/020_commerce_transaction_atomicity.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');

    assert.match(migration, /CREATE OR REPLACE FUNCTION process_commerce_transaction/);
    assert.match(migration, /REVOKE ALL ON FUNCTION apply_commerce_points_delta/);
    assert.match(migration, /FROM PUBLIC, anon, authenticated/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION process_commerce_transaction[\s\S]*TO service_role/);
  });

  await run('consume points validates positive amount and maps balance', async () => {
    commerceRepository.applyPointsDelta = async (input: any) => ({
      id: 'ledger-consume-1',
      user_id: input.userId,
      type: 'consume',
      delta: input.delta,
      balance_after: 20,
      source: input.source,
      source_id: input.sourceId,
      idempotency_key: input.idempotencyKey,
      metadata: {},
      created_at: '2026-05-03T00:00:00.000Z',
    });

    const result = await commerceService.consumeCommercePoints('user-1', {
      amount: 10,
      reason: 'drilldown',
      idempotency_key: 'consume-1',
    });

    assert.equal(result.consumed, true);
    assert.equal(result.balance, 20);
    assert.equal(result.ledger_entry_id, 'ledger-consume-1');
  });

  console.log('Commerce service tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
