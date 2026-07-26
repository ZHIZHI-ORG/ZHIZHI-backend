import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { DailyFortuneRouteDependencies } from '../api/v2/fortune/daily';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';

const { createDailyFortuneHandler } = require('../api/v2/fortune/daily') as typeof import('../api/v2/fortune/daily');
const { ServiceUnavailableError } = require('../src/utils/errors') as typeof import('../src/utils/errors');

interface MockResponse extends VercelResponse {
  statusCode: number;
  headers: Record<string, string>;
  payload: unknown;
}

function makeRequest(input: {
  method: string;
  query?: Record<string, unknown>;
  body?: unknown;
}): VercelRequest {
  return {
    method: input.method,
    query: input.query || {},
    body: input.body,
    headers: {},
  } as unknown as VercelRequest;
}

function makeResponse(): MockResponse {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(key: string, value: string | number | readonly string[]) {
      this.headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
      return this;
    },
    getHeader(key: string) {
      return this.headers[key];
    },
    json(data: unknown) {
      this.payload = data === undefined
        ? undefined
        : JSON.parse(JSON.stringify(data));
      return this;
    },
    send(data: unknown) {
      this.payload = data === undefined
        ? undefined
        : JSON.parse(JSON.stringify(data));
      return this;
    },
  };
  return response as unknown as MockResponse;
}

function makeDependencies(
  overrides: Partial<DailyFortuneRouteDependencies> = {},
): DailyFortuneRouteDependencies {
  return {
    getCurrentUser: async () => ({ id: 'user-1' }),
    resolveDailyFortune: async () => ({
      status: 'ready',
      generation_id: 'generation-1',
      artifact_id: 'artifact-1',
    }),
    getDailyFortuneGeneration: async () => ({
      status: 'generating',
      generation_id: 'generation-1',
    }),
    createRequestId: () => 'request-test-1',
    ...overrides,
  };
}

async function run(
  name: string,
  test: () => void | Promise<void>,
): Promise<void> {
  try {
    await test();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

async function main(): Promise<void> {
  await run('POST resolves or generates and forwards only server-owned request_id', async () => {
    let receivedUserId = '';
    let receivedInput: unknown;
    const handler = createDailyFortuneHandler(makeDependencies({
      resolveDailyFortune: async (userId, input) => {
        receivedUserId = userId;
        receivedInput = input;
        return {
          status: 'ready',
          generation_id: 'generation-1',
          artifact_id: 'artifact-1',
          request_id: 'service-must-not-win',
        };
      },
    }));
    const response = makeResponse();

    await handler(makeRequest({
      method: 'POST',
      body: {
        bazi_profile_id: 'profile-1',
        timezone: 'Asia/Hong_Kong',
      },
    }), response);

    assert.equal(response.statusCode, 200);
    assert.equal(receivedUserId, 'user-1');
    assert.deepEqual(receivedInput, {
      bazi_profile_id: 'profile-1',
      timezone: 'Asia/Hong_Kong',
      request_id: 'request-test-1',
    });
    assert.deepEqual(response.payload, {
      success: true,
      data: {
        status: 'ready',
        generation_id: 'generation-1',
        artifact_id: 'artifact-1',
        request_id: 'request-test-1',
      },
    });
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.equal(response.headers['X-Request-ID'], 'request-test-1');
  });

  await run('GET only polls generation and never calls resolve/claim path', async () => {
    let resolveCalls = 0;
    let pollCalls = 0;
    const handler = createDailyFortuneHandler(makeDependencies({
      resolveDailyFortune: async () => {
        resolveCalls += 1;
        throw new Error('GET must not reach resolve');
      },
      getDailyFortuneGeneration: async (userId, generationId, requestId) => {
        pollCalls += 1;
        assert.equal(userId, 'user-1');
        assert.equal(generationId, 'generation-1');
        assert.equal(requestId, 'request-test-1');
        return { status: 'generating', generation_id: generationId };
      },
    }));
    const response = makeResponse();

    await handler(makeRequest({
      method: 'GET',
      query: { generation_id: 'generation-1' },
    }), response);

    assert.equal(response.statusCode, 202);
    assert.equal(resolveCalls, 0);
    assert.equal(pollCalls, 1);
    assert.deepEqual(response.payload, {
      success: true,
      data: {
        status: 'generating',
        generation_id: 'generation-1',
        request_id: 'request-test-1',
      },
    });
  });

  await run('GET requires generation_id before polling', async () => {
    let pollCalls = 0;
    const handler = createDailyFortuneHandler(makeDependencies({
      getDailyFortuneGeneration: async () => {
        pollCalls += 1;
        return { status: 'generating' };
      },
    }));
    const response = makeResponse();

    await handler(makeRequest({ method: 'GET' }), response);

    assert.equal(response.statusCode, 400);
    assert.equal(pollCalls, 0);
    assert.deepEqual(response.payload, {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'generation_id 是必填参数',
        details: {
          cause: 'GENERATION_ID_REQUIRED',
          next_action: 'FIX_REQUEST',
          retryable: false,
          request_id: 'request-test-1',
        },
      },
    });
  });

  await run('GET missing is a normal 200 state', async () => {
    const handler = createDailyFortuneHandler(makeDependencies({
      getDailyFortuneGeneration: async () => ({
        status: 'missing',
        generation_id: 'generation-1',
      }),
    }));
    const response = makeResponse();

    await handler(makeRequest({
      method: 'GET',
      query: { generation_id: 'generation-1' },
    }), response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, {
      success: true,
      data: {
        status: 'missing',
        generation_id: 'generation-1',
        request_id: 'request-test-1',
      },
    });
  });

  await run('POST rejects client-owned request_id and unsupported fields', async () => {
    let resolveCalls = 0;
    const handler = createDailyFortuneHandler(makeDependencies({
      resolveDailyFortune: async () => {
        resolveCalls += 1;
        return { status: 'ready' };
      },
    }));
    const response = makeResponse();

    await handler(makeRequest({
      method: 'POST',
      body: {
        bazi_profile_id: 'profile-1',
        timezone: 'Asia/Hong_Kong',
        request_id: 'client-value',
      },
    }), response);

    assert.equal(response.statusCode, 400);
    assert.equal(resolveCalls, 0);
    assert.deepEqual(response.payload, {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'POST 不支持字段：request_id',
        details: {
          cause: 'UNSUPPORTED_BODY_FIELD',
          next_action: 'FIX_REQUEST',
          retryable: false,
          request_id: 'request-test-1',
        },
      },
    });
  });

  await run('OPTIONS is unauthenticated and advertises the complete method contract', async () => {
    let authCalls = 0;
    const handler = createDailyFortuneHandler(makeDependencies({
      getCurrentUser: async () => {
        authCalls += 1;
        return { id: 'user-1' };
      },
    }));
    const response = makeResponse();

    await handler(makeRequest({ method: 'OPTIONS' }), response);

    assert.equal(response.statusCode, 204);
    assert.equal(response.payload, '');
    assert.equal(authCalls, 0);
    assert.equal(response.headers.Allow, 'GET, POST, OPTIONS');
  });

  await run('unsupported methods return 405 with Allow and stable error envelope', async () => {
    const handler = createDailyFortuneHandler(makeDependencies());
    const response = makeResponse();

    await handler(makeRequest({ method: 'DELETE' }), response);

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.Allow, 'GET, POST, OPTIONS');
    assert.deepEqual(response.payload, {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: '该日运接口只支持 GET、POST 和 OPTIONS',
        details: {
          cause: 'UNSUPPORTED_HTTP_METHOD',
          next_action: 'USE_GET_OR_POST',
          retryable: false,
          request_id: 'request-test-1',
        },
      },
    });
  });

  await run('known service errors preserve actionable cause and next action', async () => {
    const handler = createDailyFortuneHandler(makeDependencies({
      resolveDailyFortune: async () => {
        throw new ServiceUnavailableError('AI 暂时不可用', {
          cause: 'AI_PROVIDER_TIMEOUT',
          next_action: 'RETRY_POST_LATER',
          retryable: true,
        });
      },
    }));
    const response = makeResponse();

    await handler(makeRequest({
      method: 'POST',
      body: {
        bazi_profile_id: 'profile-1',
        timezone: 'Asia/Hong_Kong',
      },
    }), response);

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.payload, {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'AI 暂时不可用',
        details: {
          cause: 'AI_PROVIDER_TIMEOUT',
          next_action: 'RETRY_POST_LATER',
          retryable: true,
          request_id: 'request-test-1',
        },
      },
    });
  });

  await run('route is registered in both Vercel and local adapters', () => {
    const apiRoot = path.resolve(__dirname, '..');
    const vercelAdapter = fs.readFileSync(path.join(apiRoot, 'api', '[...path].ts'), 'utf8');
    const localAdapter = fs.readFileSync(path.join(apiRoot, 'server.ts'), 'utf8');

    for (const source of [vercelAdapter, localAdapter]) {
      assert.match(source, /fortuneDailyV2Handler/);
      assert.match(source, /'\/api\/v2\/fortune\/daily': fortuneDailyV2Handler/);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
