import { supabase } from '../supabase';
import type {
  RecommendationAiInput,
  RecommendationAiOutput,
  RecommendationBehaviorEventType,
  RecommendationContentHistoryItem,
  RecommendationContentHorizon,
  RecommendationDomain,
  RecommendationPreferenceDimension,
  RecommendationQuestionJob,
  RecommendationSessionOpen,
  RecommendationSurface,
  RecommendationTopicKey,
} from '../../models/Recommendation';

export type RecommendationBatchStatus = 'generating' | 'retry_wait' | 'ready';

export type RecommendationClaimOutcome =
  | 'owner'
  | 'owner_takeover'
  | 'ready'
  | 'join'
  | 'wait'
  | 'busy'
  | 'daily_limit'
  | 'attempt_limit'
  | 'global_limit';

export interface RecommendationBatchRow {
  id: string;
  generation_key: string;
  user_id: string;
  profile_id: string;
  after_batch_id: string | null;
  effective_date: string;
  profile_revision_hash: string;
  profile_updated_at: string;
  generation_timezone: string;
  input_hash: string;
  valid_until: string;
  status: RecommendationBatchStatus;
  lease_token: string | null;
  lease_epoch: number;
  lease_expires_at: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  input_snapshot_json: RecommendationAiInput | null;
  cards_json: RecommendationAiOutput | null;
  prompt_version: string | null;
  output_schema_version: string | null;
  taxonomy_version: string | null;
  model_id: string | null;
  created_at: string;
  ready_at: string | null;
}

export interface ClaimRecommendationBatchInput {
  generationKey: string;
  userId: string;
  profileId: string;
  afterBatchId: string | null;
  effectiveDate: string;
  profileRevisionHash: string;
  profileUpdatedAt: string;
  generationTimezone: string;
  inputHash: string;
  validUntil: string;
  leaseTtlSeconds?: number;
  maxActiveGenerations?: number;
  maxNewBatchesPer24Hours?: number;
  maxAttemptsPerBatch?: number;
  maxProviderAttemptsGlobalPer24Hours?: number;
}

export interface RecommendationClaimResult {
  outcome: RecommendationClaimOutcome;
  batchId: string | null;
  status: RecommendationBatchStatus | null;
  leaseToken: string | null;
  leaseEpoch: number;
  leaseExpiresAt: string | null;
  nextAttemptAt: string | null;
}

export interface FinalizeRecommendationBatchInput {
  batchId: string;
  userId: string;
  leaseToken: string;
  leaseEpoch: number;
  inputSnapshot: RecommendationAiInput;
  cards: RecommendationAiOutput;
  promptVersion: string;
  outputSchemaVersion: string;
  taxonomyVersion: string;
  modelId: string;
}

export interface MarkRecommendationBatchRetryWaitInput {
  batchId: string;
  userId: string;
  leaseToken: string;
  leaseEpoch: number;
  retryAfterSeconds: number;
}

export interface ReleaseRecommendationBatchGenerationInput {
  batchId: string;
  userId: string;
  leaseToken: string;
  leaseEpoch: number;
}

/**
 * Counts are aggregated by PostgreSQL across the full fixed time window.
 * The service adds the derived smoothed_open_rate before this enters the AI
 * contract, so the database stays a factual aggregation boundary only.
 */
export interface RecommendationAggregatedInterestSignal {
  dimension: RecommendationPreferenceDimension;
  key: string;
  exposures: number;
  opens: number;
}

export interface RecommendationPreferenceSnapshot {
  recent_14d: RecommendationAggregatedInterestSignal[];
  long_term_90d: RecommendationAggregatedInterestSignal[];
  current_session_opens: RecommendationSessionOpen[];
  content_history: RecommendationContentHistoryItem[];
}

export interface GetRecommendationPreferenceSnapshotInput {
  userId: string;
  profileId: string;
  sessionId: string;
  now: string;
}

export interface RecordRecommendationEventInput {
  eventId: string;
  userId: string;
  batchId: string;
  sessionId: string;
  candidateId: string;
  eventType: RecommendationBehaviorEventType;
}

export type RecommendationRecordEventResult = 'recorded' | 'duplicate';

interface ClaimRpcRow {
  claim_outcome: RecommendationClaimOutcome;
  batch_id: string | null;
  batch_status: RecommendationBatchStatus | null;
  claim_lease_token: string | null;
  claim_lease_epoch: number | string;
  claim_lease_expires_at: string | null;
  claim_next_attempt_at: string | null;
}

const BATCH_COLUMNS = [
  'id',
  'generation_key',
  'user_id',
  'profile_id',
  'after_batch_id',
  'effective_date',
  'profile_revision_hash',
  'profile_updated_at',
  'generation_timezone',
  'input_hash',
  'valid_until',
  'status',
  'lease_token',
  'lease_epoch',
  'lease_expires_at',
  'attempt_count',
  'next_attempt_at',
  'input_snapshot_json',
  'cards_json',
  'prompt_version',
  'output_schema_version',
  'taxonomy_version',
  'model_id',
  'created_at',
  'ready_at',
].join(',');

const CLAIM_OUTCOMES = new Set<RecommendationClaimOutcome>([
  'owner',
  'owner_takeover',
  'ready',
  'join',
  'wait',
  'busy',
  'daily_limit',
  'attempt_limit',
  'global_limit',
]);

const EVENT_RESULTS = new Set<RecommendationRecordEventResult>([
  'recorded',
  'duplicate',
]);

export class RecommendationRepositoryError extends Error {
  constructor(
    public readonly operation: string,
    message: string,
    public readonly databaseCode?: string,
  ) {
    super(message);
    this.name = 'RecommendationRepositoryError';
  }
}

/**
 * Recommendation V1 persistence boundary.
 *
 * The repository intentionally has no method that writes an event directly.
 * `recordEvent` calls the database RPC, which reads the immutable card JSON and
 * derives all learnable labels itself.
 */
export class RecommendationRepository {
  async claim(input: ClaimRecommendationBatchInput): Promise<RecommendationClaimResult> {
    // A valid Gemini request may take up to 100 seconds, and finalization still
    // needs a small database window. Never use the old 45-second default here:
    // it permits a second worker to take over a healthy in-flight generation.
    const leaseTtlSeconds = input.leaseTtlSeconds
      ?? configuredBoundedInt('RECOMMENDATION_GENERATION_LEASE_TTL_SECONDS', 150, 130, 300);
    const maxActiveGenerations = input.maxActiveGenerations
      ?? configuredBoundedInt('RECOMMENDATION_MAX_ACTIVE_GENERATIONS', 20, 1, 10_000);
    const maxNewBatchesPer24Hours = input.maxNewBatchesPer24Hours
      ?? configuredBoundedInt('RECOMMENDATION_MAX_NEW_BATCHES_PER_24H', 6, 1, 50);
    const maxAttemptsPerBatch = input.maxAttemptsPerBatch
      ?? configuredBoundedInt('RECOMMENDATION_MAX_ATTEMPTS_PER_BATCH', 3, 1, 10);
    const maxProviderAttemptsGlobalPer24Hours = input.maxProviderAttemptsGlobalPer24Hours
      ?? configuredBoundedInt('RECOMMENDATION_MAX_PROVIDER_ATTEMPTS_GLOBAL_PER_24H', 100, 1, 1_000_000);

    const { data, error } = await supabase.rpc('claim_recommendation_batch', {
      p_generation_key: input.generationKey,
      p_user_id: input.userId,
      p_profile_id: input.profileId,
      p_after_batch_id: input.afterBatchId,
      p_effective_date: input.effectiveDate,
      p_profile_revision_hash: input.profileRevisionHash,
      p_profile_updated_at: input.profileUpdatedAt,
      p_generation_timezone: input.generationTimezone,
      p_input_hash: input.inputHash,
      p_valid_until: input.validUntil,
      p_lease_ttl_seconds: leaseTtlSeconds,
      p_max_active_generations: maxActiveGenerations,
      p_max_new_batches_per_24h: maxNewBatchesPer24Hours,
      p_max_attempts_per_batch: maxAttemptsPerBatch,
      p_max_provider_attempts_global_per_24h: maxProviderAttemptsGlobalPer24Hours,
    });

    if (error) {
      throw repositoryError('claim', error);
    }

    const row = firstRpcRow<ClaimRpcRow>(data);
    if (!row || !CLAIM_OUTCOMES.has(row.claim_outcome)) {
      throw new RecommendationRepositoryError(
        'claim',
        '推荐批次 claim RPC 返回了无效结果',
      );
    }

    const leaseEpoch = Number(row.claim_lease_epoch);
    if (!Number.isSafeInteger(leaseEpoch) || leaseEpoch < 0) {
      throw new RecommendationRepositoryError(
        'claim',
        '推荐批次 claim RPC 返回了无效 lease epoch',
      );
    }

    if (
      (row.claim_outcome === 'owner' || row.claim_outcome === 'owner_takeover')
      && (!row.batch_id || !row.claim_lease_token)
    ) {
      throw new RecommendationRepositoryError(
        'claim',
        '推荐批次 owner claim 缺少 batch 或 lease token',
      );
    }

    return {
      outcome: row.claim_outcome,
      batchId: row.batch_id,
      status: row.batch_status,
      leaseToken: row.claim_lease_token,
      leaseEpoch,
      leaseExpiresAt: row.claim_lease_expires_at,
      nextAttemptAt: row.claim_next_attempt_at,
    };
  }

  async findById(userId: string, batchId: string): Promise<RecommendationBatchRow | null> {
    const { data, error } = await supabase
      .from('recommendation_batches')
      .select(BATCH_COLUMNS)
      .eq('user_id', userId)
      .eq('id', batchId)
      .maybeSingle();

    if (error) {
      throw repositoryError('findById', error);
    }

    return data ? toBatchRow(data as unknown as Record<string, unknown>) : null;
  }

  async findReadyByGenerationKey(
    userId: string,
    generationKey: string,
  ): Promise<RecommendationBatchRow | null> {
    const { data, error } = await supabase
      .from('recommendation_batches')
      .select(BATCH_COLUMNS)
      .eq('user_id', userId)
      .eq('generation_key', generationKey)
      .eq('status', 'ready')
      .maybeSingle();

    if (error) {
      throw repositoryError('findReadyByGenerationKey', error);
    }

    return data ? toBatchRow(data as unknown as Record<string, unknown>) : null;
  }

  async findLatestReadyForProfile(input: {
    userId: string;
    profileId: string;
    effectiveDate: string;
    generationTimezone: string;
  }): Promise<RecommendationBatchRow | null> {
    const { data, error } = await supabase
      .from('recommendation_batches')
      .select(BATCH_COLUMNS)
      .eq('user_id', input.userId)
      .eq('profile_id', input.profileId)
      .eq('effective_date', input.effectiveDate)
      .eq('generation_timezone', input.generationTimezone)
      .eq('status', 'ready')
      .order('ready_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw repositoryError('findLatestReadyForProfile', error);
    }

    return data ? toBatchRow(data as unknown as Record<string, unknown>) : null;
  }

  async finalize(input: FinalizeRecommendationBatchInput): Promise<boolean> {
    const { data, error } = await supabase.rpc('finalize_recommendation_batch', {
      p_batch_id: input.batchId,
      p_user_id: input.userId,
      p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch,
      p_input_snapshot_json: input.inputSnapshot,
      p_cards_json: input.cards,
      p_prompt_version: input.promptVersion,
      p_output_schema_version: input.outputSchemaVersion,
      p_taxonomy_version: input.taxonomyVersion,
      p_model_id: input.modelId,
    });

    if (error) {
      throw repositoryError('finalize', error);
    }

    return data === true;
  }

  async markRetryWait(input: MarkRecommendationBatchRetryWaitInput): Promise<boolean> {
    const { data, error } = await supabase.rpc('mark_recommendation_batch_retry_wait', {
      p_batch_id: input.batchId,
      p_user_id: input.userId,
      p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch,
      p_retry_after_seconds: input.retryAfterSeconds,
    });

    if (error) {
      throw repositoryError('markRetryWait', error);
    }

    return data === true;
  }

  async release(input: ReleaseRecommendationBatchGenerationInput): Promise<boolean> {
    const { data, error } = await supabase.rpc('release_recommendation_batch_generation', {
      p_batch_id: input.batchId,
      p_user_id: input.userId,
      p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch,
    });

    if (error) {
      throw repositoryError('release', error);
    }

    return data === true;
  }

  /**
   * Returns bounded AI-memory inputs without paging raw behavior events. The
   * RPC owner-scopes the profile and aggregates the complete 14/90-day ranges,
   * so a highly active user's older in-window opens are not silently dropped.
   */
  async getPreferenceSnapshot(
    input: GetRecommendationPreferenceSnapshotInput,
  ): Promise<RecommendationPreferenceSnapshot> {
    const { data, error } = await supabase.rpc('get_recommendation_preference_snapshot', {
      p_user_id: input.userId,
      p_profile_id: input.profileId,
      p_session_id: input.sessionId,
      p_now: input.now,
    });

    if (error) {
      throw repositoryError('getPreferenceSnapshot', error);
    }

    return toPreferenceSnapshot(data);
  }

  async recordEvent(
    input: RecordRecommendationEventInput,
  ): Promise<RecommendationRecordEventResult> {
    const { data, error } = await supabase.rpc('record_recommendation_event', {
      p_event_id: input.eventId,
      p_user_id: input.userId,
      p_batch_id: input.batchId,
      p_session_id: input.sessionId,
      p_candidate_id: input.candidateId,
      p_event_type: input.eventType,
    });

    if (error) {
      throw repositoryError('recordEvent', error);
    }

    if (typeof data !== 'string' || !EVENT_RESULTS.has(data as RecommendationRecordEventResult)) {
      throw new RecommendationRepositoryError(
        'recordEvent',
        '推荐行为 RPC 返回了无效结果',
      );
    }

    return data as RecommendationRecordEventResult;
  }
}

function firstRpcRow<T>(data: unknown): T | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  return data[0] as T;
}

function toBatchRow(data: Record<string, unknown>): RecommendationBatchRow {
  const leaseEpoch = Number(data.lease_epoch);
  const attemptCount = Number(data.attempt_count);
  if (!Number.isSafeInteger(leaseEpoch) || leaseEpoch < 1
    || !Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new RecommendationRepositoryError(
      'decode',
      '推荐批次的计数字段无效',
    );
  }
  return {
    ...(data as unknown as RecommendationBatchRow),
    lease_epoch: leaseEpoch,
    attempt_count: attemptCount,
  };
}

const PREFERENCE_DIMENSIONS = new Set<RecommendationPreferenceDimension>([
  'domain',
  'topic_key',
  'question_job',
  'content_horizon',
]);

function toPreferenceSnapshot(data: unknown): RecommendationPreferenceSnapshot {
  const root = requiredRecord(data, '推荐偏好聚合结果');
  return {
    recent_14d: requiredArray(root.recent_14d, 'recent_14d', 40)
      .map((value, index) => toAggregatedInterestSignal(value, `recent_14d[${index}]`)),
    long_term_90d: requiredArray(root.long_term_90d, 'long_term_90d', 40)
      .map((value, index) => toAggregatedInterestSignal(value, `long_term_90d[${index}]`)),
    current_session_opens: requiredArray(root.current_session_opens, 'current_session_opens', 20)
      .map((value, index) => toSessionOpen(value, `current_session_opens[${index}]`)),
    content_history: requiredArray(root.content_history, 'content_history', 60)
      .map((value, index) => toContentHistory(value, `content_history[${index}]`)),
  };
}

function toAggregatedInterestSignal(
  value: unknown,
  path: string,
): RecommendationAggregatedInterestSignal {
  const row = requiredRecord(value, path);
  const dimension = requiredText(row.dimension, `${path}.dimension`, 64);
  if (!PREFERENCE_DIMENSIONS.has(dimension as RecommendationPreferenceDimension)) {
    throw new RecommendationRepositoryError('decode', `${path}.dimension 无效`);
  }
  return {
    dimension: dimension as RecommendationPreferenceDimension,
    key: requiredText(row.key, `${path}.key`, 128),
    exposures: requiredNonNegativeNumber(row.exposures, `${path}.exposures`),
    opens: requiredNonNegativeNumber(row.opens, `${path}.opens`),
  };
}

function toSessionOpen(value: unknown, path: string): RecommendationSessionOpen {
  const row = requiredRecord(value, path);
  const profile = requiredRecord(row.content_profile, `${path}.content_profile`);
  return {
    candidate_id: requiredText(row.candidate_id, `${path}.candidate_id`, 128),
    content_profile: {
      domain: requiredText(profile.domain, `${path}.content_profile.domain`, 128) as RecommendationDomain,
      topic_key: requiredText(profile.topic_key, `${path}.content_profile.topic_key`, 128) as RecommendationTopicKey,
      question_job: requiredText(profile.question_job, `${path}.content_profile.question_job`, 128) as RecommendationQuestionJob,
      content_horizon: requiredText(profile.content_horizon, `${path}.content_profile.content_horizon`, 128) as RecommendationContentHorizon,
    },
    opened_at: requiredText(row.opened_at, `${path}.opened_at`, 64),
  };
}

function toContentHistory(value: unknown, path: string): RecommendationContentHistoryItem {
  const row = requiredRecord(value, path);
  if (typeof row.exposed !== 'boolean' || typeof row.opened !== 'boolean') {
    throw new RecommendationRepositoryError('decode', `${path} 的打开/展示标记无效`);
  }
  const surface = requiredText(row.surface, `${path}.surface`, 16);
  if (surface !== 'deck' && surface !== 'center') {
    throw new RecommendationRepositoryError('decode', `${path}.surface 无效`);
  }
  return {
    semantic_key: requiredText(row.semantic_key, `${path}.semantic_key`, 256),
    surface: surface as RecommendationSurface,
    exposed: row.exposed,
    opened: row.opened,
    last_seen_at: requiredText(row.last_seen_at, `${path}.last_seen_at`, 64),
  };
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RecommendationRepositoryError('decode', `${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new RecommendationRepositoryError('decode', `${path} 必须是最多 ${maximum} 项的数组`);
  }
  return value;
}

function requiredText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new RecommendationRepositoryError('decode', `${path} 必须是非空文本`);
  }
  return value;
}

function requiredNonNegativeNumber(value: unknown, path: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new RecommendationRepositoryError('decode', `${path} 必须是非负数字`);
  }
  return number;
}

function configuredBoundedInt(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RecommendationRepositoryError(
      'configuration',
      `${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`,
    );
  }
  return parsed;
}

function repositoryError(operation: string, error: { message: string; code?: string }): Error {
  return new RecommendationRepositoryError(
    operation,
    `推荐引擎 ${operation} 失败: ${error.message}`,
    error.code,
  );
}

export const recommendationRepository = new RecommendationRepository();
