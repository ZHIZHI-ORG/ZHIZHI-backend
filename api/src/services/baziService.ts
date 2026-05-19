/**
 * 八字服务层（Service）
 *
 * 职责：
 *   - 创建八字档案（调用计算器、写入数据库）
 *   - 查询档案列表 / 详情
 *   - 更新档案（仅允许改非核心字段）
 *   - 删除档案（软删除）
 *
 * 计算器：baziCalculator.ts（基于 lunar-javascript + 自研神煞查表）
 */

import { baziProfileRepository } from '../database/repositories/BaziProfileRepository';
import {
  BaziProfile,
  CreateBaziProfileInput,
  UpdateBaziProfileInput,
  BaziProfileListQuery,
  BaziProfileListResponse,
} from '../models/BaziProfile';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors';
import { buildDailyLuckData, calculateFullChart, calculateWeightedWuxingFromChart } from '../utils/baziCalculator';
import {
  buildMingliFactPanel,
  buildNatalMingliInteractions,
  buildTimingMingliInteractions,
  MingliInteraction,
} from '../utils/mingliInteractionEngine';
import { normalizeBirthTimeForBazi } from './trueSolarTimeService';

// ============================================================
// 创建档案
// ============================================================

/**
 * 创建八字档案
 *
 * 流程：
 *   1. 验证输入字段
 *   2. 检查本人档案是否已存在（is_owner=true 只能有一个）
 *   3. 调用计算器生成完整命盘
 *   4. 写入数据库（基础字段 + full_chart）
 *
 * @param userId - 当前登录用户 ID
 * @param input  - 前端提交的档案信息
 */
export async function createBaziProfile(
  userId: string,
  input: CreateBaziProfileInput,
): Promise<BaziProfile> {

  // 1. 验证输入
  validateBaziInput(input);

  // 2. 本人档案唯一性检查
  if (input.is_owner) {
    const hasOwner = await baziProfileRepository.hasOwnerProfile(userId);
    if (hasOwner) {
      throw new ValidationError('您已经创建过本人档案，无法重复创建');
    }
  }

  // 3. 先按出生地经纬度校准真太阳时，再计算完整命盘
  const normalizedBirthTime = normalizeBirthTimeForBazi({
    year: input.birth_year,
    month: input.birth_month,
    day: input.birth_day,
    hour: input.birth_hour ?? 12,
    minute: input.birth_minute ?? 0,
    timezone: input.birth_timezone || 'Asia/Shanghai',
    longitude: input.birth_longitude,
    latitude: input.birth_latitude,
  });

  const chart = await calculateFullChart(
    normalizedBirthTime.corrected.year,
    normalizedBirthTime.corrected.month,
    normalizedBirthTime.corrected.day,
    normalizedBirthTime.corrected.hour,
    normalizedBirthTime.corrected.minute,
    input.is_lunar ?? false,
    input.gender === 'female' ? 2 : 1,
    1,   // sect 默认流派1
  );
  chart.calculationInfo = {
    trueSolarTime: normalizedBirthTime,
  };

  // 4. 写入数据库
  const profile = await baziProfileRepository.create(userId, {
    // 前端提交的基础字段
    is_owner: input.is_owner,
    name: input.name,
    relation_to_owner: input.relation_to_owner,
    gender: input.gender,
    birth_year: input.birth_year,
    birth_month: input.birth_month,
    birth_day: input.birth_day,
    birth_hour: input.birth_hour,
    birth_minute: input.birth_minute,
    is_lunar: input.is_lunar,
    birth_timezone: input.birth_timezone,
    // 可选扩展字段（simple.md §4.3）
    birth_country: input.birth_country,
    birth_region: input.birth_region,
    birth_latitude: input.birth_latitude,
    birth_longitude: input.birth_longitude,
    time_basis: normalizedBirthTime.timeBasis,
    true_solar_time: formatNormalizedBirthTime(normalizedBirthTime.corrected),
    true_solar_correction_minutes: normalizedBirthTime.correctionMinutes,
    calculation_metadata: {
      true_solar_time: normalizedBirthTime,
    },
    mbti: input.mbti,
    notes: input.notes,
    // 基础四柱冗余列
    bazi_year_stem: chart.year.stem,
    bazi_year_branch: chart.year.branch,
    bazi_month_stem: chart.month.stem,
    bazi_month_branch: chart.month.branch,
    bazi_day_stem: chart.day.stem,
    bazi_day_branch: chart.day.branch,
    bazi_hour_stem: chart.time.stem,
    bazi_hour_branch: chart.time.branch,
    // 五行分析
    wuxing_analysis: chart.wuxing,
    // 完整命盘 JSONB
    full_chart: chart,
    // 日主冗余字段
    day_master: chart.dayMaster,
    day_master_element: chart.dayMasterElement,
  });

  return profile;
}

// ============================================================
// 查询档案列表
// ============================================================

/**
 * 获取用户的八字档案列表
 *
 * @param userId - 用户 ID
 * @param query  - 分页/筛选参数
 */
export async function getBaziProfileList(
  userId: string,
  query?: BaziProfileListQuery,
): Promise<BaziProfileListResponse> {

  const { items, total } = await baziProfileRepository.findByOwner(userId, query);

  const page = query?.page || 1;
  const pageSize = query?.page_size || 20;

  return {
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  };
}

// ============================================================
// 查询档案详情
// ============================================================

/**
 * 获取单个八字档案详情（含完整命盘）
 *
 * @param userId    - 当前用户 ID（用于权限校验）
 * @param profileId - 档案 ID
 */
export async function getBaziProfileById(
  userId: string,
  profileId: string,
): Promise<BaziProfile> {

  const profile = await baziProfileRepository.findById(profileId);

  if (!profile) {
    throw new NotFoundError('八字档案不存在');
  }

  // 权限校验：只能访问自己的档案
  if (profile.owner_user_id !== userId) {
    throw new ForbiddenError('无权访问此档案');
  }

  return profile;
}

// ============================================================
// 更新档案
// ============================================================

/**
 * 更新八字档案
 *
 * 根据 simple.md §4.2：只允许修改姓名、关系、备注
 * 生辰信息不可更改（影响命盘计算结果的一致性）
 *
 * @param userId    - 当前用户 ID
 * @param profileId - 档案 ID
 * @param input     - 可更新字段
 */
export async function updateBaziProfile(
  userId: string,
  profileId: string,
  input: UpdateBaziProfileInput,
): Promise<BaziProfile> {

  // 权限校验（内部调用 findById）
  await getBaziProfileById(userId, profileId);

  return await baziProfileRepository.update(profileId, input);
}

// ============================================================
// 删除档案
// ============================================================

/**
 * 删除八字档案（软删除，设置 deleted_at）
 *
 * @param userId    - 当前用户 ID
 * @param profileId - 档案 ID
 */
export async function deleteBaziProfile(
  userId: string,
  profileId: string,
): Promise<boolean> {

  // 权限校验
  await getBaziProfileById(userId, profileId);

  return await baziProfileRepository.softDelete(profileId);
}

// ============================================================
// 结构化命盘 / 运势时间线
// ============================================================

function toSnakePillar(position: string, pillar: any) {
  return {
    position,
    stem: pillar?.stem || '',
    branch: pillar?.branch || '',
    ten_god: pillar?.tenGod || '',
    stem_element: pillar?.stemElement || '',
    branch_element: pillar?.branchElement || '',
    hidden_stems: (pillar?.hiddenStems || []).map((item: any) => ({
      stem: item.stem,
      ten_god: item.tenGod,
      element: item.element,
    })),
    lifecycle: pillar?.lifecycle || '',
    void_info: pillar?.voidInfo || '',
    na_yin: pillar?.naYin || '',
    shen_sha: pillar?.shenSha || [],
  };
}

function wuxingToContract(wuxing: any) {
  return {
    metal: wuxing?.金 || 0,
    wood: wuxing?.木 || 0,
    water: wuxing?.水 || 0,
    fire: wuxing?.火 || 0,
    earth: wuxing?.土 || 0,
    dominant: wuxing?.dominant || '',
    lacking: wuxing?.lacking || [],
  };
}

function weightedWuxingToContract(weighted: any) {
  if (!weighted) return null;
  const scores = weighted.scores || {};
  return {
    method_version: weighted.methodVersion || weighted.method_version || 'weighted_wuxing_v2_9',
    scores: {
      wood: scoreToContract(scores['木'] || scores.wood),
      fire: scoreToContract(scores['火'] || scores.fire),
      earth: scoreToContract(scores['土'] || scores.earth),
      metal: scoreToContract(scores['金'] || scores.metal),
      water: scoreToContract(scores['水'] || scores.water),
    },
    dominant: toEnglishElement(weighted.dominant),
    weakest: toEnglishElement(weighted.weakest),
    balance_index: weighted.balanceIndex ?? weighted.balance_index ?? 0,
    day_master_strength: {
      score: weighted.dayMasterStrength?.score ?? weighted.day_master_strength?.score ?? 0,
      label: weighted.dayMasterStrength?.label ?? weighted.day_master_strength?.label ?? '',
      support_score: weighted.dayMasterStrength?.supportScore ?? weighted.day_master_strength?.support_score ?? 0,
      drain_score: weighted.dayMasterStrength?.drainScore ?? weighted.day_master_strength?.drain_score ?? 0,
    },
    major_factors: weighted.majorFactors || weighted.major_factors || [],
    contributions: (weighted.contributions || []).map((item: any) => ({
      element: toEnglishElement(item.element),
      score: item.score,
      source: item.source,
      pillar: item.pillar,
      stem: item.stem,
      branch: item.branch,
      note: item.note,
    })),
  };
}

function mingliInteractionToContract(item: MingliInteraction) {
  return {
    id: item.id,
    scope: item.scope,
    relation: item.relation,
    relation_name: item.relationName,
    fact_label: item.factLabel,
    short_label: item.shortLabel,
    display_group: item.displayGroup,
    aliases: item.aliases,
    participants: item.participants.map(mingliParticipantToContract),
    source: item.source ? mingliParticipantToContract(item.source) : null,
    targets: item.targets.map(mingliParticipantToContract),
    transform_element: item.transformElement || null,
    center_branch: item.centerBranch || null,
    activated_palaces: item.activatedPalaces,
    domain_candidates: item.domainCandidates,
    intensity: item.intensity,
    time_horizon: item.timeHorizon,
    evidence: item.evidence,
    adjacent: item.adjacent,
    full_match: item.fullMatch,
    missing_branch: item.missingBranch || null,
    seen_stem: item.seenStem || null,
    compared_against: item.comparedAgainst,
    rule_version: item.ruleVersion,
  };
}

function mingliParticipantToContract(participant: MingliInteraction['participants'][number]) {
  return {
    type: participant.type,
    pillar: participant.pillar || null,
    label: participant.label,
    stem: participant.stem || '',
    branch: participant.branch || '',
    gan_zhi: participant.ganZhi || '',
    ten_gods: participant.tenGods || [],
  };
}

function mingliFactPanelToContract(panel: ReturnType<typeof buildMingliFactPanel>) {
  return {
    heavenly_stem_luck: panel.heavenlyStemLuck,
    earthly_branch_luck: panel.earthlyBranchLuck,
    heavenly_stem_natal: panel.heavenlyStemNatal,
    earthly_branch_natal: panel.earthlyBranchNatal,
  };
}

function scoreToContract(score: any) {
  return {
    raw: score?.raw || 0,
    percent: score?.percent || 0,
  };
}

function toEnglishElement(element: string): string {
  const map: Record<string, string> = {
    '木': 'wood',
    '火': 'fire',
    '土': 'earth',
    '金': 'metal',
    '水': 'water',
  };
  return map[element] || element || '';
}

function getChart(profile: BaziProfile): any {
  return profile.full_chart || {
    dayMaster: profile.day_master,
    dayMasterElement: profile.day_master_element,
    year: {
      stem: profile.bazi_year_stem,
      branch: profile.bazi_year_branch,
    },
    month: {
      stem: profile.bazi_month_stem,
      branch: profile.bazi_month_branch,
    },
    day: {
      stem: profile.bazi_day_stem,
      branch: profile.bazi_day_branch,
    },
    time: {
      stem: profile.bazi_hour_stem,
      branch: profile.bazi_hour_branch,
    },
    wuxing: profile.wuxing_analysis,
    majorCycles: [],
  };
}

function mapMajorCycle(cycle: any, index: number) {
  return {
    id: `${cycle.startYear || 'unknown'}-${cycle.ganZhi || index}`,
    start_year: cycle.startYear,
    end_year: cycle.endYear,
    age_start: cycle.age,
    age_end: cycle.endAge,
    stem: cycle.stem,
    branch: cycle.branch,
    gan_zhi: cycle.ganZhi,
    ten_god: cycle.tenGod,
    xun: cycle.xun || '',
    xun_kong: cycle.xunKong || '',
    label: cycle.ganZhi === '童限' ? '童限' : '大运',
  };
}

function mapAnnualLuck(item: any) {
  return {
    id: `${item.year}-${item.ganZhi}`,
    year: item.year,
    age: item.age,
    stem: item.stem,
    branch: item.branch,
    gan_zhi: item.ganZhi,
    ten_god_top: item.tenGodTop,
    ten_god_bottom: item.tenGodBottom,
    xun: item.xun,
    xun_kong: item.xunKong,
  };
}

function mapMonthlyLuck(item: any) {
  return {
    id: `${item.month}-${item.ganZhi}`,
    month: item.month,
    month_in_chinese: item.monthInChinese,
    solar_term: item.solarTerm || null,
    start_date: item.startDate || null,
    end_date: item.endDate || null,
    stem: item.stem,
    branch: item.branch,
    gan_zhi: item.ganZhi,
    ten_god: item.tenGod,
    ten_god_bottom: item.tenGodBottom,
    xun: item.xun,
    xun_kong: item.xunKong,
  };
}

function mapDailyLuck(item: any) {
  return {
    id: `${item.date}-${item.ganZhi}`,
    date: item.date,
    lunar_day: item.lunarDay,
    stem: item.stem,
    branch: item.branch,
    gan_zhi: item.ganZhi,
    ten_god_top: item.tenGodTop,
    ten_god_bottom: item.tenGodBottom,
    xun: item.xun,
    xun_kong: item.xunKong,
  };
}

export async function getBaziChart(userId: string, profileId: string) {
  const profile = await getBaziProfileById(userId, profileId);
  const chart = getChart(profile);
  const weightedWuxing = chart.weightedWuxing || chart.weighted_wuxing_analysis || calculateWeightedWuxingFromChart(chart);
  const natalInteractions = buildNatalMingliInteractions(chart);

  return {
    profile_id: profile.id,
    day_master: chart.dayMaster || profile.day_master || '',
    day_master_element: chart.dayMasterElement || profile.day_master_element || '',
    hour_precision: profile.birth_hour === null || profile.birth_hour === undefined ? 'unknown' : 'known',
    pillars: [
      toSnakePillar('year', chart.year),
      toSnakePillar('month', chart.month),
      toSnakePillar('day', chart.day),
      toSnakePillar('hour', chart.time),
    ],
    wuxing_analysis: wuxingToContract(chart.wuxing || profile.wuxing_analysis),
    weighted_wuxing_analysis: weightedWuxingToContract(weightedWuxing),
    mingli_facts: {
      rule_version: 'mingli_interactions_v1',
      fact_panel: mingliFactPanelToContract(buildMingliFactPanel(natalInteractions)),
      natal_interactions: natalInteractions.map(mingliInteractionToContract),
    },
    calculation_info: {
      start_luck_age: chart.startAge || 0,
      start_luck_text: chart.startDate ? `起运时间：${chart.startDate}` : '',
      start_luck_date: chart.startDate || null,
      is_forward: chart.isForward ?? null,
      transition_rule: chart.isForward === true ? '顺行' : chart.isForward === false ? '逆行' : '',
      commanding_stem: chart.month?.stem || profile.bazi_month_stem || '',
      time_basis: profile.time_basis || chart.calculationInfo?.trueSolarTime?.timeBasis || 'standard_time',
      true_solar_time: profile.true_solar_time || null,
      true_solar_correction_minutes: profile.true_solar_correction_minutes ?? chart.calculationInfo?.trueSolarTime?.correctionMinutes ?? null,
      birth_longitude: profile.birth_longitude ?? chart.calculationInfo?.trueSolarTime?.longitude ?? null,
      birth_latitude: profile.birth_latitude ?? chart.calculationInfo?.trueSolarTime?.latitude ?? null,
    },
  };
}

export async function getBaziLuckTimeline(
  userId: string,
  profileId: string,
  query: { year?: number; month?: number; day?: string },
) {
  if (query.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(query.day)) {
    throw new ValidationError('day 必须是 YYYY-MM-DD 格式');
  }
  const profile = await getBaziProfileById(userId, profileId);
  const chart = getChart(profile);
  const selectedDay = query.day || formatDateForLuck(new Date());
  const year = query.year || Number(selectedDay.slice(0, 4));
  const majorCycles = (chart.majorCycles || []) as any[];
  const activeCycle = majorCycles.find((cycle) => year >= cycle.startYear && year <= cycle.endYear)
    || majorCycles[0];
  const annualLucks = (activeCycle?.annualLuck || []).map(mapAnnualLuck);
  const selectedAnnual = (activeCycle?.annualLuck || []).find((item: any) => item.year === year)
    || activeCycle?.annualLuck?.[0];
  const selectedMonth = selectMonthlyLuck(selectedAnnual?.monthlyLuck || [], query.month, selectedDay);
  const selectedDaily = buildDailyLuckData(chart.dayMaster || profile.day_master || '', selectedDay);
  const timingInteractions = buildTimingMingliInteractions(chart, {
    dayun: activeCycle,
    liunian: selectedAnnual,
    liuyue: selectedMonth,
    liuri: selectedDaily,
  });
  const natalInteractions = buildNatalMingliInteractions(chart);

  return {
    profile_id: profile.id,
    selected_year: year,
    selected_month: selectedMonth?.month || query.month || null,
    selected_day: selectedDay,
    active_luck_context: {
      dayun: activeCycle ? mapMajorCycle(activeCycle, majorCycles.indexOf(activeCycle)) : null,
      liunian: selectedAnnual ? mapAnnualLuck(selectedAnnual) : null,
      liuyue: selectedMonth ? mapMonthlyLuck(selectedMonth) : null,
      liuri: selectedDaily ? mapDailyLuck(selectedDaily) : null,
    },
    major_cycles: majorCycles.map(mapMajorCycle),
    annual_lucks: annualLucks,
    monthly_lucks: (selectedAnnual?.monthlyLuck || []).map(mapMonthlyLuck),
    daily_lucks: selectedDaily ? [mapDailyLuck(selectedDaily)] : [],
    fact_panel: mingliFactPanelToContract(buildMingliFactPanel([...timingInteractions, ...natalInteractions])),
    timing_interactions: timingInteractions.map(mingliInteractionToContract),
  };
}

function selectMonthlyLuck(monthlyLuck: any[], month: number | undefined, day: string) {
  if (month) {
    return monthlyLuck.find((item: any) => item.month === month) || null;
  }
  const byDate = monthlyLuck.find((item: any) => {
    if (!item.startDate || !item.endDate) return false;
    return day >= item.startDate && day < item.endDate;
  });
  if (byDate) return byDate;
  const gregorianMonth = Number(day.slice(5, 7));
  return monthlyLuck.find((item: any) => item.month === gregorianMonth) || null;
}

function formatDateForLuck(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function getBaziLuckAnalysis(
  userId: string,
  profileId: string,
  query: { major_cycle_key?: string; year?: number; month?: number; day?: string },
) {
  if (query.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(query.day)) {
    throw new ValidationError('day 必须是 YYYY-MM-DD 格式');
  }

  const timeline = await getBaziLuckTimeline(userId, profileId, {
    year: query.year,
    month: query.month,
    day: query.day,
  });
  const selectedCycle = timeline.major_cycles.find((cycle: any) => cycle.id === query.major_cycle_key)
    || timeline.major_cycles.find((cycle: any) => timeline.selected_year >= cycle.start_year && timeline.selected_year <= cycle.end_year)
    || timeline.major_cycles[0];
  const selectedAnnual = timeline.annual_lucks.find((item: any) => item.year === timeline.selected_year)
    || timeline.annual_lucks[0];
  const selectedMonthly = query.month
    ? timeline.monthly_lucks.find((item: any) => item.month === query.month)
    : null;

  return {
    heavenly_stem_luck: selectedAnnual
      ? `${timeline.selected_year} 年天干 ${selectedAnnual.stem || '未知'}，十神为 ${selectedAnnual.ten_god_top || '未知'}。`
      : '当前档案暂无流年天干数据。',
    earthly_branch_luck: selectedAnnual
      ? `${timeline.selected_year} 年地支 ${selectedAnnual.branch || '未知'}，地支关系为 ${selectedAnnual.ten_god_bottom || '未知'}。`
      : '当前档案暂无流年地支数据。',
    heavenly_stem_base: selectedCycle
      ? `当前大运 ${selectedCycle.gan_zhi || selectedCycle.label}，天干 ${selectedCycle.stem || '未知'}。`
      : '当前档案暂无大运数据。',
    earthly_branch_base: selectedCycle
      ? `当前大运地支 ${selectedCycle.branch || '未知'}，年龄段 ${selectedCycle.age_start || '-'}-${selectedCycle.age_end || '-'}。`
      : '当前档案暂无大运数据。',
    shen_sha: {
      major_cycle: selectedCycle?.label || '',
      annual: selectedAnnual?.gan_zhi || '',
      monthly: selectedMonthly?.gan_zhi || '',
      daily: query.day || '',
    },
  };
}

// ============================================================
// 输入验证
// ============================================================

/**
 * 验证创建档案的输入字段
 */
function validateBaziInput(input: CreateBaziProfileInput): void {

  // 姓名
  if (!input.name || input.name.trim().length === 0) {
    throw new ValidationError('姓名不能为空');
  }
  if (input.name.length > 50) {
    throw new ValidationError('姓名不能超过50个字符');
  }

  // 性别
  if (!input.gender || !['male', 'female'].includes(input.gender)) {
    throw new ValidationError('性别必须为 male 或 female');
  }

  // 亲友档案必须填写关系
  if (!input.is_owner && !input.relation_to_owner) {
    throw new ValidationError('亲友档案必须填写与您的关系');
  }

  // 出生年份
  const currentYear = new Date().getFullYear();
  if (input.birth_year < 1900 || input.birth_year > currentYear + 1) {
    throw new ValidationError(`出生年份须在 1900 到 ${currentYear + 1} 之间`);
  }

  // 出生月份
  if (input.birth_month < 1 || input.birth_month > 12) {
    throw new ValidationError('出生月份须在 1 到 12 之间');
  }

  // 出生日期
  if (input.birth_day < 1 || input.birth_day > 31) {
    throw new ValidationError('出生日期须在 1 到 31 之间');
  }

  // 时辰（可选）
  if (input.birth_hour !== undefined && (input.birth_hour < 0 || input.birth_hour > 23)) {
    throw new ValidationError('出生小时须在 0 到 23 之间');
  }

  // 分钟（可选）
  if (input.birth_minute !== undefined && (input.birth_minute < 0 || input.birth_minute > 59)) {
    throw new ValidationError('出生分钟须在 0 到 59 之间');
  }

  if (input.birth_timezone && !isValidTimezone(input.birth_timezone)) {
    throw new ValidationError('出生时区格式不正确，请使用 IANA 时区，例如 Asia/Shanghai');
  }

  validateCoordinate(input.birth_latitude, '出生地纬度', -90, 90);
  validateCoordinate(input.birth_longitude, '出生地经度', -180, 180);

  const hasClockTime = input.birth_hour !== undefined || input.birth_minute !== undefined;
  if (hasClockTime && (input.birth_latitude === undefined || input.birth_longitude === undefined)) {
    throw new ValidationError('出生地经纬度不能为空。真太阳时排盘需要前端提交出生地经纬度。');
  }
}

function validateCoordinate(value: number | undefined, label: string, min: number, max: number): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(`${label}必须在 ${min} 到 ${max} 之间`);
  }
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function formatNormalizedBirthTime(time: { year: number; month: number; day: number; hour: number; minute: number }): string {
  return `${time.year}-${pad2(time.month)}-${pad2(time.day)} ${pad2(time.hour)}:${pad2(time.minute)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
