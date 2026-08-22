import assert from 'node:assert/strict';
import type { VercelRequest, VercelResponse } from '@vercel/node';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const { createMediumInsightDailyHandler } = require('../api/v2/insights/medium/daily') as typeof import('../api/v2/insights/medium/daily');
const { createMediumInsightEventsHandler } = require('../api/v2/insights/medium/events') as typeof import('../api/v2/insights/medium/events');

const profileId = '00000000-0000-4000-8000-000000000002';
const batchId = '00000000-0000-4000-8000-000000000003';
const eventId = '00000000-0000-4000-8000-000000000004';

interface MockResponse extends VercelResponse {
  statusCode: number;
  headers: Record<string, string>;
  payload: any;
}

function request(method: string, body: unknown = undefined, query: Record<string, unknown> = {}): VercelRequest {
  return { method, body, query, headers: {} } as unknown as VercelRequest;
}

function response(): MockResponse {
  const result: any = {
    statusCode: 200, headers: {}, payload: undefined,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(key: string, value: string | number | readonly string[]) { this.headers[key] = Array.isArray(value) ? value.join(', ') : String(value); return this; },
    getHeader(key: string) { return this.headers[key]; },
    json(value: unknown) { this.payload = structuredClone(value); return this; },
    send(value: unknown) { this.payload = value; return this; },
  };
  return result as MockResponse;
}

async function run(name: string, test: () => Promise<void>): Promise<void> {
  try { await test(); console.log(`✓ ${name}`); } catch (error) { console.error(`✗ ${name}`); throw error; }
}

async function main() {
  await run('POST accepts only profile and IANA timezone and returns 202 pending', async () => {
    let received: any;
    const handler = createMediumInsightDailyHandler({
      authenticate: async () => ({ id: 'user-1' } as any), requestId: () => 'request-1',
      resolve: async (userId, input) => { received = { userId, input }; return { status: 'generating', generation_id: batchId, effective_date: '2026-08-13', next_action: 'poll', retry_after_ms: 1500 }; },
    });
    const res = response();
    await handler(request('POST', { bazi_profile_id: profileId, timezone: 'Asia/Hong_Kong' }), res);
    assert.equal(res.statusCode, 202);
    assert.deepEqual(received, { userId: 'user-1', input: { bazi_profile_id: profileId, timezone: 'Asia/Hong_Kong' } });
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  });

  await run('POST rejects client-controlled topic and generation fields', async () => {
    let calls = 0;
    const handler = createMediumInsightDailyHandler({
      authenticate: async () => ({ id: 'user-1' } as any), requestId: () => 'request-2',
      resolve: async () => { calls += 1; return { status: 'unavailable', cause: 'NO', retryable: false }; },
    });
    const res = response();
    await handler(request('POST', { bazi_profile_id: profileId, timezone: 'Asia/Hong_Kong', domain: 'career' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(calls, 0);
  });

  await run('GET polls one UUID generation and maps a stale batch safely', async () => {
    const handler = createMediumInsightDailyHandler({
      authenticate: async () => ({ id: 'user-1' } as any), requestId: () => 'request-3',
      poll: async () => ({ status: 'unavailable', cause: 'STALE_GENERATION', retryable: true, generation_id: batchId }),
    });
    const res = response();
    await handler(request('GET', undefined, { generation_id: batchId }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.error.code, 'STALE_GENERATION');
  });

  await run('OPTIONS never authenticates', async () => {
    let authCalls = 0;
    const handler = createMediumInsightDailyHandler({ authenticate: async () => { authCalls += 1; throw new Error('no'); } });
    const res = response();
    await handler(request('OPTIONS'), res);
    assert.equal(res.statusCode, 204);
    assert.equal(authCalls, 0);
  });

  await run('events forward idempotent exposure identity and reject unknown fields', async () => {
    let received: any;
    const handler = createMediumInsightEventsHandler({
      authenticate: async () => ({ id: 'user-1' } as any), requestId: () => 'request-4',
      record: async (userId, input) => { received = { userId, input }; return { accepted: true, duplicate: false }; },
    });
    const res = response();
    await handler(request('POST', {
      event_id: eventId, profile_id: profileId, batch_id: batchId,
      content_id: '00000000-0000-4000-8000-000000000005', event_type: 'exposure',
      session_id: 'session-1', occurred_at: '2026-08-13T12:00:00.000Z',
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(received.userId, 'user-1');
    assert.equal(received.input.event_type, 'exposure');

    const bad = response();
    await handler(request('POST', { event_id: eventId, profile_id: profileId, score: 99 }), bad);
    assert.equal(bad.statusCode, 400);
  });
}

void main();
