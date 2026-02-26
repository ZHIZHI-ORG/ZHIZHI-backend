/**
 * 洞察页轮播卡片接口
 * GET /api/insights/cards?bazi_id=xxx
 *
 * 依据：simple.md §6
 * 返回：5个维度的轮播卡片（overall/career/love/health/study）
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../src/utils/auth';
import { getInsightCards } from '../../src/services/fortuneService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const user = await getCurrentUser(req);
    const baziId = req.query.bazi_id as string | undefined;

    const data = await getInsightCards(user.id, baziId);
    const response = Response.ok(data);
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
