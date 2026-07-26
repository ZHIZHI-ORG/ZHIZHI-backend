/**
 * 首页日运 V2
 *
 * POST /api/v2/fortune/daily
 *   Resolve the current daily-fortune identity and, when needed, claim and
 *   generate its single artifact.
 *
 * GET /api/v2/fortune/daily?generation_id=...
 *   Read-only polling for an existing generation. GET must never claim work or
 *   call the AI provider.
 */
import { randomUUID } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../../src/utils/auth';
import {
  getDailyFortuneGeneration,
  resolveDailyFortune,
} from '../../../src/services/dailyFortuneService';
import { AppError, ErrorCode, formatError } from '../../../src/utils/errors';
import { successResponse } from '../../../src/utils/response';

const ALLOWED_POST_FIELDS = new Set(['bazi_profile_id', 'timezone']);
const ALLOWED_GET_FIELDS = new Set(['generation_id']);
const SUPPORTED_METHODS = 'GET, POST, OPTIONS';

export interface DailyFortuneRouteUser {
  id: string;
}

export interface ResolveDailyFortuneRouteInput {
  bazi_profile_id: string;
  timezone: string;
  request_id: string;
}

export interface DailyFortuneRouteDependencies {
  getCurrentUser: (req: VercelRequest) => Promise<DailyFortuneRouteUser>;
  resolveDailyFortune: (
    userId: string,
    input: ResolveDailyFortuneRouteInput,
  ) => Promise<unknown>;
  getDailyFortuneGeneration: (
    userId: string,
    generationId: string,
    requestId: string,
  ) => Promise<unknown>;
  createRequestId: () => string;
}

interface ErrorResponseOptions {
  statusCode: number;
  code: string;
  message: string;
  cause: string;
  nextAction: string;
  retryable: boolean;
}

interface DailyFortuneServiceResult {
  status: 'ready' | 'generating' | 'missing' | 'unavailable';
  [key: string]: unknown;
}

const defaultDependencies: DailyFortuneRouteDependencies = {
  getCurrentUser,
  resolveDailyFortune,
  getDailyFortuneGeneration,
  createRequestId: randomUUID,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeServiceResult(value: unknown): DailyFortuneServiceResult | null {
  if (!isPlainObject(value)) return null;
  if (
    value.status !== 'ready'
    && value.status !== 'generating'
    && value.status !== 'missing'
    && value.status !== 'unavailable'
  ) {
    return null;
  }
  return value as DailyFortuneServiceResult;
}

function sendError(
  res: VercelResponse,
  requestId: string,
  options: ErrorResponseOptions,
) {
  return res.status(options.statusCode).json({
    success: false,
    error: {
      code: options.code,
      message: options.message,
      details: {
        cause: options.cause,
        next_action: options.nextAction,
        retryable: options.retryable,
        request_id: requestId,
      },
    },
  });
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
      code: 'DAILY_FORTUNE_SERVICE_CONTRACT_INVALID',
      message: '日运服务返回了无法读取的结果',
      cause: 'INVALID_SERVICE_RESULT',
      nextAction: 'RETRY_LATER',
      retryable: true,
    });
  }

  if (result.status === 'unavailable') {
    return sendError(res, requestId, {
      statusCode: 503,
      code: 'DAILY_FORTUNE_UNAVAILABLE',
      message: typeof result.message === 'string' ? result.message : '今日日运尚未生成',
      cause: typeof result.cause === 'string' ? result.cause : 'GENERATION_FAILED',
      nextAction: typeof result.next_action === 'string'
        ? result.next_action
        : 'RETRY_POST_LATER',
      retryable: typeof result.retryable === 'boolean' ? result.retryable : true,
    });
  }

  const {
    httpStatus: _httpStatus,
    message: _message,
    cause: _cause,
    next_action: _nextAction,
    retryable: _retryable,
    request_id: _serviceRequestId,
    ...publicResult
  } = result;
  const statusCode = result.status === 'generating' ? 202 : 200;

  return res.status(statusCode).json(successResponse({
    ...publicResult,
    request_id: requestId,
  }));
}

function nextActionForStatus(statusCode: number): string {
  if (statusCode === 400) return 'FIX_REQUEST';
  if (statusCode === 401) return 'AUTHENTICATE';
  if (statusCode === 403) return 'USE_OWN_PROFILE';
  if (statusCode === 404) return 'VERIFY_RESOURCE';
  return 'RETRY_LATER';
}

function sendCaughtError(
  res: VercelResponse,
  requestId: string,
  error: unknown,
) {
  const formatted = formatError(error);
  const isKnownError = error instanceof AppError;
  const details = isKnownError && isPlainObject(error.details) ? error.details : {};
  const statusCode = formatted.statusCode;

  return sendError(res, requestId, {
    statusCode,
    code: formatted.body.error.code || ErrorCode.INTERNAL_SERVER_ERROR,
    message: isKnownError
      ? formatted.body.error.message
      : '服务器暂时无法处理日运请求',
    cause: typeof details.cause === 'string'
      ? details.cause
      : (isKnownError ? formatted.body.error.code : 'UNEXPECTED_ERROR'),
    nextAction: typeof details.next_action === 'string'
      ? details.next_action
      : nextActionForStatus(statusCode),
    retryable: typeof details.retryable === 'boolean'
      ? details.retryable
      : statusCode >= 500,
  });
}

export function createDailyFortuneHandler(
  overrides: Partial<DailyFortuneRouteDependencies> = {},
) {
  const dependencies: DailyFortuneRouteDependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  return async function handler(req: VercelRequest, res: VercelResponse) {
    const requestId = dependencies.createRequestId();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('Allow', SUPPORTED_METHODS);

    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      return sendError(res, requestId, {
        statusCode: 405,
        code: 'METHOD_NOT_ALLOWED',
        message: '该日运接口只支持 GET、POST 和 OPTIONS',
        cause: 'UNSUPPORTED_HTTP_METHOD',
        nextAction: 'USE_GET_OR_POST',
        retryable: false,
      });
    }

    try {
      const user = await dependencies.getCurrentUser(req);

      if (req.method === 'GET') {
        const query = isPlainObject(req.query) ? req.query : {};
        const unsupportedFields = Object.keys(query)
          .filter((field) => !ALLOWED_GET_FIELDS.has(field));
        if (unsupportedFields.length > 0) {
          return sendError(res, requestId, {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: `GET 不支持参数：${unsupportedFields.join(', ')}`,
            cause: 'UNSUPPORTED_QUERY_FIELD',
            nextAction: 'FIX_REQUEST',
            retryable: false,
          });
        }

        const generationId = readRequiredString(query.generation_id);
        if (!generationId) {
          return sendError(res, requestId, {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'generation_id 是必填参数',
            cause: 'GENERATION_ID_REQUIRED',
            nextAction: 'FIX_REQUEST',
            retryable: false,
          });
        }

        const result = await dependencies.getDailyFortuneGeneration(
          user.id,
          generationId,
          requestId,
        );
        return sendServiceResult(res, requestId, result);
      }

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

      const unsupportedFields = Object.keys(req.body)
        .filter((field) => !ALLOWED_POST_FIELDS.has(field));
      if (unsupportedFields.length > 0) {
        return sendError(res, requestId, {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: `POST 不支持字段：${unsupportedFields.join(', ')}`,
          cause: 'UNSUPPORTED_BODY_FIELD',
          nextAction: 'FIX_REQUEST',
          retryable: false,
        });
      }

      const baziProfileId = readRequiredString(req.body.bazi_profile_id);
      if (!baziProfileId) {
        return sendError(res, requestId, {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'bazi_profile_id 是必填字段',
          cause: 'BAZI_PROFILE_ID_REQUIRED',
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

      const result = await dependencies.resolveDailyFortune(user.id, {
        bazi_profile_id: baziProfileId,
        timezone,
        request_id: requestId,
      });
      return sendServiceResult(res, requestId, result);
    } catch (error) {
      return sendCaughtError(res, requestId, error);
    }
  };
}

export default createDailyFortuneHandler();
