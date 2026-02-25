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
const { Solar, Lunar: LunarLib } = require('lunar-javascript') as { Solar: any; Lunar: any };

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
  age: number;        // 起始年龄
  stem: string;       // 天干（如"乙"）
  branch: string;     // 地支（如"酉"）
  tenGod: string;     // 天干十神（如"伤"）
}

/** 流年数据（对应 simple.md §10.5 AnnualLuck） */
export interface AnnualLuckData {
  year: number;           // 年份
  stem: string;           // 天干
  branch: string;         // 地支
  tenGodTop: string;      // 天干十神
  tenGodBottom: string;   // 地支主气十神
}

/** 流月数据（对应 simple.md §10.5 MonthlyLuck） */
export interface MonthlyLuckData {
  month: number;          // 月份序号（1-12）
  stem: string;           // 天干
  branch: string;         // 地支
  tenGod: string;         // 天干十神
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

  // 大运信息
  startAge: number;           // 起运年龄
  startDate: string;          // 起运时间
  isForward: boolean;         // 顺运（男阳/女阴）还是逆运
  majorCycles: MajorCycleData[];  // 大运列表
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

  // ── 步骤 7：计算大运 ────────────────────────────────────────
  const yun = bazi.getYun(gender, sect);
  const daYunList = yun.getDaYun();

  const startAge = daYunList.length > 0 ? daYunList[0].getStartAge() : 0;
  const startSolar = yun.getStartSolar();
  const startDate = startSolar ? startSolar.toYmd() : '';
  const isForward = yun.isForward();

  const majorCycles: MajorCycleData[] = daYunList.slice(0, 10).map((dy: any) => {
    const gz = dy.getGanZhi() || '';
    return {
      startYear: dy.getStartYear(),
      age: dy.getStartAge(),
      stem: gz[0] || '',
      branch: gz[1] || '',
      tenGod: gz ? getTenGod(gz[0]) : '',
    };
  });

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

/**
 * 根据日主天干和目标干支字符，推算十神
 * 用于大运十神计算
 */
function getTenGod(char: string): string {
  // 大运十神暂时直接返回干支字符，由前端或后续接口做完整推算
  return char || '';
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
  const yun = bazi.getYun(gender, 1);
  const daYunList = yun.getDaYun();

  if (!daYunList[daYunIndex]) return [];

  const liuNian = daYunList[daYunIndex].getLiuNian();
  return liuNian.slice(0, count).map((ln: any) => {
    const gz: string = ln.getGanZhi() || '';
    const shiShen: string[] = ln.getShiShenGan ? ln.getShiShenGan() : [];
    return {
      year: ln.getYear(),
      stem: gz[0] || '',
      branch: gz[1] || '',
      tenGodTop: shiShen[0] || '',    // 天干十神
      tenGodBottom: shiShen[1] || '', // 地支主气十神
    };
  });
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
  const yun = bazi.getYun(gender, 1);
  const daYunList = yun.getDaYun();

  if (!daYunList[daYunIndex]) return [];
  const liuNian = daYunList[daYunIndex].getLiuNian();
  if (!liuNian[liuNianIndex]) return [];

  const liuYue = liuNian[liuNianIndex].getLiuYue();
  return liuYue.map((ly: any, i: number) => {
    const gz: string = ly.getGanZhi() || '';
    const shiShen: string[] = ly.getShiShenGan ? ly.getShiShenGan() : [];
    return {
      month: i + 1,
      stem: gz[0] || '',
      branch: gz[1] || '',
      tenGod: shiShen[0] || '',  // 天干十神
    };
  });
}
