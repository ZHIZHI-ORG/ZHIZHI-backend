/**
 * 创建八字档案端点
 * POST /api/bazi/create
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { createBaziProfile } from '../../src/services/baziService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';
import { getCurrentUser } from '../../src/utils/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    // 1. 验证用户身份
    const user = await getCurrentUser(req);

    // 2. 调用服务层创建八字档案
    const profile = await createBaziProfile(user.id, {
      is_owner: req.body.is_owner,
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

    // 3. 返回成功响应
    const response = Response.created(profile, '八字档案创建成功');
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
