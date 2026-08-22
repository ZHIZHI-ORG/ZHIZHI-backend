import assert from 'node:assert/strict';
import type { VercelRequest, VercelResponse } from '@vercel/node';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const { createInsightDetailsHandler } = require('../api/v2/insights/details') as typeof import('../api/v2/insights/details');
const { createInsightFollowUpsHandler } = require('../api/v2/insights/follow-ups') as typeof import('../api/v2/insights/follow-ups');
const { InsightCardContentRepositoryError } = require('../src/database/repositories/InsightCardContentRepository') as typeof import('../src/database/repositories/InsightCardContentRepository');

const batchId = '00000000-0000-4000-8000-000000000001';
const detailId = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003';

interface MockResponse extends VercelResponse {
  statusCode: number;
  headers: Record<string, string>;
  payload: any;
}

function request(method: string, body?: unknown, query: Record<string, unknown> = {}): VercelRequest {
  return { method, body, query, headers: {} } as unknown as VercelRequest;
}

function response(): MockResponse {
  const result: any = {
    statusCode: 200, headers: {}, payload: undefined,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(key: string, value: string | number | readonly string[]) {
      this.headers[key] = Array.isArray(value) ? value.join(', ') : String(value); return this;
    },
    getHeader(key: string) { return this.headers[key]; },
    json(value: unknown) { this.payload = structuredClone(value); return this; },
    send(value: unknown) { this.payload = value; return this; },
  };
  return result as MockResponse;
}

async function main() {
  let detailInput: unknown;
  const details = createInsightDetailsHandler({
    authenticate: async () => ({ id: 'user-1' } as any),
    requestId: () => 'route-request-1',
    resolve: async (userId, input) => {
      detailInput = { userId, input };
      return { status: 'generating', generation_id: detailId, next_action: 'poll', retry_after_ms: 1_500 };
    },
  });
  const detailResponse = response();
  await details(request('POST', {
    source_type: 'medium', source_batch_id: batchId, source_item_id: 'card-1',
  }), detailResponse);
  assert.equal(detailResponse.statusCode, 202);
  assert.deepEqual(detailInput, {
    userId: 'user-1',
    input: { source_type: 'medium', source_batch_id: batchId, source_item_id: 'card-1' },
  });
  assert.equal(detailResponse.headers['Cache-Control'], 'private, no-store');

  let unsupportedCalls = 0;
  const rejectingDetails = createInsightDetailsHandler({
    authenticate: async () => ({ id: 'user-1' } as any),
    resolve: async () => { unsupportedCalls += 1; return { status: 'unavailable', cause: 'NO', retryable: false }; },
  });
  const unsupported = response();
  await rejectingDetails(request('POST', {
    source_type: 'large', source_batch_id: batchId, source_item_id: 'card-1', category: 'legacy',
  }), unsupported);
  assert.equal(unsupported.statusCode, 400);
  assert.equal(unsupportedCalls, 0);

  for (const limit of [
    {
      databaseCode: 'P4291', code: 'DETAIL_DAILY_LIMIT',
      message: '今天可生成的新详情已用完，明天可以继续', retryable: false,
    },
    {
      databaseCode: 'P4292', code: 'DETAIL_ACTIVE_LIMIT',
      message: '当前正在生成的详情较多，请稍后再试', retryable: true,
    },
  ]) {
    const limitedDetails = createInsightDetailsHandler({
      authenticate: async () => ({ id: 'user-1' } as any),
      resolve: async () => {
        throw new InsightCardContentRepositoryError('claimDetail', 'limit', limit.databaseCode);
      },
    });
    const limitedDetailResponse = response();
    await limitedDetails(request('POST', {
      source_type: 'medium', source_batch_id: batchId, source_item_id: 'card-1',
    }), limitedDetailResponse);
    assert.equal(limitedDetailResponse.statusCode, 429);
    assert.equal(limitedDetailResponse.payload.error.code, limit.code);
    assert.equal(limitedDetailResponse.payload.error.message, limit.message);
    assert.equal(limitedDetailResponse.payload.error.retryable, limit.retryable);
  }

  let followInput: unknown;
  const followUps = createInsightFollowUpsHandler({
    authenticate: async () => ({ id: 'user-1' } as any),
    requestId: () => 'route-request-2',
    resolve: async (userId, input) => {
      followInput = { userId, input };
      return { status: 'retry_wait', generation_id: requestId, next_action: 'resume_post', retry_after_ms: 15_000 };
    },
  });
  const followResponse = response();
  await followUps(request('POST', {
    detail_id: detailId, client_request_id: requestId,
    question: '  我应该观察哪些现实信号？  ',
  }), followResponse);
  assert.equal(followResponse.statusCode, 202);
  assert.deepEqual(followInput, {
    userId: 'user-1',
    input: { detail_id: detailId, client_request_id: requestId, question: '我应该观察哪些现实信号？' },
  });

  const conflict = createInsightFollowUpsHandler({
    authenticate: async () => ({ id: 'user-1' } as any),
    resolve: async () => { throw new InsightCardContentRepositoryError('claimFollowUp', 'conflict', '23505'); },
  });
  const conflictResponse = response();
  await conflict(request('POST', {
    detail_id: detailId, client_request_id: requestId, question: '不同问题',
  }), conflictResponse);
  assert.equal(conflictResponse.statusCode, 409);
  assert.equal(conflictResponse.payload.error.code, 'IDEMPOTENCY_CONFLICT');

  const limited = createInsightFollowUpsHandler({
    authenticate: async () => ({ id: 'user-1' } as any),
    resolve: async () => { throw new InsightCardContentRepositoryError('claimFollowUp', 'limit', 'P4290'); },
  });
  const limitedResponse = response();
  await limited(request('POST', {
    detail_id: detailId, client_request_id: requestId, question: '第二十一个新问题',
  }), limitedResponse);
  assert.equal(limitedResponse.statusCode, 429);
  assert.equal(limitedResponse.payload.error.code, 'FOLLOW_UP_DAILY_LIMIT');
  assert.equal(limitedResponse.payload.error.message, '今天的追问次数已用完，明天可以继续');
  assert.equal(limitedResponse.payload.error.retryable, false);

  let authCalls = 0;
  const options = createInsightFollowUpsHandler({
    authenticate: async () => { authCalls += 1; throw new Error('must not authenticate'); },
  });
  const optionsResponse = response();
  await options(request('OPTIONS'), optionsResponse);
  assert.equal(optionsResponse.statusCode, 204);
  assert.equal(authCalls, 0);

  console.log('✓ insight content routes enforce source-card contracts, idempotency conflicts, and polling statuses');
}

void main();
