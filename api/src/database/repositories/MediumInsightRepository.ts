import { supabase } from '../supabase';
import {
  MediumInsightDomainCards,
  MediumInsightEventRequest,
  MediumInsightFactSnapshot,
  MediumInsightGenerationMetrics,
  MediumInsightGroundingContextSnapshot,
} from '../../models/MediumInsight';

export type MediumInsightClaimOutcome =
  | 'owner'
  | 'owner_takeover'
  | 'ready'
  | 'join'
  | 'wait'
  | 'failed'
  | 'busy'
  | 'fact_revision_exhausted';

export interface MediumInsightBatchRow {
  id: string;
  generation_key: string;
  user_id: string;
  profile_id: string;
  effective_date: string;
  batch_revision: number;
  supersedes_batch_id: string | null;
  generation_timezone: string;
  source_boundary_at: string;
  profile_updated_at: string;
  fact_hash: string;
  fact_snapshot_json: MediumInsightFactSnapshot;
  soft_context_snapshot_json: MediumInsightGroundingContextSnapshot;
  status: 'generating' | 'retry_wait' | 'ready' | 'failed';
  lease_token: string | null;
  lease_epoch: number;
  lease_expires_at: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  cards_json: { domains: MediumInsightDomainCards[] } | null;
  contract_version: string;
  fact_projection_version: string;
  context_projection_version: string;
  prompt_version: string | null;
  output_schema_version: string | null;
  generator_version: string;
  model_id: string | null;
  generation_metrics_json: MediumInsightGenerationMetrics | null;
  last_error_code: string | null;
  last_error_stage: string | null;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediumInsightClaimResult {
  outcome: MediumInsightClaimOutcome;
  batchId: string | null;
  status: MediumInsightBatchRow['status'] | null;
  effectiveDate: string;
  timezoneChangePending: boolean;
  leaseToken: string | null;
  leaseEpoch: number;
  leaseExpiresAt: string | null;
  nextAttemptAt: string | null;
}

interface ClaimRpcRow {
  claim_outcome: MediumInsightClaimOutcome;
  batch_id: string | null;
  batch_status: MediumInsightBatchRow['status'] | null;
  target_effective_date: string;
  timezone_change_pending: boolean;
  claim_lease_token: string | null;
  claim_lease_epoch: number | string;
  claim_lease_expires_at: string | null;
  claim_next_attempt_at: string | null;
}

const CLAIM_OUTCOMES = new Set<MediumInsightClaimOutcome>([
  'owner', 'owner_takeover', 'ready', 'join', 'wait', 'failed', 'busy', 'fact_revision_exhausted',
]);

const BATCH_COLUMNS = [
  'id', 'generation_key', 'user_id', 'profile_id', 'effective_date', 'batch_revision',
  'supersedes_batch_id', 'generation_timezone', 'source_boundary_at', 'profile_updated_at',
  'fact_hash', 'fact_snapshot_json', 'soft_context_snapshot_json', 'status', 'lease_token',
  'lease_epoch', 'lease_expires_at', 'attempt_count', 'next_attempt_at', 'cards_json',
  'contract_version', 'fact_projection_version', 'prompt_version', 'output_schema_version',
  'context_projection_version',
  'generator_version', 'model_id', 'generation_metrics_json', 'last_error_code',
  'last_error_stage', 'ready_at', 'created_at', 'updated_at',
].join(',');

export class MediumInsightRepositoryError extends Error {
  constructor(public readonly operation: string, message: string, public readonly databaseCode?: string) {
    super(message);
    this.name = 'MediumInsightRepositoryError';
  }
}

export class MediumInsightRepository {
  async claim(input: {
    userId: string;
    profileId: string;
    candidateDate: string;
    profileUpdatedAt: string;
    factHash: string;
    snapshot: MediumInsightFactSnapshot;
    groundingContext: MediumInsightGroundingContextSnapshot;
    timezone: string;
    sourceBoundaryAt: string;
    contractVersion: string;
    factProjectionVersion: string;
    contextProjectionVersion: string;
    generatorVersion: string;
    promptVersion: string;
    outputSchemaVersion: string;
  }): Promise<MediumInsightClaimResult> {
    const { data, error } = await supabase.rpc('claim_medium_insight_batch_v2', {
      p_user_id: input.userId,
      p_profile_id: input.profileId,
      p_candidate_date: input.candidateDate,
      p_profile_updated_at: input.profileUpdatedAt,
      p_fact_hash: input.factHash,
      p_fact_snapshot_json: input.snapshot,
      p_soft_context_snapshot_json: input.groundingContext,
      p_generation_timezone: input.timezone,
      p_source_boundary_at: input.sourceBoundaryAt,
      p_contract_version: input.contractVersion,
      p_fact_projection_version: input.factProjectionVersion,
      p_context_projection_version: input.contextProjectionVersion,
      p_generator_version: input.generatorVersion,
      p_prompt_version: input.promptVersion,
      p_output_schema_version: input.outputSchemaVersion,
      p_lease_ttl_seconds: configuredInt('MEDIUM_INSIGHT_LEASE_TTL_SECONDS', 150, 130, 300),
      p_max_active_generations: configuredInt('MEDIUM_INSIGHT_MAX_ACTIVE_GENERATIONS', 20, 1, 10_000),
      p_max_attempts: configuredInt('MEDIUM_INSIGHT_MAX_ATTEMPTS', 3, 1, 3),
    });
    if (error) throw repositoryError('claim', error);
    const row = firstRow<ClaimRpcRow>(data);
    if (!row || !CLAIM_OUTCOMES.has(row.claim_outcome)) {
      throw new MediumInsightRepositoryError('claim', '中卡 claim RPC 返回无效结果');
    }
    const leaseEpoch = Number(row.claim_lease_epoch);
    if (!Number.isSafeInteger(leaseEpoch) || leaseEpoch < 0) {
      throw new MediumInsightRepositoryError('claim', '中卡 claim lease epoch 无效');
    }
    return {
      outcome: row.claim_outcome,
      batchId: row.batch_id,
      status: row.batch_status,
      effectiveDate: row.target_effective_date,
      timezoneChangePending: row.timezone_change_pending,
      leaseToken: row.claim_lease_token,
      leaseEpoch,
      leaseExpiresAt: row.claim_lease_expires_at,
      nextAttemptAt: row.claim_next_attempt_at,
    };
  }

  async findById(userId: string, batchId: string): Promise<MediumInsightBatchRow | null> {
    const { data, error } = await supabase.from('medium_insight_batches')
      .select(BATCH_COLUMNS).eq('id', batchId).eq('user_id', userId).maybeSingle();
    if (error) throw repositoryError('findById', error);
    return data ? data as unknown as MediumInsightBatchRow : null;
  }

  async findHead(userId: string, profileId: string): Promise<MediumInsightBatchRow | null> {
    const { data, error } = await supabase.from('medium_insight_batches')
      .select(BATCH_COLUMNS).eq('user_id', userId).eq('profile_id', profileId)
      .order('effective_date', { ascending: false }).order('batch_revision', { ascending: false })
      .limit(1).maybeSingle();
    if (error) throw repositoryError('findHead', error);
    return data ? data as unknown as MediumInsightBatchRow : null;
  }

  async findRecentReady(userId: string, profileId: string, beforeDate: string): Promise<MediumInsightBatchRow[]> {
    const { data, error } = await supabase.from('medium_insight_batches')
      .select(BATCH_COLUMNS)
      .eq('user_id', userId).eq('profile_id', profileId).eq('status', 'ready')
      .lt('effective_date', beforeDate)
      .order('effective_date', { ascending: false }).order('batch_revision', { ascending: false })
      .limit(14);
    if (error) throw repositoryError('findRecentReady', error);
    return (data ?? []) as unknown as MediumInsightBatchRow[];
  }

  async finalize(input: {
    batchId: string;
    userId: string;
    leaseToken: string;
    leaseEpoch: number;
    domains: MediumInsightDomainCards[];
    promptVersion: string;
    outputSchemaVersion: string;
    modelId: string;
    metrics: MediumInsightGenerationMetrics;
  }): Promise<boolean> {
    const { data, error } = await supabase.rpc('finalize_medium_insight_batch', {
      p_batch_id: input.batchId,
      p_user_id: input.userId,
      p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch,
      p_cards_json: { domains: input.domains },
      p_prompt_version: input.promptVersion,
      p_output_schema_version: input.outputSchemaVersion,
      p_model_id: input.modelId,
      p_generation_metrics_json: input.metrics,
    });
    if (error) throw repositoryError('finalize', error);
    return data === true;
  }

  async markRetryWait(input: {
    batchId: string; userId: string; leaseToken: string; leaseEpoch: number;
    retryAfterSeconds: number; errorCode: string; errorStage: string;
  }): Promise<boolean> {
    const { data, error } = await supabase.rpc('retry_medium_insight_batch', {
      p_batch_id: input.batchId, p_user_id: input.userId, p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch, p_retry_after_seconds: input.retryAfterSeconds,
      p_error_code: input.errorCode, p_error_stage: input.errorStage,
    });
    if (error) throw repositoryError('markRetryWait', error);
    return data === true;
  }

  async markFailed(input: {
    batchId: string; userId: string; leaseToken: string; leaseEpoch: number;
    errorCode: string; errorStage: string;
  }): Promise<boolean> {
    const { data, error } = await supabase.rpc('fail_medium_insight_batch', {
      p_batch_id: input.batchId, p_user_id: input.userId, p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch, p_error_code: input.errorCode, p_error_stage: input.errorStage,
    });
    if (error) throw repositoryError('markFailed', error);
    return data === true;
  }

  async recordEvent(userId: string, input: MediumInsightEventRequest): Promise<'recorded' | 'duplicate'> {
    const { data, error } = await supabase.rpc('record_medium_insight_event', {
      p_event_id: input.event_id,
      p_user_id: userId,
      p_profile_id: input.profile_id,
      p_batch_id: input.batch_id ?? null,
      p_content_id: input.content_id ?? null,
      p_event_type: input.event_type,
      p_session_id: input.session_id,
      p_client_wait_ms: input.client_wait_ms ?? null,
      p_occurred_at: input.occurred_at,
      p_rollout_cohort: process.env.MEDIUM_INSIGHT_ROLLOUT_COHORT?.trim() || 'internal',
    });
    if (error) throw repositoryError('recordEvent', error);
    if (data !== 'recorded' && data !== 'duplicate') {
      throw new MediumInsightRepositoryError('recordEvent', '中卡事件 RPC 返回无效结果');
    }
    return data;
  }
}

export const mediumInsightRepository = new MediumInsightRepository();

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return value.length > 0 ? value[0] as T : null;
  return value && typeof value === 'object' ? value as T : null;
}

function repositoryError(operation: string, error: { message?: string; code?: string }): MediumInsightRepositoryError {
  return new MediumInsightRepositoryError(operation, error.message || '中卡数据库操作失败', error.code);
}

function configuredInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}
