import type { BaziProfile } from '../models/BaziProfile';
import type {
  DailyFortuneFactPackage,
  DailyFortuneMingliInteraction,
  DailyFortunePillar,
  DailyFortuneTimingPillar,
} from '../models/DailyFortune';
import type {
  RecommendationCardValidity,
  RecommendationHardFactInteraction,
  RecommendationHardFactPillar,
  RecommendationHardFactTimingPillar,
  RecommendationTimeWindow,
  RecommendationTimeWindowBucket,
  RecommendationTimeWindowDetailLevel,
  RecommendationTimeWindowHistoryItem,
  RecommendationTimeWindowKind,
} from '../models/Recommendation';
import {
  RECOMMENDATION_EVIDENCE_WINDOW_LIMIT as EVIDENCE_WINDOW_LIMIT,
  RECOMMENDATION_TIME_WINDOWS_BYTE_LIMIT as TIME_WINDOWS_BYTE_LIMIT,
} from '../models/Recommendation';
import type {
  AnnualLuckData,
  FullChartResult,
  MajorCycleData,
  MonthlyLuckData,
} from '../utils/baziCalculator';
import {
  buildTimingMingliInteractions,
  MINGLI_INTERACTION_RULE_VERSION,
  type MingliInteraction,
} from '../utils/mingliInteractionEngine';

const TARGET_RECENT_LIUYUE_COUNT = 12;
const PROTECTED_RECENT_LIUYUE_COUNT = 6;
const FAR_LIUNIAN_HORIZON_YEARS = 3;

interface RawMonthWindow {
  cycle: MajorCycleData;
  annual: AnnualLuckData;
  monthly: MonthlyLuckData;
  targetWindow: RecommendationCardValidity;
}

type RawFarWindow = {
  kind: 'liunian';
  cycle: MajorCycleData;
  annual: AnnualLuckData;
  windowKey: string;
  targetWindow: RecommendationCardValidity;
} | {
  kind: 'dayun';
  cycle: MajorCycleData;
  windowKey: string;
  targetWindow: RecommendationCardValidity;
};

interface WindowInput {
  windowKey: string;
  kind: RecommendationTimeWindowKind;
  bucket: RecommendationTimeWindowBucket;
  detailLevel: RecommendationTimeWindowDetailLevel;
  parentWindowKeys: string[];
  targetWindow: RecommendationCardValidity;
  timing: RecommendationHardFactTimingPillar;
  interactions: RecommendationHardFactInteraction[];
  effectiveDate: string;
}

/**
 * Selects a bounded recommendation view over the existing full luck timeline.
 * It calls the canonical interaction engine but contains no astrology rules of
 * its own and never generates the complete daily-luck tree.
 */
export function buildRecommendationTimeWindows(input: {
  profile: BaziProfile;
  currentFacts: DailyFortuneFactPackage;
  timeWindowHistory?: RecommendationTimeWindowHistoryItem[];
}): RecommendationTimeWindow[] {
  const effectiveDate = input.currentFacts.effective_date;
  const rawChart = input.profile.full_chart as Partial<FullChartResult> | undefined;
  const cycles = Array.isArray(rawChart?.majorCycles)
    ? rawChart.majorCycles
    : [];
  const actualChart = rawChart
    ? projectToActualNatalChart(
      rawChart,
      input.profile.birth_hour !== null && input.profile.birth_hour !== undefined,
    )
    : null;

  const allMonths: RawMonthWindow[] = [];

  for (const cycle of cycles) {
    for (const annual of cycle.annualLuck || []) {
      for (const monthly of annual.monthlyLuck || []) {
        const targetWindow = monthlyValidity(monthly);
        if (!targetWindow) continue;
        allMonths.push({ cycle, annual, monthly, targetWindow });
      }
    }
  }

  allMonths.sort((left, right) => (
    left.targetWindow.valid_from.localeCompare(right.targetWindow.valid_from)
    || left.monthly.ganZhi.localeCompare(right.monthly.ganZhi)
  ));
  const currentAndFutureMonths = allMonths.filter((item) => (
    item.targetWindow.valid_until === null
    || item.targetWindow.valid_until >= effectiveDate
  ));
  let recentMonths = currentAndFutureMonths.slice(0, TARGET_RECENT_LIUYUE_COUNT);
  let farWindow = selectFarWindow({
    cycles,
    recentMonths,
    effectiveDate,
    history: input.timeWindowHistory || [],
  });

  while (true) {
    const windows = assembleTimeWindows({
      cycles,
      recentMonths,
      farWindow,
      actualChart,
      currentFacts: input.currentFacts,
    });
    const evidenceCount = windows.filter((window) => window.detail_level === 'evidence').length;
    const byteLength = Buffer.byteLength(JSON.stringify(windows), 'utf8');
    if (
      evidenceCount <= EVIDENCE_WINDOW_LIMIT
      && byteLength <= TIME_WINDOWS_BYTE_LIMIT
    ) {
      return windows;
    }

    // Preserve complete relationships inside a selected window. Budget
    // pressure removes whole, least-urgent windows rather than truncating
    // deterministic evidence into a misleading partial fact set.
    if (farWindow) {
      farWindow = null;
      continue;
    }
    if (recentMonths.length > PROTECTED_RECENT_LIUYUE_COUNT) {
      recentMonths = recentMonths.slice(0, -1);
      continue;
    }
    throw new RecommendationTimeWindowBudgetError(evidenceCount, byteLength);
  }
}

export class RecommendationTimeWindowBudgetError extends Error {
  constructor(
    public readonly evidenceWindowCount: number,
    public readonly byteLength: number,
  ) {
    super('Recommendation time-window evidence exceeds the protected budget');
    this.name = 'RecommendationTimeWindowBudgetError';
  }
}

function assembleTimeWindows(input: {
  cycles: MajorCycleData[];
  recentMonths: RawMonthWindow[];
  farWindow: RawFarWindow | null;
  actualChart: Partial<FullChartResult> | null;
  currentFacts: DailyFortuneFactPackage;
}): RecommendationTimeWindow[] {
  const effectiveDate = input.currentFacts.effective_date;
  const windows = input.cycles.map((cycle) => buildWindow({
    windowKey: dayunWindowKey(cycle),
    kind: 'dayun',
    bucket: 'dayun_index',
    detailLevel: 'index',
    parentWindowKeys: [],
    targetWindow: cycleValidity(cycle),
    timing: compactTimingFromCycle(cycle),
    interactions: [],
    effectiveDate,
  }));

  const parentCycles = uniqueBy(
    input.recentMonths.map((item) => item.cycle),
    dayunWindowKey,
  );
  const parentAnnuals = uniqueBy(
    input.recentMonths.map((item) => ({ cycle: item.cycle, annual: item.annual })),
    (item) => liunianWindowKey(item.annual),
  );

  for (const cycle of parentCycles) {
    upsertWindow(windows, buildDayunEvidenceWindow(
      cycle,
      'current_or_parent_dayun',
      input.actualChart,
      effectiveDate,
    ));
  }
  for (const item of parentAnnuals) {
    upsertWindow(windows, buildLiunianEvidenceWindow(
      item.cycle,
      item.annual,
      'parent_liunian',
      input.actualChart,
      effectiveDate,
    ));
  }
  for (const item of input.recentMonths) {
    windows.push(buildRawMonthWindow(
      item,
      'recent_12_liuyue',
      input.actualChart,
      effectiveDate,
    ));
  }

  if (input.farWindow?.kind === 'liunian') {
    upsertWindow(windows, buildLiunianEvidenceWindow(
      input.farWindow.cycle,
      input.farWindow.annual,
      'future_exploration',
      input.actualChart,
      effectiveDate,
    ));
  } else if (input.farWindow?.kind === 'dayun') {
    upsertWindow(windows, buildDayunEvidenceWindow(
      input.farWindow.cycle,
      'future_exploration',
      input.actualChart,
      effectiveDate,
    ));
  }

  upsertCurrentTimingWindows(windows, input.currentFacts);
  return windows.sort(compareTimeWindows);
}

function selectFarWindow(input: {
  cycles: MajorCycleData[];
  recentMonths: RawMonthWindow[];
  effectiveDate: string;
  history: RecommendationTimeWindowHistoryItem[];
}): RawFarWindow | null {
  const currentYear = Number(input.effectiveDate.slice(0, 4));
  const recentAnnualKeys = new Set(input.recentMonths.map((item) => liunianWindowKey(item.annual)));
  const recentCycleKeys = new Set(input.recentMonths.map((item) => dayunWindowKey(item.cycle)));
  const lastRecentMonth = input.recentMonths[input.recentMonths.length - 1];
  const lastRecentEnd = lastRecentMonth?.targetWindow.valid_until
    || lastRecentMonth?.targetWindow.valid_from
    || input.effectiveDate;
  const candidates: RawFarWindow[] = [];

  for (const cycle of input.cycles) {
    for (const annual of cycle.annualLuck || []) {
      const targetWindow = annualValidity(annual);
      const windowKey = liunianWindowKey(annual);
      if (
        recentAnnualKeys.has(windowKey)
        || targetWindow.valid_until === null
        || targetWindow.valid_until <= lastRecentEnd
        || annual.year > currentYear + FAR_LIUNIAN_HORIZON_YEARS
      ) continue;
      candidates.push({ kind: 'liunian', cycle, annual, windowKey, targetWindow });
    }

    const targetWindow = cycleValidity(cycle);
    const windowKey = dayunWindowKey(cycle);
    if (
      !recentCycleKeys.has(windowKey)
      && cycle.endYear > currentYear + FAR_LIUNIAN_HORIZON_YEARS
      && targetWindow.valid_until !== null
      && targetWindow.valid_until > lastRecentEnd
    ) {
      candidates.push({ kind: 'dayun', cycle, windowKey, targetWindow });
    }
  }

  const historyByKey = new Map(input.history.map((item) => [item.window_key, item]));
  return candidates.sort((left, right) => {
    const leftHistory = historyByKey.get(left.windowKey);
    const rightHistory = historyByKey.get(right.windowKey);
    const exposureDifference = (leftHistory?.primary_exposures || 0)
      - (rightHistory?.primary_exposures || 0);
    if (exposureDifference !== 0) return exposureDifference;
    const lastExposureDifference = compareNullableTimestamps(
      leftHistory?.last_primary_exposed_at || null,
      rightHistory?.last_primary_exposed_at || null,
    );
    if (lastExposureDifference !== 0) return lastExposureDifference;
    const kindDifference = (left.kind === 'liunian' ? 0 : 1)
      - (right.kind === 'liunian' ? 0 : 1);
    return kindDifference
      || left.targetWindow.valid_from.localeCompare(right.targetWindow.valid_from)
      || left.windowKey.localeCompare(right.windowKey);
  })[0] || null;
}

function buildDayunEvidenceWindow(
  cycle: MajorCycleData,
  bucket: Extract<RecommendationTimeWindowBucket, 'current_or_parent_dayun' | 'future_exploration'>,
  actualChart: Partial<FullChartResult> | null,
  effectiveDate: string,
): RecommendationTimeWindow {
  return buildWindow({
    windowKey: dayunWindowKey(cycle),
    kind: 'dayun',
    bucket,
    detailLevel: 'evidence',
    parentWindowKeys: [],
    targetWindow: cycleValidity(cycle),
    timing: timingFromCycle(cycle),
    interactions: actualChart
      ? projectRawInteractionsForHorizon(
        buildTimingMingliInteractions(actualChart, { dayun: cycle }),
        'ten_years',
      )
      : [],
    effectiveDate,
  });
}

function buildLiunianEvidenceWindow(
  cycle: MajorCycleData,
  annual: AnnualLuckData,
  bucket: Extract<RecommendationTimeWindowBucket, 'parent_liunian' | 'future_exploration'>,
  actualChart: Partial<FullChartResult> | null,
  effectiveDate: string,
): RecommendationTimeWindow {
  return buildWindow({
    windowKey: liunianWindowKey(annual),
    kind: 'liunian',
    bucket,
    detailLevel: 'evidence',
    parentWindowKeys: [dayunWindowKey(cycle)],
    targetWindow: annualValidity(annual),
    timing: timingFromAnnual(annual),
    interactions: actualChart
      ? projectRawInteractionsForHorizon(
        buildTimingMingliInteractions(actualChart, { dayun: cycle, liunian: annual }),
        'year',
      )
      : [],
    effectiveDate,
  });
}

export function projectRecommendationPillar(
  pillar: DailyFortunePillar,
): RecommendationHardFactPillar {
  const {
    stem_element: _stemElement,
    branch_element: _branchElement,
    hidden_stems: hiddenStems,
    ...rest
  } = pillar;
  return {
    ...rest,
    hidden_stems: hiddenStems.map(({ stem, ten_god }) => ({ stem, ten_god })),
  };
}

export function projectRecommendationTimingPillar(
  timing: DailyFortuneTimingPillar,
): RecommendationHardFactTimingPillar {
  const {
    stem_element: _stemElement,
    branch_element: _branchElement,
    hidden_stems: hiddenStems,
    ...rest
  } = timing;
  return {
    ...rest,
    hidden_stems: hiddenStems.map(({ stem, ten_god }) => ({ stem, ten_god })),
  };
}

export function projectRecommendationInteraction(
  interaction: DailyFortuneMingliInteraction,
): RecommendationHardFactInteraction {
  return {
    id: interaction.id,
    scope: interaction.scope,
    relation: interaction.relation,
    members: interaction.participants.map(({ label: _label, ...member }) => member),
    center_branch: interaction.center_branch,
    time_horizon: interaction.time_horizon,
    adjacent: interaction.adjacent,
    full_match: interaction.full_match,
    missing_branch: interaction.missing_branch,
    seen_stem: interaction.seen_stem,
  };
}

function buildRawMonthWindow(
  item: RawMonthWindow,
  bucket: Extract<RecommendationTimeWindowBucket, 'recent_12_liuyue'>,
  actualChart: Partial<FullChartResult> | null,
  effectiveDate: string,
): RecommendationTimeWindow {
  return buildWindow({
    windowKey: monthWindowKey(item),
    kind: 'liuyue',
    bucket,
    detailLevel: 'evidence',
    parentWindowKeys: [dayunWindowKey(item.cycle), liunianWindowKey(item.annual)],
    targetWindow: item.targetWindow,
    timing: timingFromMonth(item.monthly),
    interactions: actualChart
      ? projectRawInteractionsForHorizon(
        buildTimingMingliInteractions(actualChart, {
          dayun: item.cycle,
          liunian: item.annual,
          liuyue: item.monthly,
        }),
        'month',
      )
      : [],
    effectiveDate,
  });
}

function upsertCurrentTimingWindows(
  windows: RecommendationTimeWindow[],
  facts: DailyFortuneFactPackage,
): void {
  const effectiveDate = facts.effective_date;
  const currentInteractions = facts.mingli_interactions.timing;
  const dayun = facts.timing.dayun;
  const dayunKey = dayunWindowKeyFromTiming(dayun);
  upsertCurrentWindow(windows, buildWindow({
    windowKey: dayunKey,
    kind: 'dayun',
    bucket: 'current_or_parent_dayun',
    detailLevel: 'evidence',
    parentWindowKeys: [],
    targetWindow: timingValidity(dayun, 'dayun', effectiveDate),
    timing: projectRecommendationTimingPillar(dayun),
    interactions: projectCurrentInteractions(currentInteractions, 'ten_years'),
    effectiveDate,
  }));

  const liunian = facts.timing.liunian;
  const liunianKey = liunianWindowKeyFromTiming(liunian);
  upsertCurrentWindow(windows, buildWindow({
    windowKey: liunianKey,
    kind: 'liunian',
    bucket: 'parent_liunian',
    detailLevel: 'evidence',
    parentWindowKeys: [dayunKey],
    targetWindow: timingValidity(liunian, 'liunian', effectiveDate),
    timing: projectRecommendationTimingPillar(liunian),
    interactions: projectCurrentInteractions(currentInteractions, 'year'),
    effectiveDate,
  }));

  const liuyue = facts.timing.liuyue;
  const liuyueKey = liuyueWindowKeyFromTiming(liuyue, effectiveDate);
  upsertCurrentWindow(windows, buildWindow({
    windowKey: liuyueKey,
    kind: 'liuyue',
    bucket: 'recent_12_liuyue',
    detailLevel: 'evidence',
    parentWindowKeys: [dayunKey, liunianKey],
    targetWindow: timingValidity(liuyue, 'liuyue', effectiveDate),
    timing: projectRecommendationTimingPillar(liuyue),
    interactions: projectCurrentInteractions(currentInteractions, 'month'),
    effectiveDate,
  }));

}

function upsertWindow(
  windows: RecommendationTimeWindow[],
  replacement: RecommendationTimeWindow,
): void {
  const index = windows.findIndex((window) => window.window_key === replacement.window_key);
  if (index >= 0) {
    windows[index] = replacement;
  } else {
    windows.push(replacement);
  }
}

function upsertCurrentWindow(
  windows: RecommendationTimeWindow[],
  current: RecommendationTimeWindow,
): void {
  const exactIndex = windows.findIndex((window) => window.window_key === current.window_key);
  if (exactIndex >= 0) {
    windows[exactIndex] = current;
    return;
  }
  const activeIndex = windows.findIndex((window) => (
    window.kind === current.kind
    && window.target_window.valid_from <= current.target_window.valid_from
    && (window.target_window.valid_until === null
      || window.target_window.valid_until >= current.target_window.valid_from)
  ));
  if (activeIndex >= 0) {
    windows[activeIndex] = {
      ...current,
      window_key: windows[activeIndex].window_key,
      parent_window_keys: current.parent_window_keys,
    };
    return;
  }
  windows.push(current);
}

function buildWindow(input: WindowInput): RecommendationTimeWindow {
  return {
    window_key: input.windowKey,
    kind: input.kind,
    bucket: input.bucket,
    detail_level: input.detailLevel,
    parent_window_keys: input.parentWindowKeys,
    is_current: containsDate(input.targetWindow, input.effectiveDate),
    target_window: input.targetWindow,
    timing: input.timing,
    interaction_rule_version: MINGLI_INTERACTION_RULE_VERSION,
    interactions: input.interactions,
  };
}

function projectCurrentInteractions(
  interactions: DailyFortuneMingliInteraction[],
  horizon: string,
): RecommendationHardFactInteraction[] {
  return interactions
    .filter((interaction) => interaction.time_horizon === horizon)
    .map(projectRecommendationInteraction);
}

function projectRawInteractionsForHorizon(
  interactions: MingliInteraction[],
  horizon: MingliInteraction['timeHorizon'],
): RecommendationHardFactInteraction[] {
  return interactions
    .filter((interaction) => interaction.timeHorizon === horizon)
    .map((interaction) => ({
      id: interaction.id,
      scope: interaction.scope,
      relation: interaction.relation,
      members: interaction.participants.map((member) => ({
        type: member.type,
        pillar: member.pillar || null,
        stem: member.stem || '',
        branch: member.branch || '',
        gan_zhi: member.ganZhi || `${member.stem || ''}${member.branch || ''}`,
        ten_gods: member.tenGods || [],
      })),
      center_branch: interaction.centerBranch || null,
      time_horizon: interaction.timeHorizon,
      adjacent: interaction.adjacent,
      full_match: interaction.fullMatch,
      missing_branch: interaction.missingBranch || null,
      seen_stem: interaction.seenStem || null,
    }));
}

function timingFromCycle(cycle: MajorCycleData): RecommendationHardFactTimingPillar {
  return {
    gan_zhi: cycle.ganZhi,
    stem: cycle.stem,
    branch: cycle.branch,
    ten_god: cycle.tenGod,
    hidden_stems: projectRawHiddenStems(cycle.hiddenStems),
    lifecycle: cycle.lifecycle,
    self_sitting: cycle.selfSitting,
    na_yin: cycle.naYin,
    start_year: cycle.startYear,
    end_year: cycle.endYear,
  };
}

function compactTimingFromCycle(cycle: MajorCycleData): RecommendationHardFactTimingPillar {
  return {
    gan_zhi: cycle.ganZhi,
    stem: cycle.stem,
    branch: cycle.branch,
    hidden_stems: [],
    start_year: cycle.startYear,
    end_year: cycle.endYear,
  };
}

function timingFromAnnual(annual: AnnualLuckData): RecommendationHardFactTimingPillar {
  return {
    gan_zhi: annual.ganZhi,
    stem: annual.stem,
    branch: annual.branch,
    ten_god_top: annual.tenGodTop,
    ten_god_bottom: annual.tenGodBottom,
    hidden_stems: projectRawHiddenStems(annual.hiddenStems),
    lifecycle: annual.lifecycle,
    self_sitting: annual.selfSitting,
    na_yin: annual.naYin,
    year: annual.year,
  };
}

function timingFromMonth(monthly: MonthlyLuckData): RecommendationHardFactTimingPillar {
  return {
    gan_zhi: monthly.ganZhi,
    stem: monthly.stem,
    branch: monthly.branch,
    ten_god: monthly.tenGod,
    ten_god_bottom: monthly.tenGodBottom,
    hidden_stems: projectRawHiddenStems(monthly.hiddenStems),
    lifecycle: monthly.lifecycle,
    self_sitting: monthly.selfSitting,
    na_yin: monthly.naYin,
    month: monthly.month,
    start_date: monthly.startDate || null,
    end_date: monthly.endDate || null,
    solar_term: monthly.solarTerm || null,
  };
}

function projectRawHiddenStems(
  hiddenStems: Array<{ stem: string; tenGod: string }> | undefined,
) {
  return (hiddenStems || []).map((hidden) => ({
    stem: hidden.stem,
    ten_god: hidden.tenGod,
  }));
}

function cycleValidity(cycle: MajorCycleData): RecommendationCardValidity {
  if (
    isDate(cycle.startDate)
    && isDate(cycle.endDate)
    && cycle.endDate > cycle.startDate
  ) {
    return {
      valid_from: cycle.startDate,
      valid_until: previousCalendarDate(cycle.endDate),
    };
  }
  return {
    valid_from: `${cycle.startYear}-01-01`,
    valid_until: `${cycle.endYear}-12-31`,
  };
}

function annualValidity(annual: AnnualLuckData): RecommendationCardValidity {
  if (
    isDate(annual.startDate)
    && isDate(annual.endDate)
    && annual.endDate > annual.startDate
  ) {
    return {
      valid_from: annual.startDate,
      valid_until: previousCalendarDate(annual.endDate),
    };
  }
  return {
    valid_from: `${annual.year}-01-01`,
    valid_until: `${annual.year}-12-31`,
  };
}

function monthlyValidity(monthly: MonthlyLuckData): RecommendationCardValidity | null {
  if (!isDate(monthly.startDate)) return null;
  const endBoundary = isDate(monthly.endDate) ? monthly.endDate : null;
  if (endBoundary !== null && endBoundary <= monthly.startDate) return null;
  return {
    valid_from: monthly.startDate,
    valid_until: endBoundary ? previousCalendarDate(endBoundary) : null,
  };
}

function timingValidity(
  timing: DailyFortuneTimingPillar,
  kind: RecommendationTimeWindowKind,
  effectiveDate: string,
): RecommendationCardValidity {
  if (kind === 'dayun') {
    const exactStart = isDate(timing.start_date) ? timing.start_date : null;
    const exactEnd = isDate(timing.end_date) ? timing.end_date : null;
    const hasExactRange = exactStart !== null
      && exactEnd !== null
      && exactEnd > exactStart;
    return {
      valid_from: hasExactRange
        ? exactStart as string
        : yearStart(timing.start_year) || effectiveDate,
      valid_until: hasExactRange
        ? previousCalendarDate(exactEnd as string)
        : yearEnd(timing.end_year),
    };
  }
  if (kind === 'liunian') {
    const exactStart = isDate(timing.start_date) ? timing.start_date : null;
    const exactEnd = isDate(timing.end_date) ? timing.end_date : null;
    const hasExactRange = exactStart !== null
      && exactEnd !== null
      && exactEnd > exactStart;
    return {
      valid_from: hasExactRange
        ? exactStart as string
        : yearStart(timing.year) || effectiveDate,
      valid_until: hasExactRange
        ? previousCalendarDate(exactEnd as string)
        : yearEnd(timing.year),
    };
  }
  if (kind === 'liuyue') {
    const endBoundary = isDate(timing.end_date) ? timing.end_date : null;
    return {
      valid_from: isDate(timing.start_date) ? timing.start_date : effectiveDate,
      valid_until: endBoundary ? previousCalendarDate(endBoundary) : null,
    };
  }
  throw new Error(`Unsupported recommendation time window kind: ${kind}`);
}

function dayunWindowKey(cycle: MajorCycleData): string {
  return `dayun:${cycle.startYear}:${cycle.ganZhi}`;
}

function dayunWindowKeyFromTiming(timing: DailyFortuneTimingPillar): string {
  return `dayun:${timing.start_year || 'unknown'}:${timing.gan_zhi}`;
}

function liunianWindowKey(annual: AnnualLuckData): string {
  return `liunian:${annual.year}:${annual.ganZhi}`;
}

function liunianWindowKeyFromTiming(timing: DailyFortuneTimingPillar): string {
  return `liunian:${timing.year || 'unknown'}:${timing.gan_zhi}`;
}

function monthWindowKey(item: RawMonthWindow): string {
  return `liuyue:${item.targetWindow.valid_from}:${item.monthly.ganZhi}`;
}

function liuyueWindowKeyFromTiming(
  timing: DailyFortuneTimingPillar,
  effectiveDate: string,
): string {
  return `liuyue:${isDate(timing.start_date) ? timing.start_date : effectiveDate}:${timing.gan_zhi}`;
}

function compareTimeWindows(
  left: RecommendationTimeWindow,
  right: RecommendationTimeWindow,
): number {
  const bucketOrder: Record<RecommendationTimeWindowBucket, number> = {
    current_or_parent_dayun: 0,
    parent_liunian: 1,
    recent_12_liuyue: 2,
    future_exploration: 3,
    dayun_index: 4,
  };
  return Number(right.is_current) - Number(left.is_current)
    || bucketOrder[left.bucket] - bucketOrder[right.bucket]
    || left.target_window.valid_from.localeCompare(right.target_window.valid_from)
    || left.window_key.localeCompare(right.window_key);
}

function compareNullableTimestamps(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left.localeCompare(right);
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function containsDate(window: RecommendationCardValidity, date: string): boolean {
  return window.valid_from <= date
    && (window.valid_until === null || window.valid_until >= date);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function yearStart(value: number | undefined): string | null {
  return Number.isInteger(value) ? `${value}-01-01` : null;
}

function yearEnd(value: number | undefined): string | null {
  return Number.isInteger(value) ? `${value}-12-31` : null;
}

function previousCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function projectToActualNatalChart(
  chart: Partial<FullChartResult>,
  includeHour: boolean,
): Partial<FullChartResult> {
  if (includeHour) return chart;
  const {
    time: _internalFallbackTime,
    hour: _internalFallbackHour,
    ...actualChart
  } = chart as Partial<FullChartResult> & { hour?: unknown };
  return actualChart;
}
