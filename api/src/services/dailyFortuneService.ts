import { createHash } from 'node:crypto';
import {
  DailyFortuneArtifactRepository,
  DailyFortuneArtifactRow,
  dailyFortuneArtifactRepository,
} from '../database/repositories/DailyFortuneArtifactRepository';
import {
  DAILY_FORTUNE_CONTRACT_VERSION,
  DAILY_FORTUNE_PROMPT_VERSION,
  DailyFortuneAiContent,
  DailyFortuneFactPackage,
  DailyFortuneHiddenStem,
  DailyFortuneInteractionParticipant,
  DailyFortuneJsonValue,
  DailyFortuneMingliInteraction,
  DailyFortuneMingliInteractions,
  DailyFortunePillar,
  DailyFortunePillarPosition,
  DailyFortuneTimingPillar,
} from '../models/DailyFortune';
import { BaziProfile } from '../models/BaziProfile';
import { User } from '../models/User';
import { userRepository } from '../database/repositories/UserRepository';
import { getBaziDailyFortuneEngineBundle } from './baziService';
import { buildDailyFortuneUserContext } from '../utils/dailyFortuneUserContext';
import {
  DailyFortuneAiError,
  generateDailyFortuneWithAi,
} from '../utils/dailyFortuneAi';
import { NotFoundError, ValidationError } from '../utils/errors';

const GENERATION_CONFIG_VERSION = 'daily_fortune_gemini_v6';
const OUTPUT_SCHEMA_VERSION = 'daily_fortune_output_v1';
const DEFAULT_RETRY_AFTER_SECONDS = 60;
const DEFAULT_JOIN_RETRY_MS = 1_000;

type EngineBundle = Awaited<ReturnType<typeof getBaziDailyFortuneEngineBundle>>;

/**
 * Raised only for an incomplete deterministic fact package. It is handled
 * before claim, so no artifact or AI output is created from uncertain facts.
 */
export class DailyFortuneFactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyFortuneFactError';
    Object.setPrototypeOf(this, DailyFortuneFactError.prototype);
  }
}

export interface ResolveDailyFortuneInput {
  bazi_profile_id: string;
  timezone: string;
  request_id: string;
}

export interface DailyFortuneDateContext {
  effectiveDate: string;
  nextBoundaryAt: string;
}

export type DailyFortuneServiceResult =
  | DailyFortuneReadyResult
  | {
      status: 'generating';
      generation_id: string;
      effective_date: string;
      timezone: string;
      next_boundary_at: string;
      retry_after_ms: number;
    }
  | {
      status: 'missing';
      generation_id: string;
    }
  | {
      status: 'unavailable';
      message: string;
      cause: string;
      next_action: 'RETRY_POST_LATER';
      retryable: boolean;
      retry_after_ms?: number;
      generation_id?: string;
    };

export interface DailyFortuneReadyResult {
  status: 'ready';
  generation_id: string;
  artifact_id: string;
  profile_id: string;
  profile_updated_at: string;
  effective_date: string;
  timezone: string;
  next_boundary_at: string;
  day_context: Record<string, DailyFortuneJsonValue>;
  content: DailyFortuneAiContent;
}

interface DailyFortuneServiceDependencies {
  artifacts: Pick<
    DailyFortuneArtifactRepository,
    'claim'
      | 'findById'
      | 'findReadyByIdentity'
      | 'finalize'
      | 'markRetryWait'
  >;
  getEngineBundle: typeof getBaziDailyFortuneEngineBundle;
  getUser: typeof userRepository.findById;
  generateContent: typeof generateDailyFortuneWithAi;
  now: () => Date;
  generationEnabled: () => boolean;
}

const defaultDependencies: DailyFortuneServiceDependencies = {
  artifacts: dailyFortuneArtifactRepository,
  getEngineBundle: getBaziDailyFortuneEngineBundle,
  getUser: userRepository.findById.bind(userRepository),
  generateContent: generateDailyFortuneWithAi,
  now: () => new Date(),
  generationEnabled: () => readBooleanFlag('DAILY_FORTUNE_V2_GENERATION_ENABLED', true),
};

export function createDailyFortuneService(
  overrides: Partial<DailyFortuneServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    resolveDailyFortune: (
      userId: string,
      input: ResolveDailyFortuneInput,
    ): Promise<DailyFortuneServiceResult> =>
      resolveDailyFortuneWithDependencies(dependencies, userId, input),
    getDailyFortuneGeneration: (
      userId: string,
      generationId: string,
      requestId: string,
    ): Promise<DailyFortuneServiceResult> =>
      getDailyFortuneGenerationWithDependencies(
        dependencies,
        userId,
        generationId,
        requestId,
      ),
  };
}

const defaultService = createDailyFortuneService();

export const resolveDailyFortune = defaultService.resolveDailyFortune;
export const getDailyFortuneGeneration = defaultService.getDailyFortuneGeneration;

async function resolveDailyFortuneWithDependencies(
  dependencies: DailyFortuneServiceDependencies,
  userId: string,
  input: ResolveDailyFortuneInput,
): Promise<DailyFortuneServiceResult> {
  validateResolveInput(userId, input);
  const dateContext = resolveDailyFortuneDate(dependencies.now(), input.timezone);
  const [bundle, user] = await Promise.all([
    dependencies.getEngineBundle(
      userId,
      input.bazi_profile_id,
      dateContext.effectiveDate,
    ),
    dependencies.getUser(userId).catch(() => null),
  ]);

  let facts: DailyFortuneFactPackage;
  try {
    facts = buildDailyFortuneFactPackage(
      bundle,
      dateContext.effectiveDate,
      input.timezone,
      user,
    );
  } catch (error) {
    if (error instanceof DailyFortuneFactError) {
      return unavailable('FACTS_INCOMPLETE', true);
    }
    throw error;
  }

  const profileRevisionHash = sha256(canonicalJson({
    fact_contract_version: DAILY_FORTUNE_CONTRACT_VERSION,
    prompt_version: DAILY_FORTUNE_PROMPT_VERSION,
    generation_config_version: GENERATION_CONFIG_VERSION,
    profile: profileRevisionPayload(bundle.profile),
    user_context: facts.user_context,
  }));
  const identity = {
    userId,
    profileId: input.bazi_profile_id,
    effectiveDate: dateContext.effectiveDate,
    profileRevisionHash,
  };

  if (!dependencies.generationEnabled()) {
    const existingReady = await dependencies.artifacts.findReadyByIdentity(identity);
    if (existingReady) {
      if (!isEffectiveDateCurrent(dependencies, input.timezone, dateContext.effectiveDate)) {
        return unavailable('DATE_ROLLED_OVER', true);
      }
      return readyResult(
        existingReady,
        input.timezone,
        dateContext.nextBoundaryAt,
        bundle.profile.updated_at,
      );
    }
    return unavailable('GENERATION_DISABLED', false);
  }

  const factHash = sha256(canonicalJson(facts));
  const generationKey = sha256(canonicalJson(identity));
  const claim = await dependencies.artifacts.claim({
    generationKey,
    ...identity,
    profileUpdatedAt: bundle.profile.updated_at,
    generationTimezone: input.timezone,
  });

  if (claim.outcome === 'ready') {
    const row = await readClaimedArtifact(dependencies, userId, claim.artifactId);
    if (!isEffectiveDateCurrent(dependencies, input.timezone, dateContext.effectiveDate)) {
      return unavailable('DATE_ROLLED_OVER', true);
    }
    return readyResult(
      row,
      input.timezone,
      dateContext.nextBoundaryAt,
      bundle.profile.updated_at,
    );
  }

  if (claim.outcome === 'join') {
    return {
      status: 'generating',
      generation_id: requiredArtifactId(claim.artifactId),
      effective_date: dateContext.effectiveDate,
      timezone: input.timezone,
      next_boundary_at: dateContext.nextBoundaryAt,
      retry_after_ms: retryDelayMs(claim.leaseExpiresAt, dependencies.now()),
    };
  }

  if (claim.outcome === 'wait') {
    return unavailable(
      'RETRY_WAIT',
      true,
      claim.artifactId || undefined,
      retryDelayMs(claim.nextAttemptAt, dependencies.now()),
    );
  }

  if (claim.outcome === 'busy') {
    return unavailable(
      'GENERATION_BUSY',
      true,
      claim.artifactId || undefined,
      DEFAULT_JOIN_RETRY_MS,
    );
  }

  const artifactId = requiredArtifactId(claim.artifactId);
  const leaseToken = requiredLeaseToken(claim.leaseToken);

  let content: DailyFortuneAiContent;
  try {
    content = await dependencies.generateContent(facts);
  } catch (error) {
    const failure = classifyAiFailure(error);
    if (process.env.NODE_ENV === 'production' && error instanceof DailyFortuneAiError) {
      console.warn('[daily-fortune] AI generation rejected', {
        code: error.code,
        message: error.message,
        provider_status: error.providerStatus ?? null,
        finish_reason: error.finishReason ?? null,
      });
    } else if (process.env.NODE_ENV === 'production') {
      console.warn('[daily-fortune] AI generation failed with an unexpected error');
    }
    await dependencies.artifacts.markRetryWait({
      artifactId,
      userId,
      leaseToken,
      leaseEpoch: claim.leaseEpoch,
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
    });
    return unavailable(
      failure.cause,
      failure.retryable,
      artifactId,
      DEFAULT_RETRY_AFTER_SECONDS * 1_000,
    );
  }

  const finalized = await dependencies.artifacts.finalize({
    artifactId,
    userId,
    leaseToken,
    leaseEpoch: claim.leaseEpoch,
    factContractVersion: DAILY_FORTUNE_CONTRACT_VERSION,
    factHash,
    factSnapshot: facts,
    dayContext: buildDayContext(facts),
    content,
    promptVersion: DAILY_FORTUNE_PROMPT_VERSION,
    outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    generationConfigVersion: GENERATION_CONFIG_VERSION,
    modelId: process.env.DAILY_FORTUNE_AI_MODEL?.trim() || 'unconfigured',
  });

  const row = await dependencies.artifacts.findById(userId, artifactId);
  if (!finalized && (!row || row.status !== 'ready')) {
    return unavailable('LEASE_LOST', true, artifactId, DEFAULT_JOIN_RETRY_MS);
  }
  if (!row || row.status !== 'ready') {
    return unavailable('PERSISTENCE_INCOMPLETE', true, artifactId, DEFAULT_JOIN_RETRY_MS);
  }
  if (!isEffectiveDateCurrent(dependencies, input.timezone, dateContext.effectiveDate)) {
    return unavailable('DATE_ROLLED_OVER', true);
  }
  return readyResult(
    row,
    input.timezone,
    dateContext.nextBoundaryAt,
    bundle.profile.updated_at,
  );
}

async function getDailyFortuneGenerationWithDependencies(
  dependencies: DailyFortuneServiceDependencies,
  userId: string,
  generationId: string,
  _requestId: string,
): Promise<DailyFortuneServiceResult> {
  if (!userId.trim() || !generationId.trim()) {
    throw new ValidationError('generation_id 是必填参数');
  }

  const row = await dependencies.artifacts.findById(userId, generationId);
  if (!row) {
    throw new NotFoundError('日运生成记录不存在');
  }
  const context = resolveDailyFortuneDate(dependencies.now(), row.generation_timezone);
  if (context.effectiveDate !== row.effective_date) {
    return { status: 'missing', generation_id: row.id };
  }
  if (row.status === 'ready') {
    return readyResult(row, row.generation_timezone, context.nextBoundaryAt);
  }
  if (row.status === 'retry_wait') {
    return { status: 'missing', generation_id: row.id };
  }
  if (!row.lease_expires_at || new Date(row.lease_expires_at) <= dependencies.now()) {
    return { status: 'missing', generation_id: row.id };
  }

  return {
    status: 'generating',
    generation_id: row.id,
    effective_date: row.effective_date,
    timezone: row.generation_timezone,
    next_boundary_at: context.nextBoundaryAt,
    retry_after_ms: retryDelayMs(row.lease_expires_at, dependencies.now()),
  };
}

function isEffectiveDateCurrent(
  dependencies: DailyFortuneServiceDependencies,
  timezone: string,
  expectedDate: string,
): boolean {
  return resolveDailyFortuneDate(dependencies.now(), timezone).effectiveDate === expectedDate;
}

export function resolveDailyFortuneDate(now: Date, timezone: string): DailyFortuneDateContext {
  validateTimeZone(timezone);
  if (Number.isNaN(now.getTime())) {
    throw new ValidationError('当前时间无效');
  }

  const local = zonedParts(now, timezone);
  const effectiveLocalDate = local.hour >= 23
    ? addCalendarDays(local, 1)
    : local;
  const boundaryLocalDate = local.hour >= 23
    ? addCalendarDays(local, 1)
    : local;
  const nextBoundaryAt = localDateTimeToInstant({
    year: boundaryLocalDate.year,
    month: boundaryLocalDate.month,
    day: boundaryLocalDate.day,
    hour: 23,
    minute: 0,
    second: 0,
  }, timezone);

  return {
    effectiveDate: formatDate(effectiveLocalDate),
    nextBoundaryAt: nextBoundaryAt.toISOString(),
  };
}

export function buildDailyFortuneFactPackage(
  bundle: EngineBundle,
  effectiveDate: string,
  timezone: string,
  user: User | null = null,
): DailyFortuneFactPackage {
  const profile = bundle.profile;
  const chart = bundle.chart as Record<string, unknown>;
  const timeline = bundle.timeline as Record<string, unknown>;
  const activeLuck = asRecord(timeline.active_luck_context);
  const pillars = buildPillars(chart.pillars);
  assertActualNatalPillars(pillars);
  const dayMaster = requiredFactText(chart.day_master, '日主');
  const mingliFacts = asRecord(chart.mingli_facts);

  return {
    contract_version: DAILY_FORTUNE_CONTRACT_VERSION,
    effective_date: effectiveDate,
    timezone,
    day_boundary: 'zi_chu_23_local',
    profile: compactObject({
      gender: profile.gender,
      birth_date: birthDate(profile),
      birth_place: [profile.birth_country, profile.birth_region].filter(Boolean).join(' ') || undefined,
      birth_timezone: requiredFactText(profile.birth_timezone, '出生时区'),
    }),
    natal: {
      pillars,
      day_master: dayMaster,
      ...(stringOrUndefined(chart.day_master_element)
        ? { day_master_element: stringOrUndefined(chart.day_master_element) }
        : {}),
    },
    timing: {
      dayun: buildTimingPillar(activeLuck.dayun, 'dayun'),
      liunian: buildTimingPillar(activeLuck.liunian, 'liunian'),
      liuyue: buildTimingPillar(activeLuck.liuyue, 'liuyue'),
      liuri: buildTimingPillar(activeLuck.liuri, 'liuri'),
    },
    mingli_interactions: buildMingliInteractions(
      mingliFacts,
      timeline.timing_interactions,
    ),
    user_context: buildDailyFortuneUserContext(profile, user),
  };
}

function buildPillars(value: unknown): DailyFortunePillar[] {
  if (!Array.isArray(value)) {
    throw new DailyFortuneFactError('日运事实缺少命局柱');
  }
  return value.map((raw) => {
    const pillar = asRecord(raw);
    const position = pillar.position;
    if (!isPillarPosition(position)) {
      throw new DailyFortuneFactError('命盘柱位无效');
    }
    const stem = requiredFactText(pillar.stem, `${position} 柱天干`);
    const branch = requiredFactText(pillar.branch, `${position} 柱地支`);
    return {
      position,
      gan_zhi: `${stem}${branch}`,
      stem,
      branch,
      hidden_stems: buildHiddenStems(pillar.hidden_stems, `${position} 柱`),
      ...(stringOrUndefined(pillar.ten_god) ? { ten_god: stringOrUndefined(pillar.ten_god) } : {}),
      ...(stringOrUndefined(pillar.stem_element) ? { stem_element: stringOrUndefined(pillar.stem_element) } : {}),
      ...(stringOrUndefined(pillar.branch_element) ? { branch_element: stringOrUndefined(pillar.branch_element) } : {}),
      ...(stringOrUndefined(pillar.lifecycle) ? { lifecycle: stringOrUndefined(pillar.lifecycle) } : {}),
      ...(stringOrUndefined(pillar.self_sitting) ? { self_sitting: stringOrUndefined(pillar.self_sitting) } : {}),
      ...(stringOrUndefined(pillar.void_info) ? { void_info: stringOrUndefined(pillar.void_info) } : {}),
      ...(stringOrUndefined(pillar.na_yin) ? { na_yin: stringOrUndefined(pillar.na_yin) } : {}),
      ...(toJsonValue(pillar.shen_sha) ? { shen_sha: toJsonValue(pillar.shen_sha) } : {}),
    };
  });
}

function assertActualNatalPillars(pillars: DailyFortunePillar[]): void {
  const positions = pillars.map((pillar) => pillar.position);
  if (positions.length !== 3 && positions.length !== 4) {
    throw new DailyFortuneFactError('日运事实必须包含实际保存的三柱或四柱');
  }
  if (new Set(positions).size !== positions.length) {
    throw new DailyFortuneFactError('命局柱位重复');
  }
  for (const position of ['year', 'month', 'day'] as const) {
    if (!positions.includes(position)) {
      throw new DailyFortuneFactError(`命局缺少${position}柱`);
    }
  }
}

function buildTimingPillar(
  value: unknown,
  label: 'dayun' | 'liunian' | 'liuyue' | 'liuri',
): DailyFortuneTimingPillar {
  if (!isRecord(value)) {
    throw new DailyFortuneFactError(`日运事实缺少 ${label}`);
  }
  const ganZhi = requiredFactText(value.gan_zhi, `${label} 干支`);
  const stem = nullableFactText(value.stem);
  const branch = nullableFactText(value.branch);
  const isChildhoodLuck = label === 'dayun' && ganZhi === '童限' && branch === null;

  if (isChildhoodLuck && stem !== null) {
    throw new DailyFortuneFactError('童限不应携带实际天干');
  }
  if (!isChildhoodLuck) {
    if (!stem || !branch || ganZhi !== `${stem}${branch}`) {
      throw new DailyFortuneFactError(`${label} 干支事实不完整`);
    }
  }
  if (branch && !stem) {
    throw new DailyFortuneFactError(`${label} 有地支但缺少天干`);
  }

  return {
    gan_zhi: ganZhi,
    stem,
    branch,
    hidden_stems: branch ? buildHiddenStems(value.hidden_stems, label) : [],
    ...(stringOrUndefined(value.ten_god) ? { ten_god: stringOrUndefined(value.ten_god) } : {}),
    ...(stringOrUndefined(value.ten_god_top) ? { ten_god_top: stringOrUndefined(value.ten_god_top) } : {}),
    ...(stringOrUndefined(value.ten_god_bottom) ? { ten_god_bottom: stringOrUndefined(value.ten_god_bottom) } : {}),
    ...(stringOrUndefined(value.stem_element) ? { stem_element: stringOrUndefined(value.stem_element) } : {}),
    ...(stringOrUndefined(value.branch_element) ? { branch_element: stringOrUndefined(value.branch_element) } : {}),
    ...(stringOrUndefined(value.lifecycle) ? { lifecycle: stringOrUndefined(value.lifecycle) } : {}),
    ...(stringOrUndefined(value.self_sitting) ? { self_sitting: stringOrUndefined(value.self_sitting) } : {}),
    ...(stringOrUndefined(value.na_yin) ? { na_yin: stringOrUndefined(value.na_yin) } : {}),
    ...(stringOrUndefined(value.date) ? { date: stringOrUndefined(value.date) } : {}),
    ...(typeof value.year === 'number' && Number.isFinite(value.year) ? { year: value.year } : {}),
    ...(typeof value.month === 'number' && Number.isFinite(value.month) ? { month: value.month } : {}),
    ...(typeof value.start_year === 'number' && Number.isFinite(value.start_year)
      ? { start_year: value.start_year }
      : {}),
    ...(typeof value.end_year === 'number' && Number.isFinite(value.end_year)
      ? { end_year: value.end_year }
      : {}),
    ...(value.start_date === null || stringOrUndefined(value.start_date)
      ? { start_date: value.start_date === null ? null : stringOrUndefined(value.start_date) }
      : {}),
    ...(value.end_date === null || stringOrUndefined(value.end_date)
      ? { end_date: value.end_date === null ? null : stringOrUndefined(value.end_date) }
      : {}),
    ...(value.solar_term === null || stringOrUndefined(value.solar_term)
      ? { solar_term: value.solar_term === null ? null : stringOrUndefined(value.solar_term) }
      : {}),
  };
}

function buildHiddenStems(value: unknown, label: string): DailyFortuneHiddenStem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DailyFortuneFactError(`${label} 地支缺少藏干`);
  }
  return value.map((raw, index) => {
    const hidden = asRecord(raw);
    return {
      stem: requiredFactText(hidden.stem, `${label} 藏干 ${index + 1} 天干`),
      ten_god: requiredFactText(hidden.ten_god, `${label} 藏干 ${index + 1} 十神`),
      element: requiredFactText(hidden.element, `${label} 藏干 ${index + 1} 五行`),
    };
  });
}

function buildMingliInteractions(
  mingliFacts: Record<string, unknown>,
  timingInteractions: unknown,
): DailyFortuneMingliInteractions {
  const ruleVersion = requiredFactText(mingliFacts.rule_version, '命理作用规则版本');
  if (!Array.isArray(mingliFacts.natal_interactions)) {
    throw new DailyFortuneFactError('日运事实缺少原局作用关系');
  }
  if (!Array.isArray(timingInteractions)) {
    throw new DailyFortuneFactError('日运事实缺少流运作用关系');
  }
  return {
    rule_version: ruleVersion,
    natal: compactInteractions(mingliFacts.natal_interactions),
    timing: compactInteractions(timingInteractions),
  };
}

function compactInteractions(
  items: unknown[],
): DailyFortuneMingliInteraction[] {
  return items
    .map((item) => {
      if (!isMingliInteraction(item)) {
        throw new DailyFortuneFactError('命理作用关系结构无效');
      }
      return item;
    })
    .map(compactInteraction)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function isMingliInteraction(value: unknown): boolean {
  const record = asRecord(value);
  return typeof record.relation === 'string' && Array.isArray(record.participants);
}

function compactInteraction(value: unknown): DailyFortuneMingliInteraction {
  const record = asRecord(value);
  const participants = participantArray(record.participants, '命理作用参与者');
  const targets = participantArray(record.targets, '命理作用目标');
  return {
    id: requiredFactText(record.id, '命理作用 id'),
    scope: requiredFactText(record.scope, '命理作用 scope'),
    relation: requiredFactText(record.relation, '命理作用 relation'),
    relation_name: requiredFactText(record.relation_name, '命理作用名称'),
    fact_label: requiredFactText(record.fact_label, '命理作用事实标签'),
    short_label: requiredFactText(record.short_label, '命理作用短标签'),
    display_group: requiredFactText(record.display_group, '命理作用展示分组'),
    aliases: stringArray(record.aliases, '命理作用别名'),
    participants,
    source: record.source === null || record.source === undefined
      ? null
      : compactParticipant(record.source, '命理作用来源'),
    targets,
    transform_element: nullableFactText(record.transform_element),
    center_branch: nullableFactText(record.center_branch),
    activated_palaces: stringArray(record.activated_palaces, '命理作用激活宫位'),
    target_part: targetPartForRelation(requiredFactText(record.relation, '命理作用 relation')),
    intensity: requiredFiniteNumber(record.intensity, '命理作用强度'),
    time_horizon: requiredFactText(record.time_horizon, '命理作用时间范围'),
    adjacent: requiredBoolean(record.adjacent, '命理作用相邻标记'),
    full_match: requiredBoolean(record.full_match, '命理作用完整标记'),
    missing_branch: nullableFactText(record.missing_branch),
    seen_stem: nullableFactText(record.seen_stem),
    compared_against: requiredFactText(record.compared_against, '命理作用比较范围'),
    rule_version: requiredFactText(record.rule_version, '命理作用规则版本'),
  };
}

function targetPartForRelation(relation: string): 'stem' | 'branch' {
  if (relation.startsWith('stem_')) return 'stem';
  if (relation.startsWith('branch_')) return 'branch';
  throw new DailyFortuneFactError('命理作用无法确定干支目标');
}

function participantArray(value: unknown, label: string): DailyFortuneInteractionParticipant[] {
  if (!Array.isArray(value)) {
    throw new DailyFortuneFactError(`${label} 缺失`);
  }
  return value.map((participant) => compactParticipant(participant, label));
}

function compactParticipant(value: unknown, label: string): DailyFortuneInteractionParticipant {
  const item = asRecord(value);
  const pillar = item.pillar;
  if (pillar !== null && pillar !== undefined && typeof pillar !== 'string') {
    throw new DailyFortuneFactError(`${label} 柱位无效`);
  }
  return {
    type: requiredFactText(item.type, `${label} 类型`),
    pillar: typeof pillar === 'string' && pillar ? pillar : null,
    label: requiredFactText(item.label, `${label} 标签`),
    stem: typeof item.stem === 'string' ? item.stem : '',
    branch: typeof item.branch === 'string' ? item.branch : '',
    gan_zhi: typeof item.gan_zhi === 'string' ? item.gan_zhi : '',
    ten_gods: stringArray(item.ten_gods, `${label} 十神`),
  };
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new DailyFortuneFactError(`${label} 无效`);
  }
  return value as string[];
}

function requiredFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DailyFortuneFactError(`${label} 无效`);
  }
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new DailyFortuneFactError(`${label} 无效`);
  }
  return value;
}

function buildDayContext(
  facts: DailyFortuneFactPackage,
): Record<string, DailyFortuneJsonValue> {
  return {
    dayun: facts.timing.dayun.gan_zhi,
    liunian: facts.timing.liunian.gan_zhi,
    liuyue: facts.timing.liuyue.gan_zhi,
    liuri: facts.timing.liuri.gan_zhi,
  };
}

function readyResult(
  row: DailyFortuneArtifactRow,
  timezone: string,
  nextBoundaryAt: string,
  currentProfileUpdatedAt: string = row.profile_updated_at,
): DailyFortuneReadyResult {
  if (!row.content_json || !row.day_context_json) {
    throw new Error('READY 日运缺少完整内容');
  }
  return {
    status: 'ready',
    generation_id: row.id,
    artifact_id: row.id,
    profile_id: row.profile_id,
    profile_updated_at: currentProfileUpdatedAt,
    effective_date: row.effective_date,
    timezone,
    next_boundary_at: nextBoundaryAt,
    day_context: row.day_context_json,
    content: row.content_json,
  };
}

async function readClaimedArtifact(
  dependencies: DailyFortuneServiceDependencies,
  userId: string,
  artifactId: string | null,
): Promise<DailyFortuneArtifactRow> {
  const row = await dependencies.artifacts.findById(userId, requiredArtifactId(artifactId));
  if (!row || row.status !== 'ready') {
    throw new Error('READY claim 未能读取完整 artifact');
  }
  return row;
}

function unavailable(
  cause: string,
  retryable: boolean,
  generationId?: string,
  retryAfterMs?: number,
): DailyFortuneServiceResult {
  return {
    status: 'unavailable',
    message: '今日日运尚未生成',
    cause,
    next_action: 'RETRY_POST_LATER',
    retryable,
    ...(generationId ? { generation_id: generationId } : {}),
    ...(retryAfterMs !== undefined ? { retry_after_ms: retryAfterMs } : {}),
  };
}

function classifyAiFailure(error: unknown): { cause: string; retryable: boolean } {
  if (error instanceof DailyFortuneAiError) {
    return {
      cause: `AI_${error.code.toUpperCase()}`,
      retryable: error.retryable,
    };
  }
  return { cause: 'AI_UNEXPECTED_ERROR', retryable: true };
}

function validateResolveInput(userId: string, input: ResolveDailyFortuneInput): void {
  if (!userId.trim()) throw new ValidationError('用户 ID 无效');
  if (!input.bazi_profile_id?.trim()) {
    throw new ValidationError('bazi_profile_id 是必填字段');
  }
  validateTimeZone(input.timezone);
}

function validateTimeZone(timezone: string): void {
  if (!timezone?.trim()) throw new ValidationError('timezone 是必填字段');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new ValidationError('timezone 必须是有效的 IANA 时区');
  }
}

function profileRevisionPayload(profile: BaziProfile): unknown {
  return {
    birth_year: profile.birth_year,
    birth_month: profile.birth_month,
    birth_day: profile.birth_day,
    birth_hour: profile.birth_hour ?? null,
    birth_minute: profile.birth_minute ?? null,
    gender: profile.gender ?? null,
    is_lunar: profile.is_lunar,
    birth_timezone: profile.birth_timezone,
    birth_country: profile.birth_country ?? null,
    birth_region: profile.birth_region ?? null,
    birth_latitude: profile.birth_latitude ?? null,
    birth_longitude: profile.birth_longitude ?? null,
    time_basis: profile.time_basis ?? null,
    true_solar_time: profile.true_solar_time ?? null,
    true_solar_correction_minutes: profile.true_solar_correction_minutes ?? null,
    full_chart: profile.full_chart ?? null,
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readBooleanFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function retryDelayMs(value: string | null, now: Date): number {
  if (!value) return DEFAULT_JOIN_RETRY_MS;
  const delay = new Date(value).getTime() - now.getTime();
  return Number.isFinite(delay) ? Math.max(250, Math.min(delay, 10_000)) : DEFAULT_JOIN_RETRY_MS;
}

function requiredArtifactId(value: string | null): string {
  if (!value) throw new Error('日运 claim 缺少 artifact id');
  return value;
}

function requiredLeaseToken(value: string | null): string {
  if (!value) throw new Error('日运 owner claim 缺少 lease token');
  return value;
}

function birthDate(profile: BaziProfile): string {
  return [
    `${profile.birth_year}`.padStart(4, '0'),
    `${profile.birth_month}`.padStart(2, '0'),
    `${profile.birth_day}`.padStart(2, '0'),
  ].join('-');
}

function toJsonValue(value: unknown): DailyFortuneJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as DailyFortuneJsonValue;
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredFactText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DailyFortuneFactError(`${label} 缺失`);
  }
  return value.trim();
}

function nullableFactText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function isPillarPosition(value: unknown): value is DailyFortunePillarPosition {
  return value === 'year' || value === 'month' || value === 'day' || value === 'hour';
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timezone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function addCalendarDays(value: LocalDateTime, days: number): LocalDateTime {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    ...value,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatDate(value: LocalDateTime): string {
  return [
    `${value.year}`.padStart(4, '0'),
    `${value.month}`.padStart(2, '0'),
    `${value.day}`.padStart(2, '0'),
  ].join('-');
}

function localDateTimeToInstant(local: LocalDateTime, timezone: string): Date {
  const targetUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  let candidate = targetUtc;
  for (let index = 0; index < 3; index += 1) {
    const observed = zonedParts(new Date(candidate), timezone);
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    candidate += targetUtc - observedUtc;
  }
  return new Date(candidate);
}
