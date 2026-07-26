/**
 * 八字服务层（Service）
 *
 * 职责：
 *   - 创建八字档案（调用计算器、写入数据库）
 *   - 查询档案列表 / 详情
 *   - 更新档案（生日变化时重新排盘）
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
import {
  buildDailyLuckData,
  buildDailyLuckListForMonth,
  calculateFullChart,
  calculateSelfSitting,
  ensureChartLuckMetadata,
  calculateWeightedWuxingFromChart,
} from '../utils/baziCalculator';
import {
  buildMingliGanZhiEffectsBrief,
  buildMingliFactPanel,
  buildNatalMingliInteractions,
  buildTimingMingliInteractions,
  MingliInteraction,
  MingliGanZhiEffectsBrief,
} from '../utils/mingliInteractionEngine';
import { buildBaziBasicInfo } from '../utils/baziBasicInfo';
import { buildMingliAiContext } from '../utils/mingliAiContext';
import { buildPatternCandidates } from '../utils/patternJudgement';
import { buildZipingAiBrief, buildZipingStructureFacts } from '../utils/zipingStructureFacts';
import { parseDailyFortuneProfileContextInput } from '../utils/dailyFortuneUserContext';
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
  const dailyFortuneContext = parseDailyFortuneProfileContextInput(
    input.daily_fortune_context,
  );

  // 2. 本人档案唯一性检查
  if (input.is_owner) {
    const hasOwner = await baziProfileRepository.hasOwnerProfile(userId);
    if (hasOwner) {
      throw new ValidationError('您已经创建过本人档案，无法重复创建');
    }
  }

  // 3. 先按出生地经纬度校准真太阳时，再计算完整命盘
  const inputHasKnownHour = hasKnownBirthHour(input);
  const normalizedBirthTime = normalizeBirthTimeForBazi({
    year: input.birth_year,
    month: input.birth_month,
    day: input.birth_day,
    hour: input.birth_hour ?? 12,
    minute: input.birth_minute ?? 0,
    timezone: input.birth_timezone || 'Asia/Shanghai',
    longitude: inputHasKnownHour ? input.birth_longitude ?? undefined : undefined,
    latitude: inputHasKnownHour ? input.birth_latitude ?? undefined : undefined,
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
  chart.calculationInfo = inputHasKnownHour
    ? { trueSolarTime: normalizedBirthTime }
    : { hourPrecision: 'unknown', internalFallbackHour: 12 };

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
    time_basis: inputHasKnownHour ? normalizedBirthTime.timeBasis : 'standard_time',
    true_solar_time: inputHasKnownHour ? formatNormalizedBirthTime(normalizedBirthTime.corrected) : null,
    true_solar_correction_minutes: inputHasKnownHour ? normalizedBirthTime.correctionMinutes : null,
    calculation_metadata: inputHasKnownHour
      ? { true_solar_time: normalizedBirthTime }
      : { hour_precision: 'unknown', internal_fallback_hour: 12 },
    mbti: input.mbti,
    daily_fortune_context: dailyFortuneContext,
    notes: input.notes,
    // 基础四柱冗余列
    bazi_year_stem: chart.year.stem,
    bazi_year_branch: chart.year.branch,
    bazi_month_stem: chart.month.stem,
    bazi_month_branch: chart.month.branch,
    bazi_day_stem: chart.day.stem,
    bazi_day_branch: chart.day.branch,
    bazi_hour_stem: inputHasKnownHour ? chart.time.stem : null,
    bazi_hour_branch: inputHasKnownHour ? chart.time.branch : null,
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
 * 允许修改展示字段和生辰字段。生辰字段变化时必须重新计算完整命盘，
 * 否则前端资料页和排盘/流年页会读取到互相矛盾的数据。
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
  const existing = await getBaziProfileById(userId, profileId);
  const merged = mergeBaziUpdateInput(existing, input);
  validateBaziInput(merged);
  const dailyFortuneContext = parseDailyFortuneProfileContextInput(
    merged.daily_fortune_context,
  );

  const mergedHasKnownHour = hasKnownBirthHour(merged);
  const normalizedBirthTime = normalizeBirthTimeForBazi({
    year: merged.birth_year,
    month: merged.birth_month,
    day: merged.birth_day,
    hour: merged.birth_hour ?? 12,
    minute: merged.birth_minute ?? 0,
    timezone: merged.birth_timezone || 'Asia/Shanghai',
    longitude: mergedHasKnownHour ? merged.birth_longitude ?? undefined : undefined,
    latitude: mergedHasKnownHour ? merged.birth_latitude ?? undefined : undefined,
  });

  const chart = await calculateFullChart(
    normalizedBirthTime.corrected.year,
    normalizedBirthTime.corrected.month,
    normalizedBirthTime.corrected.day,
    normalizedBirthTime.corrected.hour,
    normalizedBirthTime.corrected.minute,
    merged.is_lunar ?? false,
    merged.gender === 'female' ? 2 : 1,
    1,
  );
  chart.calculationInfo = mergedHasKnownHour
    ? { trueSolarTime: normalizedBirthTime }
    : { hourPrecision: 'unknown', internalFallbackHour: 12 };

  return await baziProfileRepository.update(profileId, {
    is_owner: existing.is_owner,
    name: merged.name,
    relation_to_owner: merged.relation_to_owner,
    gender: merged.gender,
    birth_year: merged.birth_year,
    birth_month: merged.birth_month,
    birth_day: merged.birth_day,
    birth_hour: merged.birth_hour,
    birth_minute: merged.birth_minute,
    is_lunar: merged.is_lunar,
    birth_timezone: merged.birth_timezone,
    birth_country: merged.birth_country,
    birth_region: merged.birth_region,
    birth_latitude: merged.birth_latitude,
    birth_longitude: merged.birth_longitude,
    time_basis: mergedHasKnownHour ? normalizedBirthTime.timeBasis : 'standard_time',
    true_solar_time: mergedHasKnownHour ? formatNormalizedBirthTime(normalizedBirthTime.corrected) : null,
    true_solar_correction_minutes: mergedHasKnownHour ? normalizedBirthTime.correctionMinutes : null,
    calculation_metadata: mergedHasKnownHour
      ? { true_solar_time: normalizedBirthTime }
      : { hour_precision: 'unknown', internal_fallback_hour: 12 },
    mbti: merged.mbti,
    daily_fortune_context: dailyFortuneContext,
    notes: merged.notes,
    bazi_year_stem: chart.year.stem,
    bazi_year_branch: chart.year.branch,
    bazi_month_stem: chart.month.stem,
    bazi_month_branch: chart.month.branch,
    bazi_day_stem: chart.day.stem,
    bazi_day_branch: chart.day.branch,
    bazi_hour_stem: mergedHasKnownHour ? chart.time.stem : null,
    bazi_hour_branch: mergedHasKnownHour ? chart.time.branch : null,
    wuxing_analysis: chart.wuxing,
    full_chart: chart,
    day_master: chart.dayMaster,
    day_master_element: chart.dayMasterElement,
  });
}

function mergeBaziUpdateInput(
  existing: BaziProfile,
  input: UpdateBaziProfileInput,
): CreateBaziProfileInput {
  return {
    is_owner: existing.is_owner,
    name: input.name ?? existing.name,
    relation_to_owner: input.relation_to_owner ?? existing.relation_to_owner,
    gender: input.gender ?? existing.gender,
    birth_year: input.birth_year ?? existing.birth_year,
    birth_month: input.birth_month ?? existing.birth_month,
    birth_day: input.birth_day ?? existing.birth_day,
    birth_hour: hasOwn(input, 'birth_hour') ? input.birth_hour : existing.birth_hour,
    birth_minute: hasOwn(input, 'birth_minute') ? input.birth_minute : existing.birth_minute,
    is_lunar: input.is_lunar ?? existing.is_lunar,
    birth_timezone: input.birth_timezone ?? existing.birth_timezone,
    birth_country: input.birth_country ?? existing.birth_country,
    birth_region: input.birth_region ?? existing.birth_region,
    birth_latitude: input.birth_latitude ?? existing.birth_latitude,
    birth_longitude: input.birth_longitude ?? existing.birth_longitude,
    mbti: input.mbti ?? existing.mbti,
    daily_fortune_context: input.daily_fortune_context === undefined
      ? existing.daily_fortune_context
      : input.daily_fortune_context,
    notes: input.notes ?? existing.notes,
  };
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
    self_sitting: pillar?.selfSitting || pillar?.self_sitting || calculateSelfSitting(pillar?.stem || '', pillar?.branch || ''),
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

function patternCandidatesToContract(patternCandidates: any) {
  if (!patternCandidates) return null;
  const mapPenetration = (item: any) => ({
    position: item.position,
    stem: item.stem,
    ten_god: item.tenGod,
    weight: item.weight,
  });
  const mapRoot = (item: any) => ({
    position: item.position,
    branch: item.branch,
    stem: item.stem,
    qi: item.qi,
    weight: item.weight,
  });
  const mapUsableGod = (item: any) => ({
    id: item.id,
    ten_god: item.tenGod,
    stem: item.stem || '',
    element: item.element || '',
    source: item.source,
    position: item.position || '',
    branches: item.branches || [],
    label: item.label || '',
    confidence: item.confidence,
    evidence: item.evidence || [],
    notes: item.notes || [],
  });
  const mapCandidate = (candidate: any) => ({
    id: candidate.id,
    name: candidate.name,
    family: candidate.family,
    status: candidate.status,
    confidence: candidate.confidence,
    entry: candidate.entry,
    ten_god: candidate.tenGod,
    stem: candidate.stem || '',
    element: candidate.element || '',
    month_branch: candidate.monthBranch || '',
    evidence: candidate.evidence || [],
    penetration: (candidate.penetration || []).map(mapPenetration),
    roots: (candidate.roots || []).map(mapRoot),
    support_signals: candidate.supportSignals || [],
    downgrade_signals: candidate.downgradeSignals || [],
    notes: candidate.notes || [],
  });

  return {
    method_version: patternCandidates.methodVersion || patternCandidates.method_version || 'pattern_candidates_v1',
    regular: (patternCandidates.regular || []).map(mapCandidate),
    mixed_qi: (patternCandidates.mixedQi || patternCandidates.mixed_qi || []).map(mapCandidate),
    auxiliary: (patternCandidates.auxiliary || []).map(mapCandidate),
    usable_gods: (patternCandidates.usableGods || patternCandidates.usable_gods || []).map(mapUsableGod),
    notes: patternCandidates.notes || [],
  };
}

function zipingAiBriefToContract(zipingAiBrief: any, ganZhiEffects?: MingliGanZhiEffectsBrief | null) {
  if (!zipingAiBrief) return null;
  return {
    method_version: zipingAiBrief.method_version || zipingAiBrief.methodVersion || 'ziping_ai_brief_v1',
    month_command: zipingAiBrief.month_command || '',
    day_master_capacity: zipingAiBrief.day_master_capacity || '',
    pattern_candidates: zipingAiBrief.pattern_candidates || [],
    gan_zhi_effects: ganZhiEffects || zipingAiBrief.gan_zhi_effects || { heavenly_stems: [], earthly_branches: [] },
    yongshen_arbitration_facts: zipingAiBrief.yongshen_arbitration_facts || '',
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
  const chart = profile.full_chart || {
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
  return ensureChartLuckMetadata(chart, profile.day_master);
}

/**
 * Unknown-hour profiles are still calculated internally with a noon fallback
 * so the legacy chart and luck calculator can operate. Daily-fortune relation
 * facts must never treat that implementation detail as a real natal pillar.
 */
export function projectChartToActualNatalPillars(chart: any, includeHour: boolean): any {
  if (includeHour) return chart;
  const { time: _internalFallbackTime, hour: _internalFallbackHour, ...actualChart } = chart || {};
  return actualChart;
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
    hidden_stems: (cycle.hiddenStems || []).map((item: any) => ({
      stem: item.stem,
      ten_god: item.tenGod,
      element: item.element,
    })),
    lifecycle: cycle.lifecycle || '',
    self_sitting: cycle.selfSitting || '',
    na_yin: cycle.naYin || '',
    xun: cycle.xun || '',
    xun_kong: cycle.xunKong || '',
    label: cycle.ganZhi === '童限' ? '童限' : null,
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
    hidden_stems: (item.hiddenStems || []).map((hidden: any) => ({
      stem: hidden.stem,
      ten_god: hidden.tenGod,
      element: hidden.element,
    })),
    lifecycle: item.lifecycle || '',
    self_sitting: item.selfSitting || '',
    na_yin: item.naYin || '',
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
    hidden_stems: (item.hiddenStems || []).map((hidden: any) => ({
      stem: hidden.stem,
      ten_god: hidden.tenGod,
      element: hidden.element,
    })),
    lifecycle: item.lifecycle || '',
    self_sitting: item.selfSitting || '',
    na_yin: item.naYin || '',
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
    hidden_stems: (item.hiddenStems || []).map((hidden: any) => ({
      stem: hidden.stem,
      ten_god: hidden.tenGod,
      element: hidden.element,
    })),
    lifecycle: item.lifecycle || '',
    self_sitting: item.selfSitting || '',
    na_yin: item.naYin || '',
    xun: item.xun,
    xun_kong: item.xunKong,
  };
}

export async function getBaziChart(userId: string, profileId: string) {
  const profile = await getBaziProfileById(userId, profileId);
  return buildBaziChartFromProfile(profile);
}

function buildBaziChartFromProfile(profile: BaziProfile) {
  const chart = getChart(profile);
  const profileHasKnownHour = hasKnownBirthHour(profile);
  const interactionChart = projectChartToActualNatalPillars(chart, profileHasKnownHour);
  const weightedWuxing = chart.weightedWuxing || chart.weighted_wuxing_analysis || calculateWeightedWuxingFromChart(chart);
  const patternCandidates = chart.patternCandidates || chart.pattern_candidates || buildPatternCandidates({
    dayMaster: chart.dayMaster || profile.day_master || '',
    year: chart.year,
    month: chart.month,
    day: chart.day,
    time: chart.time,
    weightedWuxing,
  });
  const existingZipingBrief = chart.zipingAiBrief
    || chart.ziping_ai_brief
    || (chart.ziping_structure?.method_version === 'ziping_ai_brief_v1' ? chart.ziping_structure : null);
  const zipingStructureFacts = chart.zipingStructureFacts
    || (chart.ziping_structure?.method_version === 'ziping_structure_v2_fact_layer' ? chart.ziping_structure : null)
    || buildZipingStructureFacts({
      dayMaster: chart.dayMaster || profile.day_master || '',
      dayMasterElement: chart.dayMasterElement || profile.day_master_element || '',
      year: chart.year,
      month: chart.month,
      day: chart.day,
      time: chart.time,
      patternCandidates,
    });
  const zipingAiBrief = existingZipingBrief || buildZipingAiBrief(zipingStructureFacts);
  const baziBasicInfo = buildBaziBasicInfo({ profile, chart });
  const natalInteractions = buildNatalMingliInteractions(interactionChart);
  const natalGanZhiEffects = buildMingliGanZhiEffectsBrief(natalInteractions);
  const zipingStructure = zipingAiBriefToContract(zipingAiBrief, natalGanZhiEffects);
  const mingliAiContext = buildMingliAiContext({
    baziBasicInfo,
    zipingStructure: profileHasKnownHour ? zipingStructure : null,
  });
  const pillars = [
    toSnakePillar('year', chart.year),
    toSnakePillar('month', chart.month),
    toSnakePillar('day', chart.day),
    ...(profileHasKnownHour ? [toSnakePillar('hour', chart.time)] : []),
  ];

  return {
    profile_id: profile.id,
    mingli_ai_context: mingliAiContext,
    bazi_basic_info: baziBasicInfo,
    day_master: chart.dayMaster || profile.day_master || '',
    day_master_element: chart.dayMasterElement || profile.day_master_element || '',
    hour_precision: profileHasKnownHour ? 'known' : 'unknown',
    pillars,
    wuxing_analysis: wuxingToContract(chart.wuxing || profile.wuxing_analysis),
    weighted_wuxing_analysis: weightedWuxingToContract(weightedWuxing),
    pattern_candidates: profileHasKnownHour ? patternCandidatesToContract(patternCandidates) : null,
    ziping_structure: profileHasKnownHour ? zipingStructure : null,
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
      true_solar_correction_minutes: profileHasKnownHour ? profile.true_solar_correction_minutes ?? chart.calculationInfo?.trueSolarTime?.correctionMinutes ?? null : null,
      birth_longitude: profile.birth_longitude ?? (profileHasKnownHour ? chart.calculationInfo?.trueSolarTime?.longitude ?? null : null),
      birth_latitude: profile.birth_latitude ?? (profileHasKnownHour ? chart.calculationInfo?.trueSolarTime?.latitude ?? null : null),
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
  return buildBaziLuckTimelineFromProfile(profile, query);
}

function buildBaziLuckTimelineFromProfile(
  profile: BaziProfile,
  query: { year?: number; month?: number; day?: string },
) {
  const chart = getChart(profile);
  const interactionChart = projectChartToActualNatalPillars(chart, hasKnownBirthHour(profile));
  const requestedDay = query.day || formatDateForLuck(new Date());
  const year = query.year || Number(requestedDay.slice(0, 4));
  const majorCycles = (chart.majorCycles || []) as any[];
  const activeCycle = majorCycles.find((cycle) => year >= cycle.startYear && year <= cycle.endYear)
    || majorCycles[0];
  const annualLucks = (activeCycle?.annualLuck || []).map(mapAnnualLuck);
  const selectedAnnual = (activeCycle?.annualLuck || []).find((item: any) => item.year === year)
    || activeCycle?.annualLuck?.[0];
  const selectedMonth = selectMonthlyLuck(selectedAnnual?.monthlyLuck || [], query.month, requestedDay);
  const selectedDay = resolveSelectedDay(query.day, requestedDay, selectedMonth);
  const selectedDaily = buildDailyLuckData(chart.dayMaster || profile.day_master || '', selectedDay);
  const dailyLucks = buildDailyLuckListForMonth(chart.dayMaster || profile.day_master || '', selectedMonth, selectedDay);
  const timingInteractions = buildTimingMingliInteractions(interactionChart, {
    dayun: activeCycle,
    liunian: selectedAnnual,
    liuyue: selectedMonth,
    liuri: selectedDaily,
  });
  const natalInteractions = buildNatalMingliInteractions(interactionChart);

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
    daily_lucks: dailyLucks.map(mapDailyLuck),
    fact_panel: mingliFactPanelToContract(buildMingliFactPanel([...timingInteractions, ...natalInteractions])),
    timing_interactions: timingInteractions.map(mingliInteractionToContract),
  };
}

/**
 * 为首页 V2 日运构建同一档案快照下的原局与流运事实。
 *
 * 公开 chart/luck 接口各自读取档案，不能直接串成一次 AI 输入；
 * 这个边界只读一次 owned profile，并把有效日期显式传给流运构建器。
 */
export async function getBaziDailyFortuneEngineBundle(
  userId: string,
  profileId: string,
  effectiveDate: string,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new ValidationError('effectiveDate 必须是 YYYY-MM-DD 格式');
  }

  const profile = await baziProfileRepository.findOwnedById(userId, profileId);
  if (!profile) {
    throw new NotFoundError('八字档案不存在');
  }

  return {
    profile,
    chart: buildBaziChartFromProfile(profile),
    timeline: buildBaziLuckTimelineFromProfile(profile, { day: effectiveDate }),
  };
}

export async function getBaziLuckDisplayBundle(userId: string, profileId: string) {
  const profile = await getBaziProfileById(userId, profileId);
  const chart = getChart(profile);
  const dayMaster = chart.dayMaster || profile.day_master || '';
  const majorCycles = (chart.majorCycles || []) as any[];

  return {
    profile_id: profile.id,
    profile_updated_at: profile.updated_at || null,
    cache_version: 'bazi_luck_display_bundle_v1',
    generated_at: new Date().toISOString(),
    chart: await getBaziChart(userId, profileId),
    major_cycles: majorCycles.map((cycle, index) => {
      const annualLuck = (cycle.annualLuck || []) as any[];
      const timingInteractions = buildTimingMingliInteractions(chart, {
        dayun: cycle,
      });

      return {
        cycle: mapMajorCycle(cycle, index),
        timing_interactions: timingInteractions.map(mingliInteractionToContract),
        annual_lucks: annualLuck.map((annual: any) => {
          const monthlyLuck = (annual.monthlyLuck || []) as any[];
          const annualInteractions = buildTimingMingliInteractions(chart, {
            dayun: cycle,
            liunian: annual,
          });

          return {
            annual: mapAnnualLuck(annual),
            timing_interactions: annualInteractions.map(mingliInteractionToContract),
            monthly_lucks: monthlyLuck.map((monthly: any) => {
              const monthlyInteractions = buildTimingMingliInteractions(chart, {
                dayun: cycle,
                liunian: annual,
                liuyue: monthly,
              });
              const dailyLucks = buildDailyLuckListForMonth(dayMaster, monthly, monthly.startDate);

              return {
                monthly: mapMonthlyLuck(monthly),
                timing_interactions: monthlyInteractions.map(mingliInteractionToContract),
                daily_lucks: dailyLucks.map(mapDailyLuck),
              };
            }),
          };
        }),
      };
    }),
  };
}

function resolveSelectedDay(queryDay: string | undefined, requestedDay: string, selectedMonth: any): string {
  if (queryDay) return queryDay;
  if (isDayInMonthlyLuck(requestedDay, selectedMonth)) return requestedDay;
  return selectedMonth?.startDate || requestedDay;
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

function isDayInMonthlyLuck(day: string, selectedMonth: any): boolean {
  if (!selectedMonth?.startDate || !selectedMonth?.endDate) return true;
  return day >= selectedMonth.startDate && day < selectedMonth.endDate;
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
  if (input.birth_hour !== undefined && input.birth_hour !== null && (input.birth_hour < 0 || input.birth_hour > 23)) {
    throw new ValidationError('出生小时须在 0 到 23 之间');
  }

  // 分钟（可选）
  if (input.birth_minute !== undefined && input.birth_minute !== null && (input.birth_minute < 0 || input.birth_minute > 59)) {
    throw new ValidationError('出生分钟须在 0 到 59 之间');
  }

  if (input.birth_timezone && !isValidTimezone(input.birth_timezone)) {
    throw new ValidationError('出生时区格式不正确，请使用 IANA 时区，例如 Asia/Shanghai');
  }

  validateCoordinate(input.birth_latitude, '出生地纬度', -90, 90);
  validateCoordinate(input.birth_longitude, '出生地经度', -180, 180);

  const hasClockTime = hasKnownBirthHour(input) || (input.birth_minute !== undefined && input.birth_minute !== null);
  if (hasClockTime && (input.birth_latitude === undefined || input.birth_latitude === null || input.birth_longitude === undefined || input.birth_longitude === null)) {
    throw new ValidationError('出生地经纬度不能为空。真太阳时排盘需要前端提交出生地经纬度。');
  }
}

function validateCoordinate(value: number | undefined | null, label: string, min: number, max: number): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(`${label}必须在 ${min} 到 ${max} 之间`);
  }
}

function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasKnownBirthHour(input: { birth_hour?: number | null }): input is { birth_hour: number } {
  return input.birth_hour !== undefined && input.birth_hour !== null;
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
