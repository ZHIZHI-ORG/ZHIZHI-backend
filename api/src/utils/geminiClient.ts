/**
 * Gemini AI 客户端
 *
 * 职责：根据用户八字信息和今日日柱，一次性生成覆盖模块5（首页）
 * 和模块6（洞察）所需的完整每日运势数据。
 *
 * API Key 未配置时自动返回示例占位数据，方便前端开发调试。
 */

import { BaziProfile } from '../models/BaziProfile';
import { CategoryWeight } from '../models/UserInteraction';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';

// ─────────────────────────────────────────────────────────────
// 返回类型定义（与 simple.md §5/§6 数据结构对齐）
// ─────────────────────────────────────────────────────────────

export interface FollowUpQuestion {
  question: string;  // 追问问题（10-20字）
  answer: string;    // 答案（150-200字，支持高亮语法）
}

// 统一中型洞察卡片结构（对应 simple.md MediumInsightCard）
// 用于：首页 scenes.advices、洞察页 detail/:category
export interface MediumInsightCard {
  golden_sentence: string;             // 核心金句（5-10字）
  detailed_content: string;            // 详细建议（80-120字，支持高亮语法）
  followUpQuestions: FollowUpQuestion[]; // 追问问题+答案（2个）
}

export interface SceneAdvice {
  scene: 'career' | 'love' | 'health' | 'overall' | 'study';
  change_level: '变化较大' | '变化中等' | '变化较小';
  advices: MediumInsightCard[];  // 2张 MediumInsightCard
}

export interface InsightCard {
  category: 'career' | 'love' | 'health' | 'overall' | 'study';
  title: string;        // 核心金句（5-10字）
  description: string;  // 运势描述（40-60字）
  question: string;     // 引导问题（10-20字）
}

export interface AnalysisItem {
  golden_sentence: string;             // 核心金句（5-10字）
  detailed_content: string;            // 详细建议（80-120字，支持高亮语法）
  followUpQuestions: FollowUpQuestion[]; // 追问问题+答案（2个）
}

export interface DailyFortuneData {
  date: string;              // YYYY-MM-DD，供前端缓存对比
  day_master_card: {
    stem: string;            // 日主天干
    element: string;         // 日主五行
    title: string;           // 今日标题（15-25字）
    tip: string;             // 核心提示（40-60字）
  };
  scenes: SceneAdvice[];     // 2个最相关场景（模块5）
  insight_cards: InsightCard[]; // 5个轮播卡片（模块6）
  analysis: {
    overall: AnalysisItem;
    career: AnalysisItem;
    love: AnalysisItem;
    health: AnalysisItem;
    study: AnalysisItem;
  };
}

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

/** 获取今日公历日期字符串 YYYY-MM-DD */
function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 计算今日流年天干地支（简化版） */
function getTodayGanZhi(): { yearStem: string; yearBranch: string; monthStem: string; monthBranch: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

  const yearStem = stems[(year - 4) % 10];
  const yearBranch = branches[(year - 4) % 12];

  // 月支：寅月（1月）为起点，依次推算
  const monthBranchIndex = (month + 1) % 12;
  const monthBranch = branches[monthBranchIndex];
  // 月干根据年干推算（五虎遁年起月）
  const yearStemIndex = (year - 4) % 10;
  const monthStemBase = [2, 4, 6, 8, 0, 2, 4, 6, 8, 0][yearStemIndex];
  const monthStem = stems[(monthStemBase + month - 1) % 10];

  return { yearStem, yearBranch, monthStem, monthBranch };
}

/** 构建八字上下文字符串（注入 prompt） */
function buildBaziContext(profile: BaziProfile, weights: CategoryWeight[]): string {
  const w = profile.wuxing_analysis;
  const { yearStem, yearBranch, monthStem, monthBranch } = getTodayGanZhi();

  const weightHint = weights.length > 0
    ? `用户近期最感兴趣的方向：${weights.slice(0, 3).map(x => `${x.category}(${x.count}次)`).join('、')}，请适当增加这些方向的内容深度。`
    : '';

  return `
【用户八字】
姓名：${profile.name}，性别：${profile.gender === 'male' ? '男' : '女'}
四柱：${profile.bazi_year_stem}${profile.bazi_year_branch}年 ${profile.bazi_month_stem}${profile.bazi_month_branch}月 ${profile.bazi_day_stem}${profile.bazi_day_branch}日 ${profile.bazi_hour_stem || '?'}${profile.bazi_hour_branch || '?'}时
日主：${profile.day_master}（${profile.day_master_element}）
五行：金${w?.金 || 0} 木${w?.木 || 0} 水${w?.水 || 0} 火${w?.火 || 0} 土${w?.土 || 0}，旺：${w?.dominant || '无'}，缺：${w?.lacking?.join('、') || '无'}

【今日运势背景】
流年：${yearStem}${yearBranch}年，流月：${monthStem}${monthBranch}月
${weightHint}
`.trim();
}

// ─────────────────────────────────────────────────────────────
// 调用 Gemini API
// ─────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string> {
  const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.75,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 4096,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API 错误: ${response.status} - ${err}`);
  }

  const data = await response.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 返回格式异常');
  return text.trim();
}

// ─────────────────────────────────────────────────────────────
// 主函数：生成每日完整运势数据
// ─────────────────────────────────────────────────────────────

export async function generateDailyFortune(
  profile: BaziProfile,
  weights: CategoryWeight[] = []
): Promise<DailyFortuneData> {
  // API Key 未配置时直接返回示例数据
  if (!GEMINI_API_KEY) {
    return buildMockData(profile);
  }

  const baziContext = buildBaziContext(profile, weights);
  const today = getTodayString();

  const prompt = `
你是一位精通八字命理的专业命理师。请根据用户八字和今日运势，生成完整的每日分析数据。

${baziContext}

请严格按照以下 JSON 格式输出（只输出 JSON，不要任何其他内容）：

{
  "date": "${today}",
  "day_master_card": {
    "stem": "日主天干（1字）",
    "element": "日主五行（1字，金/木/水/火/土）",
    "title": "今日运势标题（15-25字，结合今日流年流月与日主关系）",
    "tip": "核心提示（40-60字，具体实用）"
  },
  "scenes": [
    {
      "scene": "career（从 career/love/health/overall/study 中选今日最相关的2个）",
      "change_level": "变化较大/变化中等/变化较小",
      "advices": [
        { "golden_sentence": "核心金句（5-10字）", "detailed_content": "详细内容（80-120字）", "followUpQuestions": [{"question": "追问问题1（10-20字）", "answer": "答案（150-200字）"}, {"question": "追问问题2", "answer": "答案"}] },
        { "golden_sentence": "核心金句（5-10字）", "detailed_content": "详细内容（80-120字）", "followUpQuestions": [{"question": "追问问题1", "answer": "答案"}, {"question": "追问问题2", "answer": "答案"}] }
      ]
    },
    {
      "scene": "第二个场景",
      "change_level": "变化较大/变化中等/变化较小",
      "advices": [
        { "golden_sentence": "核心金句", "detailed_content": "详细内容", "followUpQuestions": [{"question": "追问问题1", "answer": "答案"}, {"question": "追问问题2", "answer": "答案"}] },
        { "golden_sentence": "核心金句", "detailed_content": "详细内容", "followUpQuestions": [{"question": "追问问题1", "answer": "答案"}, {"question": "追问问题2", "answer": "答案"}] }
      ]
    }
  ],
  "insight_cards": [
    { "category": "overall", "title": "核心金句（5-10字）", "description": "运势描述（40-60字）", "question": "引导问题（10-20字）" },
    { "category": "career", "title": "核心金句", "description": "运势描述", "question": "引导问题" },
    { "category": "love", "title": "核心金句", "description": "运势描述", "question": "引导问题" },
    { "category": "health", "title": "核心金句", "description": "运势描述", "question": "引导问题" },
    { "category": "study", "title": "核心金句", "description": "运势描述", "question": "引导问题" }
  ],
  "analysis": {
    "overall": {
      "golden_sentence": "核心金句（5-10字）",
      "detailed_content": "详细建议（80-120字，可用 [关键词]{highlight} 标注重点）",
      "followUpQuestions": [{"question": "追问问题1（10-20字）", "answer": "答案（150-200字）"}, {"question": "追问问题2", "answer": "答案"}]
    },
    "career": { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
    "love":   { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
    "health": { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
    "study":  { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] }
  }
}

要求：
1. 内容要基于用户的日主和五行特点，不能泛泛而谈
2. 结合今日流年流月与命盘的关系给出具体分析
3. 语气温和积极，避免过于负面的表述
4. 高亮语法 [关键词]{highlight} 每段最多使用2次
`;

  try {
    const raw = await callGemini(prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 返回内容无法解析为 JSON');
    return JSON.parse(jsonMatch[0]) as DailyFortuneData;
  } catch (error) {
    console.error('[Gemini] 生成失败，降级为示例数据:', error);
    return buildMockData(profile);
  }
}

// ─────────────────────────────────────────────────────────────
// 示例占位数据（API Key 未配置或 AI 调用失败时使用）
// ─────────────────────────────────────────────────────────────

function buildMockData(profile: BaziProfile): DailyFortuneData {
  const stem = profile.day_master || '庚';
  const element = profile.day_master_element || '金';
  const today = getTodayString();

  return {
    date: today,
    day_master_card: {
      stem,
      element,
      title: `${stem}金之日，静守待时`,
      tip: `今日流月与日主${stem}形成会合，整体运势偏向内敛积蓄，适合处理细节工作，避免冒进决策，保持稳健节奏。`,
    },
    scenes: [
      {
        scene: 'career',
        change_level: '变化中等',
        advices: [
          {
            golden_sentence: '文书处理事半功倍，抓住窗口期',
            detailed_content: `今日${stem}金得地，文字表达与逻辑梳理能力较强，适合撰写报告、整理资料或处理合同文件。上午时段尤为适宜，集中精力处理需要细心的工作，避免下午时段做重大汇报。`,
            followUpQuestions: [
              { question: '上午哪个时段效率最高？', answer: '庚金日主在上午7-11点（寅卯辰时）金气得令，精力最为集中。建议将最需要逻辑推理和文字整合的工作安排在9-11点完成，此时段头脑清晰、思路流畅，处理合同、报告等细节工作事半功倍。午后能量开始收敛，适合做较为机械的整理归档工作。' },
              { question: '哪类文书最适合今天处理？', answer: '今日最适合处理需要精准表达的文书：合同审核与修改、数据分析报告、工作计划制定、邮件回复与沟通记录。庚金的特质是精准锋利，今日这些特质得到充分发挥。避免需要创意发散的文案写作，那类工作在火气旺盛的日子效果更佳。' },
            ],
          },
          {
            golden_sentence: '暂缓激进提案，以柔克刚',
            detailed_content: '流月火气较旺，与日主金形成克制关系，此时主动出击可能遭遇阻力。建议将新提案或晋升谈判推迟到下周，本周以整合资源、完善细节为主，蓄势待发效果更佳。',
            followUpQuestions: [
              { question: '何时适合重新发起提案？', answer: '从运势节律来看，当流月转入壬癸水月（金水相生）时，是发起提案的最佳窗口，通常在本月底至下月初。届时日主金气得到水的滋养，表达能力和说服力都会明显提升。可在此之前将提案打磨完善，等待时机成熟后一击即中。' },
              { question: '如何在等待中积累优势？', answer: '等待期最有价值的事是"充实弹药"：整理竞品分析数据、完善提案中的薄弱论证、收集支持观点的案例、提前了解决策者的关注点。同时可以通过非正式渠道试探反馈，了解潜在阻力所在，等正式提出时便能有针对性地回应质疑。' },
            ],
          },
        ],
      },
      {
        scene: 'health',
        change_level: '变化较小',
        advices: [
          {
            golden_sentence: '肺与呼吸道需重点关注',
            detailed_content: '金主肺，五行中金气偏旺时需注意呼吸系统。今日建议避免长时间处于空气不流通的环境，适量补充润肺食物如梨、银耳等。早晚各做10分钟深呼吸练习，有助于气血运行顺畅。',
            followUpQuestions: [
              { question: '哪些食物对肺最有益？', answer: '庚金体质的人肺气较旺，滋养方向是润燥清热。推荐白色食物：银耳（滋阴润肺）、雪梨（清肺降火）、白萝卜（化痰顺气）、百合（宁心润肺）、山药（补肺益气）。日常可饮用菊花枸杞茶或罗汉果茶。避免辛辣油炸食品，春季适当增加绿叶蔬菜平衡金木。' },
              { question: '深呼吸练习有什么具体方法？', answer: '推荐腹式深呼吸：取舒适坐姿，一手放胸部，一手放腹部。用鼻子缓慢吸气4秒，感受腹部鼓起；屏息2秒；再用嘴缓慢呼气6秒，腹部收回。每组10次，早晚各练习一组。长期坚持可增强肺活量，缓解金气过旺带来的胸闷感，同时有助于安神助眠。' },
            ],
          },
          {
            golden_sentence: '运动宜轻缓，避免剧烈消耗',
            detailed_content: '今日能量偏于收敛状态，剧烈运动容易透支体力。推荐散步、瑜伽或太极等舒缓运动，时长控制在30-45分钟为宜。运动后注意及时补水，保持充足睡眠以恢复精气。',
            followUpQuestions: [
              { question: '什么时间段运动最合适？', answer: '金气体质的人下午4-6点（申酉时）运动效果最佳，此时金气当令，肺气最为充足，有助于提升运动表现和氧气利用率。早晨7-9点次之，适合散步或轻度舒展。避免正午时分运动，火气最旺容易与金形成相克，造成不必要的消耗。' },
              { question: '如何判断运动量是否过度？', answer: '判断标准：运动后15分钟内心率恢复正常（低于100次/分）为适量；若运动后感到精力充沛为佳；若出现次日仍感疲惫、睡眠变浅、食欲下降，则说明已超量。庚金日主的人能量收敛，今日单次运动心率建议控制在最大心率的60-70%（约110-130次/分），以"能正常交谈"为舒适标准。' },
            ],
          },
        ],
      },
    ],
    insight_cards: [
      {
        category: 'overall',
        title: '静守蓄势，稳中有进',
        description: '今日整体运势趋于平稳，适合积蓄能量而非主动出击。保持从容心态，细心处理手头事务，好机会将在稳健中自然显现。',
        question: '今日最值得专注的一件事是什么？',
      },
      {
        category: 'career',
        title: '文书见长，避锋待时',
        description: '职场上文字处理与逻辑分析能力今日发挥较佳，适合推进文档类工作。重大决策和对外谈判建议延后，以守为攻是本日最优策略。',
        question: '有哪些拖延已久的文件可以今天处理？',
      },
      {
        category: 'love',
        title: '平稳温润，细水长流',
        description: '感情运势平稳，没有大起大落。单身者可多参加小范围社交活动，已有伴侣者适合进行深度交流，一起规划近期小目标。',
        question: '有什么话一直想对对方说却没说？',
      },
      {
        category: 'health',
        title: '润肺养气，轻缓为宜',
        description: '金主肺，今日需关注呼吸系统健康。避免剧烈运动，选择散步或瑜伽等舒缓方式活动筋骨，饮食上多摄入白色润肺食物。',
        question: '上次好好休息是什么时候？',
      },
      {
        category: 'study',
        title: '专注深耕，逻辑清晰',
        description: '今日思维清晰，逻辑性强，非常适合学习需要推理和分析的内容。建议将学习时间集中在上午，效率最高，避免碎片化学习。',
        question: '有哪个知识点一直没弄明白？',
      },
    ],
    analysis: {
      overall: {
        golden_sentence: '静守蓄势，稳中有进',
        detailed_content: `今日[${stem}金受流月火克]{highlight}，整体运势呈收敛之势。此时最忌强行突破，宜将精力集中于完善细节、巩固已有成果。[守中有进]{highlight}，平稳度过此阶段后，下周运势将有明显回升。`,
        followUpQuestions: [
          { question: '为何近期感觉推进什么都阻力重重？', answer: `从八字角度分析，您的日主${stem}金正处于流月丙火的克制周期中，金火相克导致行动力受到压制，这是自然的能量消长规律，并非个人能力问题。此阶段最明智的做法是减少正面对抗，将精力转向内部整合与资源积累，等待下一个金气得令的周期到来，届时您会明显感受到阻力消减、推进顺畅。` },
          { question: '如何在低能量期保持状态？', answer: '低能量期并不意味着无所作为，而是调整策略的好时机。建议：① 将每天的任务清单缩减为最重要的3件事；② 充分利用上午精力最佳的时段处理核心工作；③ 保证7-8小时睡眠，让身体自我修复；④ 减少无效社交，把时间留给真正重要的人和事。蓄势充分，才能在好时机到来时全力爆发。' },
        ],
      },
      career: {
        golden_sentence: '文书见长，避锋待时',
        detailed_content: `职场运势今日[偏向内务型工作]{highlight}，文字表达、数据整理、方案修订等任务均能高效完成。对外谈判、项目汇报等需要冲劲的工作建议延后，[以退为进]{highlight}是本阶段职场生存最优策略。`,
        followUpQuestions: [
          { question: '上司最近对我态度变冷，怎么回事？', answer: '从运势角度看，流月火克金的格局也影响职场人际，上司或权威人物可能因为外部压力将情绪带入工作中，并非针对个人。建议近期保持低调，多做少说，用扎实的工作成果说话。避免主动要求资源或提升，等待运势回转后再行动，届时机会自然浮现。' },
          { question: '现在适合找新工作吗？', answer: '目前阶段不是跳槽的最佳时机。火克金的周期中，新环境的适应压力会倍增，面试时状态也可能不是最佳。建议先将精力放在提升现有岗位的技能，储备跳槽资本。待壬癸水月来临时，金水相生，届时无论留或走都会有更清晰的方向和更强的竞争力。' },
        ],
      },
      love: {
        golden_sentence: '平稳温润，细水长流',
        detailed_content: `感情方面今日无大波澜，[适合深度沟通]{highlight}而非制造浪漫惊喜。单身者可在熟悉的社交圈中留意缘分，已有伴侣者今日是坦诚表达内心想法的好时机，[真诚胜于技巧]{highlight}。`,
        followUpQuestions: [
          { question: '为何近期与伴侣摩擦增多？', answer: `流月火旺容易让人情绪波动较大，${stem}金日主在此环境下可能显得更为固执，防御性增强，伴侣感受到"冷硬"后容易产生距离感，形成摩擦循环。建议主动软化态度，在非敏感话题上先做出让步，让伴侣感受到您愿意改变的诚意。此阶段感情维护重在"温度"而非"对错"。` },
          { question: '单身的我该如何提升桃花运？', answer: `您的八字格局中${element}气偏旺，在感情上容易给人"不好接近"的印象，即使内心热情，外在表现也偏于理性克制。提升桃花运的关键在于主动展示温柔的一面：多参与轻松的小聚活动，学习倾听他人，减少批评和分析式的回应。缘分需要一个"可以走近"的入口，适当降低防御心是关键。` },
        ],
      },
      health: {
        golden_sentence: '润肺养气，轻缓为宜',
        detailed_content: `健康方面需重点关注[肺与呼吸系统]{highlight}，金主肺，五行偏旺时对应脏腑需要格外养护。饮食上多摄入白色润肺食材，运动选择[轻缓舒展]{highlight}类型，避免高强度消耗。`,
        followUpQuestions: [
          { question: '最近总是莫名疲惫是怎么回事？', answer: `从八字角度看，您目前处于运势的蓄积期，身体能量也在进行自我调整和修复，疲惫感是正常的生理反应。建议检查近期的睡眠质量——${stem}金格局的人容易在压力大时出现入睡困难或浅眠，这会严重影响白天精力。改善睡眠的优先级高于任何其他调理方式。` },
          { question: '什么饮食对我的体质最有益？', answer: `${stem}金体质的人肺气较旺，对应的调养方向是润燥清热。推荐食材：银耳、雪梨、白萝卜、百合、山药等白色食物；适量饮用菊花茶或罗汉果茶清肺降火。避免辛辣刺激、油炸食品，减少烟酒摄入。春季可适当增加绿色蔬菜的摄入，实现金木平衡。` },
        ],
      },
      study: {
        golden_sentence: '专注深耕，逻辑清晰',
        detailed_content: `学习方面今日思维[逻辑清晰]{highlight}，分析推理能力较强，适合攻克需要系统理解的知识点。将学习时间集中在上午效率最高，[深度学习优于碎片积累]{highlight}，今天不适合广泛涉猎，宜精不宜多。`,
        followUpQuestions: [
          { question: '为什么学了很多却感觉没有进步？', answer: `这是典型的"输入过剩、输出不足"问题。知识只有通过输出（写作、讲解、实践）才能真正内化。${stem}金格局的人学习能力强，但有时过于追求"学完"而忽略"用好"。建议将学习节奏调整为：每学习30分钟，用10分钟做笔记或向他人讲解，这个方法会让知识吸收率大幅提升。` },
          { question: '如何保持长期学习的动力？', answer: '动力来自于看见进步。建议建立一个可视化的学习进度系统：用打卡表记录每天的学习内容，每周做一次小测试检验掌握程度，每月回顾一次阶段性成果。金属性格局的人对"精确感知进步"有强烈需求，当你能清晰看到自己的成长曲线时，内在驱动力会自然涌现。' },
        ],
      },
    },
  };
}
