/**
 * 自定义错误类型
 * 类似于 Java 中的自定义 Exception
 */

export enum ErrorCode {
  // 认证相关错误
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_TOKEN = 'INVALID_TOKEN',

  // 请求相关错误
  BAD_REQUEST = 'BAD_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  // 业务逻辑错误
  DUPLICATE_USERNAME = 'DUPLICATE_USERNAME',
  DUPLICATE_EMAIL = 'DUPLICATE_EMAIL',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',

  // 服务器错误
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
}

/**
 * 应用错误基类
 */
export class AppError extends Error {
  public code: ErrorCode;
  public statusCode: number;
  public details?: any;

  constructor(message: string, code: ErrorCode, statusCode: number, details?: any) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // 确保 instanceof 正确工作
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * 认证错误（401）
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = '未授权访问') {
    super(message, ErrorCode.UNAUTHORIZED, 401);
    this.name = 'UnauthorizedError';
  }
}

/**
 * 权限错误（403）
 */
export class ForbiddenError extends AppError {
  constructor(message: string = '无权限执行此操作') {
    super(message, ErrorCode.FORBIDDEN, 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * 资源未找到错误（404）
 */
export class NotFoundError extends AppError {
  constructor(message: string = '资源不存在') {
    super(message, ErrorCode.NOT_FOUND, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * 参数验证错误（400）
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * 错误响应格式化
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * 将错误转换为统一的响应格式
 */
export function formatError(error: any): { statusCode: number; body: ErrorResponse } {
  // 如果是自定义的 AppError
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  // 默认为服务器内部错误
  console.error('未处理的错误:', error);
  return {
    statusCode: 500,
    body: {
      success: false,
      error: {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: error.message || '服务器内部错误',
      },
    },
  };
}
