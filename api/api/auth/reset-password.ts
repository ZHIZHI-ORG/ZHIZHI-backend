/**
 * 重置密码接口
 * POST /api/auth/reset-password
 *
 * 依据：simple.md §3.1 密码重置
 * 流程：用户输入邮箱 → 发送验证码（send-code 接口）→ 输入新密码 → 调用本接口
 *
 * 请求体：
 * {
 *   email: string            // 邮箱（与发码时使用的邮箱一致）
 *   verificationCode: string // 邮件验证码（6位）
 *   newPassword: string      // 新密码（至少8位，含字母和数字）
 * }
 *
 * 成功响应 200：{ success: true, data: { message: "密码已重置，请重新登录" } }
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { resetPassword } from '../../src/services/authService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const {
      email,
      verificationCode, // 前端 camelCase
      newPassword,      // 前端 camelCase
    } = req.body ?? {};

    if (!email || !verificationCode || !newPassword) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELD',
          message: '缺少必填字段：email、verificationCode、newPassword',
        },
      });
    }

    await resetPassword({
      email,
      verification_code: verificationCode, // camelCase → snake_case
      new_password: newPassword,           // camelCase → snake_case
    });

    const response = Response.ok({ message: '密码已重置，请用新密码重新登录' });
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
