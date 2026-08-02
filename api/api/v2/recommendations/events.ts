/** POST /api/v2/recommendations/events — idempotent exposure/open feedback. */
import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../../src/utils/auth';
import {
  recordRecommendationEvent,
  RecordRecommendationEventInput,
} from '../../../src/services/recommendationService';
import { successResponse } from '../../../src/utils/response';
import {
  isPlainObject,
  isUuid,
  readRequiredString,
  sendCaughtError,
  sendError,
  setPrivateNoStoreHeaders,
} from './routeUtils';

const ALLOWED_POST_FIELDS = new Set([
  'event_id',
  'batch_id',
  'candidate_id',
  'event_type',
  'session_id',
]);
const SUPPORTED_METHODS = 'POST, OPTIONS';

export interface RecommendationEventRouteUser {
  id: string;
}

export interface RecommendationEventRouteDependencies {
  getCurrentUser: (req: VercelRequest) => Promise<RecommendationEventRouteUser>;
  recordRecommendationEvent: (
    userId: string,
    input: RecordRecommendationEventInput,
  ) => Promise<unknown>;
  createRequestId: () => string;
}

const defaultDependencies: RecommendationEventRouteDependencies = {
  getCurrentUser,
  recordRecommendationEvent,
  createRequestId: randomUUID,
};

function isEventResult(value: unknown): value is { accepted: boolean; duplicate: boolean } {
  return isPlainObject(value)
    && typeof value.accepted === 'boolean'
    && typeof value.duplicate === 'boolean';
}

export function createRecommendationEventsHandler(
  overrides: Partial<RecommendationEventRouteDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const requestId = dependencies.createRequestId();
    setPrivateNoStoreHeaders(res, requestId, SUPPORTED_METHODS);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') {
      return sendError(res, requestId, {
        statusCode: 405,
        code: 'METHOD_NOT_ALLOWED',
        message: '推荐行为接口只支持 POST 和 OPTIONS',
        cause: 'UNSUPPORTED_HTTP_METHOD',
        nextAction: 'USE_POST',
        retryable: false,
      });
    }
    try {
      const user = await dependencies.getCurrentUser(req);
      if (!isPlainObject(req.body)) {
        return sendError(res, requestId, {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: '请求体必须是 JSON 对象',
          cause: 'INVALID_JSON_BODY',
          nextAction: 'FIX_REQUEST',
          retryable: false,
        });
      }
      const unsupported = Object.keys(req.body)
        .filter((field) => !ALLOWED_POST_FIELDS.has(field));
      if (unsupported.length > 0) {
        return sendError(res, requestId, {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: `POST 不支持字段：${unsupported.join(', ')}`,
          cause: 'UNSUPPORTED_BODY_FIELD',
          nextAction: 'FIX_REQUEST',
          retryable: false,
        });
      }
      const eventId = readRequiredString(req.body.event_id);
      const batchId = readRequiredString(req.body.batch_id);
      const candidateId = readRequiredString(req.body.candidate_id);
      const sessionId = readRequiredString(req.body.session_id);
      const eventType = req.body.event_type;
      if (!eventId || !isUuid(eventId)) {
        return validation(res, requestId, 'event_id 必须是有效 UUID', 'INVALID_EVENT_ID');
      }
      if (!batchId || !isUuid(batchId)) {
        return validation(res, requestId, 'batch_id 必须是有效 UUID', 'INVALID_BATCH_ID');
      }
      if (!candidateId || candidateId.length > 128) {
        return validation(res, requestId, 'candidate_id 是必填字段且最长 128 个字符', 'INVALID_CANDIDATE_ID');
      }
      if (!sessionId || sessionId.length > 128) {
        return validation(res, requestId, 'session_id 是必填字段且最长 128 个字符', 'INVALID_SESSION_ID');
      }
      if (eventType !== 'exposure' && eventType !== 'open') {
        return validation(res, requestId, 'event_type 只能是 exposure 或 open', 'INVALID_EVENT_TYPE');
      }
      const result = await dependencies.recordRecommendationEvent(user.id, {
        event_id: eventId,
        batch_id: batchId,
        candidate_id: candidateId,
        event_type: eventType,
        session_id: sessionId,
      });
      if (!isEventResult(result)) {
        return sendError(res, requestId, {
          statusCode: 500,
          code: 'RECOMMENDATION_SERVICE_CONTRACT_INVALID',
          message: '推荐行为服务返回了无法读取的结果',
          cause: 'INVALID_SERVICE_RESULT',
          nextAction: 'RETRY_LATER',
          retryable: true,
        });
      }
      return res.status(200).json(successResponse({ ...result, request_id: requestId }));
    } catch (error) {
      return sendCaughtError(res, requestId, error, '服务器暂时无法记录推荐行为');
    }
  };
}

function validation(
  res: VercelResponse,
  requestId: string,
  message: string,
  cause: string,
) {
  return sendError(res, requestId, {
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message,
    cause,
    nextAction: 'FIX_REQUEST',
    retryable: false,
  });
}

export default createRecommendationEventsHandler();
