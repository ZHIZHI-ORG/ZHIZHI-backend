/**
 * 用户邀请记录端点
 * GET /api/user/invitations - 获取通过用户邀请码注册的好友列表
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../src/utils/auth';
import { getUserInvitations } from '../../src/services/inviteCodeService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const currentUser = await getCurrentUser(req);
    const invitations = await getUserInvitations(currentUser.id);

    const response = Response.ok({
      total: invitations.length,
      invitations,
    });
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
