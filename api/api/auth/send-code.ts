/**
 * 发送邮件验证码接口
 * POST /api/auth/send-code
 *
 * 依据：simple.md §3.1
 * 此接口被三个场景复用（前端根据所在页面决定何时调用）：
 *   - 注册页：用户填写邮箱后点击"获取验证码"
 *   - 验证码登录页：用户填写邮箱后点击"获取验证码"
 *   - 密码重置页：用户填写邮箱后点击"获取验证码"
 *
 * 请求体：{ email: string }
 * 成功响应 200：{ success: true, data: { message: "验证码已发送" } }
 *
 * 注意：
 *   Supabase 对同一邮箱有 60 秒的发送频率限制，超出会返回 rate limit 错误。
 *   本接口统一处理并返回友好提示。
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { sendVerificationCode } from '../../src/services/authService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    // 从请求体提取邮箱（前端字段名 email，两端一致）
    const email = req.body?.email;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: '请输入邮箱地址' },
      });
    }

    // 调用 service 层发送验证码（内部含邮箱格式校验和 rate limit 处理）
    await sendVerificationCode({ email });

    // 返回成功（不透露具体发送状态，防止枚举攻击）
    const response = Response.ok({ message: '验证码已发送至您的邮箱，请注意查收' });
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
