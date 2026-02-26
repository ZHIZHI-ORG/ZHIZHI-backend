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

export interface AdviceItem {
  title: string;   // 建议标题（15-25字）
  detail: string;  // 详细内容（80-120字）
}

export interface SceneAdvice {
  scene: 'career' | 'love' | 'health' | 'overall' | 'study';
  change_level: '变化较大' | '变化中等' | '变化较小';
  advices: AdviceItem[];
}

export interface InsightCard {
  category: 'career' | 'love' | 'health' | 'overall' | 'study';
  title: string;        // 核心金句（5-10字）
  description: string;  // 运势描述（40-60字）
  question: string;     // 引导问题（10-20字）
}

export interface BulletPoint {
  topic: string;    // bullet 标题（10-20字）
  expanded: string; // 展开内容（100-150字，支持 [text]{highlight} 语法）
}

export interface AnalysisItem {
  golden_sentence: string;   // 核心金句（5-10字）
  detailed_content: string;  // 详细建议（80-120字，支持高亮语法）
  bullets: BulletPoint[];    // 3个延伸话题
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
        { "title": "建议标题（15-25字）", "detail": "详细内容（80-120字）" },
        { "title": "建议标题（15-25字）", "detail": "详细内容（80-120字）" }
      ]
    },
    {
      "scene": "第二个场景",
      "change_level": "变化较大/变化中等/变化较小",
      "advices": [
        { "title": "建议标题", "detail": "详细内容" },
        { "title": "建议标题", "detail": "详细内容" }
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
      "bullets": [
        { "topic": "延伸话题标题（10-20字）", "expanded": "展开内容（100-150字）" },
        { "topic": "延伸话题标题", "expanded": "展开内容" },
        { "topic": "延伸话题标题", "expanded": "展开内容" }
      ]
    },
    "career": { "golden_sentence": "", "detailed_content": "", "bullets": [{},{},{}] },
    "love":   { "golden_sentence": "", "detailed_content": "", "bullets": [{},{},{}] },
    "health": { "golden_sentence": "", "detailed_content": "", "bullets": [{},{},{}] },
    "study":  { "golden_sentence": "", "detailed_content": "", "bullets": [{},{},{}] }
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
            title: '文书处理事半功倍，抓住窗口期',
            detail: '今日${stem}金得地，文字表达与逻辑梳理能力较强，适合撰写报告、整理资料或处理合同文件。上午时段尤为适宜，集中精力处理需要细心的工作，避免下午时段做重大汇报。',
          },
          {
            title: '暂缓激进提案，以柔克刚',
            detail: '流月火气较旺，与日主金形成克制关系，此时主动出击可能遭遇阻力。建议将新提案或晋升谈判推迟到下周，本周以整合资源、完善细节为主，蓄势待发效果更佳。',
          },
        ],
      },
      {
        scene: 'health',
        change_level: '变化较小',
        advices: [
          {
            title: '肺与呼吸道需重点关注',
            detail: '金主肺，五行中金气偏旺时需注意呼吸系统。今日建议避免长时间处于空气不流通的环境，适量补充润肺食物如梨、银耳等。早晚各做10分钟深呼吸练习，有助于气血运行顺畅。',
          },
          {
            title: '运动宜轻缓，避免剧烈消耗',
            detail: '今日能量偏于收敛状态，剧烈运动容易透支体力。推荐散步、瑜伽或太极等舒缓运动，时长控制在30-45分钟为宜。运动后注意及时补水，保持充足睡眠以恢复精气。',
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
        bullets: [
          {
            topic: '为何近期感觉推进什么都阻力重重？',
            expanded: `从八字角度分析，您的日主${stem}金正处于流月丙火的克制周期中，金火相克导致行动力受到压制，这是自然的能量消长规律，并非个人能力问题。此阶段最明智的做法是减少正面对抗，将精力转向内部整合与资源积累，等待下一个金气得令的周期到来，届时您会明显感受到阻力消减、推进顺畅。`,
          },
          {
            topic: '哪些事情今天做效果最好？',
            expanded: `今日最适合的事情集中在"整理"和"规划"两个方向：整理混乱的文件、理清思路写计划、修改已有方案、梳理人际关系等。${stem}金的特质赋予您今日较强的分析和归纳能力，凡是需要条理性和精细度的工作，今天都能发挥比平时更好的水准。避免需要激情和冲劲的事情。`,
          },
          {
            topic: '如何在低能量期保持状态？',
            expanded: `低能量期并不意味着无所作为，而是调整策略的好时机。建议：① 将每天的任务清单缩减为最重要的3件事；② 充分利用上午精力最佳的时段处理核心工作；③ 保证7-8小时睡眠，让身体自我修复；④ 减少无效社交，把时间留给真正重要的人和事。蓄势充分，才能在好时机到来时全力爆发。`,
          },
        ],
      },
      career: {
        golden_sentence: '文书见长，避锋待时',
        detailed_content: `职场运势今日[偏向内务型工作]{highlight}，文字表达、数据整理、方案修订等任务均能高效完成。对外谈判、项目汇报等需要冲劲的工作建议延后，[以退为进]{highlight}是本阶段职场生存最优策略。`,
        bullets: [
          {
            topic: '上司最近对我态度变冷，怎么回事？',
            expanded: `从运势角度看，流月火克金的格局也影响职场人际，上司或权威人物可能因为外部压力将情绪带入工作中，并非针对个人。建议近期保持低调，多做少说，用扎实的工作成果说话。避免主动要求资源或提升，等待运势回转后再行动，届时机会自然浮现。`,
          },
          {
            topic: '现在适合找新工作吗？',
            expanded: `目前阶段不是跳槽的最佳时机。火克金的周期中，新环境的适应压力会倍增，而且面试时的状态也可能不是最佳。建议先将精力放在提升现有岗位的技能，储备跳槽资本。待丙丁月过后，壬癸水月来临时，金水相生，届时无论留或走都会有更清晰的方向和更强的竞争力。`,
          },
          {
            topic: '如何提升职场影响力？',
            expanded: `金的特质是精准、锋利、高质量，您在职场的核心竞争力应该建立在"专业深度"而非"广泛人脉"上。建议选择一个核心领域深耕，成为团队中该领域的首选专家。同时培养清晰的表达能力，将复杂问题简化为易懂的结论，这正是金属性格局者的天然优势。`,
          },
        ],
      },
      love: {
        golden_sentence: '平稳温润，细水长流',
        detailed_content: `感情方面今日无大波澜，[适合深度沟通]{highlight}而非制造浪漫惊喜。单身者可在熟悉的社交圈中留意缘分，已有伴侣者今日是坦诚表达内心想法的好时机，[真诚胜于技巧]{highlight}。`,
        bullets: [
          {
            topic: '为何近期与伴侣摩擦增多？',
            expanded: `流月火旺容易让人情绪波动较大，${stem}金日主在此环境下可能显得更为固执和防御性增强，而伴侣感受到这种"冷硬"后容易产生距离感，形成摩擦循环。建议主动软化态度，在非敏感话题上先做出让步，让伴侣感受到您愿意改变的诚意。此阶段的感情维护重在"温度"而非"对错"。`,
          },
          {
            topic: '单身的我该如何提升桃花运？',
            expanded: `您的八字格局中${element}气偏旺，在感情上容易给人"不好接近"的印象，即使内心热情，外在表现也偏于理性克制。提升桃花运的关键在于主动展示温柔的一面：多参与轻松的小聚活动，学习倾听他人，减少批评和分析式的回应。缘分需要一个"可以走近"的入口，适当降低防御心是关键。`,
          },
          {
            topic: '如何判断一段关系值不值得继续？',
            expanded: `判断感情是否值得继续，可以从三个维度评估：① 对方是否在您低谷时仍然陪伴（忠诚度）；② 你们的沟通是否能够解决问题而非制造更多问题（兼容性）；③ 在一起时您是否感到被接纳而非需要不断表演（安全感）。如果三项中有两项以上令您满意，这段关系值得投入精力去经营和改善。`,
          },
        ],
      },
      health: {
        golden_sentence: '润肺养气，轻缓为宜',
        detailed_content: `健康方面需重点关注[肺与呼吸系统]{highlight}，金主肺，五行偏旺时对应脏腑需要格外养护。饮食上多摄入白色润肺食材，运动选择[轻缓舒展]{highlight}类型，避免高强度消耗。`,
        bullets: [
          {
            topic: '最近总是莫名疲惫是怎么回事？',
            expanded: `从八字角度看，您目前处于运势的蓄积期，身体能量也在进行自我调整和修复，疲惫感是正常的生理反应。建议检查一下近期的睡眠质量——${stem}金格局的人容易在压力大时出现入睡困难或浅眠，这会严重影响白天的精力。改善睡眠的优先级高于任何其他调理方式。`,
          },
          {
            topic: '什么饮食对我的体质最有益？',
            expanded: `${stem}金体质的人肺气较旺，对应的调养方向是润燥清热。推荐食材：银耳、雪梨、白萝卜、百合、山药等白色食物；适量饮用菊花茶或罗汉果茶清肺降火。避免辛辣刺激、油炸食品，减少烟酒摄入。春季是养肝的好时节，可适当增加绿色蔬菜的摄入，实现金木平衡。`,
          },
          {
            topic: '适合我的运动方式是什么？',
            expanded: `金属性格局的人适合具有节奏感和精准性的运动，而非爆发性的竞技类运动。推荐：① 太极拳或气功，能调节呼吸并强化内在气场；② 游泳，水克火，有助于平衡偏旺的火气；③ 慢跑配合腹式呼吸，强化肺功能。运动时间建议选择下午4-6点，此时段金气最旺，运动效果最佳。`,
          },
        ],
      },
      study: {
        golden_sentence: '专注深耕，逻辑清晰',
        detailed_content: `学习方面今日思维[逻辑清晰]{highlight}，分析推理能力较强，适合攻克需要系统理解的知识点。将学习时间集中在上午效率最高，[深度学习优于碎片积累]{highlight}，今天不适合广泛涉猎，宜精不宜多。`,
        bullets: [
          {
            topic: '为什么学了很多却感觉没有进步？',
            expanded: `这是典型的"输入过剩、输出不足"问题。知识只有通过输出（写作、讲解、实践）才能真正内化。${stem}金格局的人学习能力强，但有时过于追求"学完"而忽略"用好"。建议将学习节奏调整为：每学习30分钟，用10分钟做笔记或向他人讲解你学到的内容。这个方法会让知识吸收率提升3倍以上。`,
          },
          {
            topic: '如何保持长期学习的动力？',
            expanded: `动力来自于看见进步。建议建立一个可视化的学习进度系统：用打卡表记录每天的学习内容，每周做一次小测试检验掌握程度，每月回顾一次阶段性成果。金属性格局的人对"精确感知进步"有强烈需求，当你能清晰看到自己的成长曲线时，内在驱动力会自然涌现，不再需要强迫自己。`,
          },
          {
            topic: '现在适合备考或考证吗？',
            expanded: `从当前运势看，本月处于蓄积期，适合深度复习和查漏补缺，不太适合在此期间参加关键性考试。如果考期在本月，建议重点做错题整理和薄弱点强化。如果考期在下月，那么现在的蓄积期反而是最好的备考窗口，因为接下来的运势回升期将让您的学习成果得到充分发挥。`,
          },
        ],
      },
    },
  };
}
