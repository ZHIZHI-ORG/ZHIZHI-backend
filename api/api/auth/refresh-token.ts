/**
 * 刷新访问令牌接口
 * POST /api/auth/refresh-token
 *
 * 依据：simple.md §3.3 Token刷新
 * 用途：access_token 约 1 小时过期，iOS 客户端在收到 401 时自动调用此接口换新 token，
 *       实现"一次登录，长期有效"的移动端体验。
 *
 * 请求体：{ refreshToken: string }
 * 成功响应 200：{ success: true, data: { access_token, refresh_token } }
 *
 * 注意：refresh_token 本身也是一次性的，Supabase 每次刷新都会返回新的 refresh_token，
 *       前端需要同时更新本地存储中的两个 token。
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { refreshAccessToken } from '../../src/services/authService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    // 前端字段名（参考 simple.md 风格统一用 camelCase）
    const refreshToken = req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: '缺少 refreshToken' },
      });
    }

    const result = await refreshAccessToken({ refresh_token: refreshToken });

    const response = Response.ok(result, 'Token 刷新成功');
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
