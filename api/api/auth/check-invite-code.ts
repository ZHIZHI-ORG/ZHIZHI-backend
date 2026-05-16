/**
 * 验证邀请码接口
 * POST /api/auth/check-invite-code
 *
 * 依据：simple.md §3.1 邀请码验证
 * 用途：单独校验邀请码。是否作为注册门禁由 INVITE_CODE_REQUIRED 控制。
 *
 * 请求体：{ invitationCode: string }
 * 成功响应 200：{ success: true, data: { valid: true, message: "欢迎加入知之" } }
 * 失败响应 400：{ success: false, error: { code, message } }
 *
 * 注意：此接口不消耗邀请码次数，仅做校验。
 *       真正"消耗"（记录使用关系）发生在注册完成时。
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { checkInviteCode } from '../../src/services/inviteCodeService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 仅接受 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    // 前端字段名为 camelCase（invitationCode），后端统一转 snake_case 处理
    const invitationCode = req.body?.invitationCode;

    if (!invitationCode) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: '请输入邀请码' },
      });
    }

    // 调用 service 层校验（只读校验，不消耗次数）
    const result = await checkInviteCode(invitationCode);

    if (!result.valid) {
      // 邀请码无效：返回 400，前端停留在门禁页展示错误提示
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INVITE_CODE', message: result.message },
      });
    }

    // 验证通过：返回 200，前端解锁登录/注册页面
    const response = Response.ok({ valid: true, message: result.message });
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
