/**
 * 注销账号接口
 * POST /api/auth/delete-account
 *
 * 依据：simple.md §3.3 注销账户
 * 背景：Apple App Store 审核政策强制要求 App 提供账号注销功能，
 *       用户注销后，其账号和个人数据必须被彻底处理。
 *
 * 实现策略：
 *   - 业务表（users、bazi_profiles 等）：软删除（保留数据用于合规审计）
 *   - 认证表（auth.users）：硬删除（用户无法再次用此邮箱登录）
 *
 * 请求头：Authorization: Bearer <access_token>（必须登录）
 * 请求体：无
 * 成功响应 200：{ success: true, data: { message: "账号已注销" } }
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { deleteAccount } from '../../src/services/authService';
import { getCurrentUser } from '../../src/utils/auth';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    // 验证登录状态并获取当前用户（getCurrentUser 在未登录时抛出 UnauthorizedError）
    const currentUser = await getCurrentUser(req);

    // 执行注销：软删除业务数据 + 硬删除 Auth 用户
    await deleteAccount(currentUser.id);

    const response = Response.ok({ message: '账号已注销，感谢您使用知之' });
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
