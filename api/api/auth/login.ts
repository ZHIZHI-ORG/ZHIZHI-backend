/**
 * 用户登录接口
 * POST /api/auth/login
 *
 * 依据：simple.md §3.1
 * 支持两种登录模式，由请求体中是否包含 password 或 verificationCode 来区分：
 *
 * 模式 A — 密码登录（老用户常规路径）：
 *   请求体：{ email, password }
 *
 * 模式 B — 验证码登录（免密路径，需先调用 send-code）：
 *   请求体：{ email, verificationCode }
 *
 * 成功响应 200：{ success: true, data: { user, access_token, refresh_token } }
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { loginWithPassword, loginWithCode } from '../../src/services/authService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const {
      email,
      password,
      verificationCode, // 前端 camelCase
    } = req.body ?? {};

    if (!email) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: '请输入邮箱地址' },
      });
    }

    let result;

    if (password) {
      // 模式 A：密码登录（有 password 字段）
      result = await loginWithPassword({ email, password });
    } else if (verificationCode) {
      // 模式 B：验证码登录（有 verificationCode 字段）
      result = await loginWithCode({
        email,
        verification_code: verificationCode, // camelCase → snake_case
      });
    } else {
      // 两种模式的必填字段都不存在
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELD',
          message: '请提供 password（密码登录）或 verificationCode（验证码登录）',
        },
      });
    }

    const response = Response.ok(result, '登录成功');
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
