/**
 * 用户注册接口
 * POST /api/auth/register
 *
 * 依据：simple.md §3.1 邮箱注册
 * 流程：邮箱 → 发送验证码（send-code 接口）→ 输入验证码+密码 → 调用本接口 → 获取 Token
 *
 * 请求体（前端字段名为 camelCase，此处做映射转换）：
 * {
 *   email: string            // 邮箱
 *   password: string         // 密码（至少8位，含字母和数字）
 *   verificationCode: string // 邮件验证码（6位数字）
 *   invitationCode?: string  // 邀请码（受 INVITE_CODE_REQUIRED 开关控制）
 *   displayName?: string     // 昵称（可选）
 * }
 *
 * 成功响应 201：{ success: true, data: { user, access_token, refresh_token } }
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { registerUser } from '../../src/services/authService';
import { isInviteCodeRequired } from '../../src/config/auth';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    // 提取前端字段（camelCase），在此处统一做命名映射
    const {
      email,
      password,
      verificationCode, // 前端 camelCase → service 层 snake_case
      invitationCode,   // 前端 camelCase → service 层 snake_case
      displayName,      // 前端 camelCase → service 层 snake_case（可选）
    } = req.body ?? {};

    // Handler 层做快速必填校验，具体格式校验由 service 层处理
    const requiredFields = ['email', 'password', 'verificationCode'];
    if (isInviteCodeRequired()) {
      requiredFields.push('invitationCode');
    }

    const missingFields = requiredFields.filter((field) => !req.body?.[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELD',
          message: `缺少必填字段：${missingFields.join('、')}`,
        },
      });
    }

    // 调用 service 层执行完整注册逻辑
    const result = await registerUser({
      email,
      password,
      verification_code: verificationCode,
      invitation_code: invitationCode,
      display_name: displayName,
    });

    const response = Response.created(result, '注册成功，欢迎加入知之');
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
