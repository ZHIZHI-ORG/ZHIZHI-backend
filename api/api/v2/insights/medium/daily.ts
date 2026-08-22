import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../../../src/utils/auth';
import {
  pollMediumInsightDaily,
  resolveMediumInsightDaily,
} from '../../../../src/services/mediumInsightService';
import { isRecord, isTimeZone, isUuid, sendCaught, sendServiceResult, sendValidation, setHeaders } from './routeUtils';

export const config = { maxDuration: 120 };
const POST_FIELDS = new Set(['bazi_profile_id', 'timezone']);

interface DailyRouteDependencies {
  authenticate: typeof getCurrentUser;
  resolve: typeof resolveMediumInsightDaily;
  poll: typeof pollMediumInsightDaily;
  requestId: () => string;
}

const defaults: DailyRouteDependencies = {
  authenticate: getCurrentUser,
  resolve: resolveMediumInsightDaily,
  poll: pollMediumInsightDaily,
  requestId: randomUUID,
};

export function createMediumInsightDailyHandler(overrides: Partial<DailyRouteDependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const requestId = dependencies.requestId();
  setHeaders(res, requestId, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 GET、POST 和 OPTIONS' }, request_id: requestId });
  }
  try {
    const user = await dependencies.authenticate(req);
    if (req.method === 'GET') {
      const generationId = singleString(req.query.generation_id);
      if (!generationId || !isUuid(generationId)) return sendValidation(res, requestId, 'generation_id 必须是 UUID', 'INVALID_GENERATION_ID');
      return sendServiceResult(res, requestId, await dependencies.poll(user.id, generationId));
    }
    if (!isRecord(req.body)) return sendValidation(res, requestId, '请求体必须是 JSON 对象', 'INVALID_JSON_BODY');
    const unsupported = Object.keys(req.body).filter((key) => !POST_FIELDS.has(key));
    if (unsupported.length) return sendValidation(res, requestId, `不支持字段：${unsupported.join(', ')}`, 'UNSUPPORTED_BODY_FIELD');
    const profileId = singleString(req.body.bazi_profile_id);
    const timezone = singleString(req.body.timezone);
    if (!profileId || !isUuid(profileId)) return sendValidation(res, requestId, 'bazi_profile_id 必须是 UUID', 'INVALID_PROFILE_ID');
    if (!timezone || !isTimeZone(timezone)) return sendValidation(res, requestId, 'timezone 必须是 IANA 时区', 'INVALID_TIMEZONE');
    return sendServiceResult(res, requestId, await dependencies.resolve(user.id, {
      bazi_profile_id: profileId,
      timezone,
    }));
  } catch (error) {
    return sendCaught(res, requestId, error);
  }
  };
}

export default createMediumInsightDailyHandler();

function singleString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
