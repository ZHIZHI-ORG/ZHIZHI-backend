import { VercelResponse } from '@vercel/node';
import { InsightCardContentRepositoryError } from '../../../src/database/repositories/InsightCardContentRepository';
import { InsightDetailServiceResult, InsightFollowUpServiceResult } from '../../../src/models/InsightCardContent';
import { AppError, formatError } from '../../../src/utils/errors';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function setContentHeaders(res: VercelResponse, requestId: string, allow: string): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('Allow', allow);
}

export function sendContentResult(
  res: VercelResponse,
  requestId: string,
  result: InsightDetailServiceResult | InsightFollowUpServiceResult,
) {
  if (result.status === 'unavailable') {
    const statusCode = result.cause === 'GENERATION_FAILED'
      || result.cause === 'STALE_CONTRACT'
      || result.cause === 'DETAIL_NOT_READY' ? 409 : 503;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: result.cause,
        message: result.cause === 'GENERATION_FAILED'
          ? '这次内容暂时无法生成'
          : result.cause === 'DETAIL_NOT_READY'
            ? '详情尚未准备好'
            : '内容暂时不可用',
        retryable: result.retryable,
        ...(result.generation_id ? { generation_id: result.generation_id } : {}),
      },
      request_id: requestId,
    });
  }
  return res.status(result.status === 'ready' ? 200 : 202).json({
    success: true,
    data: { ...result, request_id: requestId },
  });
}

export function sendContentValidation(
  res: VercelResponse,
  requestId: string,
  message: string,
  cause: string,
) {
  return res.status(400).json({
    success: false,
    error: { code: 'VALIDATION_ERROR', message, cause, retryable: false },
    request_id: requestId,
  });
}

export function sendContentCaught(res: VercelResponse, requestId: string, error: unknown) {
  if (error instanceof InsightCardContentRepositoryError) {
    const followUpDailyLimit = error.databaseCode === 'P4290';
    const detailDailyLimit = error.databaseCode === 'P4291';
    const detailActiveLimit = error.databaseCode === 'P4292';
    const rateLimited = followUpDailyLimit || detailDailyLimit || detailActiveLimit;
    const conflict = error.databaseCode === '23505' || error.databaseCode === '40001';
    const notFound = error.databaseCode === '42501' || error.databaseCode === 'P0002';
    const statusCode = rateLimited ? 429 : conflict ? 409 : notFound ? 404 : 503;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: followUpDailyLimit
          ? 'FOLLOW_UP_DAILY_LIMIT'
          : detailDailyLimit
            ? 'DETAIL_DAILY_LIMIT'
            : detailActiveLimit
              ? 'DETAIL_ACTIVE_LIMIT'
              : conflict ? 'IDEMPOTENCY_CONFLICT' : notFound ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE',
        message: followUpDailyLimit
          ? '今天的追问次数已用完，明天可以继续'
          : detailDailyLimit
            ? '今天可生成的新详情已用完，明天可以继续'
            : detailActiveLimit
              ? '当前正在生成的详情较多，请稍后再试'
              : conflict ? 'client_request_id 已用于不同的追问' : notFound ? '源卡或内容不存在' : '内容服务暂时不可用',
        retryable: detailActiveLimit || statusCode >= 500,
      },
      request_id: requestId,
    });
  }
  const formatted = formatError(error);
  return res.status(formatted.statusCode).json({
    success: false,
    error: {
      code: formatted.body.error.code,
      message: error instanceof AppError ? formatted.body.error.message : '内容服务暂时不可用',
      retryable: formatted.statusCode >= 500,
    },
    request_id: requestId,
  });
}
