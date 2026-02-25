/**
 * Gemini AI 客户端
 * 用于生成八字相关的问题和答案
 */

import {
  QuestionCategory,
  QuestionTimeframe,
  QuestionCard,
  FollowUpQuestion,
} from '../models/QuestionCard';
import { BaziProfile } from '../models/BaziProfile';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

/**
 * 调用Gemini API
 */
async function callGeminiAPI(prompt: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API Key未配置');
  }

  const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API错误: ${response.status} - ${error}`);
  }

  const data = await response.json();

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Gemini API未返回有效内容');
  }

  const text = data.candidates[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API返回格式错误');
  }

  return text.trim();
}

/**
 * 生成八字分析上下文
 */
function buildBaziContext(baziProfile: BaziProfile): string {
  const wuxing = baziProfile.wuxing_analysis;

  return `
【用户八字信息】
姓名：${baziProfile.name}
性别：${baziProfile.gender === 'male' ? '男' : '女'}
出生时间：${baziProfile.birth_year}年${baziProfile.birth_month}月${baziProfile.birth_day}日 ${baziProfile.birth_hour || 0}时

【四柱八字】
年柱：${baziProfile.bazi_year_stem}${baziProfile.bazi_year_branch}
月柱：${baziProfile.bazi_month_stem}${baziProfile.bazi_month_branch}
日柱：${baziProfile.bazi_day_stem}${baziProfile.bazi_day_branch}
时柱：${baziProfile.bazi_hour_stem}${baziProfile.bazi_hour_branch}

【五行分析】
金：${wuxing?.金 || 0}
木：${wuxing?.木 || 0}
水：${wuxing?.水 || 0}
火：${wuxing?.火 || 0}
土：${wuxing?.土 || 0}
旺相：${wuxing?.dominant || '无'}
缺失：${wuxing?.lacking && wuxing.lacking.length > 0 ? wuxing.lacking.join('、') : '无'}
`.trim();
}

/**
 * 分类名称映射
 */
const CATEGORY_NAMES: Record<QuestionCategory, string> = {
  career: '事业发展',
  wealth: '财运投资',
  health: '健康养生',
  relationship: '感情婚姻',
  study: '学习进修',
  daily_life: '日常生活',
  food: '饮食建议',
  travel: '出行方位',
  social: '人际社交',
  decision: '决策建议',
};

/**
 * 时间范围映射
 */
const TIMEFRAME_NAMES: Record<QuestionTimeframe, string> = {
  today: '今日',
  this_week: '本周',
  this_month: '本月',
  this_year: '今年',
  general: '通用',
};

/**
 * 生成当前时间上下文
 */
function buildTimingContext(timeframe: QuestionTimeframe): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  // 计算当前流年流月（简化版本）
  const yearStem = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'][(year - 4) % 10];
  const yearBranch = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'][(year - 4) % 12];

  return `
【当前时间】
公历：${year}年${month}月${day}日
流年：${yearStem}${yearBranch}年
时间范围：${TIMEFRAME_NAMES[timeframe]}
`.trim();
}

/**
 * 生成个性化问题
 */
export async function generateQuestions(
  baziProfile: BaziProfile,
  categories: QuestionCategory[],
  count: number = 10
): Promise<Array<{ questionText: string; category: QuestionCategory; timeframe: QuestionTimeframe }>> {

  const baziContext = buildBaziContext(baziProfile);
  const timingContext = buildTimingContext('today');

  const categoryList = categories.map(c => CATEGORY_NAMES[c]).join('、');

  const prompt = `
你是一位专业的命理师,精通八字命理学。请根据用户的八字信息，生成${count}个个性化的问题。

${baziContext}

${timingContext}

【任务要求】
1. 生成${count}个问题，涵盖以下类别：${categoryList}
2. 每个问题要：
   - 简短精炼（10-25字）
   - 针对用户的八字特点
   - 结合当前时间和运势
   - 让用户有兴趣点开查看答案
3. 问题示例格式：
   - 今天适合签订重要合同吗？
   - 本周哪几天财运较旺？
   - 本月在感情上需要注意什么？
   - 你的五行缺${baziProfile.wuxing_analysis?.lacking?.[0] || '无'}，饮食上该如何调理？

请按照以下JSON格式输出（只输出JSON，不要其他内容）：
[
  {
    "questionText": "问题内容",
    "category": "career",
    "timeframe": "today"
  },
  ...
]

分类选项：${categories.join(', ')}
时间范围选项：today, this_week, this_month, this_year, general
`;

  try {
    const response = await callGeminiAPI(prompt);

    // 尝试解析JSON
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('AI返回格式不正确');
    }

    const questions = JSON.parse(jsonMatch[0]);
    return questions.slice(0, count); // 确保不超过请求数量

  } catch (error) {
    console.error('生成问题失败:', error);
    // 返回备用问题
    return generateFallbackQuestions(baziProfile, categories, count);
  }
}

/**
 * 生成问题的答案
 */
export async function generateAnswer(
  questionText: string,
  baziProfile: BaziProfile,
  category: QuestionCategory,
  timeframe: QuestionTimeframe
): Promise<{ answer: string; summary: string }> {

  const baziContext = buildBaziContext(baziProfile);
  const timingContext = buildTimingContext(timeframe);

  const prompt = `
你是一位专业的命理师,精通八字命理学。请根据用户的八字信息和当前运势，详细回答以下问题。

【用户问题】
${questionText}

${baziContext}

${timingContext}

【回答要求】
1. 根据用户的八字特点（日主、五行、天干地支等）分析
2. 结合当前的流年流月运势
3. 给出具体、实用的建议
4. 语气温和、积极正面
5. 篇幅控制在150-300字之间

请按照以下JSON格式输出（只输出JSON，不要其他内容）：
{
  "answer": "详细的答案内容（150-300字）",
  "summary": "一句话总结（15-30字）"
}
`;

  try {
    const response = await callGeminiAPI(prompt);

    // 尝试解析JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI返回格式不正确');
    }

    const result = JSON.parse(jsonMatch[0]);
    return {
      answer: result.answer || '暂时无法生成答案',
      summary: result.summary || '请稍后再试'
    };

  } catch (error) {
    console.error('生成答案失败:', error);
    return {
      answer: '抱歉，当前无法生成详细答案。请稍后再试。',
      summary: '系统繁忙'
    };
  }
}

/**
 * 生成后续问题
 */
export async function generateFollowUpQuestions(
  originalQuestion: string,
  answer: string,
  category: QuestionCategory,
  count: number = 3
): Promise<FollowUpQuestion[]> {

  const prompt = `
基于用户刚刚查看的问题和答案，生成${count}个相关的后续问题。

【原问题】
${originalQuestion}

【答案摘要】
${answer.substring(0, 200)}...

【任务要求】
1. 生成${count}个后续问题
2. 问题要与原问题相关，但角度不同
3. 激发用户的好奇心和继续探索的欲望
4. 每个问题10-25字

请按照以下JSON格式输出（只输出JSON，不要其他内容）：
[
  "后续问题1",
  "后续问题2",
  "后续问题3"
]
`;

  try {
    const response = await callGeminiAPI(prompt);

    // 尝试解析JSON
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('AI返回格式不正确');
    }

    const questions: string[] = JSON.parse(jsonMatch[0]);

    return questions.slice(0, count).map((q, index) => ({
      id: `followup-${Date.now()}-${index}`,
      questionText: q,
      sequenceOrder: index + 1
    }));

  } catch (error) {
    console.error('生成后续问题失败:', error);
    return [];
  }
}

/**
 * 备用问题生成器（当AI调用失败时使用）
 */
function generateFallbackQuestions(
  baziProfile: BaziProfile,
  categories: QuestionCategory[],
  count: number
): Array<{ questionText: string; category: QuestionCategory; timeframe: QuestionTimeframe }> {

  const lacking = baziProfile.wuxing_analysis?.lacking?.[0] || '金';
  const dominant = baziProfile.wuxing_analysis?.dominant || '木';

  const templates: Record<QuestionCategory, string[]> = {
    career: [
      '今天适合开展新项目吗？',
      '本周事业运势如何？',
      '最近适合跳槽吗？'
    ],
    wealth: [
      '本月财运如何？',
      '今天适合投资吗？',
      '哪个方位利于财运？'
    ],
    health: [
      `五行缺${lacking}，健康上需要注意什么？`,
      '本周需要注意哪些健康问题？',
      '适合什么样的运动？'
    ],
    relationship: [
      '本月感情运势如何？',
      '今天适合表白吗？',
      '如何改善人际关系？'
    ],
    study: [
      '最近适合学习新技能吗？',
      '考试运势如何？',
      '学习上需要注意什么？'
    ],
    daily_life: [
      '今天的幸运颜色是什么？',
      '今天适合做什么？',
      '本周需要注意的事项？'
    ],
    food: [
      `五行${dominant}旺，饮食上该如何平衡？`,
      '今天适合吃什么？',
      '哪些食物对我有益？'
    ],
    travel: [
      '本月哪个方向适合出行？',
      '今天适合远行吗？',
      '出行需要注意什么？'
    ],
    social: [
      '今天适合见重要的人吗？',
      '如何提升人缘？',
      '本周社交运势如何？'
    ],
    decision: [
      '今天适合做重要决定吗？',
      '面对选择该如何决策？',
      '本周决策运势如何？'
    ],
  };

  const result: Array<{ questionText: string; category: QuestionCategory; timeframe: QuestionTimeframe }> = [];

  categories.forEach(category => {
    const questions = templates[category] || [];
    questions.forEach((q, index) => {
      if (result.length < count) {
        result.push({
          questionText: q,
          category,
          timeframe: index === 0 ? 'today' : index === 1 ? 'this_week' : 'this_month'
        });
      }
    });
  });

  return result.slice(0, count);
}
