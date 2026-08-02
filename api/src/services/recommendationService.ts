import { createHash } from 'node:crypto';
import {
  RecommendationAggregatedInterestSignal,
  RecommendationBatchRow,
  RecommendationPreferenceSnapshot,
  RecommendationRepository,
  recommendationRepository,
} from '../database/repositories/RecommendationRepository';
import {
  RECOMMENDATION_CONTRACT_VERSION,
  RECOMMENDATION_PROMPT_VERSION,
  RECOMMENDATION_TAXONOMY_VERSION,
  RecommendationAiInput,
  RecommendationBatch,
  RecommendationBatchResponse,
  RecommendationBehaviorEventType,
  RecommendationInterestSignal,
  RecommendationNextRequest,
  RecommendationNextResponse,
  RecommendationRelationshipStatus,
  RecommendationFactReference,
  RecommendationForecastWindow,
} from '../models/Recommendation';
import { userRepository } from '../database/repositories/UserRepository';
import { getBaziDailyFortuneEngineBundle } from './baziService';
import {
  buildDailyFortuneFactPackage,
  DailyFortuneFactError,
  resolveDailyFortuneDate,
} from './dailyFortuneService';
import { DailyFortuneFactPackage, DailyFortuneMingliInteraction } from '../models/DailyFortune';
import { BaziProfile } from '../models/BaziProfile';
import {
  DailyFortuneAiError,
} from '../utils/dailyFortuneAi';
import {
  generateRecommendationCandidatesWithAi,
} from '../utils/recommendationAi';
import { NotFoundError, ValidationError } from '../utils/errors';

const OUTPUT_SCHEMA_VERSION = 'recommendation_output_v1';
const DEFAULT_RETRY_AFTER_SECONDS = 60;
const DEFAULT_JOIN_RETRY_MS = 1_000;
const RECOMMENDATION_GENERATION_LEASE_TTL_SECONDS = 150;

export interface ResolveRecommendationsInput extends RecommendationNextRequest {
  request_id: string;
}

export interface RecordRecommendationEventInput {
  event_id: string;
  batch_id: string;
  candidate_id: string;
  event_type: RecommendationBehaviorEventType;
  session_id: string;
}

export type RecommendationServiceResult = RecommendationNextResponse & {
  effective_date?: string;
  timezone?: string;
  next_boundary_at?: string;
  retryable?: boolean;
};

export interface RecommendationEventServiceResult {
  accepted: boolean;
  duplicate: boolean;
}

interface RecommendationServiceDependencies {
  batches: Pick<
    RecommendationRepository,
    'claim'
      | 'findById'
      | 'finalize'
      | 'markRetryWait'
      | 'release'
      | 'getPreferenceSnapshot'
      | 'recordEvent'
  >;
  getEngineBundle: typeof getBaziDailyFortuneEngineBundle;
  getUser: typeof userRepository.findById;
  generateCandidates: typeof generateRecommendationCandidatesWithAi;
  now: () => Date;
  generationEnabled: () => boolean;
}

const defaultDependencies: RecommendationServiceDependencies = {
  batches: recommendationRepository,
  getEngineBundle: getBaziDailyFortuneEngineBundle,
  getUser: userRepository.findById.bind(userRepository),
  generateCandidates: generateRecommendationCandidatesWithAi,
  now: () => new Date(),
  // Keep the legacy insights path as the production default until this new
  // recommendation loop is explicitly enabled in the deployment environment.
  generationEnabled: () => readBooleanFlag('RECOMMENDATIONS_V1_ENABLED', false),
};

export function createRecommendationService(
  overrides: Partial<RecommendationServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    resolveRecommendations: (
      userId: string,
      input: ResolveRecommendationsInput,
    ): Promise<RecommendationServiceResult> =>
      resolveRecommendationsWithDependencies(dependencies, userId, input),
    getRecommendationBatch: (
      userId: string,
      batchId: string,
    ): Promise<RecommendationBatchResponse> =>
      getRecommendationBatchWithDependencies(dependencies, userId, batchId),
    recordRecommendationEvent: (
      userId: string,
      input: RecordRecommendationEventInput,
    ): Promise<RecommendationEventServiceResult> =>
      recordRecommendationEventWithDependencies(dependencies, userId, input),
  };
}

const defaultService = createRecommendationService();

export const resolveRecommendations = defaultService.resolveRecommendations;
export const getRecommendationBatch = defaultService.getRecommendationBatch;
export const recordRecommendationEvent = defaultService.recordRecommendationEvent;

async function resolveRecommendationsWithDependencies(
  dependencies: RecommendationServiceDependencies,
  userId: string,
  input: ResolveRecommendationsInput,
): Promise<RecommendationServiceResult> {
  validateResolveInput(userId, input);
  const dateContext = resolveDailyFortuneDate(dependencies.now(), input.timezone);
  const [bundle, user] = await Promise.all([
    dependencies.getEngineBundle(userId, input.bazi_profile_id, dateContext.effectiveDate),
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

  if (!isEffectiveDateCurrent(dependencies, input.timezone, dateContext.effectiveDate)) {
    return unavailable('DATE_ROLLED_OVER', true);
  }

  if (!dependencies.generationEnabled()) {
    return unavailable('GENERATION_DISABLED', false);
  }

  // This is a second deterministic fact read, not a second AI decision.  It
  // gives the one recommendation call a concrete next-liuyue window when the
  // engine can provide one, so "下个月会怎样" is grounded in that month's
  // actual timing/interactions instead of asking the model to extrapolate
  // today's facts.  A missing future package simply leaves this optional
  // window out; current facts remain the minimum contract.
  const forecastWindows = await buildNextLiuyueForecastWindow({
    dependencies,
    userId,
    profileId: input.bazi_profile_id,
    timezone: input.timezone,
    currentFacts: facts,
    currentEffectiveDate: dateContext.effectiveDate,
    user,
  });

  // This is the recommendation content identity for a profile, not merely its
  // updated_at timestamp. It changes when deterministic birth/chart facts or
  // the declared user context that AI can see changes, while harmless metadata
  // edits can reuse an equivalent same-day batch.
  const profileRevisionHash = sha256(canonicalJson({
    contract_version: RECOMMENDATION_CONTRACT_VERSION,
    prompt_version: RECOMMENDATION_PROMPT_VERSION,
    taxonomy_version: RECOMMENDATION_TAXONOMY_VERSION,
    profile: profileRevisionPayload(bundle.profile),
    user_context: facts.user_context,
  }));

  // A batch only continues within the same live local recommendation day.
  // If a retained screen tries to prefetch after 23:00, begin today's root
  // instead of returning a database error or attaching today's facts to
  // yesterday's card sequence. The RPC repeats this check as the authority.
  //
  // Preference memory is deliberately read through one bounded aggregate RPC,
  // rather than a capped raw-event list. An active user's 501st recent event
  // must not erase a still-relevant open from earlier in the same 90-day window.
  const preferenceNow = dependencies.now();
  const [afterBatchId, preferenceSnapshot] = await Promise.all([
    activeAfterBatchId(
      dependencies,
      userId,
      input.bazi_profile_id,
      input.after_batch_id ?? null,
      dateContext.effectiveDate,
      profileRevisionHash,
      input.timezone,
    ),
    dependencies.batches.getPreferenceSnapshot({
      userId,
      profileId: input.bazi_profile_id,
      sessionId: input.session_id,
      now: preferenceNow.toISOString(),
    }),
  ]);
  const aiInput = buildRecommendationAiInput({
    facts,
    effectiveDate: dateContext.effectiveDate,
    timezone: input.timezone,
    forecastWindows,
    relationshipStatus: normalizeRelationshipStatus(facts),
    preferenceSnapshot,
  });
  const inputHash = sha256(canonicalJson(aiInput));
  const generationKey = sha256(canonicalJson({
    user_id: userId,
    profile_id: input.bazi_profile_id,
    effective_date: dateContext.effectiveDate,
    timezone: input.timezone,
    after_batch_id: afterBatchId,
    input_hash: inputHash,
    profile_revision_hash: profileRevisionHash,
    contract_version: RECOMMENDATION_CONTRACT_VERSION,
    prompt_version: RECOMMENDATION_PROMPT_VERSION,
    taxonomy_version: RECOMMENDATION_TAXONOMY_VERSION,
  }));

  const claim = await dependencies.batches.claim({
    generationKey,
    userId,
    profileId: input.bazi_profile_id,
    afterBatchId,
    effectiveDate: dateContext.effectiveDate,
    profileRevisionHash,
    profileUpdatedAt: bundle.profile.updated_at,
    generationTimezone: input.timezone,
    inputHash,
    validUntil: dateContext.nextBoundaryAt,
    leaseTtlSeconds: RECOMMENDATION_GENERATION_LEASE_TTL_SECONDS,
  });

  if (claim.outcome === 'ready') {
    const row = await requiredBatch(dependencies, userId, claim.batchId);
    if (!isEffectiveDateCurrent(dependencies, input.timezone, dateContext.effectiveDate)) {
      return unavailable('DATE_ROLLED_OVER', true);
    }
    return readyResult(row, dateContext.nextBoundaryAt);
  }

  if (claim.outcome === 'join') {
    return generatingResult(
      claim.batchId,
      dateContext.effectiveDate,
      input.timezone,
      dateContext.nextBoundaryAt,
      retryDelayMs(claim.leaseExpiresAt, dependencies.now()),
    );
  }

  if (claim.outcome === 'wait') {
    return retryWaitResult(
      claim.batchId,
      dateContext.effectiveDate,
      input.timezone,
      dateContext.nextBoundaryAt,
      retryDelayMs(claim.nextAttemptAt, dependencies.now()),
    );
  }

  if (claim.outcome === 'busy') {
    return unavailable(
      'GENERATION_BUSY',
      true,
      claim.batchId || undefined,
      DEFAULT_JOIN_RETRY_MS,
    );
  }

  if (claim.outcome === 'daily_limit') {
    // This only limits new AI batch rows. It never judges the cards' meaning
    // or preference, and it does not block a join/retry of an existing batch.
    return unavailable('DAILY_BATCH_LIMIT_REACHED', false);
  }

  if (claim.outcome === 'attempt_limit') {
    return unavailable('GENERATION_ATTEMPT_LIMIT_REACHED', false, claim.batchId || undefined);
  }

  if (claim.outcome === 'global_limit') {
    return unavailable('GLOBAL_GENERATION_BUDGET_REACHED', false, claim.batchId || undefined);
  }

  const batchId = requireText(claim.batchId, 'Recommendation owner claim 缺少 batch id');
  const leaseToken = requireText(claim.leaseToken, 'Recommendation owner claim 缺少 lease token');
  let cards;
  try {
    cards = await dependencies.generateCandidates(aiInput);
  } catch (error) {
    const failure = classifyAiFailure(error);
    if (process.env.NODE_ENV === 'production' && error instanceof DailyFortuneAiError) {
      console.warn('[recommendations] AI generation rejected', {
        code: error.code,
        provider_status: error.providerStatus ?? null,
        finish_reason: error.finishReason ?? null,
      });
    } else if (process.env.NODE_ENV === 'production') {
      console.warn('[recommendations] AI generation failed with an unexpected error');
    }
    if (!failure.retryable) {
      await dependencies.batches.release({
        batchId,
        userId,
        leaseToken,
        leaseEpoch: claim.leaseEpoch,
      });
      return unavailable(failure.cause, false);
    }
    await dependencies.batches.markRetryWait({
      batchId,
      userId,
      leaseToken,
      leaseEpoch: claim.leaseEpoch,
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
    });
    return retryWaitResult(
      batchId,
      dateContext.effectiveDate,
      input.timezone,
      dateContext.nextBoundaryAt,
      DEFAULT_RETRY_AFTER_SECONDS * 1_000,
      failure.cause,
    );
  }

  const finalized = await dependencies.batches.finalize({
    batchId,
    userId,
    leaseToken,
    leaseEpoch: claim.leaseEpoch,
    inputSnapshot: aiInput,
    cards,
    promptVersion: RECOMMENDATION_PROMPT_VERSION,
    outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    taxonomyVersion: RECOMMENDATION_TAXONOMY_VERSION,
    modelId: readModelId(),
  });
  const row = await dependencies.batches.findById(userId, batchId);
  if (!finalized && (!row || row.status !== 'ready')) {
    // A false finalize is normally a lease takeover or a profile revision that
    // changed while Gemini was working. Releasing with our exact lease fence
    // moves only our stale attempt to retry_wait; it cannot touch a newer owner
    // or erase the claimed row from the rolling AI-cost budget. Do not return
    // its old AI output to the caller.
    await dependencies.batches.release({
      batchId,
      userId,
      leaseToken,
      leaseEpoch: claim.leaseEpoch,
    });
    return unavailable('FINALIZE_FENCED', true, batchId, DEFAULT_JOIN_RETRY_MS);
  }
  if (!row || row.status !== 'ready') {
    return unavailable('PERSISTENCE_INCOMPLETE', true, batchId, DEFAULT_JOIN_RETRY_MS);
  }
  if (!isEffectiveDateCurrent(dependencies, input.timezone, dateContext.effectiveDate)) {
    return unavailable('DATE_ROLLED_OVER', true);
  }
  return readyResult(row, dateContext.nextBoundaryAt);
}

async function getRecommendationBatchWithDependencies(
  dependencies: RecommendationServiceDependencies,
  userId: string,
  batchId: string,
): Promise<RecommendationBatchResponse> {
  if (!userId.trim() || !batchId.trim()) {
    throw new ValidationError('batch_id 是必填参数');
  }
  const row = await dependencies.batches.findById(userId, batchId);
  if (!row) {
    throw new NotFoundError('推荐卡片批次不存在');
  }
  const dateContext = resolveDailyFortuneDate(dependencies.now(), row.generation_timezone);
  if (dateContext.effectiveDate !== row.effective_date) {
    return { status: 'missing', generation_id: row.id };
  }
  if (row.status === 'ready') {
    return {
      status: 'ready',
      generation_id: row.id,
      batch: toBatch(row),
    };
  }
  if (row.status === 'retry_wait') {
    return {
      status: 'retry_wait',
      generation_id: row.id,
      retry_after_ms: retryDelayMs(row.next_attempt_at, dependencies.now()),
    };
  }
  if (!row.lease_expires_at || new Date(row.lease_expires_at) <= dependencies.now()) {
    return { status: 'missing', generation_id: row.id };
  }
  return {
    status: 'generating',
    generation_id: row.id,
    retry_after_ms: retryDelayMs(row.lease_expires_at, dependencies.now()),
  };
}

async function activeAfterBatchId(
  dependencies: RecommendationServiceDependencies,
  userId: string,
  profileId: string,
  requestedBatchId: string | null,
  effectiveDate: string,
  profileRevisionHash: string,
  timezone: string,
): Promise<string | null> {
  if (!requestedBatchId) return null;
  const prior = await dependencies.batches.findById(userId, requestedBatchId);
  if (
    !prior
    || prior.profile_id !== profileId
    || prior.status !== 'ready'
    || prior.effective_date !== effectiveDate
    || prior.profile_revision_hash !== profileRevisionHash
    || prior.generation_timezone !== timezone
    || !isFutureTimestamp(prior.valid_until, dependencies.now())
  ) {
    return null;
  }
  return requestedBatchId;
}

async function recordRecommendationEventWithDependencies(
  dependencies: RecommendationServiceDependencies,
  userId: string,
  input: RecordRecommendationEventInput,
): Promise<RecommendationEventServiceResult> {
  validateEventInput(userId, input);
  const outcome = await dependencies.batches.recordEvent({
    eventId: input.event_id,
    userId,
    batchId: input.batch_id,
    sessionId: input.session_id,
    candidateId: input.candidate_id,
    eventType: input.event_type,
  });
  return {
    accepted: true,
    duplicate: outcome === 'duplicate',
  };
}

function buildRecommendationAiInput(input: {
  facts: DailyFortuneFactPackage;
  effectiveDate: string;
  timezone: string;
  forecastWindows: RecommendationForecastWindow[];
  relationshipStatus: RecommendationRelationshipStatus;
  preferenceSnapshot: RecommendationPreferenceSnapshot;
}): RecommendationAiInput {
  const currentFactRefs = buildFactReferences(input.facts, input.effectiveDate);
  const forecastFactRefs = input.forecastWindows.flatMap((window) => restrictFactReferencesToTargetWindow(
    buildFactReferences(
      window.fortune_facts,
      window.target_window.valid_from,
      { prefix: window.fact_ref_prefix, includeNatal: false },
    ),
    window.target_window,
  ));
  return {
    contract_version: RECOMMENDATION_CONTRACT_VERSION,
    taxonomy_version: RECOMMENDATION_TAXONOMY_VERSION,
    effective_date: input.effectiveDate,
    timezone: input.timezone,
    fortune_facts: input.facts,
    forecast_windows: input.forecastWindows,
    available_fact_refs: [...currentFactRefs, ...forecastFactRefs],
    relationship_status: input.relationshipStatus,
    preference_context: {
      recent_14d: addSmoothedOpenRates(input.preferenceSnapshot.recent_14d),
      long_term_90d: addSmoothedOpenRates(input.preferenceSnapshot.long_term_90d),
      current_session_opens: input.preferenceSnapshot.current_session_opens,
    },
    content_history: input.preferenceSnapshot.content_history,
  };
}

function buildFactReferences(
  facts: DailyFortuneFactPackage,
  effectiveDate: string,
  options: { prefix?: string; includeNatal?: boolean } = {},
): RecommendationFactReference[] {
  const prefix = options.prefix || '';
  const ref = (value: string) => `${prefix}${value}`;
  const refs: RecommendationFactReference[] = options.includeNatal === false
    ? []
    : facts.natal.pillars.map((pillar) => ({
      ref: ref(`natal:pillar:${pillar.position}`),
      valid_from: facts.profile.birth_date,
      valid_until: null,
    }));
  const timingRefs = {
    dayun: timingValidity(facts, 'dayun', effectiveDate),
    liunian: timingValidity(facts, 'liunian', effectiveDate),
    liuyue: timingValidity(facts, 'liuyue', effectiveDate),
    liuri: timingValidity(facts, 'liuri', effectiveDate),
  };
  (Object.keys(timingRefs) as Array<keyof typeof timingRefs>).forEach((key) => {
    const validity = timingRefs[key];
    refs.push({ ref: ref(`timing:${key}`), ...validity });
  });

  const interactions = [
    ...(options.includeNatal === false ? [] : facts.mingli_interactions.natal),
    ...facts.mingli_interactions.timing,
  ];
  for (const interaction of interactions) {
    refs.push({
      ref: ref(`interaction:${interaction.id}`),
      ...interactionValidity(interaction, timingRefs, facts.profile.birth_date, effectiveDate),
    });
  }
  return refs;
}

function restrictFactReferencesToTargetWindow(
  factReferences: RecommendationFactReference[],
  targetWindow: RecommendationForecastWindow['target_window'],
): RecommendationFactReference[] {
  // A next-liuyue card may cite that month's dayun or liunian background, but
  // its question still describes the next liuyue.  Narrow every future-window
  // reference to that target interval before AI sees it, so a yearly ref
  // cannot mechanically materialize a card with a whole-year validity.
  return factReferences.flatMap((fact) => {
    const validFrom = fact.valid_from > targetWindow.valid_from
      ? fact.valid_from
      : targetWindow.valid_from;
    const finiteEnds = [fact.valid_until, targetWindow.valid_until]
      .filter((date): date is string => date !== null);
    const validUntil = finiteEnds.length === 0
      ? null
      : finiteEnds.reduce((earliest, date) => date < earliest ? date : earliest);
    if (validUntil !== null && validUntil < validFrom) return [];
    return [{ ref: fact.ref, valid_from: validFrom, valid_until: validUntil }];
  });
}

async function buildNextLiuyueForecastWindow(input: {
  dependencies: RecommendationServiceDependencies;
  userId: string;
  profileId: string;
  timezone: string;
  currentFacts: DailyFortuneFactPackage;
  currentEffectiveDate: string;
  user: Awaited<ReturnType<typeof userRepository.findById>> | null;
}): Promise<RecommendationForecastWindow[]> {
  // The luck engine treats liuyue.end_date as the next solar-term boundary
  // (exclusive for the current month), so it is exactly the date to ask the
  // existing engine for the next liuyue.  Do not add a Gregorian month or a
  // day here: that would break the solar-term fact boundary.
  const nextLiuyueStart = validDateOrNull(input.currentFacts.timing.liuyue.end_date);
  if (!nextLiuyueStart || nextLiuyueStart <= input.currentEffectiveDate) return [];

  let nextFacts: DailyFortuneFactPackage;
  try {
    const nextBundle = await input.dependencies.getEngineBundle(
      input.userId,
      input.profileId,
      nextLiuyueStart,
    );
    nextFacts = buildDailyFortuneFactPackage(
      nextBundle,
      nextLiuyueStart,
      input.timezone,
      input.user,
    );
  } catch (error) {
    // The optional forecast window must never be fabricated.  If the existing
    // deterministic fact builder cannot produce it, the same request remains
    // valid for current facts only.  Other failures retain their normal error
    // behavior instead of being silently disguised as an AI decision.
    if (error instanceof DailyFortuneFactError) return [];
    throw error;
  }

  const targetWindow = timingValidity(nextFacts, 'liuyue', nextLiuyueStart);
  if (
    targetWindow.valid_from !== nextLiuyueStart
    || targetWindow.valid_until === null
    || targetWindow.valid_until < nextLiuyueStart
  ) {
    return [];
  }

  return [{
    window_key: 'next_liuyue',
    label: '下一个流月',
    target_window: targetWindow,
    fact_ref_prefix: 'forecast:next_liuyue:',
    fortune_facts: nextFacts,
  }];
}

function timingValidity(
  facts: DailyFortuneFactPackage,
  key: keyof DailyFortuneFactPackage['timing'],
  effectiveDate: string,
): Pick<RecommendationFactReference, 'valid_from' | 'valid_until'> {
  const timing = facts.timing[key];
  if (key === 'dayun') {
    return {
      valid_from: validDateOr(timing.start_date, yearStart(timing.start_year), effectiveDate),
      valid_until: validDateOrNull(timing.end_date, yearEnd(timing.end_year)),
    };
  }
  if (key === 'liunian') {
    const year = timing.year;
    return {
      valid_from: yearStart(year) || effectiveDate,
      valid_until: yearEnd(year),
    };
  }
  if (key === 'liuyue') {
    const endBoundary = validDateOrNull(timing.end_date);
    return {
      valid_from: validDateOr(timing.start_date, effectiveDate),
      // The engine's end_date is the next solar-term / next-liuyue start.
      // Card fact windows use inclusive calendar dates, so represent the last
      // date governed by this liuyue rather than accidentally overlapping the
      // following month on its first day.
      valid_until: endBoundary ? previousCalendarDate(endBoundary) : null,
    };
  }
  return {
    valid_from: validDateOr(timing.date, effectiveDate),
    valid_until: validDateOr(timing.date, effectiveDate),
  };
}

function interactionValidity(
  interaction: DailyFortuneMingliInteraction,
  timing: Record<string, Pick<RecommendationFactReference, 'valid_from' | 'valid_until'>>,
  birthDate: string,
  effectiveDate: string,
): Pick<RecommendationFactReference, 'valid_from' | 'valid_until'> {
  if (interaction.scope === 'natal' || interaction.time_horizon === 'long_term') {
    return { valid_from: birthDate, valid_until: null };
  }
  // `ten_years` contains the substring `year`; use the engine's fixed horizon
  // vocabulary rather than substring matching so a dayun interaction retains
  // its full ten-year validity window.
  switch (interaction.time_horizon) {
    case 'ten_years':
      return timing.dayun;
    case 'year':
      return timing.liunian;
    case 'month':
      return timing.liuyue;
    case 'day':
      return timing.liuri;
    default:
      return { valid_from: effectiveDate, valid_until: effectiveDate };
  }
}

function addSmoothedOpenRates(
  signals: RecommendationAggregatedInterestSignal[],
): RecommendationInterestSignal[] {
  return signals.map((signal) => ({
    ...signal,
    // This is an AI input feature, not a server-side recommendation score. A
    // first open therefore remains a weak clue until it has enough exposure.
    smoothed_open_rate: roundSignal(
      (1 + signal.opens) / (4 + Math.max(signal.exposures, signal.opens)),
    ),
  }));
}

function normalizeRelationshipStatus(
  facts: DailyFortuneFactPackage,
): RecommendationRelationshipStatus {
  const raw = facts.user_context.declared.relationship.status?.trim().toLowerCase() || '';
  if (['single', 'single_now', 'unpartnered', '单身', '未婚'].includes(raw)) return 'single';
  if (['dating', 'in_relationship', 'partnered', '恋爱', '恋爱中', '有伴侣'].includes(raw)) return 'dating';
  if (['married', 'marriage', '已婚', '婚姻'].includes(raw)) return 'married';
  return 'unknown';
}

function readyResult(
  row: RecommendationBatchRow,
  nextBoundaryAt: string,
): RecommendationServiceResult {
  return {
    status: 'ready',
    batch: toBatch(row),
    generation_id: row.id,
    effective_date: row.effective_date,
    timezone: row.generation_timezone,
    next_boundary_at: nextBoundaryAt,
  };
}

function generatingResult(
  batchId: string | null,
  effectiveDate: string,
  timezone: string,
  nextBoundaryAt: string,
  retryAfterMs: number,
): RecommendationServiceResult {
  return {
    status: 'generating',
    generation_id: requireText(batchId, 'Recommendation join 缺少 batch id'),
    effective_date: effectiveDate,
    timezone,
    next_boundary_at: nextBoundaryAt,
    retry_after_ms: retryAfterMs,
  };
}

function retryWaitResult(
  batchId: string | null,
  effectiveDate: string,
  timezone: string,
  nextBoundaryAt: string,
  retryAfterMs: number,
  cause?: string,
): RecommendationServiceResult {
  return {
    status: 'retry_wait',
    generation_id: requireText(batchId, 'Recommendation retry wait 缺少 batch id'),
    effective_date: effectiveDate,
    timezone,
    next_boundary_at: nextBoundaryAt,
    retry_after_ms: retryAfterMs,
    ...(cause ? { cause } : {}),
  };
}

function unavailable(
  cause: string,
  retryable: boolean,
  generationId?: string,
  retryAfterMs?: number,
): RecommendationServiceResult {
  return {
    status: 'unavailable',
    cause,
    retryable,
    ...(generationId ? { generation_id: generationId } : {}),
    ...(retryAfterMs === undefined ? {} : { retry_after_ms: retryAfterMs }),
  };
}

function toBatch(row: RecommendationBatchRow): RecommendationBatch {
  if (!row.cards_json || !row.prompt_version || !row.taxonomy_version || !row.model_id) {
    throw new Error('READY 推荐批次缺少完整内容');
  }
  return {
    batch_id: row.id,
    status: 'ready',
    bazi_profile_id: row.profile_id,
    effective_date: row.effective_date,
    timezone: row.generation_timezone,
    after_batch_id: row.after_batch_id,
    deck_cards: row.cards_json.deck_cards,
    center_cards: row.cards_json.center_cards,
    prompt_version: row.prompt_version,
    taxonomy_version: row.taxonomy_version,
    model_id: row.model_id,
    created_at: row.created_at,
  };
}

async function requiredBatch(
  dependencies: RecommendationServiceDependencies,
  userId: string,
  batchId: string | null,
): Promise<RecommendationBatchRow> {
  const row = await dependencies.batches.findById(userId, requireText(batchId, 'Recommendation claim 缺少 batch id'));
  if (!row || row.status !== 'ready') {
    throw new Error('READY 推荐批次无法读取');
  }
  return row;
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

function validateResolveInput(userId: string, input: ResolveRecommendationsInput): void {
  if (!userId.trim()) throw new ValidationError('用户 ID 无效');
  if (!input.bazi_profile_id?.trim()) throw new ValidationError('bazi_profile_id 是必填字段');
  if (!input.session_id?.trim() || input.session_id.trim().length > 128) {
    throw new ValidationError('session_id 是必填字段且最长 128 个字符');
  }
  if (input.after_batch_id !== undefined && input.after_batch_id !== null && !input.after_batch_id.trim()) {
    throw new ValidationError('after_batch_id 无效');
  }
  validateTimeZone(input.timezone);
}

function validateEventInput(userId: string, input: RecordRecommendationEventInput): void {
  if (!userId.trim()) throw new ValidationError('用户 ID 无效');
  for (const [field, value] of Object.entries({
    event_id: input.event_id,
    batch_id: input.batch_id,
    candidate_id: input.candidate_id,
    session_id: input.session_id,
  })) {
    if (!value?.trim() || value.trim().length > 128) {
      throw new ValidationError(`${field} 是必填字段且最长 128 个字符`);
    }
  }
  if (input.event_type !== 'exposure' && input.event_type !== 'open') {
    throw new ValidationError('event_type 只能是 exposure 或 open');
  }
}

function validateTimeZone(timezone: string): void {
  if (!timezone?.trim()) throw new ValidationError('timezone 是必填字段');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new ValidationError('timezone 必须是有效的 IANA 时区');
  }
}

function isEffectiveDateCurrent(
  dependencies: RecommendationServiceDependencies,
  timezone: string,
  expectedDate: string,
): boolean {
  return resolveDailyFortuneDate(dependencies.now(), timezone).effectiveDate === expectedDate;
}

function validDateOr(value: unknown, ...fallbacks: Array<string | null | undefined>): string {
  if (typeof value === 'string' && isDate(value)) return value;
  for (const fallback of fallbacks) {
    if (typeof fallback === 'string' && isDate(fallback)) return fallback;
  }
  throw new DailyFortuneFactError('推荐事实缺少有效日期');
}

function validDateOrNull(value: unknown, fallback?: string | null): string | null {
  if (typeof value === 'string' && isDate(value)) return value;
  if (typeof fallback === 'string' && isDate(fallback)) return fallback;
  return null;
}

function previousCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return [
    previous.getUTCFullYear(),
    String(previous.getUTCMonth() + 1).padStart(2, '0'),
    String(previous.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function yearStart(year: unknown): string | null {
  return typeof year === 'number' && Number.isInteger(year) && year >= 1000 && year <= 9999
    ? `${year}-01-01`
    : null;
}

function yearEnd(year: unknown): string | null {
  return typeof year === 'number' && Number.isInteger(year) && year >= 1000 && year <= 9999
    ? `${year}-12-31`
    : null;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isFutureTimestamp(value: string, now: Date): boolean {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function requireText(value: string | null, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function readModelId(): string {
  return process.env.RECOMMENDATION_AI_MODEL?.trim()
    || process.env.DAILY_FORTUNE_AI_MODEL?.trim()
    || 'unconfigured';
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

function roundSignal(value: number): number {
  return Math.round(value * 1_000) / 1_000;
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
