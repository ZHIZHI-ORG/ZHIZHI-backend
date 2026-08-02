/** GET /api/v2/recommendations/:batch_id — read-only polling and replay. */
import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../../src/utils/auth';
import { getRecommendationBatch } from '../../../src/services/recommendationService';
import { successResponse } from '../../../src/utils/response';
import {
  isPlainObject,
  isUuid,
  readRequiredString,
  sendCaughtError,
  sendError,
  setPrivateNoStoreHeaders,
} from './routeUtils';

const SUPPORTED_METHODS = 'GET, OPTIONS';

export interface RecommendationBatchRouteUser {
  id: string;
}

export interface RecommendationBatchRouteDependencies {
  getCurrentUser: (req: VercelRequest) => Promise<RecommendationBatchRouteUser>;
  getRecommendationBatch: (userId: string, batchId: string) => Promise<unknown>;
  createRequestId: () => string;
}

interface RecommendationBatchServiceResult {
  status: 'ready' | 'generating' | 'retry_wait' | 'missing';
  [key: string]: unknown;
}

const defaultDependencies: RecommendationBatchRouteDependencies = {
  getCurrentUser,
  getRecommendationBatch,
  createRequestId: randomUUID,
};

function normalizeServiceResult(value: unknown): RecommendationBatchServiceResult | null {
  if (!isPlainObject(value)) return null;
  if (
    value.status !== 'ready'
    && value.status !== 'generating'
    && value.status !== 'retry_wait'
    && value.status !== 'missing'
  ) {
    return null;
  }
  return value as RecommendationBatchServiceResult;
}

export function createRecommendationBatchHandler(
  overrides: Partial<RecommendationBatchRouteDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const requestId = dependencies.createRequestId();
    setPrivateNoStoreHeaders(res, requestId, SUPPORTED_METHODS);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'GET') {
      return sendError(res, requestId, {
        statusCode: 405,
        code: 'METHOD_NOT_ALLOWED',
        message: '推荐批次接口只支持 GET 和 OPTIONS',
        cause: 'UNSUPPORTED_HTTP_METHOD',
        nextAction: 'USE_GET',
        retryable: false,
      });
    }
    try {
      const user = await dependencies.getCurrentUser(req);
      const params = isPlainObject((req as VercelRequest & { params?: unknown }).params)
        ? (req as VercelRequest & { params?: Record<string, unknown> }).params || {}
        : {};
      const query = isPlainObject(req.query) ? req.query : {};
      const batchId = readRequiredString(params.batchId ?? query.batchId);
      if (!batchId || !isUuid(batchId)) {
        return sendError(res, requestId, {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'batch_id 必须是有效 UUID',
          cause: 'INVALID_BATCH_ID',
          nextAction: 'FIX_REQUEST',
          retryable: false,
        });
      }
      const result = normalizeServiceResult(
        await dependencies.getRecommendationBatch(user.id, batchId),
      );
      if (!result) {
        return sendError(res, requestId, {
          statusCode: 500,
          code: 'RECOMMENDATION_SERVICE_CONTRACT_INVALID',
          message: '推荐批次服务返回了无法读取的结果',
          cause: 'INVALID_SERVICE_RESULT',
          nextAction: 'RETRY_LATER',
          retryable: true,
        });
      }
      const { request_id: _serviceRequestId, ...publicResult } = result;
      return res.status(
        result.status === 'generating' || result.status === 'retry_wait' ? 202 : 200,
      ).json(successResponse({ ...publicResult, request_id: requestId }));
    } catch (error) {
      return sendCaughtError(res, requestId, error, '服务器暂时无法读取推荐批次');
    }
  };
}

export default createRecommendationBatchHandler();
