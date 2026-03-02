/**
 * 运势服务层
 *
 * 职责：
 *   1. 获取用户当前使用的八字档案
 *   2. 获取用户行为权重（用于 AI 个性化）
 *   3. 调用 geminiClient 生成完整每日运势数据
 *   4. 按接口需要拆分返回对应字段
 */

import { baziProfileRepository } from '../database/repositories/BaziProfileRepository';
import { userInteractionRepository } from '../database/repositories/UserInteractionRepository';
import { generateDailyFortune, DailyFortuneData } from '../utils/geminiClient';
import { NotFoundError } from '../utils/errors';

/**
 * 获取完整每日运势数据
 *
 * @param userId   - 当前登录用户 ID
 * @param baziId   - 指定八字档案 ID（不传则取用户本人档案）
 */
async function getDailyFortuneData(
  userId: string,
  baziId?: string
): Promise<DailyFortuneData> {
  // 1. 获取八字档案
  let profile;
  if (baziId) {
    profile = await baziProfileRepository.findById(baziId);
    if (!profile || profile.owner_user_id !== userId) {
      throw new NotFoundError('八字档案不存在');
    }
  } else {
    // 取用户本人档案（is_owner = true）
    const { items } = await baziProfileRepository.findByOwner(userId, { is_owner: true });
    profile = items[0];
    if (!profile) {
      throw new NotFoundError('请先创建本人八字档案');
    }
  }

  // 2. 获取用户行为权重
  const weights = await userInteractionRepository.getCategoryWeights(userId);

  // 3. 生成完整运势数据
  return generateDailyFortune(profile, weights);
}

// ─────────────────────────────────────────────────────────────
// 各接口对应的 Service 方法
// ─────────────────────────────────────────────────────────────

/**
 * 模块5：获取首页每日运势
 * 返回 day_master_card + scenes
 */
export async function getDailyFortune(userId: string, baziId?: string) {
  const data = await getDailyFortuneData(userId, baziId);
  return {
    date: data.date,
    day_master_card: data.day_master_card,
    scenes: data.scenes,
    // scenes.advices 已内嵌完整 MediumInsightCard（golden_sentence/detailed_content/followUpQuestions）
    // 前端首页无需额外接口，直接用 advices 数据展示和展开
    analysis: Object.fromEntries(
      data.scenes.map((s) => [s.scene, data.analysis[s.scene]])
    ),
  };
}

/**
 * 模块6：获取洞察页轮播卡片
 * 返回 insight_cards
 */
export async function getInsightCards(userId: string, baziId?: string) {
  const data = await getDailyFortuneData(userId, baziId);
  return {
    date: data.date,
    cards: data.insight_cards,
  };
}

/**
 * 模块6：获取五维分析概览
 * 返回每个维度的 golden_sentence + detailed_content（不含 bullets）
 */
export async function getInsightAnalysis(userId: string, baziId?: string) {
  const data = await getDailyFortuneData(userId, baziId);
  const categories = ['overall', 'career', 'love', 'health', 'study'] as const;

  return {
    date: data.date,
    analysis: categories.map((cat) => ({
      category: cat,
      golden_sentence: data.analysis[cat].golden_sentence,
      detailed_content: data.analysis[cat].detailed_content,
    })),
  };
}

/**
 * 模块6：获取某维度详细分析（含 followUpQuestions）
 * 返回完整 AnalysisItem（MediumInsightCard）
 */
export async function getInsightDetail(
  userId: string,
  category: string,
  baziId?: string
) {
  const validCategories = ['overall', 'career', 'love', 'health', 'study'];
  if (!validCategories.includes(category)) {
    throw new NotFoundError(`不支持的分析类别: ${category}`);
  }

  const data = await getDailyFortuneData(userId, baziId);
  const cat = category as keyof typeof data.analysis;

  return {
    date: data.date,
    category,
    ...data.analysis[cat],
  };
}

