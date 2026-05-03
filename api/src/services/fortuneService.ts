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
import { historyRepository } from '../database/repositories/HistoryRepository';
import { userInteractionRepository } from '../database/repositories/UserInteractionRepository';
import { BaziProfile } from '../models/BaziProfile';
import { createOrGetHistoryRecord } from './historyService';
import {
  generateDailyFortune,
  generateDrilldownAnswer,
  DailyFortuneData,
  FollowUpQuestion,
} from '../utils/geminiClient';
import { NotFoundError, ValidationError } from '../utils/errors';

const crypto = require('crypto') as typeof import('crypto');

type ControlledQuestion = FollowUpQuestion & {
  id: string;
  category: string;
  depth: number;
};

function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function stableId(parts: Array<string | number | undefined | null>): string {
  return crypto
    .createHash('sha1')
    .update(parts.map((part) => String(part ?? '')).join('|'))
    .digest('hex')
    .slice(0, 14);
}

function addQuestionContracts(data: DailyFortuneData): DailyFortuneData {
  data.scenes = data.scenes.map((scene) => ({
    ...scene,
    advices: scene.advices.map((advice, adviceIndex) => {
      const questions = (advice.followUpQuestions || []).map((item, questionIndex) => ({
        ...item,
        id: stableId([
          data.date,
          'home_scene',
          scene.scene,
          adviceIndex,
          questionIndex,
          item.question,
        ]),
        category: scene.scene,
        depth: 1,
      }));

      return {
        ...advice,
        followUpQuestions: questions,
        follow_up_questions: questions,
      };
    }),
  }));

  for (const category of Object.keys(data.analysis) as Array<keyof typeof data.analysis>) {
    data.analysis[category] = data.analysis[category].map((item, cardIndex) => {
      const questions = (item.followUpQuestions || []).map((question, questionIndex) => ({
        ...question,
        id: stableId([
          data.date,
          'insight_detail',
          category,
          cardIndex,
          questionIndex,
          question.question,
        ]),
        category,
        depth: 1,
      }));

      return {
        ...item,
        followUpQuestions: questions,
        follow_up_questions: questions,
      };
    });
  }

  return data;
}

function normalizeQuestionMap(data: DailyFortuneData): Map<string, {
  question: ControlledQuestion;
  sourceAdvice: Record<string, any>;
  adviceId: string;
}> {
  const map = new Map<string, {
    question: ControlledQuestion;
    sourceAdvice: Record<string, any>;
    adviceId: string;
  }>();

  data.scenes.forEach((scene) => {
    scene.advices.forEach((advice, adviceIndex) => {
      const adviceId = `${scene.scene}-${adviceIndex}`;
      const questions = (advice.follow_up_questions || advice.followUpQuestions || []) as ControlledQuestion[];
      questions.forEach((question) => {
        if (question.id) {
          map.set(question.id, {
            question,
            adviceId,
            sourceAdvice: {
              scene: scene.scene,
              change_level: scene.change_level,
              advice_index: adviceIndex,
              golden_sentence: advice.golden_sentence,
              detailed_content: advice.detailed_content,
            },
          });
        }
      });
    });
  });

  return map;
}

function buildNextFollowUpQuestions(
  sourceDate: string,
  parentQuestionId: string,
  category: string,
  depth: number,
): ControlledQuestion[] {
  const templates = [
    '这件事今天最大的风险是什么？',
    '我现在最应该先做哪一步？',
  ];

  return templates.map((question, index) => ({
    id: stableId([sourceDate, 'drilldown_next', parentQuestionId, depth, index, question]),
    question,
    answer: '',
    category,
    depth,
  }));
}

function conversationKey(conversationPath: any[] | undefined): string {
  if (!Array.isArray(conversationPath) || conversationPath.length === 0) return 'root';
  return stableId(conversationPath.map((item) => `${item?.question || ''}:${item?.answer || ''}`));
}

function categoryDisplayName(category: string): string {
  const names: Record<string, string> = {
    overall: '整体运势',
    career: '事业发展',
    love: '情感关系',
    health: '身心健康',
    study: '学习成长',
  };
  return names[category] || category;
}

/**
 * 获取完整每日运势数据
 *
 * @param userId   - 当前登录用户 ID
 * @param baziId   - 指定八字档案 ID（不传则取用户本人档案）
 */
async function getDailyFortuneData(
  userId: string,
  baziId?: string
): Promise<{ data: DailyFortuneData; profile: BaziProfile; baziProfileId: string }> {
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

  const sourceDate = getTodayString();
  const baziProfileId = profile.id;
  const dedupeKey = `daily_fortune:${baziProfileId}:${sourceDate}`;
  const cached = await historyRepository.findByDedupeKey(userId, dedupeKey);
  if (cached?.payload?.fortune_data) {
    return {
      data: cached.payload.fortune_data as DailyFortuneData,
      profile,
      baziProfileId,
    };
  }

  // 2. 获取用户行为权重
  const weights = await userInteractionRepository.getCategoryWeights(userId);

  // 3. 生成完整运势数据
  const data = addQuestionContracts(await generateDailyFortune(profile, weights));
  try {
    await createOrGetHistoryRecord(userId, {
      type: 'daily_fortune',
      title: data.day_master_card.title,
      summary: data.day_master_card.tip,
      source_date: data.date,
      bazi_profile_id: baziProfileId,
      category: 'overall',
      dedupe_key: dedupeKey,
      payload: {
        schema_version: 1,
        fortune_data: data,
        detail_preview: {
          golden_sentence: data.day_master_card.title,
          detailed_content: data.day_master_card.tip,
        },
      },
    });
  } catch (error) {
    console.error('[History] daily_fortune 写入失败，继续返回当日内容:', error);
  }

  return { data, profile, baziProfileId };
}

// ─────────────────────────────────────────────────────────────
// 各接口对应的 Service 方法
// ─────────────────────────────────────────────────────────────

/**
 * 模块5：获取首页每日运势
 * 返回 day_master_card + scenes
 */
export async function getDailyFortune(userId: string, baziId?: string) {
  const { data } = await getDailyFortuneData(userId, baziId);
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
  const { data } = await getDailyFortuneData(userId, baziId);
  return {
    date: data.date,
    cards: data.insight_cards,
  };
}

/**
 * 模块6：获取五维分析概览
 * 返回每个维度第一张卡片的 golden_sentence + detailed_content
 */
export async function getInsightAnalysis(userId: string, baziId?: string) {
  const { data } = await getDailyFortuneData(userId, baziId);
  const categories = ['overall', 'career', 'love', 'health', 'study'] as const;

  return {
    date: data.date,
    analysis: categories.map((cat) => ({
      category: cat,
      golden_sentence: data.analysis[cat][0].golden_sentence,
      detailed_content: data.analysis[cat][0].detailed_content,
    })),
  };
}

/**
 * 模块6：获取某维度详细分析（含 followUpQuestions）
 * 返回该维度全部5张 MediumInsightCard 数组
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

  const { data, baziProfileId } = await getDailyFortuneData(userId, baziId);
  const cat = category as keyof typeof data.analysis;
  const cards = data.analysis[cat];
  const firstCard = cards[0];
  let historyRecordId: string | undefined;

  try {
    const record = await createOrGetHistoryRecord(userId, {
      type: 'analysis',
      title: categoryDisplayName(category),
      summary: firstCard?.detailed_content?.slice(0, 120) || firstCard?.golden_sentence || null,
      source_date: data.date,
      bazi_profile_id: baziProfileId,
      category,
      dedupe_key: `insight_detail:${baziProfileId}:${data.date}:${category}`,
      payload: {
        schema_version: 1,
        source_type: 'insight_detail',
        category,
        cards,
        detail_preview: {
          golden_sentence: firstCard?.golden_sentence || categoryDisplayName(category),
          detailed_content: firstCard?.detailed_content || null,
        },
      },
    });
    historyRecordId = record.id;
  } catch (error) {
    console.error('[History] insight_detail 写入失败，继续返回洞察详情:', error);
  }

  return {
    date: data.date,
    category,
    cards,
    history_record_id: historyRecordId,
  };
}

export async function getControlledDrilldownAnswer(userId: string, input: {
  bazi_profile_id?: string;
  source_date?: string;
  source_type?: string;
  source_id?: string;
  advice_id?: string;
  question_id?: string;
  conversation_path?: Array<{ question: string; answer?: string }>;
}) {
  if (!input.bazi_profile_id) {
    throw new ValidationError('缺少 bazi_profile_id');
  }
  if (!input.source_date || !/^\d{4}-\d{2}-\d{2}$/.test(input.source_date)) {
    throw new ValidationError('source_date 必须是 YYYY-MM-DD 格式');
  }
  if (input.source_type !== 'home_scene') {
    throw new ValidationError('source_type 目前仅支持 home_scene');
  }
  if (!input.question_id) {
    throw new ValidationError('缺少 question_id');
  }

  const { data, profile, baziProfileId } = await getDailyFortuneData(userId, input.bazi_profile_id);
  if (data.date !== input.source_date) {
    throw new ValidationError('source_date 与当前日运势不匹配');
  }

  const questionMap = normalizeQuestionMap(data);
  let selected = questionMap.get(input.question_id);

  if (!selected && Array.isArray(input.conversation_path) && input.conversation_path.length > 0) {
    const parent = input.conversation_path[input.conversation_path.length - 1];
    const parentCandidate = Array.from(questionMap.values())
      .find((item) => item.question.question === parent.question);
    if (parentCandidate) {
      const nextQuestions = buildNextFollowUpQuestions(
        data.date,
        parentCandidate.question.id,
        parentCandidate.question.category,
        parentCandidate.question.depth + 1,
      );
      const next = nextQuestions.find((item) => item.id === input.question_id);
      if (next) {
        selected = {
          question: next,
          adviceId: parentCandidate.adviceId,
          sourceAdvice: parentCandidate.sourceAdvice,
        };
      }
    }
  }

  if (!selected) {
    throw new ValidationError('question_id 不属于当前后端生成的问题候选');
  }

  const todayDrilldowns = await historyRepository.listByUser(userId, {
    page: 1,
    page_size: 1,
    type: 'drilldown',
    date_from: input.source_date,
    date_to: input.source_date,
  });
  if (todayDrilldowns.total >= 20) {
    throw new ValidationError('今日下钻次数已达上限', { code: 'DRILLDOWN_RATE_LIMITED' });
  }

  const dedupeKey = `drilldown:${baziProfileId}:${input.source_date}:${selected.adviceId}:${input.question_id}:${conversationKey(input.conversation_path)}`;
  const cached = await historyRepository.findByDedupeKey(userId, dedupeKey);
  if (cached?.payload) {
    return {
      question: cached.payload.question,
      answer: cached.payload.answer,
      follow_up_questions: cached.payload.follow_up_questions || [],
      history_record_id: cached.id,
      generated_at: cached.created_at,
    };
  }

  const answer = selected.question.answer?.trim()
    || await generateDrilldownAnswer(
      profile,
      selected.question.question,
      JSON.stringify({
        source_advice: selected.sourceAdvice,
        conversation_path: input.conversation_path || [],
      }),
    );
  const nextQuestions = buildNextFollowUpQuestions(
    input.source_date,
    selected.question.id,
    selected.question.category,
    selected.question.depth + 1,
  );

  const record = await createOrGetHistoryRecord(userId, {
    type: 'drilldown',
    title: selected.question.question,
    summary: answer.slice(0, 120),
    source_date: input.source_date,
    bazi_profile_id: baziProfileId,
    category: selected.question.category,
    dedupe_key: dedupeKey,
    payload: {
      schema_version: 1,
      source_type: input.source_type,
      source_id: input.source_id || selected.sourceAdvice.scene,
      advice_id: input.advice_id || selected.adviceId,
      source_advice: selected.sourceAdvice,
      question: {
        id: selected.question.id,
        text: selected.question.question,
      },
      answer,
      follow_up_questions: nextQuestions,
      conversation_path: input.conversation_path || [],
      detail_preview: {
        golden_sentence: selected.question.question,
        detailed_content: answer,
      },
    },
  });

  return {
    question: {
      id: selected.question.id,
      text: selected.question.question,
    },
    answer,
    follow_up_questions: nextQuestions,
    history_record_id: record.id,
    generated_at: record.created_at,
  };
}
