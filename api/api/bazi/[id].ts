/**
 * 八字档案详情端点（支持查询、更新、删除）
 * GET    /api/bazi/:id - 查询详情
 * PUT    /api/bazi/:id - 更新档案
 * DELETE /api/bazi/:id - 删除档案
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getBaziProfileById,
  updateBaziProfile,
  deleteBaziProfile,
} from '../../src/services/baziService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';
import { getCurrentUser } from '../../src/utils/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const profileId = req.query.id as string;

  if (!profileId) {
    return res.status(400).json({ success: false, error: { message: '缺少档案 ID' } });
  }

  try {
    // 验证用户身份
    const user = await getCurrentUser(req);

    if (req.method === 'GET') {
      // 查询档案详情
      const profile = await getBaziProfileById(user.id, profileId);
      const response = Response.ok(profile);
      return res.status(response.statusCode).json(response.body);
    }

    if (req.method === 'PUT') {
      // 更新档案
      const updatedProfile = await updateBaziProfile(user.id, profileId, {
        name: req.body.name,
        relation_to_owner: req.body.relation_to_owner,
        gender: req.body.gender,
        birth_year: req.body.birth_year,
        birth_month: req.body.birth_month,
        birth_day: req.body.birth_day,
        birth_hour: req.body.birth_hour,
        birth_minute: req.body.birth_minute,
        is_lunar: req.body.is_lunar,
        birth_timezone: req.body.birth_timezone,
        birth_country: req.body.birth_country,
        birth_region: req.body.birth_region,
        birth_latitude: req.body.birth_latitude,
        birth_longitude: req.body.birth_longitude,
        mbti: req.body.mbti,
        daily_fortune_context: req.body.daily_fortune_context,
        notes: req.body.notes,
      });
      const response = Response.ok(updatedProfile, '档案更新成功');
      return res.status(response.statusCode).json(response.body);
    }

    if (req.method === 'DELETE') {
      // 删除档案
      await deleteBaziProfile(user.id, profileId);
      const response = Response.noContent();
      return res.status(response.statusCode).send('');
    }

    // 不支持的方法
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
