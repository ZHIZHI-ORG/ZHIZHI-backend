/**
 * 洞察页某维度详细分析接口
 * GET /api/insights/detail/:category?bazi_id=xxx
 *
 * 依据：simple.md §6
 * 路径参数：category - overall / career / love / health / study
 * 返回：golden_sentence + detailed_content + bullets（含展开内容）
 *
 * 同时记录用户行为（view_card），用于后期推荐权重统计
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../../src/utils/auth';
import { getInsightDetail } from '../../../src/services/fortuneService';
import { userInteractionRepository } from '../../../src/database/repositories/UserInteractionRepository';
import { Response } from '../../../src/utils/response';
import { formatError } from '../../../src/utils/errors';
import { InteractionCategory } from '../../../src/models/UserInteraction';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const user = await getCurrentUser(req);
    const category = (req as any).params?.category as string;
    const baziId = req.query.bazi_id as string | undefined;

    const data = await getInsightDetail(user.id, category, baziId);

    // 异步记录用户行为（不阻塞响应）
    const validCategories = ['overall', 'career', 'love', 'health', 'study'];
    if (validCategories.includes(category)) {
      userInteractionRepository.create({
        user_id: user.id,
        category: category as InteractionCategory,
        action: 'view_card',
      }).catch((e) => console.error('[行为记录] view_card 失败:', e));
    }

    const response = Response.ok(data);
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const err = formatError(error);
    return res.status(err.statusCode).json(err.body);
  }
}
