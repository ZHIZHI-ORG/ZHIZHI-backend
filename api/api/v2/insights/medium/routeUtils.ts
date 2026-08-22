import { VercelResponse } from '@vercel/node';
import { AppError, formatError } from '../../../../src/utils/errors';
import { MediumInsightServiceResult } from '../../../../src/services/mediumInsightService';
import { MediumInsightRepositoryError } from '../../../../src/database/repositories/MediumInsightRepository';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function setHeaders(res: VercelResponse, requestId: string, allow: string): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('Allow', allow);
}

export function sendServiceResult(res: VercelResponse, requestId: string, result: MediumInsightServiceResult) {
  if (result.status === 'unavailable') {
    const statusCode = result.cause === 'GENERATION_FAILED_FOR_DATE'
      || result.cause === 'FACT_REVISION_EXHAUSTED' ? 409
      : result.cause === 'FACTS_INCOMPLETE'
        || result.cause === 'STRUCTURE_FACTS_TOO_LARGE'
        || result.cause === 'FACT_SNAPSHOT_TOO_LARGE' ? 422
        : result.cause === 'GENERATION_BUSY' ? 429 : 503;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: result.cause,
        message: publicMessage(result.cause),
        retryable: result.retryable,
        ...(result.generation_id ? { generation_id: result.generation_id } : {}),
        ...(result.next_refresh_at ? { next_refresh_at: result.next_refresh_at } : {}),
      },
      request_id: requestId,
    });
  }
  return res.status(result.status === 'ready' ? 200 : 202).json({
    success: true,
    data: { ...result, request_id: requestId },
  });
}

export function sendValidation(res: VercelResponse, requestId: string, message: string, cause: string) {
  return res.status(400).json({
    success: false,
    error: { code: 'VALIDATION_ERROR', message, retryable: false, cause },
    request_id: requestId,
  });
}

export function sendCaught(res: VercelResponse, requestId: string, error: unknown) {
  if (error instanceof MediumInsightRepositoryError) {
    const statusCode = error.databaseCode === '42501' ? 404 : error.databaseCode === '40001' ? 409 : 503;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONCURRENT_UPDATE' : 'SERVICE_UNAVAILABLE',
        message: statusCode === 404 ? '中卡批次不存在' : '逐项理解暂时不可用',
        retryable: statusCode !== 404,
      },
      request_id: requestId,
    });
  }
  const formatted = formatError(error);
  const statusCode = formatted.statusCode;
  const message = error instanceof AppError ? formatted.body.error.message : '逐项理解暂时不可用';
  return res.status(statusCode).json({
    success: false,
    error: {
      code: formatted.body.error.code,
      message,
      retryable: statusCode >= 500,
    },
    request_id: requestId,
  });
}

function publicMessage(cause: string): string {
  if (cause === 'GENERATION_FAILED_FOR_DATE') return '今天的逐项理解暂时无法整理';
  if (cause === 'FACT_REVISION_EXHAUSTED') return '命盘今天再次变化，请在下一命理日查看';
  if (cause === 'FACTS_INCOMPLETE') return '这份命盘暂时无法生成逐项理解';
  if (cause === 'STRUCTURE_FACTS_TOO_LARGE' || cause === 'FACT_SNAPSHOT_TOO_LARGE') return '这份命盘的事实材料超出当前处理范围';
  if (cause === 'GENERATION_DISABLED' || cause === 'READ_ONLY_MISS') return '逐项理解暂未开放';
  return '逐项理解正在排队，请稍后重试';
}
