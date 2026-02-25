/**
 * 用户登出接口
 * POST /api/auth/logout
 *
 * 依据：simple.md §3.3 登出
 * 用途：使当前 session 在服务端失效，前端同时清除本地存储的 token。
 *
 * 请求头：Authorization: Bearer <access_token>（必须登录才能登出）
 * 请求体：无
 * 成功响应 200：{ success: true, data: { message: "已退出登录" } }
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { logoutUser } from '../../src/services/authService';
import { extractToken } from '../../src/utils/auth';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    // 从请求头提取 access_token（extractToken 在 token 缺失时抛出 UnauthorizedError）
    const token = extractToken(req);

    // 调用 service 层使 session 失效
    await logoutUser(token);

    const response = Response.ok({ message: '已退出登录' });
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
