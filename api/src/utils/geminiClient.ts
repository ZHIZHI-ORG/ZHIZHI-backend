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
    overall: AnalysisItem[];   // 5张 MediumInsightCard
    career: AnalysisItem[];
    love: AnalysisItem[];
    health: AnalysisItem[];
    study: AnalysisItem[];
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
    "overall": [
      { "golden_sentence": "核心金句（5-10字）", "detailed_content": "详细建议（80-120字，可用 [关键词]{highlight} 标注重点）", "followUpQuestions": [{"question": "追问问题1（10-20字）", "answer": "答案（150-200字）"}, {"question": "追问问题2", "answer": "答案"}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] }
    ],
    "career": [
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] }
    ],
    "love": [
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] }
    ],
    "health": [
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] }
    ],
    "study": [
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] },
      { "golden_sentence": "", "detailed_content": "", "followUpQuestions": [{"question": "", "answer": ""}, {"question": "", "answer": ""}] }
    ]
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
      overall: [
        {
          golden_sentence: '静守蓄势，稳中有进',
          detailed_content: `今日[${stem}金受流月火克]{highlight}，整体运势呈收敛之势。此时最忌强行突破，宜将精力集中于完善细节、巩固已有成果。[守中有进]{highlight}，平稳度过此阶段后，下周运势将有明显回升。`,
          followUpQuestions: [
            { question: '为何近期感觉推进什么都阻力重重？', answer: `从八字角度分析，您的日主${stem}金正处于流月丙火的克制周期中，金火相克导致行动力受到压制，这是自然的能量消长规律，并非个人能力问题。此阶段最明智的做法是减少正面对抗，将精力转向内部整合与资源积累，等待下一个金气得令的周期到来，届时您会明显感受到阻力消减、推进顺畅。` },
            { question: '如何在低能量期保持状态？', answer: '低能量期并不意味着无所作为，而是调整策略的好时机。建议：① 将每天的任务清单缩减为最重要的3件事；② 充分利用上午精力最佳的时段处理核心工作；③ 保证7-8小时睡眠，让身体自我修复；④ 减少无效社交，把时间留给真正重要的人和事。蓄势充分，才能在好时机到来时全力爆发。' },
          ],
        },
        {
          golden_sentence: '情绪收敛，观察为上',
          detailed_content: `${stem}金性格内敛，今日流月带来额外压力，情绪容易积压。[觉察情绪]{highlight}而非压抑是关键，可通过简短的冥想或独处时间完成内在整理。[以静制动]{highlight}，今日的沉淀是明日爆发的基础。`,
          followUpQuestions: [
            { question: '情绪积压久了会有什么影响？', answer: `${stem}金体质的人天生情绪处理偏向内化，容易将压力转为身体信号，比如肩颈紧张、睡眠变浅、消化不佳。长期积压会影响金主肺的功能，引发呼吸系统问题。建议每天留出15分钟"情绪处理时间"：写日记、冥想或与信任的人倾诉，及时疏导比累积后爆发代价小得多。` },
            { question: '有什么快速平复情绪的方法？', answer: '当感到情绪涌上来时，可以用4-7-8呼吸法：用鼻子吸气4秒，屏息7秒，用嘴呼气8秒，重复3-4次。这个方法能激活副交感神经，在2-3分钟内降低焦虑感。另外，短暂离开当前环境——哪怕只是走到窗边看5分钟远处——也能有效打断情绪循环，给大脑一个重置的机会。' },
          ],
        },
        {
          golden_sentence: '细节决定成败，精益求精',
          detailed_content: `今日${stem}金的精准特质得到充分发挥，[注重细节]{highlight}的工作最能彰显您的价值。无论是文件校对、数据核验还是方案完善，此刻的细心投入都将带来超出预期的成果，[精益求精]{highlight}是今日最有价值的行动方向。`,
          followUpQuestions: [
            { question: '如何避免因追求完美而拖延？', answer: '完美主义拖延的本质是"对结果的恐惧"。解决方法是设定"足够好"标准：在开始前明确写下"这件事达到什么程度就算完成"，而不是追求无限优化。可以用"80分完成，20分迭代"的原则——先交出80分的版本，收集反馈后再迭代提升。金属性格局的人一旦建立了明确标准，反而能发挥出超高效率。' },
            { question: '今天最适合审查哪类细节？', answer: `${stem}金日主在逻辑结构和数字准确性上天生敏锐，今日特别适合：数据报表的核验与复盘、合同条款的逐条核读、代码或设计稿的错误排查、重要邮件发送前的最终检查。这些工作在平时可能令人烦躁，但今日您会发现自己能以高度专注进入"心流"状态，错误发现率明显提升。` },
          ],
        },
        {
          golden_sentence: '整合资源，构建优势',
          detailed_content: `今日适合进行[资源盘点]{highlight}：梳理手头未完成的项目、整理联系人脉络、归纳近期学到的知识。这些看似"整理"的工作实际上是在构建竞争优势。[厚积薄发]{highlight}，当下的积累将成为下个阶段快速突破的底气。`,
          followUpQuestions: [
            { question: '怎样有效整理和激活沉睡的人脉？', answer: '人脉整理分三步：① 筛选——将联系人按"互动频率"和"资源匹配度"分为A/B/C三级；② 激活——对A级人脉每月主动联系一次，内容要有价值（分享有用信息、提出合作机会）；③ 维护——对B级人脉每季度问候一次，保持存在感。避免"有事才找人"的模式，平时建立的情感账户，在关键时刻才能顺畅提取。' },
            { question: '如何快速梳理手头积压的未完成事项？', answer: '推荐"GTD清空法"：① 用20分钟将所有未完成事项全部写下来，不分类不判断；② 逐一判断每件事的"下一步行动"是什么（一个具体的动词+对象）；③ 按"2分钟能完成的立即做，超过2分钟的加入计划"原则分配。这个过程通常能让积压感减少70%以上，因为真正的压力不是事情多，而是大脑反复想起它们却没有出口。' },
          ],
        },
        {
          golden_sentence: '顺势而为，借力打力',
          detailed_content: `金克木、火克金——今日运势提醒您[识别外部阻力]{highlight}，不要硬碰硬。找到当前环境中对您有利的力量（支持者、有利政策、市场趋势），[借势推进]{highlight}比单打独斗效率高出数倍，智慧在于选择战场。`,
          followUpQuestions: [
            { question: '如何判断哪些外部力量对我有利？', answer: `判断"可借之势"有三个维度：① 方向一致——对方的目标和您的目标有交集；② 资源互补——对方拥有您缺少的资源（信息、渠道、资金、技术）；③ 成本合理——合作或借助的代价在可承受范围内。${stem}金的人擅长逻辑分析，建议用表格列出当前可接触的5个潜在"势能"，逐一打分评估，找出最值得投入时间的那个。` },
            { question: '被人借势利用了怎么办？', answer: `${stem}金格局的人有时因为理性而忽视了情感层面的博弈，容易被善于表达的人过度占用资源。预防方法：在合作前明确"我能提供什么，对方能回报什么"，将模糊的承诺落实为具体时间节点。如果发现已被占用，不必正面冲突，可以逐步减少投入，将资源转向更对等的关系，金的特质是干脆，边界一旦设定就坚守。` },
          ],
        },
      ],
      career: [
        {
          golden_sentence: '文书见长，避锋待时',
          detailed_content: `职场运势今日[偏向内务型工作]{highlight}，文字表达、数据整理、方案修订等任务均能高效完成。对外谈判、项目汇报等需要冲劲的工作建议延后，[以退为进]{highlight}是本阶段职场生存最优策略。`,
          followUpQuestions: [
            { question: '上司最近对我态度变冷，怎么回事？', answer: '从运势角度看，流月火克金的格局也影响职场人际，上司或权威人物可能因为外部压力将情绪带入工作中，并非针对个人。建议近期保持低调，多做少说，用扎实的工作成果说话。避免主动要求资源或提升，等待运势回转后再行动，届时机会自然浮现。' },
            { question: '现在适合找新工作吗？', answer: '目前阶段不是跳槽的最佳时机。火克金的周期中，新环境的适应压力会倍增，面试时状态也可能不是最佳。建议先将精力放在提升现有岗位的技能，储备跳槽资本。待壬癸水月来临时，金水相生，届时无论留或走都会有更清晰的方向和更强的竞争力。' },
          ],
        },
        {
          golden_sentence: '积累口碑，厚积薄发',
          detailed_content: `今日不宜争功抢先，而是[默默积累口碑]{highlight}的好时机。高质量地完成分配到的每项任务，让结果替您说话。同事和上级会逐渐形成"靠谱"印象，[信任是最稀缺的职场资产]{highlight}，此刻的付出正在投资未来的机会。`,
          followUpQuestions: [
            { question: '如何让努力被看见而不显得刻意？', answer: '自然地展示工作成果有几个技巧：① 在团队群中分享"今日进展"时，具体写出解决了什么问题、产出了什么成果，而不只是"完成了XX"；② 在汇报时主动提一句"这里遇到了XX难点，我用XX方法解决了"，让过程可见；③ 遇到好结果时，及时感谢协助你的同事，让成功变成一件有人见证的事。透明度本身就是最好的自我推销。' },
            { question: '同事抢功了我该怎么处理？', answer: '遇到抢功情况，冷静应对比情绪反应更有效。短期：在下次相关场合自然提及您的具体贡献（用事实，不带攻击性）；中期：建立"留痕"习惯，重要工作通过邮件确认、文档记录，让贡献有迹可查；长期：与直属上级建立定期一对一沟通，让对方直接了解您的工作内容，减少依赖他人转述。金的特质是公正，坚守事实是最有力的武器。' },
          ],
        },
        {
          golden_sentence: '深耕专业，建立壁垒',
          detailed_content: `${stem}金的精准特质在专业深度上有天然优势。今日适合[深化核心技能]{highlight}，选定一个关键领域集中投入，而非广泛涉猎。专业壁垒是职场中最难被替代的竞争力，[宁做某领域专家]{highlight}，胜过样样平庸的全才。`,
          followUpQuestions: [
            { question: '如何选定值得深耕的专业方向？', answer: '选择深耕方向可以用"三圆交集法"：① 你擅长的（现有优势）；② 你感兴趣的（长期投入不觉疲惫）；③ 市场需要的（有实际应用和变现场景）。三圆交集处就是值得深耕的方向。如果找不到明显交集，优先选择"擅长且市场需要"的，兴趣可以在实践中培养，但市场需求是客观存在的，不能忽视。' },
            { question: '深耕一个领域会不会太窄，错过机会？', answer: `这是常见的误解。专业深度带来的是"T型能力"的竖线——一个坚实的核心竞争力。在此基础上横向拓展（横线），反而比从零开始广泛积累更高效。${stem}金格局的人专注力强、执行精准，最适合先在某一领域建立权威地位，再向周边延伸。历史上最有影响力的人几乎都是某一领域的深度专家，而非全才通才。` },
          ],
        },
        {
          golden_sentence: '理清优先级，拒绝内耗',
          detailed_content: `今日流月带来额外的工作干扰，[明确优先级]{highlight}是保持高效的关键。用"重要/紧急"矩阵重新评估手头所有任务，果断推迟或拒绝低价值请求。[保护核心时间]{highlight}不被碎片化任务侵蚀，才能真正推进重要目标。`,
          followUpQuestions: [
            { question: '如何拒绝同事请求而不伤感情？', answer: '拒绝的艺术在于"接受请求，拒绝时间"。句式模板：" 这个很重要，我目前手头有XX正在推进，我XX时间（给一个具体时间点）可以帮你看，你看行吗？"这样既表达了重视对方，又为自己划定了边界。如果对方的请求真的超出您的职责范围，可以补充："这块可能更适合找XX（更对口的人），他在这方面比我更专业。"' },
            { question: '总是被紧急事项打断，怎么办？', answer: '频繁被打断的根本原因通常是"响应预期"——别人默认你会立即回应。改变这一预期需要温和而一致地重新设定：① 设定固定的"集中工作时间"（如上午9-11点），期间关闭即时通讯消息提醒；② 对需要你的人说"我下午2点会统一回复消息"；③ 对真正紧急的事设定一个绕过机制（如电话）。坚持2-3周后，团队会自然适应你的节奏。' },
          ],
        },
        {
          golden_sentence: '向上管理，主动沟通',
          detailed_content: `今日是与上级进行[主动沟通]{highlight}的好时机，但方式要以"汇报进展、对齐预期"为主，而非提出新需求。让上级清楚您的工作状态，减少信息不对称带来的误解。[管理预期]{highlight}是职场中被严重低估的关键技能。`,
          followUpQuestions: [
            { question: '如何做一次高质量的向上汇报？', answer: '高效汇报的结构：① 结论先行——用一句话说清楚"目前状态是什么"；② 关键数据——2-3个能体现进展的具体数字或里程碑；③ 遇到的挑战——主动说出障碍，同时附上您的应对方案（而非等上级给答案）；④ 下一步计划——清晰说明接下来要做什么，预计何时完成。全程控制在5分钟内，上级最讨厌"不知道重点在哪里"的汇报。' },
            { question: '上级总是临时改需求怎么应对？', answer: '应对频繁变更需求的核心是"让变更成本可见"。每次收到变更时，平静地反馈："好的，我来评估一下这个调整对当前进度的影响，可能需要延后XX天/需要增加XX资源，您确认吗？"这样的沟通不是抱怨，而是让上级意识到变更是有代价的，促使其在做决定前多思考一步。同时帮助双方共同管理项目风险，而非您一个人独自承受。' },
          ],
        },
      ],
      love: [
        {
          golden_sentence: '平稳温润，细水长流',
          detailed_content: `感情方面今日无大波澜，[适合深度沟通]{highlight}而非制造浪漫惊喜。单身者可在熟悉的社交圈中留意缘分，已有伴侣者今日是坦诚表达内心想法的好时机，[真诚胜于技巧]{highlight}。`,
          followUpQuestions: [
            { question: '为何近期与伴侣摩擦增多？', answer: `流月火旺容易让人情绪波动较大，${stem}金日主在此环境下可能显得更为固执，防御性增强，伴侣感受到"冷硬"后容易产生距离感，形成摩擦循环。建议主动软化态度，在非敏感话题上先做出让步，让伴侣感受到您愿意改变的诚意。此阶段感情维护重在"温度"而非"对错"。` },
            { question: '单身的我该如何提升桃花运？', answer: `您的八字格局中${element}气偏旺，在感情上容易给人"不好接近"的印象，即使内心热情，外在表现也偏于理性克制。提升桃花运的关键在于主动展示温柔的一面：多参与轻松的小聚活动，学习倾听他人，减少批评和分析式的回应。缘分需要一个"可以走近"的入口，适当降低防御心是关键。` },
          ],
        },
        {
          golden_sentence: '倾听胜于表达，用心感受',
          detailed_content: `${stem}金的人擅长分析，有时会无意中将感情交流变成"问题诊断"。今日提醒您[放下分析模式]{highlight}，专注于倾听伴侣或身边人真正想表达的情感需求。[被听见比被理解更重要]{highlight}，一个安静的陪伴往往胜过十句解决方案。`,
          followUpQuestions: [
            { question: '如何练习真正的倾听而不急于给建议？', answer: '主动倾听的核心是"延迟判断"。实操方法：对方说话时，忍住给建议的冲动，改用"然后呢？""你当时感觉怎样？"等开放性问题引导对方继续表达；等对方说完后，先复述你听到的内容（"我听到你说……是这样吗？"），确认理解无误后再表达你的想法。这个过程会让对方感受到"我被认真对待了"，大幅提升沟通质量。' },
            { question: '伴侣说我"不够用心"，我该怎么改变？', answer: `"不够用心"通常指的是细节层面的关注度不足。${stem}金的人擅长大局但容易忽略细节。改变从三件小事开始：① 记住对方最近提到的一件重要的事（面试、项目、健康检查），在事后主动询问结果；② 发现对方情绪变化时，不等对方开口，主动问一句"今天看起来不太对，发生什么了？"；③ 每周制造一次二人专属时间，手机静音。用心不是抽象的，它体现在一个个具体的细节里。` },
          ],
        },
        {
          golden_sentence: '共同成长，携手前行',
          detailed_content: `感情长久的秘诀是[共同成长]{highlight}而非相互依赖。今日适合与伴侣讨论近期各自的目标和计划，找到可以互相支持的交汇点。两个都在进步的人，感情会随时间[越来越深厚]{highlight}；而停滞不前的一方，会让另一方感到窒息。`,
          followUpQuestions: [
            { question: '和伴侣的成长方向不一样怎么办？', answer: '方向不同不一定是问题，关键是双方是否都在成长，以及是否尊重对方的成长路径。可以问自己三个问题：① 我们各自的成长是否互相兼容（生活方式、时间分配不冲突）；② 在核心价值观上我们是否一致（对家庭、金钱、事业的基本态度）；③ 我们是否都支持对方追求自己的目标。如果三点都是肯定的，方向不同反而能带来互补，是感情中的优势而非障碍。' },
            { question: '如何与伴侣一起制定共同目标？', answer: '共同目标需要"自愿+具体+可追踪"。步骤：① 分别写下各自未来1年最重要的3个目标，不互相影响地完成；② 分享并找出交集（可能是存钱、旅行、健康、购房等）；③ 针对共同目标制定具体计划，明确各自负责的部分；④ 每月一次简短的"目标复盘"，庆祝进展、调整偏差。这个过程本身就是亲密关系的建立——共同经历"为了一件事努力"的过程。' },
          ],
        },
        {
          golden_sentence: '化解隔阂，主动靠近',
          detailed_content: `感情中的[距离感]{highlight}如果不及时处理，会像裂缝一样越扩越大。今日${stem}金的沟通力较强，适合主动发起一次真诚的对话，哪怕只是"最近我们好像都很忙，我有点想你"这样简单的一句话。[主动是爱的具体行动]{highlight}，等待对方先开口，只会让彼此更疏远。`,
          followUpQuestions: [
            { question: '主动示好被无视或冷淡回应怎么办？', answer: `${stem}金的人自尊心强，被无视时容易选择退缩甚至以冷制冷，这会加速关系恶化。建议：给对方时间和空间（可能对方有自己的压力），但不要沉默超过48小时。第二次尝试换一种方式，从行动而非语言入手——准备对方喜欢的食物、完成一件对方头疼的事。如果多次尝试都无法打破僵局，那问题可能不在于你的方式，而需要一次直接的"我们之间发生了什么"的对话。` },
            { question: '异地恋如何维持感情温度？', answer: '异地恋维系感情温度有三个关键：① 固定的"在一起"仪式——每晚固定时间的视频，哪怕只有10分钟，建立一种"结束一天，和你分享"的习惯；② 参与对方的日常——询问对方今天吃了什么、遇到什么有趣的事，让对方感受到虽然不在身边但你关注着他的生活；③ 有期待可盼——永远有一个具体的"下次见面"计划，没有期待的异地会让人感到漫无边际的孤独。' },
          ],
        },
        {
          golden_sentence: '爱自己，是一切关系的基础',
          detailed_content: `今日运势提醒您，[对自己的关爱]{highlight}不是自私，而是维系健康关系的前提。过度付出而忽略自身需求，会导致情绪耗竭和关系失衡。找到今天让自己感到滋养的一件小事去做，[充盈的自己]{highlight}才能给予他人真正的爱与陪伴。`,
          followUpQuestions: [
            { question: '总是在感情中付出更多，如何改变？', answer: `${element}气偏强的人在感情中有时会用"付出"来获得安全感，担心付出少了会失去对方。但这种模式长期下去容易产生委屈感，并将压力转移给伴侣。改变从识别开始：注意自己在什么情况下说"好，我来"——是真心愿意，还是害怕冲突？每次做决定前问自己"如果对方不感谢我，我还愿意做这件事吗？"如果答案是否，那就是边界在被侵蚀的信号。` },
            { question: '如何在恋爱中不迷失自我？', answer: '保持自我的核心是维护三个"自己的空间"：① 时间空间——保留属于自己的兴趣爱好，不因恋爱而完全放弃；② 思想空间——保持独立思考，不因爱对方就认同他所有的观点；③ 情感空间——拥有除伴侣之外的朋友和支持系统。健康的爱情是"1+1>2"——两个完整的人相遇，而不是两个半人拼成一个整体。你越完整，关系越稳固。' },
          ],
        },
      ],
      health: [
        {
          golden_sentence: '润肺养气，轻缓为宜',
          detailed_content: `健康方面需重点关注[肺与呼吸系统]{highlight}，金主肺，五行偏旺时对应脏腑需要格外养护。饮食上多摄入白色润肺食材，运动选择[轻缓舒展]{highlight}类型，避免高强度消耗。`,
          followUpQuestions: [
            { question: '最近总是莫名疲惫是怎么回事？', answer: `从八字角度看，您目前处于运势的蓄积期，身体能量也在进行自我调整和修复，疲惫感是正常的生理反应。建议检查近期的睡眠质量——${stem}金格局的人容易在压力大时出现入睡困难或浅眠，这会严重影响白天精力。改善睡眠的优先级高于任何其他调理方式。` },
            { question: '什么饮食对我的体质最有益？', answer: `${stem}金体质的人肺气较旺，对应的调养方向是润燥清热。推荐食材：银耳、雪梨、白萝卜、百合、山药等白色食物；适量饮用菊花茶或罗汉果茶清肺降火。避免辛辣刺激、油炸食品，减少烟酒摄入。春季可适当增加绿色蔬菜的摄入，实现金木平衡。` },
          ],
        },
        {
          golden_sentence: '睡眠为本，修复优先',
          detailed_content: `今日能量偏向收敛，身体正在进行自我修复，[优质睡眠]{highlight}是最好的养生方式。建议今晚比平时早30分钟入睡，睡前一小时避免手机屏幕，可做5分钟温水泡脚。[让身体好好休息]{highlight}，明日的精力将远胜于今日硬撑。`,
          followUpQuestions: [
            { question: '如何改善入睡困难的问题？', answer: `${stem}金格局的人思维活跃，睡前容易反复思考未完成的事，导致入睡困难。改善方法：① 睡前将明日待办事项写下来（"大脑清空"技术，让思维有地方"放下"事情）；② 保持固定起床时间（比固定入睡时间更重要，它会反向稳定生物钟）；③ 睡前1小时调暗灯光，避免蓝光刺激；④ 可以尝试478呼吸法（吸气4秒，屏息7秒，呼气8秒）帮助神经系统进入休息状态。` },
            { question: '白天总想打盹，是身体出了问题吗？', answer: '白天困倦通常来自三个原因：① 夜间睡眠质量差（即使睡够时数）——建议检查是否有打鼾、频繁翻身等浅眠信号；② 饭后血糖波动——高碳水午餐会导致下午2-3点困倦，改为"少糖+蛋白质+蔬菜"的搭配可明显改善；③ 久坐导致血液循环减缓——每小时起身活动5分钟，比喝咖啡更能持久提神。如症状持续超过两周，建议检查甲状腺功能和血常规。' },
          ],
        },
        {
          golden_sentence: '情绪与身体，同频调养',
          detailed_content: `中医认为金主悲，${stem}金体质的人在情绪低落时更容易出现[肺气受损]{highlight}的信号，如叹气频繁、胸口发闷。今日关注情绪状态与身体反应的关联，一旦发现身体在"说话"，即刻停下来做几次[深腹式呼吸]{highlight}，让气机重新流通。`,
          followUpQuestions: [
            { question: '什么身体信号说明我情绪压力过大？', answer: `${stem}金体质的压力信号通常出现在：① 肺/呼吸系统——容易叹气、胸闷、偶发咳嗽（无感染原因）；② 皮肤——干燥、暗沉或小疹子增多（肺主皮毛）；③ 大肠——便秘或腹泻交替出现（金主大肠）；④ 整体——莫名感到悲伤、对事物失去兴趣。出现2个以上信号时，说明情绪压力已经开始影响身体，需要主动减压，而不仅仅依靠身体自我修复。` },
            { question: '有哪些呼吸练习可以快速缓解压力？', answer: '三种实用的呼吸练习：① 腹式呼吸（基础）：吸气时腹部鼓起，呼气时腹部收回，5分钟即可激活副交感神经；② 等时呼吸（平衡）：吸气4秒、屏息4秒、呼气4秒，适合焦虑时使用；③ 延长呼气呼吸（快速放松）：吸气4秒、呼气8秒，呼气时间是吸气的两倍，能快速降低心率。每天早晚各练5分钟，两周内您会明显感受到整体压力水平下降。' },
          ],
        },
        {
          golden_sentence: '适度运动，激活气血',
          detailed_content: `今日能量虽偏收敛，但[适度的身体活动]{highlight}依然必要。推荐选择对肺有益的有氧运动：快走、游泳或骑车，时长30-45分钟为宜。运动时专注于呼吸节律，让每一次深呼吸都成为[养肺的时机]{highlight}，而非单纯消耗体力的过程。`,
          followUpQuestions: [
            { question: '游泳和跑步哪个更适合金属体质？', answer: `游泳对${stem}金体质尤为适合，原因有三：① 游泳涉及大量呼吸控制，直接锻炼肺活量，与金主肺相合；② 水属壬癸，金水相生，游泳环境与金属体质相辅；③ 游泳是全身性有氧运动，强度可自由控制，不会造成关节冲击伤害。跑步也是好选择，但建议在空气质量好的环境（公园、河边）进行，避免在污染较重的路边跑步，以保护肺部。` },
            { question: '工作太忙没时间运动怎么办？', answer: '忙碌时期的运动策略是"化整为零"：① 上下班步行最后500米，累计每天增加20分钟步行；② 利用等电梯、等微波炉的碎片时间做原地踏步或拉伸；③ 每工作1小时，起身做2分钟颈肩放松（低头、转头、耸肩）；④ 午休10分钟快走。这些微运动的累积效果虽不及连续运动，但比完全不动强出很多，且更容易坚持，不会因为"没时间去健身房"而产生罪恶感放弃整个计划。' },
          ],
        },
        {
          golden_sentence: '节律为王，作息稳定',
          detailed_content: `身体的修复能力依赖稳定的昼夜节律，[规律的作息]{highlight}是最廉价也最有效的养生方式。今日特别提醒：固定起床时间比固定入睡时间更重要，它是生物钟的"锚点"。抵制熬夜冲动，[黄金修复发生在夜间11点前]{highlight}，这段时间的睡眠质量远超凌晨。`,
          followUpQuestions: [
            { question: '已经熬夜习惯了，如何调整回来？', answer: '调整作息不能急，猛然早睡通常无法入睡，反而挫败信心。正确方法：每3天将入睡时间提前30分钟（而不是一次提前2小时），同时固定起床时间不变。两周后生物钟会自然适应新的作息。期间可以配合：傍晚6点后减少咖啡因摄入、睡前1小时调暗灯光、早晨起床后立刻拉开窗帘接受自然光（这是重置生物钟最有效的单一方法）。' },
            { question: '怎样知道自己的睡眠质量是否达标？', answer: '评估睡眠质量的几个实用指标：① 入睡时间——躺下15-20分钟内入睡为正常；② 夜间唤醒——整夜醒来不超过1次为良好；③ 起床感受——起床时感觉有精力，而非需要很久才能"启动"；④ 白天状态——下午3点前无强烈困倦感。如果连续一周有2项以上不达标，可以先从"固定起床时间+睡前减少屏幕"这两项改变入手，通常2周内会有明显改善。' },
          ],
        },
      ],
      study: [
        {
          golden_sentence: '专注深耕，逻辑清晰',
          detailed_content: `学习方面今日思维[逻辑清晰]{highlight}，分析推理能力较强，适合攻克需要系统理解的知识点。将学习时间集中在上午效率最高，[深度学习优于碎片积累]{highlight}，今天不适合广泛涉猎，宜精不宜多。`,
          followUpQuestions: [
            { question: '为什么学了很多却感觉没有进步？', answer: `这是典型的"输入过剩、输出不足"问题。知识只有通过输出（写作、讲解、实践）才能真正内化。${stem}金格局的人学习能力强，但有时过于追求"学完"而忽略"用好"。建议将学习节奏调整为：每学习30分钟，用10分钟做笔记或向他人讲解，这个方法会让知识吸收率大幅提升。` },
            { question: '如何保持长期学习的动力？', answer: '动力来自于看见进步。建议建立一个可视化的学习进度系统：用打卡表记录每天的学习内容，每周做一次小测试检验掌握程度，每月回顾一次阶段性成果。金属性格局的人对"精确感知进步"有强烈需求，当你能清晰看到自己的成长曲线时，内在驱动力会自然涌现。' },
          ],
        },
        {
          golden_sentence: '间隔复习，巩固记忆',
          detailed_content: `单次学习的遗忘速度远超多数人的预期，[间隔复习]{highlight}是对抗遗忘曲线最有效的方法。今日在学习新内容的同时，安排15-20分钟复习昨天和上周的知识。[遗忘前复习]{highlight}的效果远胜于遗忘后重学，主动安排回顾是高效学习者的共同习惯。`,
          followUpQuestions: [
            { question: '如何建立间隔复习系统？', answer: '最简单的间隔复习系统是"1-3-7-21天法则"：新学内容在第1天、第3天、第7天、第21天各复习一次。可以用Anki（闪卡软件）自动安排复习时间，它内置了算法优化复习间隔。如果不想用软件，用一个笔记本记下每条知识点的学习日期，每天翻开检查哪些需要今天复习。坚持一个月后，长期记忆量会出现质的飞跃。' },
            { question: '学完就忘，是不是记忆力差？', answer: `记忆力"差"很少是天生的，更多是学习方式的问题。${stem}金的人逻辑强，但有时学习时过于被动（只读不输出）。改变方法：① 学完后立刻合上书，凭记忆写出刚学内容的框架（主动回忆比重读效果好3倍）；② 给每个知识点找一个"钩子"——与已知事物建立联系；③ 大声讲出来——用自己的话解释刚学的内容，发现讲不出来的地方就是真正不懂的地方。` },
          ],
        },
        {
          golden_sentence: '输出倒逼输入，以教为学',
          detailed_content: `今日学习效率提升的捷径是[以教代学]{highlight}——尝试向他人解释您最近学到的知识，哪怕是向朋友随意讲述。这个过程会强迫您发现理解的盲点，并以最快速度填补。[费曼技巧]{highlight}的核心就是：如果你不能用简单语言讲清楚，说明你还没真正理解。`,
          followUpQuestions: [
            { question: '身边没有可以讲述的人，怎么办？', answer: '没有听众时，可以用这几个替代方法：① 写作输出——用博客、备忘录或私密日记写"今日所学"，读者是未来的自己；② 自我录音——打开手机录音，用口述方式讲解知识点，回听时会发现很多表达不清晰之处；③ "橡皮鸭调试法"——找一个实体物品（比如桌上的橡皮鸭或公仔），假装向它讲解，这个方法看起来荒诞，但在程序员群体中被广泛验证有效。讲述的对象不重要，关键是迫使自己把模糊的理解转化为清晰的语言。' },
            { question: '如何选择适合自己的输出方式？', answer: `不同类型的知识适合不同的输出方式：① 概念性知识（理论、定义）——适合写作或绘制思维导图；② 操作性知识（技能、流程）——适合实际操作演练，边做边说；③ 分析性知识（案例、逻辑推导）——适合讨论或辩论，让对方质疑你的观点；④ 创造性知识（设计、写作）——直接创作作品。${stem}金格局的人逻辑性强，对概念性和分析性知识的输出尤为擅长，这类知识可以优先安排学习。` },
          ],
        },
        {
          golden_sentence: '心流状态，效率倍增',
          detailed_content: `今日上午是进入[心流状态]{highlight}的最佳窗口。心流需要三个条件：挑战适中（不太难也不太易）、目标明确、干扰最小化。提前关闭消息通知，准备好学习材料，设定25分钟专注计时器，一旦进入状态就会感受到时间飞逝与[极度专注]{highlight}带来的愉悦感。`,
          followUpQuestions: [
            { question: '总是无法专注超过10分钟怎么办？', answer: '注意力像肌肉，需要训练。从10分钟开始：设定10分钟计时，期间只做一件事，时间到后休息2分钟，然后再做一个10分钟。每周增加5分钟，逐步延伸到25分钟（番茄工作法的标准时段）。同时排查注意力杀手：手机通知（关掉或放到另一个房间）、开放式办公环境（戴降噪耳机）、饥饿（学习前吃好）。大脑的专注力是有限资源，早晨使用最高质量的专注力，不要浪费在刷手机上。' },
            { question: '如何为自己创造进入心流的环境？', answer: '心流环境的四个要素：① 固定场所——大脑会把"那个地方"与"专注模式"产生关联，每次坐下就会自动切换状态；② 固定开始仪式——如泡一杯茶、整理桌面、打开特定的背景音乐；③ 消除决策负担——提前准备好学习材料，不要在学习开始时还在想"我要学什么"；④ 适度的环境噪音——咖啡馆级别的白噪音（65分贝左右）对很多人的专注力有提升作用，可用网站或App模拟。' },
          ],
        },
        {
          golden_sentence: '跨领域联结，激发创新',
          detailed_content: `${stem}金的精准特质加上今日良好的思维状态，适合尝试[跨领域学习]{highlight}：将本领域的知识与另一个完全不同的领域联结，往往能产生创新性洞见。阅读一篇看似无关的文章，或与不同行业的人交流，[意外的联结]{highlight}有时比专注深挖更能带来突破性想法。`,
          followUpQuestions: [
            { question: '如何系统地进行跨领域学习？', answer: '跨领域学习的高效方法：① "类比思维"练习——学完一个新知识后，强迫自己找出与其他领域的3个相似结构；② 订阅多样化的内容源——在你主要领域之外，定期阅读一个完全不同领域的高质量内容（如技术人读心理学，商业人读生物学）；③ 参加混合背景的活动——与不同行业的人交流，注意对方解决问题的方式；④ 建立"灵感记录本"——随时记录跨领域联想，定期回顾。这些联结最初看起来牵强，但时间积累后会形成独特的思维方式。' },
            { question: '感觉自己只懂一个领域，会不会太局限？', answer: `专精一个领域是基础，跨领域联结是升级。${stem}金格局的人有天然的分析框架能力，这恰恰是跨领域迁移最需要的工具。建议：先在本领域建立扎实的核心模型，然后用这个模型去理解其他领域的现象——你会发现很多规律是通用的（比如"优化"在软件工程和商业运营中的逻辑几乎相同）。从一个领域出发去理解另一个领域，比从零开始学习快得多，这正是深度专家的跨界优势所在。` },
          ],
        },
      ],
    },
  };
}
