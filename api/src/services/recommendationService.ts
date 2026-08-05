import { createHash } from 'node:crypto';
import {
  RecommendationAggregatedInterestSignal,
  RecommendationBatchRow,
  RecommendationPreferenceSnapshot,
  RecommendationRepository,
  recommendationRepository,
} from '../database/repositories/RecommendationRepository';
import {
  RECOMMENDATION_CANDIDATE_POOL_SIZE,
  RECOMMENDATION_CANDIDATE_POOL_VERSION,
  RECOMMENDATION_CONTRACT_VERSION,
  RECOMMENDATION_DISPLAY_CENTER_COUNT,
  RECOMMENDATION_DISPLAY_DECK_COUNT,
  RECOMMENDATION_ORCHESTRATOR_VERSION,
  RECOMMENDATION_PROMPT_VERSION,
  RECOMMENDATION_TAXONOMY_VERSION,
  RecommendationAiInput,
  RecommendationBatch,
  RecommendationBatchCards,
  RecommendationBatchResponse,
  RecommendationBehaviorEventType,
  RecommendationCandidate,
  JungianCognitiveFunction,
  RecommendationCandidatePool,
  RecommendationInterestSignal,
  RecommendationNextRequest,
  RecommendationNextResponse,
  RecommendationRelationshipStatus,
  RecommendationFactReference,
  RecommendationHardFactPackage,
  RecommendationPreferenceContext,
  RecommendationRealityContext,
  RecommendationSelectionContext,
  RecommendationTimeWindow,
} from '../models/Recommendation';
import { userRepository } from '../database/repositories/UserRepository';
import { getBaziDailyFortuneEngineBundle } from './baziService';
import {
  buildDailyFortuneFactPackage,
  DailyFortuneFactError,
  resolveDailyFortuneDate,
} from './dailyFortuneService';
import { DailyFortuneFactPackage } from '../models/DailyFortune';
import { BaziProfile } from '../models/BaziProfile';
import {
  DailyFortuneAiError,
} from '../utils/dailyFortuneAi';
import {
  generateRecommendationCandidatesWithAi,
} from '../utils/recommendationAi';
import { NotFoundError, ValidationError } from '../utils/errors';
import {
  buildRecommendationTimeWindows,
  projectRecommendationInteraction,
  projectRecommendationPillar,
  RecommendationTimeWindowBudgetError,
} from './recommendationTimeWindows';

const OUTPUT_SCHEMA_VERSION = 'recommendation_output_v3';
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
      | 'createPoolContinuation'
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
  // Generation is explicitly enabled per environment. Disabled means a clear
  // unavailable state; callers must not substitute mock or legacy content.
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

  const realityContext = buildRealityContext(facts);

  // This is the recommendation content identity for a profile, not merely its
  // updated_at timestamp. It changes when deterministic birth/chart facts or
  // the declared user context that AI can see changes, while harmless metadata
  // edits can reuse an equivalent same-day batch.
  const profileRevisionHash = sha256(canonicalJson({
    contract_version: RECOMMENDATION_CONTRACT_VERSION,
    prompt_version: RECOMMENDATION_PROMPT_VERSION,
    taxonomy_version: RECOMMENDATION_TAXONOMY_VERSION,
    profile: profileRevisionPayload(bundle.profile),
    reality_context: realityContext,
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
  const [afterBatch, preferenceSnapshot] = await Promise.all([
    activeAfterBatch(
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
  const afterBatchId = afterBatch?.id ?? null;

  if (afterBatch?.output_schema_version === OUTPUT_SCHEMA_VERSION) {
    let continuationState: RecommendationPoolContinuationState;
    try {
      continuationState = await loadPoolContinuationState(
        dependencies,
        userId,
        afterBatch,
      );
    } catch {
      return unavailable('CANDIDATE_POOL_INVALID', false, afterBatch.id);
    }
    const continuationCards = selectPoolContinuationCards(
      continuationState.root,
      continuationState.consumedCandidateIds,
      preferenceSnapshot,
    );
    if (continuationCards) {
      const continuationId = await dependencies.batches.createPoolContinuation({
        userId,
        parentBatchId: afterBatch.id,
        rootBatchId: continuationState.root.id,
        cards: continuationCards,
        selectionContext: buildSelectionContext(preferenceSnapshot, 'pool_continuation'),
      });
      const continuation = await requiredBatch(dependencies, userId, continuationId);
      if (!isEffectiveDateCurrent(dependencies, input.timezone, dateContext.effectiveDate)) {
        return unavailable('DATE_ROLLED_OVER', true);
      }
      return readyResult(continuation, dateContext.nextBoundaryAt);
    }
  }

  let timeWindows: RecommendationTimeWindow[];
  try {
    // The complete timeline stays server-side. Only the bounded current,
    // near-term, parent, and one freshness-aware exploration window enter this
    // AI call; the selector itself contains no astrology importance rules.
    timeWindows = buildRecommendationTimeWindows({
      profile: bundle.profile,
      currentFacts: facts,
      timeWindowHistory: preferenceSnapshot.time_window_history,
    });
  } catch (error) {
    if (error instanceof RecommendationTimeWindowBudgetError) {
      return unavailable('TIME_WINDOW_BUDGET_EXCEEDED', false);
    }
    throw error;
  }

  const aiInput = buildRecommendationAiInput({
    facts,
    effectiveDate: dateContext.effectiveDate,
    timezone: input.timezone,
    timeWindows,
    realityContext,
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
    // This limits new recommendation batch rows. V2 pool continuations also
    // count toward this conservative per-user abuse limit, although only AI
    // roots reserve provider-attempt cost. It never judges card semantics.
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
  let generatedPool;
  try {
    generatedPool = await dependencies.generateCandidates(aiInput);
  } catch (error) {
    const failure = classifyAiFailure(error);
    if (process.env.NODE_ENV === 'production' && error instanceof DailyFortuneAiError) {
      console.warn('[recommendations] AI generation rejected', {
        code: error.code,
        provider_status: error.providerStatus ?? null,
        finish_reason: error.finishReason ?? null,
        provider_detail: error.providerDetail ?? null,
        error_detail: error.message.replace(/\s+/g, ' ').slice(0, 500),
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

  const candidatePool: RecommendationCandidatePool = {
    pool_version: RECOMMENDATION_CANDIDATE_POOL_VERSION,
    candidates: generatedPool.candidates,
  };
  const cards = selectDisplayCards(
    candidatePool.candidates,
    preferenceSnapshot,
    'ai_generation',
  );

  const finalized = await dependencies.batches.finalize({
    batchId,
    userId,
    leaseToken,
    leaseEpoch: claim.leaseEpoch,
    inputSnapshot: aiInput,
    cards,
    candidatePool,
    selectionContext: buildSelectionContext(preferenceSnapshot, 'ai_generation'),
    generationMetrics: generatedPool.generation_metrics,
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

async function activeAfterBatch(
  dependencies: RecommendationServiceDependencies,
  userId: string,
  profileId: string,
  requestedBatchId: string | null,
  effectiveDate: string,
  profileRevisionHash: string,
  timezone: string,
): Promise<RecommendationBatchRow | null> {
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
  return prior;
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
  timeWindows: RecommendationTimeWindow[];
  realityContext: RecommendationRealityContext;
  preferenceSnapshot: RecommendationPreferenceSnapshot;
}): RecommendationAiInput {
  const hardFacts = projectRecommendationHardFacts(input.facts);
  const availableFactRefs = [
    ...buildNatalFactReferences(hardFacts),
    ...input.timeWindows.flatMap(buildTimeWindowFactReferences),
  ];
  return {
    contract_version: RECOMMENDATION_CONTRACT_VERSION,
    taxonomy_version: RECOMMENDATION_TAXONOMY_VERSION,
    effective_date: input.effectiveDate,
    timezone: input.timezone,
    fortune_facts: hardFacts,
    time_windows: input.timeWindows,
    available_fact_refs: availableFactRefs,
    reality_context: input.realityContext,
    preference_context: buildPreferenceContext(input.preferenceSnapshot),
    content_history: input.preferenceSnapshot.content_history,
    time_window_history: input.preferenceSnapshot.time_window_history.filter((item) => (
      input.timeWindows.some((window) => window.window_key === item.window_key)
    )),
  };
}

function buildNatalFactReferences(
  facts: RecommendationHardFactPackage,
): RecommendationFactReference[] {
  return [
    ...facts.natal.pillars.map((pillar) => ({
      ref: `natal:pillar:${pillar.position}`,
      valid_from: facts.profile.birth_date,
      valid_until: null,
    })),
    ...facts.mingli_interactions.natal.map((interaction) => ({
      ref: `natal:interaction:${interaction.id}`,
      valid_from: facts.profile.birth_date,
      valid_until: null,
    })),
  ];
}

function buildTimeWindowFactReferences(
  window: RecommendationTimeWindow,
): RecommendationFactReference[] {
  const validity = {
    valid_from: window.target_window.valid_from,
    valid_until: window.target_window.valid_until,
  };
  return [
    {
      ref: `time:${window.window_key}:timing`,
      ...validity,
    },
    ...window.interactions.map((interaction) => ({
      ref: `time:${window.window_key}:interaction:${interaction.id}`,
      ...validity,
    })),
  ];
}

function projectRecommendationHardFacts(
  facts: DailyFortuneFactPackage,
): RecommendationHardFactPackage {
  return {
    contract_version: facts.contract_version,
    effective_date: facts.effective_date,
    timezone: facts.timezone,
    day_boundary: facts.day_boundary,
    profile: facts.profile,
    natal: {
      pillars: facts.natal.pillars.map(projectRecommendationPillar),
      day_master: facts.natal.day_master,
    },
    mingli_interactions: {
      rule_version: facts.mingli_interactions.rule_version,
      natal: facts.mingli_interactions.natal.map(projectRecommendationInteraction),
    },
  };
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

function buildPreferenceContext(
  snapshot: RecommendationPreferenceSnapshot,
): RecommendationPreferenceContext {
  return {
    recent_14d: addSmoothedOpenRates(snapshot.recent_14d),
    long_term_90d: addSmoothedOpenRates(snapshot.long_term_90d),
    current_session_opens: snapshot.current_session_opens.map((open) => ({
      ...open,
      primary_time_window_key: open.primary_time_window_key ?? null,
      referenced_window_keys: open.referenced_window_keys || [],
    })),
  };
}

function buildSelectionContext(
  snapshot: RecommendationPreferenceSnapshot,
  source: RecommendationSelectionContext['source'],
): RecommendationSelectionContext {
  return {
    orchestrator_version: RECOMMENDATION_ORCHESTRATOR_VERSION,
    source,
    preference_context: buildPreferenceContext(snapshot),
  };
}

interface RecommendationPoolContinuationState {
  root: RecommendationBatchRow;
  consumedCandidateIds: Set<string>;
}

async function loadPoolContinuationState(
  dependencies: RecommendationServiceDependencies,
  userId: string,
  afterBatch: RecommendationBatchRow,
): Promise<RecommendationPoolContinuationState> {
  const chain: RecommendationBatchRow[] = [afterBatch];
  let current = afterBatch;

  while (current.generation_kind === 'pool') {
    if (!current.after_batch_id || chain.length >= 3) {
      throw new Error('候选池展示链无效');
    }
    const parent = await dependencies.batches.findById(userId, current.after_batch_id);
    if (
      !parent
      || parent.status !== 'ready'
      || parent.profile_id !== afterBatch.profile_id
      || parent.profile_revision_hash !== afterBatch.profile_revision_hash
      || parent.effective_date !== afterBatch.effective_date
      || parent.generation_timezone !== afterBatch.generation_timezone
      || parent.output_schema_version !== OUTPUT_SCHEMA_VERSION
      || !isFutureTimestamp(parent.valid_until, dependencies.now())
    ) {
      throw new Error('候选池展示链父批次无效');
    }
    chain.push(parent);
    current = parent;
  }

  const root = current;
  if (
    root.generation_kind !== 'ai'
    || !root.candidate_pool_json
    || root.candidate_pool_json.pool_version !== RECOMMENDATION_CANDIDATE_POOL_VERSION
    || root.candidate_pool_json.candidates.length !== RECOMMENDATION_CANDIDATE_POOL_SIZE
    || chain.some((batch) => (
      batch.generation_kind === 'pool' && batch.pool_source_batch_id !== root.id
    ))
  ) {
    throw new Error('候选池根批次无效');
  }

  const poolIds = new Set(
    root.candidate_pool_json.candidates.map((candidate) => candidate.candidate_id),
  );
  if (poolIds.size !== RECOMMENDATION_CANDIDATE_POOL_SIZE) {
    throw new Error('候选池 candidate_id 不唯一');
  }

  const consumedCandidateIds = new Set<string>();
  chain.forEach((batch) => {
    if (
      !batch.cards_json
      || batch.cards_json.deck_cards.length !== RECOMMENDATION_DISPLAY_DECK_COUNT
      || batch.cards_json.center_cards.length !== RECOMMENDATION_DISPLAY_CENTER_COUNT
      || batch.cards_json.deck_cards.some((candidate) => candidate.surface !== 'deck')
    ) {
      throw new Error('候选池展示批次形状无效');
    }
    batch.cards_json.deck_cards.forEach((candidate) => {
      if (!poolIds.has(candidate.candidate_id) || consumedCandidateIds.has(candidate.candidate_id)) {
        throw new Error('候选池展示批次包含无效或重复卡片');
      }
      consumedCandidateIds.add(candidate.candidate_id);
    });
  });

  return { root, consumedCandidateIds };
}

function selectPoolContinuationCards(
  root: RecommendationBatchRow,
  consumedCandidateIds: Set<string>,
  preferenceSnapshot: RecommendationPreferenceSnapshot,
): RecommendationBatchCards | null {
  const pool = root.candidate_pool_json;
  if (
    !pool
    || pool.pool_version !== RECOMMENDATION_CANDIDATE_POOL_VERSION
    || pool.candidates.length !== RECOMMENDATION_CANDIDATE_POOL_SIZE
  ) {
    throw new Error('候选池续批缺少完整来源');
  }

  const poolIds = new Set(pool.candidates.map((candidate) => candidate.candidate_id));
  if (poolIds.size !== RECOMMENDATION_CANDIDATE_POOL_SIZE) {
    throw new Error('候选池 candidate_id 不唯一');
  }
  const expectedDisplayCount = RECOMMENDATION_DISPLAY_DECK_COUNT
    + RECOMMENDATION_DISPLAY_CENTER_COUNT;
  if (
    ![expectedDisplayCount, expectedDisplayCount * 2, expectedDisplayCount * 3]
      .includes(consumedCandidateIds.size)
    || [...consumedCandidateIds].some((candidateId) => !poolIds.has(candidateId))
  ) {
    throw new Error('候选池已展示数量无效');
  }

  const remaining = pool.candidates.filter(
    (candidate) => !consumedCandidateIds.has(candidate.candidate_id),
  );
  if (remaining.length === 0) return null;
  if (remaining.length < expectedDisplayCount) {
    throw new Error('候选池剩余数量无效');
  }
  return selectDisplayCards(remaining, preferenceSnapshot, 'pool_continuation');
}

function selectDisplayCards(
  candidates: RecommendationCandidate[],
  preferenceSnapshot: RecommendationPreferenceSnapshot,
  source: RecommendationSelectionContext['source'],
): RecommendationBatchCards {
  const requiredCount = RECOMMENDATION_DISPLAY_DECK_COUNT
    + RECOMMENDATION_DISPLAY_CENTER_COUNT;
  if (candidates.length < requiredCount) {
    throw new Error('展示编排缺少足够候选卡');
  }

  const ranked = source === 'pool_continuation'
    ? [...candidates].sort((left, right) => {
      const roleDifference = selectionRolePriority(left.selection_role)
        - selectionRolePriority(right.selection_role);
      if (roleDifference !== 0) return roleDifference;
      const affinityDifference = currentSessionAffinity(
        right,
        preferenceSnapshot.current_session_opens,
      ) - currentSessionAffinity(left, preferenceSnapshot.current_session_opens);
      return affinityDifference || left.pool_position - right.pool_position;
    })
    : [...candidates].sort((left, right) => left.pool_position - right.pool_position);
  const selected = ranked.slice(0, requiredCount);
  if (selected.length !== RECOMMENDATION_DISPLAY_DECK_COUNT) {
    throw new Error('展示面分配数量无效');
  }

  return {
    deck_cards: selected.map((candidate, position) => ({
      ...candidate,
      position,
      surface: 'deck',
    })),
    center_cards: [],
  };
}

function selectionRolePriority(
  role: RecommendationCandidate['selection_role'],
): number {
  const priorities: Record<RecommendationCandidate['selection_role'], number> = {
    p1_mingli_change: 0,
    p2_interest_match: 1,
    p2_baseline: 2,
    p3_diversity: 3,
  };
  return priorities[role];
}

function currentSessionAffinity(
  candidate: RecommendationCandidate,
  opens: RecommendationPreferenceSnapshot['current_session_opens'],
): number {
  return opens.reduce((score, open) => {
    const opened = open.content_profile;
    return score
      + (opened.topic_key === candidate.content_profile.topic_key ? 8 : 0)
      + (opened.domain === candidate.content_profile.domain ? 4 : 0)
      + (opened.question_job === candidate.content_profile.question_job ? 2 : 0)
      + (opened.content_horizon === candidate.content_profile.content_horizon ? 1 : 0);
  }, 0);
}

function normalizeRelationshipStatus(
  facts: DailyFortuneFactPackage,
): RecommendationRelationshipStatus {
  const raw = facts.user_context.declared.relationship.status?.trim().toLowerCase() || '';
  // "未婚" is marital status, not proof that the user currently has no
  // partner. Only an explicit present-tense relationship statement is safe.
  if (['single', 'single_now', 'unpartnered', '单身'].includes(raw)) return 'single';
  if (['dating', 'in_relationship', 'partnered', 'getting_to_know', '暧昧了解中', '恋爱', '恋爱中', '有伴侣'].includes(raw)) return 'dating';
  if (['married', 'marriage', 'stable_or_married', '已婚', '婚姻', '已婚或稳定关系'].includes(raw)) return 'married';
  return 'unknown';
}

const JUNGIAN_FUNCTION_ORDER: Record<string, JungianCognitiveFunction[]> = {
  INTJ: ['Ni', 'Te', 'Fi', 'Se', 'Ne', 'Ti', 'Fe', 'Si'],
  INFJ: ['Ni', 'Fe', 'Ti', 'Se', 'Ne', 'Fi', 'Te', 'Si'],
  INTP: ['Ti', 'Ne', 'Si', 'Fe', 'Te', 'Ni', 'Se', 'Fi'],
  INFP: ['Fi', 'Ne', 'Si', 'Te', 'Fe', 'Ni', 'Se', 'Ti'],
  ISTJ: ['Si', 'Te', 'Fi', 'Ne', 'Se', 'Ti', 'Fe', 'Ni'],
  ISFJ: ['Si', 'Fe', 'Ti', 'Ne', 'Se', 'Fi', 'Te', 'Ni'],
  ISTP: ['Ti', 'Se', 'Ni', 'Fe', 'Te', 'Si', 'Ne', 'Fi'],
  ISFP: ['Fi', 'Se', 'Ni', 'Te', 'Fe', 'Si', 'Ne', 'Ti'],
  ENTJ: ['Te', 'Ni', 'Se', 'Fi', 'Ti', 'Ne', 'Si', 'Fe'],
  ENFJ: ['Fe', 'Ni', 'Se', 'Ti', 'Fi', 'Ne', 'Si', 'Te'],
  ENTP: ['Ne', 'Ti', 'Fe', 'Si', 'Ni', 'Te', 'Fi', 'Se'],
  ENFP: ['Ne', 'Fi', 'Te', 'Si', 'Ni', 'Fe', 'Ti', 'Se'],
  ESTJ: ['Te', 'Si', 'Ne', 'Fi', 'Ti', 'Se', 'Ni', 'Fe'],
  ESFJ: ['Fe', 'Si', 'Ne', 'Ti', 'Fi', 'Se', 'Ni', 'Te'],
  ESTP: ['Se', 'Ti', 'Fe', 'Ni', 'Si', 'Te', 'Fi', 'Ne'],
  ESFP: ['Se', 'Fi', 'Te', 'Ni', 'Si', 'Fe', 'Ti', 'Ne'],
};

function buildPersonalityContext(mbti: string | null) {
  const normalized = mbti?.trim().toUpperCase() || '';
  const functionOrder = JUNGIAN_FUNCTION_ORDER[normalized];
  return {
    mbti: functionOrder ? normalized : null,
    jungian_function_order: functionOrder ? [...functionOrder] : [],
  };
}

function buildRealityContext(
  facts: DailyFortuneFactPackage,
): RecommendationRealityContext {
  const declared = facts.user_context.declared;
  const understanding = facts.user_context.zhizhi_understanding;
  return {
    personality: buildPersonalityContext(declared.mbti),
    life_stage: declared.life_stage,
    work_study: declared.work_study,
    relationship: {
      status: normalizeRelationshipStatus(facts),
      declared_status: declared.relationship.status,
      current_focus: declared.relationship.current_focus,
    },
    saved_understanding: {
      snapshot_version: understanding.snapshot_version,
      current_focus: understanding.current_focus,
      expression_preferences: understanding.expression_preferences,
      behavior_signals: understanding.behavior_signals,
      updated_at: understanding.updated_at,
    },
  };
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
