import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { ResolveInsightFollowUpRequest } from '../../../src/models/InsightCardContent';
import { pollInsightCardFollowUp, resolveInsightCardFollowUp } from '../../../src/services/insightCardContentService';
import { getCurrentUser } from '../../../src/utils/auth';
import {
  isRecord, isUuid, sendContentCaught, sendContentResult, sendContentValidation, setContentHeaders,
} from './contentRouteUtils';

export const config = { maxDuration: 120 };
const POST_FIELDS = new Set(['detail_id', 'client_request_id', 'question', 'parent_follow_up_id']);

interface Dependencies {
  authenticate: typeof getCurrentUser;
  resolve: typeof resolveInsightCardFollowUp;
  poll: typeof pollInsightCardFollowUp;
  requestId: () => string;
}

const defaults: Dependencies = {
  authenticate: getCurrentUser,
  resolve: resolveInsightCardFollowUp,
  poll: pollInsightCardFollowUp,
  requestId: randomUUID,
};

export function createInsightFollowUpsHandler(overrides: Partial<Dependencies> = {}) {
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
      const parent = string(req.body.parent_follow_up_id);
      const input: ResolveInsightFollowUpRequest = {
        detail_id: string(req.body.detail_id),
        client_request_id: string(req.body.client_request_id),
        question: string(req.body.question),
        ...(parent ? { parent_follow_up_id: parent } : {}),
      };
      if (!isUuid(input.detail_id) || !isUuid(input.client_request_id)
        || (input.parent_follow_up_id && !isUuid(input.parent_follow_up_id))) {
        return sendContentValidation(res, requestId, '详情、请求或父追问ID无效', 'INVALID_ID');
      }
      if (!input.question) return sendContentValidation(res, requestId, 'question 不能为空', 'INVALID_QUESTION');
      return sendContentResult(res, requestId, await dependencies.resolve(user.id, input));
    } catch (error) {
      return sendContentCaught(res, requestId, error);
    }
  };
}

export default createInsightFollowUpsHandler();

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
