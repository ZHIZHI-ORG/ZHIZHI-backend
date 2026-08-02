import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { RecommendationNextRouteDependencies } from '../api/v2/recommendations/next';
import type { RecommendationEventRouteDependencies } from '../api/v2/recommendations/events';
import type { RecommendationBatchRouteDependencies } from '../api/v2/recommendations/[batchId]';
import type { RecommendationEventRequest } from '../src/models/Recommendation';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const { createRecommendationNextHandler } = require('../api/v2/recommendations/next') as typeof import('../api/v2/recommendations/next');
const { createRecommendationEventsHandler } = require('../api/v2/recommendations/events') as typeof import('../api/v2/recommendations/events');
const { createRecommendationBatchHandler } = require('../api/v2/recommendations/[batchId]') as typeof import('../api/v2/recommendations/[batchId]');
const { ServiceUnavailableError } = require('../src/utils/errors') as typeof import('../src/utils/errors');

const profileId = '00000000-0000-4000-8000-000000000002';
const batchId = '00000000-0000-4000-8000-000000000003';
const eventId = '00000000-0000-4000-8000-000000000004';

interface MockResponse extends VercelResponse {
  statusCode: number;
  headers: Record<string, string>;
  payload: unknown;
}

function makeRequest(input: {
  method: string;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
}): VercelRequest {
  return {
    method: input.method,
    body: input.body,
    query: input.query || {},
    params: input.params,
    headers: {},
  } as unknown as VercelRequest;
}

function makeResponse(): MockResponse {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    payload: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(key: string, value: string | number | readonly string[]) {
      this.headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
      return this;
    },
    getHeader(key: string) { return this.headers[key]; },
    json(value: unknown) { this.payload = JSON.parse(JSON.stringify(value)); return this; },
    send(value: unknown) { this.payload = value; return this; },
  };
  return response as unknown as MockResponse;
}

function run(name: string, test: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(test).then(() => console.log(`✓ ${name}`)).catch((error) => {
    console.error(`✗ ${name}`);
    throw error;
  });
}

function nextDependencies(
  overrides: Partial<RecommendationNextRouteDependencies> = {},
): RecommendationNextRouteDependencies {
  return {
    getCurrentUser: async () => ({ id: 'user-1' }),
    resolveRecommendations: async () => ({ status: 'ready', generation_id: batchId, batch: { batch_id: batchId } }),
    createRequestId: () => 'request-test-1',
    ...overrides,
  };
}

function eventDependencies(
  overrides: Partial<RecommendationEventRouteDependencies> = {},
): RecommendationEventRouteDependencies {
  return {
    getCurrentUser: async () => ({ id: 'user-1' }),
    recordRecommendationEvent: async () => ({ accepted: true, duplicate: false }),
    createRequestId: () => 'request-test-2',
    ...overrides,
  };
}

function batchDependencies(
  overrides: Partial<RecommendationBatchRouteDependencies> = {},
): RecommendationBatchRouteDependencies {
  return {
    getCurrentUser: async () => ({ id: 'user-1' }),
    getRecommendationBatch: async () => ({ status: 'ready', generation_id: batchId, batch: { batch_id: batchId } }),
    createRequestId: () => 'request-test-3',
    ...overrides,
  };
}

async function main(): Promise<void> {
  await run('共享行为请求合同包含服务端必填的 session_id', () => {
    const request: RecommendationEventRequest = {
      event_id: eventId,
      batch_id: batchId,
      candidate_id: 'candidate-1',
      event_type: 'open',
      session_id: 'session-current',
    };
    assert.equal(request.session_id, 'session-current');
  });

  await run('next 只转发生成所需的身份、时区、会话和前批次，不接收客户端标签', async () => {
    let receivedUser = '';
    let receivedInput: unknown;
    const handler = createRecommendationNextHandler(nextDependencies({
      resolveRecommendations: async (userId, input) => {
        receivedUser = userId;
        receivedInput = input;
        return { status: 'generating', generation_id: batchId, retry_after_ms: 900 };
      },
    }));
    const response = makeResponse();
    await handler(makeRequest({
      method: 'POST',
      body: {
        bazi_profile_id: profileId,
        timezone: 'Asia/Hong_Kong',
        session_id: 'session-current',
        after_batch_id: null,
      },
    }), response);
    assert.equal(response.statusCode, 202);
    assert.equal(receivedUser, 'user-1');
    assert.deepEqual(receivedInput, {
      bazi_profile_id: profileId,
      timezone: 'Asia/Hong_Kong',
      session_id: 'session-current',
      after_batch_id: null,
      request_id: 'request-test-1',
    });
    assert.deepEqual(response.payload, {
      success: true,
      data: {
        status: 'generating',
        generation_id: batchId,
        retry_after_ms: 900,
        request_id: 'request-test-1',
      },
    });
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
  });

  await run('next 拒绝客户端伪造的 domain、score 或 request_id', async () => {
    let calls = 0;
    const handler = createRecommendationNextHandler(nextDependencies({
      resolveRecommendations: async () => { calls += 1; return { status: 'ready' }; },
    }));
    const response = makeResponse();
    await handler(makeRequest({
      method: 'POST',
      body: {
        bazi_profile_id: profileId,
        timezone: 'Asia/Hong_Kong',
        session_id: 'session-current',
        domain: 'love',
        rank_score: 100,
        request_id: 'client-must-not-control',
      },
    }), response);
    assert.equal(response.statusCode, 400);
    assert.equal(calls, 0);
    assert.equal((response.payload as any).error.details.cause, 'UNSUPPORTED_BODY_FIELD');
  });

  await run('unavailable 给客户端明确回退旧知识页的信号', async () => {
    const handler = createRecommendationNextHandler(nextDependencies({
      resolveRecommendations: async () => ({ status: 'unavailable', cause: 'GENERATION_DISABLED' }),
    }));
    const response = makeResponse();
    await handler(makeRequest({
      method: 'POST',
      body: { bazi_profile_id: profileId, timezone: 'Asia/Hong_Kong', session_id: 'session-current' },
    }), response);
    assert.equal(response.statusCode, 503);
    assert.deepEqual((response.payload as any).error.details, {
      cause: 'GENERATION_DISABLED',
      next_action: 'FALLBACK_TO_INSIGHTS',
      retryable: false,
      request_id: 'request-test-1',
    });
  });

  await run('events 只把行为的五个客户端字段交给服务，标签由服务端从冻结卡片反查', async () => {
    let receivedUser = '';
    let receivedInput: unknown;
    const handler = createRecommendationEventsHandler(eventDependencies({
      recordRecommendationEvent: async (userId, input) => {
        receivedUser = userId;
        receivedInput = input;
        return { accepted: true, duplicate: true };
      },
    }));
    const response = makeResponse();
    await handler(makeRequest({
      method: 'POST',
      body: {
        event_id: eventId,
        batch_id: batchId,
        candidate_id: 'candidate-1',
        event_type: 'open',
        session_id: 'session-current',
      },
    }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(receivedUser, 'user-1');
    assert.deepEqual(receivedInput, {
      event_id: eventId,
      batch_id: batchId,
      candidate_id: 'candidate-1',
      event_type: 'open',
      session_id: 'session-current',
    });
    assert.deepEqual(response.payload, {
      success: true,
      data: { accepted: true, duplicate: true, request_id: 'request-test-2' },
    });
  });

  await run('batch GET 只读轮询，不会调用 next/claim，并正确读取动态 batchId', async () => {
    let reads = 0;
    const handler = createRecommendationBatchHandler(batchDependencies({
      getRecommendationBatch: async (userId, id) => {
        reads += 1;
        assert.equal(userId, 'user-1');
        assert.equal(id, batchId);
        return { status: 'retry_wait', generation_id: id, retry_after_ms: 1_000 };
      },
    }));
    const response = makeResponse();
    await handler(makeRequest({ method: 'GET', params: { batchId } }), response);
    assert.equal(reads, 1);
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.payload, {
      success: true,
      data: {
        status: 'retry_wait',
        generation_id: batchId,
        retry_after_ms: 1_000,
        request_id: 'request-test-3',
      },
    });
  });

  await run('OPTIONS 不要求登录，服务异常保留可执行错误信息', async () => {
    let authCalls = 0;
    const next = createRecommendationNextHandler(nextDependencies({
      getCurrentUser: async () => { authCalls += 1; return { id: 'user-1' }; },
    }));
    const options = makeResponse();
    await next(makeRequest({ method: 'OPTIONS' }), options);
    assert.equal(options.statusCode, 204);
    assert.equal(authCalls, 0);
    assert.equal(options.headers.Allow, 'POST, OPTIONS');

    const eventHandler = createRecommendationEventsHandler(eventDependencies({
      recordRecommendationEvent: async () => {
        throw new ServiceUnavailableError('存储暂时不可用', {
          cause: 'DATABASE_UNAVAILABLE', next_action: 'RETRY_LATER', retryable: true,
        });
      },
    }));
    const failed = makeResponse();
    await eventHandler(makeRequest({
      method: 'POST',
      body: { event_id: eventId, batch_id: batchId, candidate_id: 'candidate-1', event_type: 'exposure', session_id: 's' },
    }), failed);
    assert.equal(failed.statusCode, 503);
    assert.equal((failed.payload as any).error.details.cause, 'DATABASE_UNAVAILABLE');
  });

  await run('三个 endpoint 都注册在 Vercel catch-all 和本地 adapter', () => {
    const apiRoot = path.resolve(__dirname, '..');
    const vercel = fs.readFileSync(path.join(apiRoot, 'api', '[...path].ts'), 'utf8');
    const local = fs.readFileSync(path.join(apiRoot, 'server.ts'), 'utf8');
    for (const source of [vercel, local]) {
      assert.match(source, /recommendationNextHandler/);
      assert.match(source, /recommendationEventsHandler/);
      assert.match(source, /recommendationBatchHandler/);
      assert.match(source, /'\/api\/v2\/recommendations\/next': recommendationNextHandler/);
      assert.match(source, /'\/api\/v2\/recommendations\/events': recommendationEventsHandler/);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
