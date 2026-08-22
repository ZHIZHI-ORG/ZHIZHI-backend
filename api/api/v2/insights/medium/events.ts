import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../../../src/utils/auth';
import { MEDIUM_INSIGHT_EVENT_TYPES, MediumInsightEventRequest } from '../../../../src/models/MediumInsight';
import { recordMediumInsightEvent } from '../../../../src/services/mediumInsightService';
import { isRecord, isUuid, sendCaught, sendValidation, setHeaders } from './routeUtils';

const FIELDS = new Set(['event_id', 'profile_id', 'batch_id', 'content_id', 'event_type', 'session_id', 'client_wait_ms', 'occurred_at']);

interface EventRouteDependencies {
  authenticate: typeof getCurrentUser;
  record: typeof recordMediumInsightEvent;
  requestId: () => string;
}

const defaults: EventRouteDependencies = {
  authenticate: getCurrentUser,
  record: recordMediumInsightEvent,
  requestId: randomUUID,
};

export function createMediumInsightEventsHandler(overrides: Partial<EventRouteDependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const requestId = dependencies.requestId();
  setHeaders(res, requestId, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 POST 和 OPTIONS' }, request_id: requestId });
  try {
    const user = await dependencies.authenticate(req);
    if (!isRecord(req.body)) return sendValidation(res, requestId, '请求体必须是 JSON 对象', 'INVALID_JSON_BODY');
    const unsupported = Object.keys(req.body).filter((key) => !FIELDS.has(key));
    if (unsupported.length) return sendValidation(res, requestId, `不支持字段：${unsupported.join(', ')}`, 'UNSUPPORTED_BODY_FIELD');
    const string = (key: string) => typeof req.body[key] === 'string' ? (req.body[key] as string).trim() : '';
    const input: MediumInsightEventRequest = {
      event_id: string('event_id'),
      profile_id: string('profile_id'),
      event_type: string('event_type') as MediumInsightEventRequest['event_type'],
      session_id: string('session_id'),
      occurred_at: string('occurred_at'),
      ...(string('batch_id') ? { batch_id: string('batch_id') } : {}),
      ...(string('content_id') ? { content_id: string('content_id') } : {}),
      ...(typeof req.body.client_wait_ms === 'number' ? { client_wait_ms: req.body.client_wait_ms } : {}),
    };
    if (!isUuid(input.event_id) || !isUuid(input.profile_id)) return sendValidation(res, requestId, 'event_id 和 profile_id 必须是 UUID', 'INVALID_ID');
    if (!MEDIUM_INSIGHT_EVENT_TYPES.includes(input.event_type as never)) return sendValidation(res, requestId, 'event_type 无效', 'INVALID_EVENT_TYPE');
    const result = await dependencies.record(user.id, input);
    return res.status(200).json({ success: true, data: { ...result, request_id: requestId } });
  } catch (error) {
    return sendCaught(res, requestId, error);
  }
  };
}

export default createMediumInsightEventsHandler();
