/**
 * 用户扩展资料端点
 * PUT /api/user/profile/extended - 更新职业、MBTI、简介等扩展字段
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../../src/utils/auth';
import { updateUserExtendedProfile } from '../../../src/services/userService';
import { Response } from '../../../src/utils/response';
import { formatError } from '../../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const currentUser = await getCurrentUser(req);

    const { bio, location, career, school, mbti, notes } = req.body ?? {};

    const updatedProfile = await updateUserExtendedProfile(currentUser.id, {
      bio,
      location,
      career,
      school,
      mbti,
      notes,
    });

    const response = Response.ok(updatedProfile, '扩展资料更新成功');
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
