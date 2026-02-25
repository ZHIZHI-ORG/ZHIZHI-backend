/**
 * 用户资料端点
 * GET /api/user/profile - 获取当前用户资料
 * PUT /api/user/profile - 更新当前用户资料
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../src/utils/auth';
import { getUserProfile, updateUserProfile } from '../../src/services/userService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 验证用户身份（需要登录）
    const currentUser = await getCurrentUser(req);

    if (req.method === 'GET') {
      // 获取当前用户资料
      const profile = await getUserProfile(currentUser.id);
      const response = Response.ok(profile);
      return res.status(response.statusCode).json(response.body);
    }

    if (req.method === 'PUT') {
      // 更新当前用户资料
      const updatedProfile = await updateUserProfile(currentUser.id, {
        display_name: req.body.display_name,
        avatar_url: req.body.avatar_url,
      });
      const response = Response.ok(updatedProfile, '资料更新成功');
      return res.status(response.statusCode).json(response.body);
    }

    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
