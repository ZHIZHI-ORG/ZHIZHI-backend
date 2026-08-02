import { VercelResponse } from '@vercel/node';
import { AppError, ErrorCode, formatError } from '../../../src/utils/errors';

export interface RouteErrorOptions {
  statusCode: number;
  code: string;
  message: string;
  cause: string;
  nextAction: string;
  retryable: boolean;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function sendError(
  res: VercelResponse,
  requestId: string,
  options: RouteErrorOptions,
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

export function nextActionForStatus(statusCode: number): string {
  if (statusCode === 400) return 'FIX_REQUEST';
  if (statusCode === 401) return 'AUTHENTICATE';
  if (statusCode === 403) return 'USE_OWN_PROFILE';
  if (statusCode === 404) return 'VERIFY_RESOURCE';
  return 'RETRY_LATER';
}

export function sendCaughtError(
  res: VercelResponse,
  requestId: string,
  error: unknown,
  fallbackMessage: string,
) {
  const formatted = formatError(error);
  const isKnownError = error instanceof AppError;
  const details = isKnownError && isPlainObject(error.details) ? error.details : {};
  const statusCode = formatted.statusCode;
  return sendError(res, requestId, {
    statusCode,
    code: formatted.body.error.code || ErrorCode.INTERNAL_SERVER_ERROR,
    message: isKnownError ? formatted.body.error.message : fallbackMessage,
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

export function setPrivateNoStoreHeaders(
  res: VercelResponse,
  requestId: string,
  allow: string,
): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('Allow', allow);
}
