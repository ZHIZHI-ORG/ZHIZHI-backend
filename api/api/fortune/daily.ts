/**
 * 首页每日运势接口
 * GET /api/fortune/daily?bazi_id=xxx
 *
 * 依据：simple.md §5
 * 返回：day_master_card + scenes（2个最相关场景）
 *
 * 查询参数：
 *   bazi_id（可选）- 指定八字档案 ID，不传则取当前用户本人档案
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../src/utils/auth';
import { getDailyFortune } from '../../src/services/fortuneService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const user = await getCurrentUser(req);
    const baziId = req.query.bazi_id as string | undefined;

    const data = await getDailyFortune(user.id, baziId);
    const response = Response.ok(data);
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
