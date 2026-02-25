/**
 * 问答卡片模型（内存中的临时数据结构）
 */

export type QuestionCategory =
  | 'career'        // 事业发展
  | 'wealth'        // 财运投资
  | 'health'        // 健康养生
  | 'relationship'  // 感情婚姻
  | 'study'         // 学习进修
  | 'daily_life'    // 日常生活
  | 'food'          // 饮食建议
  | 'travel'        // 出行方位
  | 'social'        // 人际社交
  | 'decision';     // 决策建议

export type QuestionTimeframe =
  | 'today'         // 今天
  | 'this_week'     // 本周
  | 'this_month'    // 本月
  | 'this_year'     // 今年
  | 'general';      // 通用

/**
 * 问题卡片（临时数据结构，不存数据库）
 */
export interface QuestionCard {
  id: string;                      // 临时ID（当天有效）
  userId: string;
  baziProfileId: string;

  // 问题内容
  questionText: string;
  category: QuestionCategory;
  timeframe: QuestionTimeframe;

  // 答案（懒加载，用户点击时才生成）
  answer?: string;
  answerSummary?: string;

  // 后续问题（查看答案后生成）
  followUpQuestions?: FollowUpQuestion[];

  // 元数据
  generatedAt: Date;
  priority: number;                // 1-10
}

/**
 * 后续问题选项
 */
export interface FollowUpQuestion {
  id: string;
  questionText: string;
  sequenceOrder: number;           // 1, 2, 3
}

/**
 * 用户兴趣偏好
 */
export interface UserInterest {
  userId: string;
  category: QuestionCategory;
  interestWeight: number;          // 0-1
  viewCount: number;
  answerOpenCount: number;
  followUpClickCount: number;
  updatedAt: Date;
}

/**
 * 八字类别模板
 */
export interface BaziCategoryTemplate {
  id: string;
  templateName: string;
  description: string;
  matchConditions: {
    wuxing_lacking?: string[];     // 缺失的五行
    wuxing_dominant?: string;      // 旺盛的五行
    day_stem?: string;             // 日主天干
    // 可扩展其他条件
  };
  categoryWeights: Record<QuestionCategory, number>;
  isActive: boolean;
}

/**
 * 每日问题种子
 */
export interface DailyQuestionSeed {
  userId: string;
  seedDate: string;                // YYYY-MM-DD
  randomSeed: string;
  questionIds: string[];
  expiresAt: Date;
}

/**
 * Gemini生成问题的请求参数
 */
export interface GenerateQuestionsRequest {
  userId: string;
  baziProfileId: string;
  count?: number;                  // 生成问题数量，默认10
  categories?: QuestionCategory[]; // 限定的分类
}

/**
 * Gemini生成答案的请求参数
 */
export interface GenerateAnswerRequest {
  questionId: string;
  userId: string;
  baziProfileId: string;
  questionText: string;
  category: QuestionCategory;
  timeframe: QuestionTimeframe;
}

/**
 * Gemini生成后续问题的请求参数
 */
export interface GenerateFollowUpRequest {
  originalQuestion: string;
  answer: string;
  category: QuestionCategory;
  count?: number;                  // 生成数量，默认3
}

/**
 * 用户交互行为
 */
export interface QuestionInteraction {
  userId: string;
  questionId: string;
  category: QuestionCategory;
  action: 'view_question' | 'open_answer' | 'click_follow_up' | 'dismiss';
  createdAt: Date;
}

/**
 * 问题缓存（内存中存储当天的问题）
 */
export interface QuestionCache {
  userId: string;
  date: string;                    // YYYY-MM-DD
  questions: QuestionCard[];
  createdAt: Date;
}
