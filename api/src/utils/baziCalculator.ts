/**
 * 八字排盘计算器
 *
 * 依赖：lunar-javascript（负责四柱、十神、藏干、纳音、空亡、大运流年等）
 * 自研：shenShaCalculator（负责命盘神煞，lunar-javascript 不提供此功能）
 *
 * 测试验证：1995年11月05日22:30，男
 *   四柱：乙亥 丙戌 庚子 丁亥  ✓
 *   日主：庚金
 */

// lunar-javascript 无官方 TS 类型，用 require 绕过 TS 类型检查
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Solar, Lunar: LunarLib, LunarUtil } = require('lunar-javascript') as { Solar: any; Lunar: any; LunarUtil: any };

import { calculateShenSha, FourPillars, ShenShaResult } from './shenShaCalculator';

// ============================================================
// 返回类型定义
// ============================================================

/** 藏干详情（对应 simple.md §10.4 hiddenStems[] 结构） */
export interface HiddenStemData {
  stem: string;     // 藏干天干（如"壬"）
  tenGod: string;   // 该藏干的十神（如"食神"）
  element: string;  // 该藏干的五行（如"水"）
}

/** 单柱详细数据（严格对应 simple.md §10.4 PillarData） */
export interface PillarData {
  name: string;           // 柱名（"年柱"/"月柱"/"日柱"/"时柱"）
  stem: string;           // 天干（如"庚"）
  stemElement: string;    // 天干五行（如"金"）
  branch: string;         // 地支（如"子"）
  branchElement: string;  // 地支五行（如"水"）
  ganZhi: string;         // 干支组合（如"庚子"）
  tenGod: string;         // 天干十神（如"比肩"；日柱固定"日主"）
  hiddenStems: HiddenStemData[];  // 藏干列表，含十神和五行
  lifecycle: string;      // 长生十二宫（如"死"）
  voidInfo: string;       // 空亡（如"辰巳"）
  naYin: string;          // 纳音（如"壁上土"）
  shenSha: string[];      // 命盘神煞（如["天乙贵人","文昌贵人"]）
}

/** 大运数据（对应 simple.md §10.5 MajorCycle） */
export interface MajorCycleData {
  startYear: number;  // 起始年份
  endYear: number;    // 结束年份
  age: number;        // 起始年龄
  endAge: number;     // 结束年龄
  stem: string;       // 天干（如"乙"）
  branch: string;     // 地支（如"酉"）
  ganZhi: string;     // 干支（如"乙酉"）
  tenGod: string;     // 天干十神（如"伤"）
  xun: string;        // 旬
  xunKong: string;    // 旬空
  annualLuck: AnnualLuckData[]; // 该大运下的流年
}

/** 流年数据（对应 simple.md §10.5 AnnualLuck） */
export interface AnnualLuckData {
  year: number;           // 年份
  age: number;            // 年龄
  stem: string;           // 天干
  branch: string;         // 地支
  ganZhi: string;         // 干支（如"丙午"）
  tenGodTop: string;      // 天干十神
  tenGodBottom: string;   // 地支主气十神
  xun: string;            // 旬
  xunKong: string;        // 旬空
  monthlyLuck: MonthlyLuckData[]; // 该流年下的流月
}

/** 流月数据（对应 simple.md §10.5 MonthlyLuck） */
export interface MonthlyLuckData {
  month: number;          // 月份序号（1-12）
  monthInChinese: string; // 中文月名（如"正"）
  stem: string;           // 天干
  branch: string;         // 地支
  ganZhi: string;         // 干支（如"庚寅"）
  tenGod: string;         // 天干十神
  tenGodBottom: string;   // 地支主气十神
  xun: string;            // 旬
  xunKong: string;        // 旬空
}

/** 五行分析 */
export interface WuxingAnalysis {
  金: number;
  木: number;
  水: number;
  火: number;
  土: number;
  dominant: string;       // 最强五行
  lacking: string[];      // 缺失五行
}

export interface WeightedElementScore {
  raw: number;      // 原始加权分
  percent: number;  // 归一化百分比（五行合计为100）
}

export interface WeightedWuxingContribution {
  element: string;
  score: number;
  source: string;
  pillar?: string;
  stem?: string;
  branch?: string;
  note: string;
}

export interface DayMasterStrength {
  score: number;          // -100 到 100，越高表示日主越得生扶
  label: string;          // extremely_strong / strong / balanced / neutral_weak / weak / extremely_weak
  supportScore: number;   // 生扶日主的力量
  drainScore: number;     // 克泄耗日主的力量
}

export interface WeightedWuxingAnalysis {
  methodVersion: 'weighted_wuxing_v2_9';
  scores: Record<string, WeightedElementScore>;
  dominant: string;
  weakest: string;
  balanceIndex: number; // 0-1，越接近1表示五行越均衡
  dayMasterStrength: DayMasterStrength;
  majorFactors: string[];
  contributions: WeightedWuxingContribution[];
}

/** 完整排盘结果 */
export interface FullChartResult {
  // 基础信息
  solar: string;          // 公历日期字符串
  lunar: string;          // 农历日期字符串
  dayMaster: string;      // 日主天干（如"庚"）
  dayMasterElement: string; // 日主五行（如"金"）

  // 四柱详情
  year: PillarData;
  month: PillarData;
  day: PillarData;
  time: PillarData;

  // 五行分析
  wuxing: WuxingAnalysis;
  weightedWuxing: WeightedWuxingAnalysis;

  // 大运信息
  startAge: number;           // 起运年龄
  startDate: string;          // 起运时间
  isForward: boolean;         // 顺运（男阳/女阴）还是逆运
  majorCycles: MajorCycleData[];  // 大运列表

  // 排盘校准元信息（例如真太阳时）
  calculationInfo?: any;
}

// ============================================================
// 五行映射
// ============================================================

const GAN_WUXING: Record<string, string> = {
  '甲': '木', '乙': '木',
  '丙': '火', '丁': '火',
  '戊': '土', '己': '土',
  '庚': '金', '辛': '金',
  '壬': '水', '癸': '水',
};

const ZHI_WUXING: Record<string, string> = {
  '子': '水', '亥': '水',
  '寅': '木', '卯': '木',
  '巳': '火', '午': '火',
  '申': '金', '酉': '金',
  '丑': '土', '辰': '土', '未': '土', '戌': '土',
};

const GAN_YIN_YANG: Record<string, boolean> = {
  '甲': true, '丙': true, '戊': true, '庚': true, '壬': true,
  '乙': false, '丁': false, '己': false, '辛': false, '癸': false,
};

const WUXING_GENERATES: Record<string, string> = {
  '木': '火',
  '火': '土',
  '土': '金',
  '金': '水',
  '水': '木',
};

const WUXING_CONTROLS: Record<string, string> = {
  '木': '土',
  '土': '水',
  '水': '火',
  '火': '金',
  '金': '木',
};

const WUXING_ELEMENTS = ['木', '火', '土', '金', '水'] as const;
type WuxingElement = typeof WUXING_ELEMENTS[number];
type PillarPosition = 'year' | 'month' | 'day' | 'time';

const STEM_POSITION_WEIGHTS: Record<PillarPosition, number> = {
  year: 0.6,
  month: 1.5,
  day: 1.2,
  time: 1.0,
};

const BRANCH_POSITION_WEIGHTS: Record<PillarPosition, number> = {
  year: 0.6,
  month: 3.0,
  day: 1.5,
  time: 1.0,
};

const HIDDEN_QI_WEIGHTS_BY_COUNT: Record<number, number[]> = {
  1: [1.0],
  2: [0.7, 0.3],
  3: [0.6, 0.3, 0.1],
};
const ZHI_HIDDEN_QI_WEIGHTS: Record<string, number[]> = {
  '子': [1.0],
  '丑': [0.6, 0.25, 0.15],
  '寅': [0.6, 0.25, 0.15],
  '卯': [1.0],
  '辰': [0.6, 0.25, 0.15],
  '巳': [0.6, 0.25, 0.15],
  '午': [0.7, 0.3],
  '未': [0.6, 0.25, 0.15],
  '申': [0.6, 0.25, 0.15],
  '酉': [1.0],
  '戌': [0.65, 0.2, 0.15],
  '亥': [0.7, 0.3],
};
const ROOTED_PENETRATION_WEIGHTS_BY_COUNT: Record<number, number[]> = {
  1: [0.22],
  2: [0.18, 0.1],
  3: [0.16, 0.09, 0.04],
};
const STEM_TRANSFORM_DRAIN_RATIO = 0.40;
const STEM_BIND_DRAIN_RATIO = 0.08;
const THREE_MEETING_TRANSFORM_DRAIN_RATIO = 0.35;
const THREE_HARMONY_TRANSFORM_DRAIN_RATIO = 0.30;
const SIX_COMBINATION_TRANSFORM_DRAIN_RATIO = 0.20;
const CONTROLLING_DRAIN_RATIO = 0.30;
const RESTRAINING_FLOW_RATIO = 0.012;
const RESTRAINING_DRAIN_RATIO = 0.20;
const DIRECT_STEM_CONTROL_DRAIN_RATIO = 0.25;
const SAME_ELEMENT_ROOT_RATIOS = [0.85, 0.25, 0.15, 0.10];

const ZHI_HIDDEN_STEMS: Record<string, string[]> = {
  '子': ['癸'],
  '丑': ['己', '癸', '辛'],
  '寅': ['甲', '丙', '戊'],
  '卯': ['乙'],
  '辰': ['戊', '乙', '癸'],
  '巳': ['丙', '戊', '庚'],
  '午': ['丁', '己'],
  '未': ['己', '丁', '乙'],
  '申': ['庚', '壬', '戊'],
  '酉': ['辛'],
  '戌': ['戊', '辛', '丁'],
  '亥': ['壬', '甲'],
};

const MONTH_SEASON_STAGE: Record<string, Record<WuxingElement, number>> = {
  '寅': { 木: 1.22, 火: 1.1, 土: 0.8, 金: 0.9, 水: 1.0 },
  '卯': { 木: 1.22, 火: 1.1, 土: 0.8, 金: 0.9, 水: 1.0 },
  '辰': { 木: 1.05, 火: 1.05, 土: 1.18, 金: 0.85, 水: 0.95 },
  '巳': { 木: 1.0, 火: 1.22, 土: 1.1, 金: 0.8, 水: 0.9 },
  '午': { 木: 1.0, 火: 1.22, 土: 1.1, 金: 0.8, 水: 0.9 },
  '未': { 木: 0.9, 火: 1.05, 土: 1.18, 金: 0.95, 水: 0.85 },
  '申': { 木: 0.8, 火: 0.9, 土: 1.0, 金: 1.22, 水: 1.1 },
  '酉': { 木: 0.8, 火: 0.9, 土: 1.0, 金: 1.22, 水: 1.1 },
  '戌': { 木: 0.85, 火: 0.95, 土: 1.18, 金: 0.95, 水: 1.0 },
  '亥': { 木: 1.1, 火: 0.8, 土: 0.9, 金: 1.0, 水: 1.22 },
  '子': { 木: 1.1, 火: 0.8, 土: 0.9, 金: 1.0, 水: 1.22 },
  '丑': { 木: 0.95, 火: 0.85, 土: 1.18, 金: 1.0, 水: 1.05 },
};

const BRANCH_CLASHES: Array<[string, string]> = [
  ['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥'],
];

const BRANCH_HARMS: Array<[string, string]> = [
  ['子', '未'], ['丑', '午'], ['寅', '巳'], ['卯', '辰'], ['申', '亥'], ['酉', '戌'],
];

const BRANCH_PUNISHMENTS: Array<[string, string]> = [
  ['子', '卯'], ['寅', '巳'], ['巳', '申'], ['丑', '戌'], ['戌', '未'], ['丑', '未'],
];

const BRANCH_SIX_COMBINATIONS: Array<{ branches: [string, string]; element: WuxingElement }> = [
  { branches: ['子', '丑'], element: '土' },
  { branches: ['寅', '亥'], element: '木' },
  { branches: ['卯', '戌'], element: '火' },
  { branches: ['辰', '酉'], element: '金' },
  { branches: ['巳', '申'], element: '水' },
  { branches: ['午', '未'], element: '土' },
];

const BRANCH_THREE_HARMONIES: Array<{ branches: [string, string, string]; element: WuxingElement; center: string }> = [
  { branches: ['申', '子', '辰'], element: '水', center: '子' },
  { branches: ['亥', '卯', '未'], element: '木', center: '卯' },
  { branches: ['寅', '午', '戌'], element: '火', center: '午' },
  { branches: ['巳', '酉', '丑'], element: '金', center: '酉' },
];

const BRANCH_THREE_MEETINGS: Array<{ branches: [string, string, string]; element: WuxingElement }> = [
  { branches: ['寅', '卯', '辰'], element: '木' },
  { branches: ['巳', '午', '未'], element: '火' },
  { branches: ['申', '酉', '戌'], element: '金' },
  { branches: ['亥', '子', '丑'], element: '水' },
];

const STEM_COMBINATIONS: Array<{ stems: [string, string]; element: WuxingElement }> = [
  { stems: ['甲', '己'], element: '土' },
  { stems: ['乙', '庚'], element: '金' },
  { stems: ['丙', '辛'], element: '水' },
  { stems: ['丁', '壬'], element: '木' },
  { stems: ['戊', '癸'], element: '火' },
];

const SHI_SHEN_ZHI: Record<string, string> = {
  '甲子': '正印', '甲丑': '正财', '甲寅': '比肩', '甲卯': '劫财', '甲辰': '偏财', '甲巳': '食神', '甲午': '伤官', '甲未': '正财', '甲申': '七杀', '甲酉': '正官', '甲戌': '偏财', '甲亥': '偏印',
  '乙子': '偏印', '乙丑': '偏财', '乙寅': '劫财', '乙卯': '比肩', '乙辰': '正财', '乙巳': '伤官', '乙午': '食神', '乙未': '偏财', '乙申': '正官', '乙酉': '七杀', '乙戌': '正财', '乙亥': '正印',
  '丙子': '正官', '丙丑': '伤官', '丙寅': '偏印', '丙卯': '正印', '丙辰': '食神', '丙巳': '比肩', '丙午': '劫财', '丙未': '伤官', '丙申': '偏财', '丙酉': '正财', '丙戌': '食神', '丙亥': '七杀',
  '丁子': '七杀', '丁丑': '食神', '丁寅': '正印', '丁卯': '偏印', '丁辰': '伤官', '丁巳': '劫财', '丁午': '比肩', '丁未': '食神', '丁申': '正财', '丁酉': '偏财', '丁戌': '伤官', '丁亥': '正官',
  '戊子': '正财', '戊丑': '劫财', '戊寅': '七杀', '戊卯': '正官', '戊辰': '比肩', '戊巳': '偏印', '戊午': '正印', '戊未': '劫财', '戊申': '食神', '戊酉': '伤官', '戊戌': '比肩', '戊亥': '偏财',
  '己子': '偏财', '己丑': '比肩', '己寅': '正官', '己卯': '七杀', '己辰': '劫财', '己巳': '正印', '己午': '偏印', '己未': '比肩', '己申': '伤官', '己酉': '食神', '己戌': '劫财', '己亥': '正财',
  '庚子': '伤官', '庚丑': '正印', '庚寅': '偏财', '庚卯': '正财', '庚辰': '偏印', '庚巳': '七杀', '庚午': '正官', '庚未': '正印', '庚申': '比肩', '庚酉': '劫财', '庚戌': '偏印', '庚亥': '食神',
  '辛子': '食神', '辛丑': '偏印', '辛寅': '正财', '辛卯': '偏财', '辛辰': '正印', '辛巳': '正官', '辛午': '七杀', '辛未': '偏印', '辛申': '劫财', '辛酉': '比肩', '辛戌': '正印', '辛亥': '伤官',
  '壬子': '劫财', '壬丑': '正官', '壬寅': '食神', '壬卯': '伤官', '壬辰': '七杀', '壬巳': '偏财', '壬午': '正财', '壬未': '正官', '壬申': '偏印', '壬酉': '正印', '壬戌': '七杀', '壬亥': '比肩',
  '癸子': '比肩', '癸丑': '七杀', '癸寅': '伤官', '癸卯': '食神', '癸辰': '正官', '癸巳': '正财', '癸午': '偏财', '癸未': '七杀', '癸申': '正印', '癸酉': '偏印', '癸戌': '正官', '癸亥': '劫财',
};

const SHI_SHEN_SIMPLIFIED: Record<string, string> = {
  '正印': '印',
  '正官': '官',
  '劫财': '劫',
  '伤官': '伤',
  '正财': '财',
  '七杀': '杀',
  '偏印': '枭',
  '比肩': '比',
  '食神': '食',
  '偏财': '才',
};

// 主流排盘 app 常见的附加层口径：年干或日干查四柱地支。
// 这不是当前 china-testing/bazi 主流程的一部分，因此放在附加层。
const COMMON_TAIJI_BY_GAN: Record<string, string[]> = {
  '甲': ['子', '午'], '乙': ['子', '午'],
  '丙': ['卯', '酉'], '丁': ['卯', '酉'],
  '戊': ['辰', '戌', '丑', '未'], '己': ['辰', '戌', '丑', '未'],
  '庚': ['寅', '亥'], '辛': ['寅', '亥'],
  '壬': ['巳', '申'], '癸': ['巳', '申'],
};

// 天厨禄贵按《三车一览》常见整理口径：既要见食神天干，又要见食神之禄位地支，二者同见方成。
// 为兼容当前按柱展示的结构，命中后会把参与成格的“食神干”所在柱、以及“禄位支”所在柱标记为“天厨贵人”。
const COMMON_TIANCHU_RULES_BY_GAN: Record<string, {
  foodStem: string;
  luBranches: string[];
}> = {
  '甲': { foodStem: '丙', luBranches: ['巳'] },
  '乙': { foodStem: '丁', luBranches: ['午'] },
  '丙': { foodStem: '戊', luBranches: ['巳'] },
  '丁': { foodStem: '己', luBranches: ['午'] },
  '戊': { foodStem: '庚', luBranches: ['申'] },
  '己': { foodStem: '辛', luBranches: ['酉'] },
  '庚': { foodStem: '壬', luBranches: ['亥'] },
  '辛': { foodStem: '癸', luBranches: ['子'] },
  '壬': { foodStem: '甲', luBranches: ['寅'] },
  '癸': { foodStem: '乙', luBranches: ['卯'] },
};

const COMMON_GUOYIN_BY_GAN: Record<string, string[]> = {
  '甲': ['戌'], '乙': ['亥'],
  '丙': ['丑'], '丁': ['寅'],
  '戊': ['丑'], '己': ['寅'],
  '庚': ['辰'], '辛': ['巳'],
  '壬': ['未'], '癸': ['申'],
};

const COMMON_JINYU_BY_GAN: Record<string, string[]> = {
  '甲': ['辰'], '乙': ['巳'],
  '丙': ['未'], '丁': ['申'],
  '戊': ['未'], '己': ['申'],
  '庚': ['戌'], '辛': ['亥'],
  '壬': ['丑'], '癸': ['寅'],
};

const COMMON_HONGLUAN_BY_BRANCH: Record<string, string> = {
  '子': '卯', '丑': '寅', '寅': '丑', '卯': '子',
  '辰': '亥', '巳': '戌', '午': '酉', '未': '申',
  '申': '未', '酉': '午', '戌': '巳', '亥': '辰',
};

const COMMON_TIANXI_BY_BRANCH: Record<string, string> = {
  '子': '酉', '丑': '申', '寅': '未', '卯': '午',
  '辰': '巳', '巳': '辰', '午': '卯', '未': '寅',
  '申': '丑', '酉': '子', '戌': '亥', '亥': '戌',
};

// 德秀贵人按《三命通会》常见整理口径：以月令定局，四柱天干同时成“德”“秀”方成格。
// 对当前按柱展示的产品结构，命中后将参与成格的天干所在柱标记为“德秀贵人”。
const COMMON_DEXIU_RULES_BY_MONTH_BRANCH: Record<string, {
  de: string[];
  xiu: string[];
}> = {
  '寅': { de: ['丙', '丁'], xiu: ['戊', '癸'] },
  '午': { de: ['丙', '丁'], xiu: ['戊', '癸'] },
  '戌': { de: ['丙', '丁'], xiu: ['戊', '癸'] },
  '申': { de: ['壬', '癸', '戊', '己'], xiu: ['丙', '辛', '甲', '己'] },
  '子': { de: ['壬', '癸', '戊', '己'], xiu: ['丙', '辛', '甲', '己'] },
  '辰': { de: ['壬', '癸', '戊', '己'], xiu: ['丙', '辛', '甲', '己'] },
  '巳': { de: ['庚', '辛'], xiu: ['乙', '庚'] },
  '酉': { de: ['庚', '辛'], xiu: ['乙', '庚'] },
  '丑': { de: ['庚', '辛'], xiu: ['乙', '庚'] },
  '亥': { de: ['甲', '乙'], xiu: ['丁', '壬'] },
  '卯': { de: ['甲', '乙'], xiu: ['丁', '壬'] },
  '未': { de: ['甲', '乙'], xiu: ['丁', '壬'] },
};

const REPO_YUTANG: Record<string, string> = {
  '甲': '丑', '乙': '子', '丙': '亥', '丁': '酉', '戊': '未',
  '己': '申', '庚': '未', '辛': '午', '壬': '巳', '癸': '卯',
};

const REPO_WENXING: Record<string, string> = {
  '甲': '午', '乙': '巳', '丙': '申', '丁': '酉', '戊': '申',
  '己': '酉', '庚': '戌', '辛': '亥', '壬': '寅', '癸': '卯',
};

const REPO_TIANYIN: Record<string, string[]> = {
  '甲': ['子', '寅'], '乙': ['亥'], '丙': ['戌'], '丁': ['酉'], '戊': ['申'],
  '己': ['未'], '庚': ['午'], '辛': ['巳'], '壬': ['辰'], '癸': ['卯'],
};

// ============================================================
// 主计算函数
// ============================================================

/**
 * 计算完整八字命盘
 *
 * @param birthYear   公历出生年
 * @param birthMonth  公历出生月
 * @param birthDay    公历出生日
 * @param birthHour   出生小时（0-23），不知道时辰传 undefined
 * @param birthMinute 出生分钟（0-59）
 * @param isLunar     是否农历输入（若是，先转公历）
 * @param gender      性别：1=男，2=女（影响大运顺逆）
 * @param sect        流派：1=晚子时算明日（默认），2=晚子时算当日
 * @returns           完整排盘结果
 */
export async function calculateFullChart(
  birthYear: number,
  birthMonth: number,
  birthDay: number,
  birthHour: number = 12,  // 默认午时（不知时辰时用正午）
  birthMinute: number = 0,
  isLunar: boolean = false,
  gender: number = 1,
  sect: number = 1,
): Promise<FullChartResult> {

  // ── 步骤 1：获取 Solar 对象 ─────────────────────────────────
  let solar: any;

  if (isLunar) {
    // 农历转公历：用顶部导入的 LunarLib.fromYmd 构建 Lunar 再转 Solar
    const lunarDate = LunarLib.fromYmd(birthYear, birthMonth, birthDay);
    solar = lunarDate.getSolar();
    // 注意：农历输入时 birthHour 仍使用传入值
  } else {
    solar = Solar.fromYmdHms(birthYear, birthMonth, birthDay, birthHour, birthMinute, 0);
  }

  // ── 步骤 2：获取 EightChar 对象 ────────────────────────────
  const lunar = solar.getLunar();
  const bazi = lunar.getEightChar();
  bazi.setSect(sect); // 设置流派

  // ── 步骤 3：提取四柱基础数据 ───────────────────────────────
  const yearGan = bazi.getYearGan();
  const yearZhi = bazi.getYearZhi();
  const monthGan = bazi.getMonthGan();
  const monthZhi = bazi.getMonthZhi();
  const dayGan = bazi.getDayGan();
  const dayZhi = bazi.getDayZhi();
  const timeGan = bazi.getTimeGan();
  const timeZhi = bazi.getTimeZhi();

  // ── 步骤 4：计算命盘神煞 ────────────────────────────────────
  const pillars: FourPillars = { yearGan, yearZhi, monthGan, monthZhi, dayGan, dayZhi, timeGan, timeZhi };
  const shenSha: ShenShaResult = calculateShenSha(pillars);

  // ── 步骤 5：组装四柱详情 ────────────────────────────────────
  const yearPillar = buildPillarData(
    '年柱',
    yearGan, yearZhi,
    bazi.getYearShiShenGan(),
    bazi.getYearShiShenZhi(),
    bazi.getYearHideGan(),
    bazi.getYearNaYin(),
    bazi.getYearDiShi(),
    bazi.getYearXunKong(),
    shenSha.year,
  );

  const monthPillar = buildPillarData(
    '月柱',
    monthGan, monthZhi,
    bazi.getMonthShiShenGan(),
    bazi.getMonthShiShenZhi(),
    bazi.getMonthHideGan(),
    bazi.getMonthNaYin(),
    bazi.getMonthDiShi(),
    bazi.getMonthXunKong(),
    shenSha.month,
  );

  const dayPillar = buildPillarData(
    '日柱',
    dayGan, dayZhi,
    '日主',                    // 日干固定为"日主"
    bazi.getDayShiShenZhi(),
    bazi.getDayHideGan(),
    bazi.getDayNaYin(),
    bazi.getDayDiShi(),
    bazi.getDayXunKong(),
    shenSha.day,
  );

  const timePillar = buildPillarData(
    '时柱',
    timeGan, timeZhi,
    bazi.getTimeShiShenGan(),
    bazi.getTimeShiShenZhi(),
    bazi.getTimeHideGan(),
    bazi.getTimeNaYin(),
    bazi.getTimeDiShi(),
    bazi.getTimeXunKong(),
    shenSha.time,
  );

  // ── 步骤 6：计算五行分析 ────────────────────────────────────
  const wuxing = calculateWuxing(yearGan, yearZhi, monthGan, monthZhi, dayGan, dayZhi, timeGan, timeZhi);
  const weightedWuxing = calculateWeightedWuxingFromPillars({
    year: yearPillar,
    month: monthPillar,
    day: dayPillar,
    time: timePillar,
  }, dayGan);

  // ── 步骤 7：计算大运 ────────────────────────────────────────
  const yun = bazi.getYun(gender, sect);
  const daYunList = yun.getDaYun();

  const startAge = daYunList.length > 0 ? daYunList[0].getStartAge() : 0;
  const startSolar = yun.getStartSolar();
  const startDate = startSolar ? startSolar.toYmd() : '';
  const isForward = yun.isForward();

  const majorCycles: MajorCycleData[] = daYunList.slice(0, 10).map((dy: any) => {
    const gz = dy.getGanZhi() || '童限';
    return {
      startYear: dy.getStartYear(),
      endYear: dy.getEndYear(),
      age: dy.getStartAge(),
      endAge: dy.getEndAge(),
      stem: gz === '童限' ? '' : (gz[0] || ''),
      branch: gz === '童限' ? '' : (gz[1] || ''),
      ganZhi: gz,
      tenGod: gz === '童限' ? '童限' : getTenGod(dayGan, gz[0]),
      xun: gz === '童限' ? '' : (dy.getXun?.() || ''),
      xunKong: gz === '童限' ? '' : (dy.getXunKong?.() || ''),
      annualLuck: buildLiuNianList(dayGan, dy),
    };
  });

  applyRepoExtraShenSha(
    [yearPillar, monthPillar, dayPillar, timePillar],
    yearGan,
    dayGan,
    yearPillar.naYin,
    gender,
  );

  // ── 步骤 8：组装返回结果 ────────────────────────────────────
  return {
    solar: solar.toYmdHms(),
    lunar: lunar.toString(),
    dayMaster: dayGan,
    dayMasterElement: GAN_WUXING[dayGan] || '',

    year: yearPillar,
    month: monthPillar,
    day: dayPillar,
    time: timePillar,

    wuxing,
    weightedWuxing,

    startAge,
    startDate,
    isForward,
    majorCycles,
  };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 组装单柱数据
 *
 * @param name        柱名（"年柱"/"月柱"/"日柱"/"时柱"）
 * @param gan         天干
 * @param zhi         地支
 * @param tenGod      天干十神（日柱固定传"日主"）
 * @param tenGodZhi   地支藏干的十神列表（lunar-javascript getXxxShiShenZhi() 返回）
 * @param hideGan     地支藏干天干列表（lunar-javascript getXxxHideGan() 返回）
 * @param naYin       纳音
 * @param diShi       长生十二宫（地势）
 * @param xunKong     空亡
 * @param shenSha     命盘神煞列表
 */
function buildPillarData(
  name: string,
  gan: string,
  zhi: string,
  tenGod: string,
  tenGodZhi: string | string[],
  hideGan: string | string[],
  naYin: string,
  diShi: string,
  xunKong: string,
  shenSha: string[],
): PillarData {
  // lunar-javascript 返回的藏干天干列表（string[]）
  const hideGanArr = Array.isArray(hideGan) ? hideGan : (hideGan ? [hideGan] : []);
  // lunar-javascript 返回的藏干十神列表（string[]），与 hideGan 一一对应
  const tenGodZhiArr = Array.isArray(tenGodZhi) ? tenGodZhi : (tenGodZhi ? [tenGodZhi] : []);

  // 将藏干天干 + 十神 + 五行合并为 HiddenStemData[]
  const hiddenStems: HiddenStemData[] = hideGanArr.map((stem, i) => ({
    stem,
    tenGod: tenGodZhiArr[i] || '',
    element: GAN_WUXING[stem] || '',
  }));

  return {
    name,
    stem: gan,
    stemElement: GAN_WUXING[gan] || '',
    branch: zhi,
    branchElement: ZHI_WUXING[zhi] || '',
    ganZhi: gan + zhi,
    tenGod,
    hiddenStems,
    lifecycle: diShi || '',
    voidInfo: xunKong || '',
    naYin: naYin || '',
    shenSha,
  };
}

function applyRepoExtraShenSha(
  pillars: PillarData[],
  yearGan: string,
  dayGan: string,
  yearNaYin: string,
  gender: number,
): void {
  addByBranchMatches(pillars, COMMON_TAIJI_BY_GAN[yearGan], '太极贵人');
  addByBranchMatches(pillars, COMMON_TAIJI_BY_GAN[dayGan], '太极贵人');
  applyCommonTianChu(pillars, yearGan);
  applyCommonTianChu(pillars, dayGan);
  addByBranchMatches(pillars, COMMON_GUOYIN_BY_GAN[yearGan], '国印贵人');
  addByBranchMatches(pillars, COMMON_GUOYIN_BY_GAN[dayGan], '国印贵人');
  addByBranchMatches(pillars, COMMON_JINYU_BY_GAN[yearGan], '金舆');
  addByBranchMatches(pillars, COMMON_JINYU_BY_GAN[dayGan], '金舆');
  addByBranchMatch(pillars, COMMON_HONGLUAN_BY_BRANCH[pillars[2].branch], '红鸾');
  addByBranchMatch(pillars, COMMON_TIANXI_BY_BRANCH[pillars[2].branch], '天喜');
  addByBranchMatch(pillars, REPO_YUTANG[dayGan], '玉堂贵人');
  addByBranchMatch(pillars, REPO_WENXING[dayGan], '文星贵人');
  addByBranchMatches(pillars, REPO_TIANYIN[dayGan], '天印贵人');
  applyCommonDeXiu(pillars);

  pillars.forEach((pillar) => {
    if (matchesRepoLifecycleStage(pillar.lifecycle, '长')) {
      addShenSha(pillar, '学堂');
      const dayMasterElement = GAN_WUXING[dayGan] || '';
      if (dayMasterElement && pillar.naYin.endsWith(dayMasterElement)) {
        addShenSha(pillar, '正学堂');
      }
    }
  });

  applyRepoTaoHua(pillars);
  applyRepoTianLuoDiWang(pillars, yearNaYin, gender);
}

function addByBranchMatch(
  pillars: PillarData[],
  targetBranch: string | undefined,
  shenShaName: string,
): void {
  if (!targetBranch) return;
  pillars.forEach((pillar) => {
    if (pillar.branch === targetBranch) {
      addShenSha(pillar, shenShaName);
    }
  });
}

function addByBranchMatches(
  pillars: PillarData[],
  targetBranches: string[] | undefined,
  shenShaName: string,
): void {
  if (!targetBranches?.length) return;
  pillars.forEach((pillar) => {
    if (targetBranches.includes(pillar.branch)) {
      addShenSha(pillar, shenShaName);
    }
  });
}

function applyCommonDeXiu(pillars: PillarData[]): void {
  const monthBranch = pillars[1].branch;
  const rule = COMMON_DEXIU_RULES_BY_MONTH_BRANCH[monthBranch];
  if (!rule) return;

  const stems = pillars.map((pillar) => pillar.stem);
  const hasDe = stems.some((stem) => rule.de.includes(stem));
  const hasXiu = stems.some((stem) => rule.xiu.includes(stem));
  if (!hasDe || !hasXiu) return;

  pillars.forEach((pillar) => {
    if (rule.de.includes(pillar.stem) || rule.xiu.includes(pillar.stem)) {
      addShenSha(pillar, '德秀贵人');
    }
  });
}

function applyCommonTianChu(pillars: PillarData[], baseGan: string): void {
  const rule = COMMON_TIANCHU_RULES_BY_GAN[baseGan];
  if (!rule) return;

  const hasFoodStem = pillars.some((pillar) => pillar.stem === rule.foodStem);
  const hasLuBranch = pillars.some((pillar) => rule.luBranches.includes(pillar.branch));
  if (!hasFoodStem || !hasLuBranch) return;

  pillars.forEach((pillar) => {
    if (pillar.stem === rule.foodStem || rule.luBranches.includes(pillar.branch)) {
      addShenSha(pillar, '天厨贵人');
    }
  });
}

function addShenSha(pillar: PillarData, shenShaName: string): void {
  pillar.shenSha = [...new Set([...pillar.shenSha, shenShaName])];
}

function matchesRepoLifecycleStage(
  lifecycle: string,
  stage: '长',
): boolean {
  const normalized = lifecycle.trim();
  if (!normalized) return false;

  if (stage === '长') {
    return normalized === '长' || normalized === '长生';
  }

  return false;
}

function applyRepoTaoHua(pillars: PillarData[]): void {
  const zhis = pillars.map((pillar) => pillar.branch);
  const dayZhi = zhis[2];
  const yearZhi = zhis[0];
  const dayCandidates = [zhis[0], zhis[1], zhis[3]];
  const yearCandidates = [zhis[1], zhis[2], zhis[3]];

  collectRepoTaoHuaTargets(dayZhi, dayCandidates).forEach((targetBranch) => {
    pillars.forEach((pillar, index) => {
      if (index !== 2 && pillar.branch === targetBranch) {
        addShenSha(pillar, '桃花');
      }
    });
  });

  collectRepoTaoHuaTargets(yearZhi, yearCandidates).forEach((targetBranch) => {
    pillars.forEach((pillar, index) => {
      if (index !== 0 && pillar.branch === targetBranch) {
        addShenSha(pillar, '桃花');
      }
    });
  });
}

function collectRepoTaoHuaTargets(
  baseBranch: string,
  candidates: string[],
): string[] {
  const targets: string[] = [];

  if ('申子辰'.includes(baseBranch) && candidates.includes('酉')) {
    targets.push('酉');
  }
  if ('丑巳酉'.includes(baseBranch) && candidates.includes('午')) {
    targets.push('午');
  }
  if ('寅午戌'.includes(baseBranch) && candidates.includes('卯')) {
    targets.push('卯');
  }
  if ('亥卯未'.includes(baseBranch) && candidates.includes('子')) {
    targets.push('子');
  }

  return [...new Set(targets)];
}

function applyRepoTianLuoDiWang(
  pillars: PillarData[],
  yearNaYin: string,
  gender: number,
): void {
  const dayPillar = pillars[2];
  const yearNaYinElement = yearNaYin.slice(-1);

  if (gender === 1) {
    addByOppositeBranchPairReference(pillars, 0, ['戌', '亥'], '天罗');
    addByOppositeBranchPairReference(pillars, 2, ['戌', '亥'], '天罗');
  }

  if (gender === 2) {
    addByOppositeBranchPairReference(pillars, 0, ['辰', '巳'], '地网');
    addByOppositeBranchPairReference(pillars, 2, ['辰', '巳'], '地网');
  }

  if (gender === 1 && yearNaYinElement === '火' && '戌亥'.includes(dayPillar.branch)) {
    addShenSha(dayPillar, '天罗');
  }
  if (gender === 2 && '水土'.includes(yearNaYinElement) && '辰巳'.includes(dayPillar.branch)) {
    addShenSha(dayPillar, '地网');
  }
}

function addByOppositeBranchPairReference(
  pillars: PillarData[],
  referenceIndex: number,
  pair: [string, string],
  shenShaName: string,
): void {
  const referenceBranch = pillars[referenceIndex].branch;
  if (!pair.includes(referenceBranch)) return;

  const targetBranch = referenceBranch === pair[0] ? pair[1] : pair[0];
  pillars.forEach((pillar, index) => {
    if (index !== referenceIndex && pillar.branch === targetBranch) {
      addShenSha(pillar, shenShaName);
    }
  });
}

/**
 * 根据日主天干和目标天干，推算十神简称
 */
function getTenGod(dayGan: string, targetGan: string): string {
  const fullName = getTenGodFull(dayGan, targetGan);
  return SHI_SHEN_SIMPLIFIED[fullName] || fullName || '';
}

function getTenGodFull(dayGan: string, targetGan: string): string {
  if (!dayGan || !targetGan) return '';
  const dayElement = GAN_WUXING[dayGan];
  const targetElement = GAN_WUXING[targetGan];
  if (!dayElement || !targetElement) return '';

  const samePolarity = GAN_YIN_YANG[dayGan] === GAN_YIN_YANG[targetGan];
  const generatedByDay = WUXING_GENERATES[dayElement];
  const controlledByDay = WUXING_CONTROLS[dayElement];
  const generatesDay = Object.keys(WUXING_GENERATES).find(key => WUXING_GENERATES[key] === dayElement);

  if (targetElement === dayElement) {
    return samePolarity ? '比肩' : '劫财';
  }
  if (generatedByDay === targetElement) {
    return samePolarity ? '食神' : '伤官';
  }
  if (generatesDay === targetElement) {
    return samePolarity ? '偏印' : '正印';
  }
  if (controlledByDay === targetElement) {
    return samePolarity ? '偏财' : '正财';
  }
  if (WUXING_CONTROLS[targetElement] === dayElement) {
    return samePolarity ? '七杀' : '正官';
  }

  return '';
}

function getBranchTenGod(dayGan: string, targetZhi: string): string {
  const fullName = SHI_SHEN_ZHI[dayGan + targetZhi] || '';
  return SHI_SHEN_SIMPLIFIED[fullName] || fullName;
}

function buildLiuNianList(dayGan: string, daYun: any): AnnualLuckData[] {
  const liuNian = daYun.getLiuNian?.() || [];
  return liuNian.map((ln: any) => buildLiuNianData(dayGan, ln));
}

function buildLiuNianData(dayGan: string, liuNian: any): AnnualLuckData {
  const gz: string = liuNian.getGanZhi?.() || '';
  return {
    year: liuNian.getYear(),
    age: liuNian.getAge?.() || 0,
    stem: gz[0] || '',
    branch: gz[1] || '',
    ganZhi: gz,
    tenGodTop: getTenGod(dayGan, gz[0] || ''),
    tenGodBottom: getBranchTenGod(dayGan, gz[1] || ''),
    xun: liuNian.getXun?.() || '',
    xunKong: liuNian.getXunKong?.() || '',
    monthlyLuck: buildLiuYueList(dayGan, liuNian),
  };
}

function buildLiuYueList(dayGan: string, liuNian: any): MonthlyLuckData[] {
  const liuYue = liuNian.getLiuYue?.() || [];
  return liuYue.map((ly: any, i: number) => {
    const gz: string = ly.getGanZhi?.() || '';
    return {
      month: i + 1,
      monthInChinese: ly.getMonthInChinese?.() || '',
      stem: gz[0] || '',
      branch: gz[1] || '',
      ganZhi: gz,
      tenGod: getTenGod(dayGan, gz[0] || ''),
      tenGodBottom: getBranchTenGod(dayGan, gz[1] || ''),
      xun: ly.getXun?.() || '',
      xunKong: ly.getXunKong?.() || '',
    };
  });
}

/**
 * 计算五行分布
 */
function calculateWuxing(
  yearGan: string, yearZhi: string,
  monthGan: string, monthZhi: string,
  dayGan: string, dayZhi: string,
  timeGan: string, timeZhi: string,
): WuxingAnalysis {

  const count: Record<string, number> = { 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 };

  const gans = [yearGan, monthGan, dayGan, timeGan];
  const zhis = [yearZhi, monthZhi, dayZhi, timeZhi];

  gans.forEach(g => { const wx = GAN_WUXING[g]; if (wx) count[wx]++; });
  zhis.forEach(z => { const wx = ZHI_WUXING[z]; if (wx) count[wx]++; });

  const dominant = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
  const lacking = Object.entries(count).filter(([, v]) => v === 0).map(([k]) => k);

  return {
    金: count['金'], 木: count['木'], 水: count['水'],
    火: count['火'], 土: count['土'],
    dominant, lacking,
  };
}

export function calculateWeightedWuxingFromChart(chart: any): WeightedWuxingAnalysis {
  return calculateWeightedWuxingFromPillars({
    year: chart?.year,
    month: chart?.month,
    day: chart?.day,
    time: chart?.time,
  }, chart?.dayMaster || chart?.day?.stem || '');
}

function calculateWeightedWuxingFromPillars(
  pillars: Record<PillarPosition, PillarData>,
  dayGan: string,
): WeightedWuxingAnalysis {
  const rawScores = emptyElementScores();
  const contributions: WeightedWuxingContribution[] = [];
  const monthBranch = pillars.month?.branch || '';

  const addContribution = (input: WeightedWuxingContribution) => {
    if (!isWuxingElement(input.element) || !Number.isFinite(input.score) || input.score === 0) return;
    const roundedScore = round2(input.score);
    if (roundedScore === 0) return;
    rawScores[input.element] += input.score;
    contributions.push({
      ...input,
      score: roundedScore,
    });
  };

  (Object.keys(pillars) as PillarPosition[]).forEach((position) => {
    const pillar = pillars[position];
    if (!pillar) return;

    const stemElement = toWuxingElement(pillar.stemElement || GAN_WUXING[pillar.stem]);
    if (stemElement) {
      addContribution({
        element: stemElement,
        score: STEM_POSITION_WEIGHTS[position] * seasonMultiplier(stemElement, monthBranch),
        source: `${position}_stem`,
        pillar: position,
        stem: pillar.stem,
        note: `${pillar.name}天干${pillar.stem}${stemElement}显性能量`,
      });
    }

    const hiddenStems = getCanonicalHiddenStems(pillar);
    hiddenStems.forEach((hidden, index) => {
      const hiddenElement = toWuxingElement(hidden.element || GAN_WUXING[hidden.stem]);
      if (!hiddenElement) return;
      const qiWeight = hiddenQiWeight(pillar.branch, hiddenStems, index);
      const commandMultiplier = position === 'month' ? (1.08 - Math.min(index, 2) * 0.04) : 1;
      const hiddenSeasonMultiplier = position === 'month' ? 1 : seasonMultiplier(hiddenElement, monthBranch);
      addContribution({
        element: hiddenElement,
        score: BRANCH_POSITION_WEIGHTS[position] * qiWeight * commandMultiplier * hiddenSeasonMultiplier,
        source: `${position}_hidden_${hiddenQiName(index)}`,
        pillar: position,
        stem: hidden.stem,
        branch: pillar.branch,
        note: `${pillar.name}${pillar.branch}藏${hiddenQiName(index)}${hidden.stem}${hiddenElement}`,
      });
    });
  });

  applyRootedPenetration(pillars, monthBranch, addContribution);
  applyStemDirectControls(pillars, monthBranch, addContribution);
  applyBranchRelations(pillars, monthBranch, addContribution);
  applyStemCombinations(pillars, monthBranch, addContribution);
  applyElementFlowAdjustments(rawScores, addContribution);

  WUXING_ELEMENTS.forEach((element) => {
    if (rawScores[element] < 0) rawScores[element] = 0;
  });

  const total = WUXING_ELEMENTS.reduce((sum, element) => sum + rawScores[element], 0);
  const scores = WUXING_ELEMENTS.reduce((acc, element) => {
    acc[element] = {
      raw: round2(rawScores[element]),
      percent: total > 0 ? round2((rawScores[element] / total) * 100) : 0,
    };
    return acc;
  }, {} as Record<string, WeightedElementScore>);

  const sorted = [...WUXING_ELEMENTS].sort((a, b) => rawScores[b] - rawScores[a]);
  const dayMasterStrength = calculateDayMasterStrength(dayGan, monthBranch, contributions);

  return {
    methodVersion: 'weighted_wuxing_v2_9',
    scores,
    dominant: sorted[0],
    weakest: sorted[sorted.length - 1],
    balanceIndex: calculateBalanceIndex(scores),
    dayMasterStrength,
    majorFactors: buildMajorFactors(pillars, sorted[0], sorted[sorted.length - 1], dayMasterStrength),
    contributions: topContributions(contributions),
  };
}

function emptyElementScores(): Record<WuxingElement, number> {
  return { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
}

function toWuxingElement(value: string | undefined): WuxingElement | undefined {
  return isWuxingElement(value) ? value : undefined;
}

function isWuxingElement(value: string | undefined): value is WuxingElement {
  return !!value && (WUXING_ELEMENTS as readonly string[]).includes(value);
}

function getCanonicalHiddenStems(pillar: PillarData): HiddenStemData[] {
  const canonical = ZHI_HIDDEN_STEMS[pillar?.branch] || [];
  if (canonical.length === 0) return pillar?.hiddenStems || [];

  return canonical.map((stem) => {
    const existing = (pillar.hiddenStems || []).find(item => item.stem === stem);
    return existing || {
      stem,
      tenGod: '',
      element: GAN_WUXING[stem] || '',
    };
  });
}

function seasonMultiplier(element: WuxingElement, monthBranch: string): number {
  return MONTH_SEASON_STAGE[monthBranch]?.[element] || 1;
}

function hiddenQiName(index: number): string {
  if (index === 0) return 'main';
  if (index === 1) return 'middle';
  return 'residual';
}

function applyRootedPenetration(
  pillars: Record<PillarPosition, PillarData>,
  monthBranch: string,
  addContribution: (input: WeightedWuxingContribution) => void,
): void {
  const visibleStems = (Object.keys(pillars) as PillarPosition[])
    .map(position => ({ position, stem: pillars[position]?.stem, element: toWuxingElement(pillars[position]?.stemElement) }))
    .filter(item => item.stem && item.element);

  visibleStems.forEach((visible) => {
    (Object.keys(pillars) as PillarPosition[]).forEach((rootPosition) => {
      const pillar = pillars[rootPosition];
      const hiddenStems = getCanonicalHiddenStems(pillar);
      hiddenStems.forEach((hidden, rootIndex) => {
        if (!visible.element) return;
        const hiddenElement = toWuxingElement(hidden.element || GAN_WUXING[hidden.stem]);
        if (!hiddenElement || hiddenElement !== visible.element) return;

        if (hidden.stem === visible.stem) {
          const rootWeight = rootedPenetrationWeight(hiddenStems, rootIndex);
          addContribution({
            element: visible.element,
            score: BRANCH_POSITION_WEIGHTS[rootPosition] * rootWeight * seasonMultiplier(visible.element, monthBranch),
            source: 'rooted_penetration',
            pillar: rootPosition,
            stem: visible.stem,
            branch: pillar.branch,
            note: `${visible.stem}${visible.element}在${pillar.name}${pillar.branch}有根且透出`,
          });
          return;
        }

        addContribution({
          element: visible.element,
          score: hiddenStemBaseScore(rootPosition, pillar.branch, hiddenStems, hiddenElement, rootIndex, monthBranch) *
            sameElementRootRatio(visible.position, rootPosition),
          source: 'elemental_rooted_penetration',
          pillar: rootPosition,
          stem: visible.stem,
          branch: pillar.branch,
          note: `${visible.stem}${visible.element}得${pillar.name}${pillar.branch}藏${hidden.stem}${hiddenElement}同气通根`,
        });
      });
    });
  });
}

function applyStemDirectControls(
  pillars: Record<PillarPosition, PillarData>,
  monthBranch: string,
  addContribution: (input: WeightedWuxingContribution) => void,
): void {
  const ordered = (Object.keys(pillars) as PillarPosition[])
    .map(position => ({
      position,
      stem: pillars[position]?.stem,
      element: toWuxingElement(pillars[position]?.stemElement || GAN_WUXING[pillars[position]?.stem]),
    }))
    .filter(item => item.stem && item.element);

  for (let index = 0; index < ordered.length - 1; index += 1) {
    applyStemControlPair(ordered[index], ordered[index + 1], monthBranch, addContribution);
    applyStemControlPair(ordered[index + 1], ordered[index], monthBranch, addContribution);
  }
}

function applyStemControlPair(
  controller: { position: PillarPosition; stem: string | undefined; element: WuxingElement | undefined },
  controlled: { position: PillarPosition; stem: string | undefined; element: WuxingElement | undefined },
  monthBranch: string,
  addContribution: (input: WeightedWuxingContribution) => void,
): void {
  if (!controller.element || !controlled.element || WUXING_CONTROLS[controller.element] !== controlled.element) return;

  const base = STEM_POSITION_WEIGHTS[controlled.position] * seasonMultiplier(controlled.element, monthBranch);
  const ratio = controller.position === 'month' && controlled.position === 'day' ? 0.10 : 0.06;
  const amount = base * ratio;
  addContribution({
    element: controlled.element,
    score: -amount,
    source: 'direct_stem_control',
    pillar: controlled.position,
    stem: `${controller.stem}${controlled.stem}`,
    note: `${pillarPositionLabel(controller.position)}干${controller.stem}${controller.element}贴近克${pillarPositionLabel(controlled.position)}干${controlled.stem}${controlled.element}`,
  });
  addContribution({
    element: controller.element,
    score: -amount * DIRECT_STEM_CONTROL_DRAIN_RATIO,
    source: 'direct_stem_control_drain',
    pillar: controller.position,
    stem: `${controller.stem}${controlled.stem}`,
    note: `${controller.stem}${controller.element}克${controlled.stem}${controlled.element}，贴身克伐自身耗气`,
  });
}

function applyBranchRelations(
  pillars: Record<PillarPosition, PillarData>,
  monthBranch: string,
  addContribution: (input: WeightedWuxingContribution) => void,
): void {
  const branchItems = (Object.keys(pillars) as PillarPosition[])
    .map(position => ({ position, branch: pillars[position]?.branch, element: toWuxingElement(pillars[position]?.branchElement) }))
    .filter(item => item.branch && item.element);
  const branches = branchItems.map(item => item.branch);

  applyDirectionalBranchClashes(pillars, branchItems, monthBranch, addContribution);
  applyNegativeBranchPair(BRANCH_HARMS, 'branch_harm', 0.05, '六害轻微削弱相关地支藏干气势', pillars, branchItems, monthBranch, addContribution);
  applyNegativeBranchPair(BRANCH_PUNISHMENTS, 'branch_punishment', 0.04, '刑关系轻微削弱相关地支藏干气势', pillars, branchItems, monthBranch, addContribution);

  BRANCH_THREE_MEETINGS.forEach((rule) => {
    const matched = rule.branches.filter(branch => branches.includes(branch));
    if (matched.length === 3) {
      addContribution({
        element: rule.element,
        score: sumBranchWeights(matched, branchItems) * 0.22 * seasonMultiplier(rule.element, monthBranch),
        source: 'three_meeting',
        note: `${rule.branches.join('')}三会${rule.element}局成势`,
      });
      applyBranchTransformationDrain(matched, rule.element, 'three_meeting_transform_drain', THREE_MEETING_TRANSFORM_DRAIN_RATIO, pillars, branchItems, monthBranch, addContribution);
    } else {
      const adjacentPair = findBestAdjacentBranchPair(rule.branches, branchItems);
      if (!adjacentPair) return;
      addContribution({
        element: rule.element,
        score: sumBranchItemWeights(adjacentPair) * 0.04 * seasonMultiplier(rule.element, monthBranch),
        source: 'partial_three_meeting',
        note: `${adjacentPair.map(item => item.branch).join('')}相邻半会${rule.element}气`,
      });
    }
  });

  BRANCH_THREE_HARMONIES.forEach((rule) => {
    const matched = rule.branches.filter(branch => branches.includes(branch));
    if (matched.length === 3) {
      addContribution({
        element: rule.element,
        score: sumBranchWeights(matched, branchItems) * 0.18 * seasonMultiplier(rule.element, monthBranch),
        source: 'three_harmony',
        note: `${rule.branches.join('')}三合${rule.element}局成势`,
      });
      applyBranchTransformationDrain(matched, rule.element, 'three_harmony_transform_drain', THREE_HARMONY_TRANSFORM_DRAIN_RATIO, pillars, branchItems, monthBranch, addContribution);
    } else {
      const adjacentPair = findBestAdjacentBranchPair(rule.branches, branchItems, rule.center);
      if (!adjacentPair) return;
      addContribution({
        element: rule.element,
        score: sumBranchItemWeights(adjacentPair) * 0.05 * seasonMultiplier(rule.element, monthBranch),
        source: 'partial_three_harmony',
        note: `${adjacentPair.map(item => item.branch).join('')}相邻半合${rule.element}气`,
      });
    }
  });

  BRANCH_SIX_COMBINATIONS.forEach((rule) => {
    const [left, right] = rule.branches;
    if (!branches.includes(left) || !branches.includes(right)) return;
    const canTransform = hasStrongTransformSupport(pillars, rule.element, monthBranch);
    addContribution({
      element: rule.element,
      score: sumBranchWeights([left, right], branchItems) * (canTransform ? 0.05 : 0.015) * seasonMultiplier(rule.element, monthBranch),
      source: canTransform ? 'six_combination_transform' : 'six_combination_bind',
      note: `${left}${right}六合${canTransform ? `化${rule.element}` : '有情未化'}`,
    });
    if (canTransform) {
      applyBranchTransformationDrain([left, right], rule.element, 'six_combination_transform_drain', SIX_COMBINATION_TRANSFORM_DRAIN_RATIO, pillars, branchItems, monthBranch, addContribution);
    }
  });
}

function applyStemCombinations(
  pillars: Record<PillarPosition, PillarData>,
  monthBranch: string,
  addContribution: (input: WeightedWuxingContribution) => void,
): void {
  const stemItems = (Object.keys(pillars) as PillarPosition[])
    .map(position => ({
      position,
      stem: pillars[position]?.stem,
      element: toWuxingElement(pillars[position]?.stemElement || GAN_WUXING[pillars[position]?.stem]),
    }))
    .filter(item => item.stem && item.element);
  const stems = stemItems.map(item => item.stem);
  STEM_COMBINATIONS.forEach((rule) => {
    const [left, right] = rule.stems;
    if (!stems.includes(left) || !stems.includes(right)) return;
    const canTransform = hasStrongTransformSupport(pillars, rule.element, monthBranch) && !hasStrongVisibleController(pillars, rule.element);
    addContribution({
      element: rule.element,
      score: (canTransform ? 0.25 : 0.08) * seasonMultiplier(rule.element, monthBranch),
      source: canTransform ? 'stem_combination_transform' : 'stem_combination_bind',
      stem: `${left}${right}`,
      note: `${left}${right}天干合${canTransform ? `化${rule.element}` : '有合未化'}`,
    });
    const matchedItems = stemItems.filter(item => item.stem === left || item.stem === right);
    matchedItems.forEach((item) => {
      if (!item.element) return;
      const ratio = canTransform ? STEM_TRANSFORM_DRAIN_RATIO : STEM_BIND_DRAIN_RATIO * stemBindDistanceRatio(matchedItems);
      addContribution({
        element: item.element,
        score: -STEM_POSITION_WEIGHTS[item.position] * seasonMultiplier(item.element, monthBranch) * ratio,
        source: canTransform ? 'stem_combination_transform_drain' : 'stem_combination_bind_drain',
        pillar: item.position,
        stem: item.stem,
        note: `${left}${right}天干合${canTransform ? `化${rule.element}` : '而未化'}，${item.stem}${item.element}原气${canTransform ? '折减' : '轻微牵绊'}`,
      });
    });
  });
}

function applyElementFlowAdjustments(
  rawScores: Record<WuxingElement, number>,
  addContribution: (input: WeightedWuxingContribution) => void,
): void {
  const snapshot = { ...rawScores };
  const average = WUXING_ELEMENTS.reduce((sum, element) => sum + snapshot[element], 0) / WUXING_ELEMENTS.length;
  if (average <= 0) return;

  WUXING_ELEMENTS.forEach((source) => {
    const sourceScore = snapshot[source];
    if (sourceScore <= 0) return;

    const generated = toWuxingElement(WUXING_GENERATES[source]);
    if (generated && sourceScore >= average * 0.75) {
      const generatedScore = snapshot[generated];
      const flowPressure = sourceScore > generatedScore ? 1 : 0.6;
      const generateAmount = sourceScore * 0.045 * flowPressure;
      const drainAmount = sourceScore * 0.018 * flowPressure;
      addContribution({
        element: generated,
        score: generateAmount,
        source: 'generating_flow',
        note: `${source}生${generated}，原局气势流通`,
      });
      addContribution({
        element: source,
        score: -drainAmount,
        source: 'draining_flow',
        note: `${source}生${generated}而自身轻微泄气`,
      });
    }

    const controlled = toWuxingElement(WUXING_CONTROLS[source]);
    if (!controlled) return;
    const controlledScore = snapshot[controlled];
    if (controlledScore <= 0) return;

    const restrainAmount = Math.min(controlledScore * RESTRAINING_FLOW_RATIO, sourceScore * RESTRAINING_FLOW_RATIO);
    addContribution({
      element: controlled,
      score: -restrainAmount,
      source: 'restraining_flow',
      note: `${source}克${controlled}，五行循环形成基础约束`,
    });
    addContribution({
      element: source,
      score: -restrainAmount * RESTRAINING_DRAIN_RATIO,
      source: 'restraining_drain',
      note: `${source}克${controlled}，基础制约自身轻微耗气`,
    });

    const dominanceRatio = sourceScore / controlledScore;
    if (sourceScore < average || dominanceRatio < 1.2) return;

    const suppressAmount = Math.min(controlledScore * 0.055, sourceScore * 0.03);
    addContribution({
      element: controlled,
      score: -suppressAmount,
      source: 'controlling_flow',
      note: `${source}克${controlled}，强者对被克五行形成压制`,
    });
    addContribution({
      element: source,
      score: -suppressAmount * CONTROLLING_DRAIN_RATIO,
      source: 'controlling_drain',
      note: `${source}克${controlled}，克伐过程自身轻微耗气`,
    });
  });
}

function applyDirectionalBranchClashes(
  pillars: Record<PillarPosition, PillarData>,
  branchItems: Array<{ position: PillarPosition; branch: string | undefined; element: WuxingElement | undefined }>,
  monthBranch: string,
  addContribution: (input: WeightedWuxingContribution) => void,
): void {
  BRANCH_CLASHES.forEach(([left, right]) => {
    const leftItems = branchItems.filter(item => item.branch === left);
    const rightItems = branchItems.filter(item => item.branch === right);
    if (leftItems.length === 0 || rightItems.length === 0) return;

    [...leftItems, ...rightItems].forEach((item) => {
      if (!item.branch || !item.element) return;
      const opposite = item.branch === left ? rightItems[0] : leftItems[0];
      if (!opposite?.branch || !opposite.element) return;
      const ratio = directionalClashRatio(item, opposite, pillars, monthBranch);
      const pillar = pillars[item.position];
      const hiddenStems = getCanonicalHiddenStems(pillar);
      hiddenStems.forEach((hidden, index) => {
        const hiddenElement = toWuxingElement(hidden.element || GAN_WUXING[hidden.stem]);
        if (!hiddenElement) return;
        addContribution({
          element: hiddenElement,
          score: -hiddenStemBaseScore(item.position, pillar.branch, hiddenStems, hiddenElement, index, monthBranch) * ratio,
          source: 'directional_branch_clash',
          pillar: item.position,
          stem: hidden.stem,
          branch: item.branch,
          note: `${left}${right}六冲按五行强弱方向削弱${item.branch}藏干`,
        });
      });
    });
  });
}

function directionalClashRatio(
  current: { position: PillarPosition; branch: string | undefined; element: WuxingElement | undefined },
  opposite: { position: PillarPosition; branch: string | undefined; element: WuxingElement | undefined },
  pillars: Record<PillarPosition, PillarData>,
  monthBranch: string,
): number {
  if (!current.branch || !current.element || !opposite.branch || !opposite.element) return 0.10;

  const currentStrength = branchStrength(current, pillars, monthBranch);
  const oppositeStrength = branchStrength(opposite, pillars, monthBranch);

  if (isEarthStorageClash(current.branch, opposite.branch)) {
    if (currentStrength < oppositeStrength * 0.90) return 0.12;
    if (currentStrength > oppositeStrength * 1.10) return 0.08;
    return 0.10;
  }

  const oppositeControlsCurrent = WUXING_CONTROLS[opposite.element] === current.element;
  const currentControlsOpposite = WUXING_CONTROLS[current.element] === opposite.element;

  if (oppositeControlsCurrent) {
    return oppositeStrength >= currentStrength ? 0.15 : 0.12;
  }
  if (currentControlsOpposite) {
    return currentStrength >= oppositeStrength ? 0.06 : 0.08;
  }
  if (currentStrength < oppositeStrength * 0.90) return 0.12;
  if (currentStrength > oppositeStrength * 1.10) return 0.08;
  return 0.10;
}

function branchStrength(
  item: { position: PillarPosition; branch: string | undefined },
  pillars: Record<PillarPosition, PillarData>,
  monthBranch: string,
): number {
  const pillar = pillars[item.position];
  const hiddenStems = getCanonicalHiddenStems(pillar);
  return hiddenStems.reduce((sum, hidden, index) => {
    const hiddenElement = toWuxingElement(hidden.element || GAN_WUXING[hidden.stem]);
    if (!hiddenElement) return sum;
    return sum + hiddenStemBaseScore(item.position, pillar.branch, hiddenStems, hiddenElement, index, monthBranch);
  }, 0);
}

function isEarthStorageClash(left: string, right: string): boolean {
  return (left === '辰' && right === '戌') ||
    (left === '戌' && right === '辰') ||
    (left === '丑' && right === '未') ||
    (left === '未' && right === '丑');
}

function applyBranchTransformationDrain(
  branches: string[],
  targetElement: WuxingElement,
  source: string,
  ratio: number,
  pillars: Record<PillarPosition, PillarData>,
  branchItems: Array<{ position: PillarPosition; branch: string | undefined }>,
  monthBranch: string,
  addContribution: (input: WeightedWuxingContribution) => void,
): void {
  branchItems
    .filter(item => item.branch && branches.includes(item.branch))
    .forEach((item) => {
      if (!item.branch) return;
      const pillar = pillars[item.position];
      const hiddenStems = getCanonicalHiddenStems(pillar);
      hiddenStems.forEach((hidden, index) => {
        const hiddenElement = toWuxingElement(hidden.element || GAN_WUXING[hidden.stem]);
        if (!hiddenElement || hiddenElement === targetElement) return;
        addContribution({
          element: hiddenElement,
          score: -hiddenStemBaseScore(item.position, pillar.branch, hiddenStems, hiddenElement, index, monthBranch) * ratio,
          source,
          pillar: item.position,
          stem: hidden.stem,
          branch: item.branch,
          note: `${branches.join('')}成化${targetElement}，${item.branch}藏${hidden.stem}${hiddenElement}原气折减`,
        });
      });
    });
}

function applyNegativeBranchPair(
  pairs: Array<[string, string]>,
  source: string,
  ratio: number,
  note: string,
  pillars: Record<PillarPosition, PillarData>,
  branchItems: Array<{ position: PillarPosition; branch: string | undefined; element: WuxingElement | undefined }>,
  monthBranch: string,
  addContribution: (input: WeightedWuxingContribution) => void,
): void {
  pairs.forEach(([left, right]) => {
    const hasLeft = branchItems.some(item => item.branch === left);
    const hasRight = branchItems.some(item => item.branch === right);
    if (!hasLeft || !hasRight) return;
    const matched = branchItems.filter(item => item.branch === left || item.branch === right);
    matched.forEach((item) => {
      if (!item.branch) return;
      const pillar = pillars[item.position];
      const hiddenStems = getCanonicalHiddenStems(pillar);
      hiddenStems.forEach((hidden, index) => {
        const hiddenElement = toWuxingElement(hidden.element || GAN_WUXING[hidden.stem]);
        if (!hiddenElement) return;
        addContribution({
          element: hiddenElement,
          score: -hiddenStemBaseScore(item.position, pillar.branch, hiddenStems, hiddenElement, index, monthBranch) * ratio,
          source,
          pillar: item.position,
          stem: hidden.stem,
          branch: item.branch,
          note,
        });
      });
    });
  });
}

function hiddenStemBaseScore(
  position: PillarPosition,
  branch: string,
  hiddenStems: HiddenStemData[],
  hiddenElement: WuxingElement,
  hiddenIndex: number,
  monthBranch: string,
): number {
  const qiWeight = hiddenQiWeight(branch, hiddenStems, hiddenIndex);
  const commandMultiplier = position === 'month' ? (1.08 - Math.min(hiddenIndex, 2) * 0.04) : 1;
  const hiddenSeasonMultiplier = position === 'month' ? 1 : seasonMultiplier(hiddenElement, monthBranch);
  return BRANCH_POSITION_WEIGHTS[position] * qiWeight * commandMultiplier * hiddenSeasonMultiplier;
}

function hiddenQiWeight(branch: string, hiddenStems: HiddenStemData[], index: number): number {
  const weights = ZHI_HIDDEN_QI_WEIGHTS[branch] || HIDDEN_QI_WEIGHTS_BY_COUNT[hiddenStems.length] || HIDDEN_QI_WEIGHTS_BY_COUNT[3];
  return weights[index] ?? weights[weights.length - 1];
}

function rootedPenetrationWeight(hiddenStems: HiddenStemData[], index: number): number {
  const weights = ROOTED_PENETRATION_WEIGHTS_BY_COUNT[hiddenStems.length] || ROOTED_PENETRATION_WEIGHTS_BY_COUNT[3];
  return weights[index] ?? weights[weights.length - 1];
}

function sameElementRootRatio(visiblePosition: PillarPosition, rootPosition: PillarPosition): number {
  const order: Record<PillarPosition, number> = { year: 0, month: 1, day: 2, time: 3 };
  const distance = Math.abs(order[visiblePosition] - order[rootPosition]);
  return SAME_ELEMENT_ROOT_RATIOS[distance] ?? SAME_ELEMENT_ROOT_RATIOS[SAME_ELEMENT_ROOT_RATIOS.length - 1];
}

function stemBindDistanceRatio(items: Array<{ position: PillarPosition }>): number {
  if (items.length < 2) return 1;
  const order: Record<PillarPosition, number> = { year: 0, month: 1, day: 2, time: 3 };
  const distance = Math.abs(order[items[0].position] - order[items[1].position]);
  if (distance <= 1) return 1;
  if (distance === 2) return 0.55;
  return 0.35;
}

function pillarPositionLabel(position: PillarPosition): string {
  const labels: Record<PillarPosition, string> = {
    year: '年',
    month: '月',
    day: '日',
    time: '时',
  };
  return labels[position];
}

function sumBranchWeights(
  branches: string[],
  branchItems: Array<{ position: PillarPosition; branch: string | undefined }>,
): number {
  return branches.reduce((sum, branch) => {
    const best = branchItems
      .filter(item => item.branch === branch)
      .reduce((max, item) => Math.max(max, BRANCH_POSITION_WEIGHTS[item.position]), 0);
    return sum + best;
  }, 0);
}

function sumBranchItemWeights(items: Array<{ position: PillarPosition }>): number {
  return items.reduce((sum, item) => sum + BRANCH_POSITION_WEIGHTS[item.position], 0);
}

function findBestAdjacentBranchPair(
  ruleBranches: string[],
  branchItems: Array<{ position: PillarPosition; branch: string | undefined }>,
  requiredBranch?: string,
): Array<{ position: PillarPosition; branch: string | undefined }> | null {
  let bestPair: Array<{ position: PillarPosition; branch: string | undefined }> | null = null;
  let bestScore = -Infinity;

  for (let index = 0; index < branchItems.length - 1; index += 1) {
    const pair = [branchItems[index], branchItems[index + 1]];
    if (!pair.every(item => item.branch && ruleBranches.includes(item.branch))) continue;
    if (pair[0].branch === pair[1].branch) continue;
    if (requiredBranch && !pair.some(item => item.branch === requiredBranch)) continue;

    const score = sumBranchItemWeights(pair);
    if (score > bestScore) {
      bestPair = pair;
      bestScore = score;
    }
  }

  return bestPair;
}

function hasStrongTransformSupport(
  pillars: Record<PillarPosition, PillarData>,
  element: WuxingElement,
  monthBranch: string,
): boolean {
  return seasonMultiplier(element, monthBranch) >= 1.1 ||
    hasMainQiElement(pillars, element) ||
    (hasVisibleElement(pillars, element) && hasHiddenElement(pillars, element));
}

function hasVisibleElement(pillars: Record<PillarPosition, PillarData>, element: WuxingElement): boolean {
  return (Object.keys(pillars) as PillarPosition[]).some(position => pillars[position]?.stemElement === element);
}

function hasHiddenElement(pillars: Record<PillarPosition, PillarData>, element: WuxingElement): boolean {
  return (Object.keys(pillars) as PillarPosition[])
    .some(position => getCanonicalHiddenStems(pillars[position]).some(hidden => (hidden.element || GAN_WUXING[hidden.stem]) === element));
}

function hasMainQiElement(pillars: Record<PillarPosition, PillarData>, element: WuxingElement): boolean {
  return (Object.keys(pillars) as PillarPosition[])
    .some(position => {
      const mainHidden = getCanonicalHiddenStems(pillars[position])[0];
      return (mainHidden?.element || GAN_WUXING[mainHidden?.stem]) === element;
    });
}

function hasStrongVisibleController(pillars: Record<PillarPosition, PillarData>, element: WuxingElement): boolean {
  const controller = WUXING_ELEMENTS.find(item => WUXING_CONTROLS[item] === element);
  if (!controller) return false;
  return (Object.keys(pillars) as PillarPosition[]).some(position => {
    const pillar = pillars[position];
    return pillar?.stemElement === controller && STEM_POSITION_WEIGHTS[position] >= 1;
  });
}

function calculateDayMasterStrength(
  dayGan: string,
  monthBranch: string,
  contributions: WeightedWuxingContribution[],
): DayMasterStrength {
  const dayElement = toWuxingElement(GAN_WUXING[dayGan]);
  if (!dayElement) {
    return { score: 0, label: 'unknown', supportScore: 0, drainScore: 0 };
  }

  const resourceElement = WUXING_ELEMENTS.find(element => WUXING_GENERATES[element] === dayElement);
  let supportScore = 0;
  let drainScore = 0;

  contributions.forEach((item) => {
    if (item.source === 'day_stem') return;
    const element = toWuxingElement(item.element);
    if (!element) return;
    const amount = item.score;
    const supportsDay = element === dayElement || element === resourceElement;
    if (supportsDay) {
      supportScore += amount;
    } else {
      drainScore += amount;
    }
  });

  supportScore = Math.max(0, supportScore);
  drainScore = Math.max(0, drainScore);
  const total = supportScore + drainScore;
  const score = total > 0 ? Math.round((supportScore / total) * 200 - 100) : 0;

  return {
    score,
    label: dayMasterStrengthLabel(score),
    supportScore: round2(supportScore),
    drainScore: round2(drainScore),
  };
}

function dayMasterStrengthLabel(score: number): string {
  if (score > 60) return 'extremely_strong';
  if (score > 30) return 'strong';
  if (score >= -10) return 'balanced';
  if (score >= -30) return 'neutral_weak';
  if (score >= -60) return 'weak';
  return 'extremely_weak';
}

function calculateBalanceIndex(scores: Record<string, WeightedElementScore>): number {
  const totalDeviation = WUXING_ELEMENTS.reduce((sum, element) => {
    return sum + Math.abs((scores[element]?.percent || 0) - 20);
  }, 0);
  return round2(Math.max(0, 1 - totalDeviation / 160));
}

function buildMajorFactors(
  pillars: Record<PillarPosition, PillarData>,
  dominant: string,
  weakest: string,
  strength: DayMasterStrength,
): string[] {
  const factors = [
    `月令${pillars.month?.branch || ''}${pillars.month?.branchElement || ''}主导季节气势`,
    `${dominant}为当前加权最强五行`,
    `${weakest}为当前加权最弱五行`,
    `日主${pillars.day?.stem || ''}${pillars.day?.stemElement || ''}强弱为${strength.label}`,
  ];

  const visible = (Object.keys(pillars) as PillarPosition[])
    .map(position => pillars[position]?.stem)
    .filter(Boolean)
    .join('');
  if (visible) factors.push(`天干${visible}透出参与显性能量`);

  return factors;
}

function topContributions(contributions: WeightedWuxingContribution[]): WeightedWuxingContribution[] {
  return [...contributions]
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 64);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 获取指定大运下的流年列表
 *
 * @param birthYear   公历出生年
 * @param birthMonth  公历出生月
 * @param birthDay    公历出生日
 * @param birthHour   出生小时
 * @param gender      性别
 * @param daYunIndex  大运序号（0=第一个大运）
 * @param count       流年数量（默认10）
 */
export async function getLiuNian(
  birthYear: number, birthMonth: number, birthDay: number,
  birthHour: number = 12, gender: number = 1,
  daYunIndex: number = 0, count: number = 10,
): Promise<AnnualLuckData[]> {

  const solar = Solar.fromYmdHms(birthYear, birthMonth, birthDay, birthHour, 0, 0);
  const lunar = solar.getLunar();
  const bazi = lunar.getEightChar();
  const dayGan = bazi.getDayGan();
  const yun = bazi.getYun(gender, 1);
  const daYunList = yun.getDaYun();

  if (!daYunList[daYunIndex]) return [];

  return buildLiuNianList(dayGan, daYunList[daYunIndex]).slice(0, count);
}

/**
 * 获取指定流年下的流月列表
 *
 * @param birthYear   公历出生年
 * @param birthMonth  公历出生月
 * @param birthDay    公历出生日
 * @param birthHour   出生小时
 * @param gender      性别
 * @param daYunIndex  大运序号
 * @param liuNianIndex 流年序号
 */
export async function getLiuYue(
  birthYear: number, birthMonth: number, birthDay: number,
  birthHour: number = 12, gender: number = 1,
  daYunIndex: number = 0, liuNianIndex: number = 0,
): Promise<MonthlyLuckData[]> {

  const solar = Solar.fromYmdHms(birthYear, birthMonth, birthDay, birthHour, 0, 0);
  const lunar = solar.getLunar();
  const bazi = lunar.getEightChar();
  const dayGan = bazi.getDayGan();
  const yun = bazi.getYun(gender, 1);
  const daYunList = yun.getDaYun();

  if (!daYunList[daYunIndex]) return [];
  const liuNian = daYunList[daYunIndex].getLiuNian();
  if (!liuNian[liuNianIndex]) return [];

  return buildLiuYueList(dayGan, liuNian[liuNianIndex]);
}
