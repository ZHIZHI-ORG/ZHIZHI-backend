/**
 * 第三方登录接口
 * POST /api/auth/social-login
 *
 * 依据：simple.md §3.1 第三方登录
 * 场景：获取 OAuth Token → 调用本接口 → 已绑定直接登录 / 新用户需补充信息
 *
 * iOS 端流程：
 *   1. 用户点击「Sign in with Apple」或「Sign in with Google」
 *   2. iOS SDK 完成 OAuth 流程，返回 identity_token（JWT 格式）
 *   3. 前端以 socialToken 字段发给本接口
 *
 * 请求体：
 * {
 *   provider: "apple" | "google"  // 第三方平台
 *   socialToken: string            // iOS SDK 返回的 identity_token
 *   nonce?: string                 // Google 登录生产校验用的一次性随机码
 *   invitationCode?: string        // 邀请码（邀请码门禁开启时新用户需要）
 * }
 *
 * 响应（两种情况）：
 *   200 登录成功：{ success: true, data: { user, access_token, refresh_token } }
 *   202 需补全信息：{ success: true, data: { status: "need_info", temp_token: "..." } }
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { socialLogin } from '../../src/services/authService';
import { isInviteCodeRequired } from '../../src/config/auth';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const {
      provider,
      socialToken,     // 前端 camelCase，对应 simple.md §3.2 socialToken 字段
      nonce,           // Google Sign-In 生产环境 nonce 校验
      invitationCode,  // 前端 camelCase（可选）
    } = req.body ?? {};

    if (!provider || !socialToken) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: '缺少必填字段：provider、socialToken' },
      });
    }

    if (provider !== 'apple' && provider !== 'google') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PROVIDER', message: 'provider 只支持 apple 或 google' },
      });
    }

    if (provider === 'google' && (!nonce || typeof nonce !== 'string')) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: 'Google 登录缺少必填字段：nonce' },
      });
    }

    // 调用 service 层，返回 SocialLoginResponse（两种 status）
    const result = await socialLogin({
      provider,
      social_token: socialToken,          // camelCase → snake_case
      nonce,
      invitation_code: invitationCode,    // camelCase → snake_case（可 undefined）
    });

    if (result.status === 'ok') {
      // 已有账号，或新用户在当前邀请码门禁策略下注册成功
      const response = Response.ok(result.data, '登录成功');
      return res.status(response.statusCode).json(response.body);
    } else {
      // 新用户且当前开启邀请码门禁：202，让前端引导用户补全信息
      return res.status(202).json({
        success: true,
        data: {
          status: 'need_info',
          temp_token: result.temp_token,
          message: isInviteCodeRequired() ? '请输入邀请码以完成注册' : '请补全注册信息以完成注册',
        },
      });
    }
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
