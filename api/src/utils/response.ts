/**
 * 统一响应格式工具
 */

/**
 * 成功响应格式
 */
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  message?: string;
}

/**
 * 创建成功响应
 */
export function successResponse<T>(data: T, message?: string): SuccessResponse<T> {
  return {
    success: true,
    data,
    message,
  };
}

/**
 * 返回成功的 HTTP 响应
 */
export function httpSuccess<T>(statusCode: number, data: T, message?: string) {
  return {
    statusCode,
    body: successResponse(data, message),
  };
}

/**
 * 常用的成功响应快捷方法
 */
export const Response = {
  /**
   * 200 OK
   */
  ok: <T>(data: T, message?: string) => httpSuccess(200, data, message),

  /**
   * 201 Created
   */
  created: <T>(data: T, message?: string) => httpSuccess(201, data, message),

  /**
   * 204 No Content
   */
  noContent: () => ({
    statusCode: 204,
    body: null,
  }),
};
