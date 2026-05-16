import 'dotenv/config';
import assert from 'assert';

const commerceService = require('../src/services/commerceService');
const { commerceRepository } = require('../src/database/repositories/CommerceRepository');

type AsyncFn = (...args: any[]) => Promise<any>;

const originalMethods: Record<string, AsyncFn> = {
  findAccountByUser: commerceRepository.findAccountByUser.bind(commerceRepository),
  upsertAccountToken: commerceRepository.upsertAccountToken.bind(commerceRepository),
  findTransactionById: commerceRepository.findTransactionById.bind(commerceRepository),
  createTransaction: commerceRepository.createTransaction.bind(commerceRepository),
  getLatestMembership: commerceRepository.getLatestMembership.bind(commerceRepository),
  upsertMembership: commerceRepository.upsertMembership.bind(commerceRepository),
  getPointsBalance: commerceRepository.getPointsBalance.bind(commerceRepository),
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
  });

  await run('points transaction is accepted once and returns ledger delta', async () => {
    const token = '11111111-1111-4111-8111-111111111111';
    const transactionId = 'tx-points-1';
    commerceRepository.findTransactionById = async () => null;
    commerceRepository.upsertAccountToken = async (userId: string) => ({
      user_id: userId,
      app_account_token: token,
      created_at: '2026-05-03T00:00:00.000Z',
      updated_at: '2026-05-03T00:00:00.000Z',
    });
    commerceRepository.createTransaction = async (input: any) => ({
      ...input,
      processed_at: '2026-05-03T00:00:00.000Z',
      created_at: '2026-05-03T00:00:00.000Z',
    });
    commerceRepository.applyPointsDelta = async (input: any) => ({
      id: 'ledger-1',
      user_id: input.userId,
      type: 'purchase',
      delta: input.delta,
      balance_after: input.delta,
      source: input.source,
      source_id: input.sourceId,
      idempotency_key: input.idempotencyKey,
      metadata: {},
      created_at: '2026-05-03T00:00:00.000Z',
    });

    const result = await commerceService.syncCommerceTransaction('user-1', {
      transaction_id: transactionId,
      original_transaction_id: transactionId,
      product_id: 'com.zhizhi.points.small',
      purchase_date: '2026-05-03T00:00:00.000Z',
      app_account_token: token,
      signed_transaction_info: fakeJws({
        transactionId,
        originalTransactionId: transactionId,
        productId: 'com.zhizhi.points.small',
        appAccountToken: token,
        environment: 'Xcode',
      }),
    });

    assert.equal(result.accepted, true);
    assert.equal(result.duplicate, false);
    assert.equal(result.points.delta, 60);
    assert.equal(result.points.balance, 60);
  });

  await run('duplicate transaction does not deliver points again', async () => {
    const token = '11111111-1111-4111-8111-111111111111';
    commerceRepository.findTransactionById = async () => ({ transaction_id: 'tx-existing' });
    commerceRepository.upsertAccountToken = async (userId: string) => ({
      user_id: userId,
      app_account_token: token,
      created_at: '2026-05-03T00:00:00.000Z',
      updated_at: '2026-05-03T00:00:00.000Z',
    });
    commerceRepository.getLatestMembership = async () => null;
    commerceRepository.getPointsBalance = async () => ({ balance: 60, updated_at: '2026-05-03T00:00:00.000Z' });

    const result = await commerceService.syncCommerceTransaction('user-1', {
      transaction_id: 'tx-existing',
      original_transaction_id: 'tx-existing',
      product_id: 'com.zhizhi.points.small',
      purchase_date: '2026-05-03T00:00:00.000Z',
      app_account_token: token,
      signed_transaction_info: fakeJws({
        transactionId: 'tx-existing',
        productId: 'com.zhizhi.points.small',
      }),
    });

    assert.equal(result.duplicate, true);
    assert.equal(result.points.delta, null);
    assert.equal(result.points.balance, 60);
  });

  await run('membership transaction updates server entitlement', async () => {
    const token = '11111111-1111-4111-8111-111111111111';
    const transactionId = 'tx-membership-1';
    const expiresDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
    commerceRepository.findTransactionById = async () => null;
    commerceRepository.upsertAccountToken = async (userId: string) => ({
      user_id: userId,
      app_account_token: token,
      created_at: '2026-05-03T00:00:00.000Z',
      updated_at: '2026-05-03T00:00:00.000Z',
    });
    commerceRepository.createTransaction = async (input: any) => ({
      ...input,
      processed_at: '2026-05-03T00:00:00.000Z',
      created_at: '2026-05-03T00:00:00.000Z',
    });
    commerceRepository.upsertMembership = async (input: any) => ({
      ...input,
      created_at: '2026-05-03T00:00:00.000Z',
      updated_at: '2026-05-03T00:00:00.000Z',
    });

    const result = await commerceService.syncCommerceTransaction('user-1', {
      transaction_id: transactionId,
      original_transaction_id: transactionId,
      product_id: 'com.zhizhi.membership.monthly',
      purchase_date: '2026-05-03T00:00:00.000Z',
      app_account_token: token,
      signed_transaction_info: fakeJws({
        transactionId,
        originalTransactionId: transactionId,
        productId: 'com.zhizhi.membership.monthly',
        appAccountToken: token,
        expiresDate,
        environment: 'Xcode',
      }),
    });

    assert.equal(result.membership.status, 'active');
    assert.equal(result.membership.tier, 'monthly');
    assert.equal(result.points, null);
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
