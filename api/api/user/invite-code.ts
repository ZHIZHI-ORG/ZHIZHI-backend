/**
 * 用户邀请码端点
 * GET /api/user/invite-code - 获取当前用户的专属邀请码（不存在则自动生成）
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../src/utils/auth';
import { buildInviteQuotaContract, getUserInviteCode } from '../../src/services/inviteCodeService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const currentUser = await getCurrentUser(req);
    const inviteCode = await getUserInviteCode(currentUser.id);
    const quota = await buildInviteQuotaContract(inviteCode);

    const response = Response.ok(quota);
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
