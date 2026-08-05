/**
 * POST /api/v2/recommendations/next
 *
 * Claims the current root or successor slot. Only the worker that owns the
 * lease calls Gemini; callers joining an in-flight batch get 202 and poll its
 * immutable result through GET /api/v2/recommendations/:batch_id.
 */
import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../../src/utils/auth';
import {
  resolveRecommendations,
  ResolveRecommendationsInput,
} from '../../../src/services/recommendationService';
import { successResponse } from '../../../src/utils/response';
import {
  isPlainObject,
  isUuid,
  isValidTimeZone,
  readRequiredString,
  sendCaughtError,
  sendError,
  setPrivateNoStoreHeaders,
} from './routeUtils';

// Gemini is allowed up to 100 seconds by the AI contract. Keep the route's
// serverless ceiling above that so a valid first batch is not cut off early.
export const config = { maxDuration: 120 };

const ALLOWED_POST_FIELDS = new Set([
  'bazi_profile_id',
  'timezone',
  'session_id',
  'after_batch_id',
]);
const SUPPORTED_METHODS = 'POST, OPTIONS';

export interface RecommendationNextRouteUser {
  id: string;
}

export interface RecommendationNextRouteDependencies {
  getCurrentUser: (req: VercelRequest) => Promise<RecommendationNextRouteUser>;
  resolveRecommendations: (
    userId: string,
    input: ResolveRecommendationsInput,
  ) => Promise<unknown>;
  createRequestId: () => string;
}

interface RecommendationNextServiceResult {
  status: 'ready' | 'generating' | 'retry_wait' | 'unavailable';
  [key: string]: unknown;
}

const defaultDependencies: RecommendationNextRouteDependencies = {
  getCurrentUser,
  resolveRecommendations,
  createRequestId: randomUUID,
};

function normalizeServiceResult(value: unknown): RecommendationNextServiceResult | null {
  if (!isPlainObject(value)) return null;
  if (
    value.status !== 'ready'
    && value.status !== 'generating'
    && value.status !== 'retry_wait'
    && value.status !== 'unavailable'
  ) {
    return null;
  }
  return value as RecommendationNextServiceResult;
}

function sendServiceResult(
  res: VercelResponse,
  requestId: string,
  rawResult: unknown,
) {
  const result = normalizeServiceResult(rawResult);
  if (!result) {
    return sendError(res, requestId, {
      statusCode: 500,
      code: 'RECOMMENDATION_SERVICE_CONTRACT_INVALID',
      message: '推荐服务返回了无法读取的结果',
      cause: 'INVALID_SERVICE_RESULT',
      nextAction: 'RETRY_LATER',
      retryable: true,
    });
  }
  if (result.status === 'unavailable') {
    return sendError(res, requestId, {
      statusCode: 503,
      code: 'RECOMMENDATIONS_UNAVAILABLE',
      message: '推荐卡片暂时不可用，请稍后重试',
      cause: typeof result.cause === 'string' ? result.cause : 'GENERATION_FAILED',
      nextAction: 'SHOW_UNAVAILABLE',
      retryable: typeof result.retryable === 'boolean'
        ? result.retryable
        : result.cause !== 'GENERATION_DISABLED',
    });
  }

  const { request_id: _serviceRequestId, ...publicResult } = result;
  return res.status(
    result.status === 'generating' || result.status === 'retry_wait' ? 202 : 200,
  ).json(successResponse({
    ...publicResult,
    request_id: requestId,
  }));
}

export function createRecommendationNextHandler(
  overrides: Partial<RecommendationNextRouteDependencies> = {},
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
        message: '该推荐接口只支持 POST 和 OPTIONS',
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
      const baziProfileId = readRequiredString(req.body.bazi_profile_id);
      if (!baziProfileId || !isUuid(baziProfileId)) {
        return sendError(res, requestId, {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'bazi_profile_id 必须是有效 UUID',
          cause: 'INVALID_BAZI_PROFILE_ID',
          nextAction: 'FIX_REQUEST',
          retryable: false,
        });
      }
      const timezone = readRequiredString(req.body.timezone);
      if (!timezone || !isValidTimeZone(timezone)) {
        return sendError(res, requestId, {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'timezone 必须是有效的 IANA 时区',
          cause: 'INVALID_TIMEZONE',
          nextAction: 'FIX_REQUEST',
          retryable: false,
        });
      }
      const sessionId = readRequiredString(req.body.session_id);
      if (!sessionId || sessionId.length > 128) {
        return sendError(res, requestId, {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'session_id 是必填字段且最长 128 个字符',
          cause: 'INVALID_SESSION_ID',
          nextAction: 'FIX_REQUEST',
          retryable: false,
        });
      }
      const afterBatchRaw = req.body.after_batch_id;
      const afterBatchId = afterBatchRaw === undefined || afterBatchRaw === null
        ? null
        : readRequiredString(afterBatchRaw);
      if (afterBatchRaw !== undefined && afterBatchRaw !== null && (!afterBatchId || !isUuid(afterBatchId))) {
        return sendError(res, requestId, {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'after_batch_id 必须是 UUID 或 null',
          cause: 'INVALID_AFTER_BATCH_ID',
          nextAction: 'FIX_REQUEST',
          retryable: false,
        });
      }
      return sendServiceResult(res, requestId, await dependencies.resolveRecommendations(user.id, {
        bazi_profile_id: baziProfileId,
        timezone,
        session_id: sessionId,
        after_batch_id: afterBatchId,
        request_id: requestId,
      }));
    } catch (error) {
      return sendCaughtError(res, requestId, error, '服务器暂时无法生成推荐卡片');
    }
  };
}

export default createRecommendationNextHandler();
