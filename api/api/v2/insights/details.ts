import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { INSIGHT_SOURCE_TYPES, ResolveInsightDetailRequest } from '../../../src/models/InsightCardContent';
import { pollInsightCardDetail, resolveInsightCardDetail } from '../../../src/services/insightCardContentService';
import { getCurrentUser } from '../../../src/utils/auth';
import {
  isRecord, isUuid, sendContentCaught, sendContentResult, sendContentValidation, setContentHeaders,
} from './contentRouteUtils';

export const config = { maxDuration: 120 };
const POST_FIELDS = new Set(['source_type', 'source_batch_id', 'source_item_id']);

interface Dependencies {
  authenticate: typeof getCurrentUser;
  resolve: typeof resolveInsightCardDetail;
  poll: typeof pollInsightCardDetail;
  requestId: () => string;
}

const defaults: Dependencies = {
  authenticate: getCurrentUser,
  resolve: resolveInsightCardDetail,
  poll: pollInsightCardDetail,
  requestId: randomUUID,
};

export function createInsightDetailsHandler(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const requestId = dependencies.requestId();
    setContentHeaders(res, requestId, 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持GET、POST和OPTIONS' }, request_id: requestId });
    }
    try {
      const user = await dependencies.authenticate(req);
      if (req.method === 'GET') {
        const generationId = string(req.query.generation_id);
        if (!generationId || !isUuid(generationId)) {
          return sendContentValidation(res, requestId, 'generation_id 必须是 UUID', 'INVALID_GENERATION_ID');
        }
        return sendContentResult(res, requestId, await dependencies.poll(user.id, generationId));
      }
      if (!isRecord(req.body)) return sendContentValidation(res, requestId, '请求体必须是JSON对象', 'INVALID_JSON_BODY');
      const unsupported = Object.keys(req.body).filter((key) => !POST_FIELDS.has(key));
      if (unsupported.length) return sendContentValidation(res, requestId, `不支持字段：${unsupported.join(', ')}`, 'UNSUPPORTED_BODY_FIELD');
      const input: ResolveInsightDetailRequest = {
        source_type: string(req.body.source_type) as ResolveInsightDetailRequest['source_type'],
        source_batch_id: string(req.body.source_batch_id),
        source_item_id: string(req.body.source_item_id),
      };
      if (!INSIGHT_SOURCE_TYPES.includes(input.source_type as never)) return sendContentValidation(res, requestId, 'source_type 无效', 'INVALID_SOURCE_TYPE');
      if (!isUuid(input.source_batch_id) || !input.source_item_id) return sendContentValidation(res, requestId, '源批次或源卡ID无效', 'INVALID_SOURCE_ID');
      return sendContentResult(res, requestId, await dependencies.resolve(user.id, input));
    } catch (error) {
      return sendContentCaught(res, requestId, error);
    }
  };
}

export default createInsightDetailsHandler();

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
