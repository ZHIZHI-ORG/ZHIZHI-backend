import { supabase } from '../supabase';
import type {
  DailyFortuneAiContent,
  DailyFortuneFactPackage,
  DailyFortuneJsonValue,
} from '../../models/DailyFortune';

export type DailyFortuneArtifactStatus = 'generating' | 'retry_wait' | 'ready';

export type DailyFortuneClaimOutcome =
  | 'owner'
  | 'owner_takeover'
  | 'ready'
  | 'join'
  | 'wait'
  | 'busy';

export interface DailyFortuneArtifactRow {
  id: string;
  generation_key: string;
  user_id: string;
  profile_id: string;
  effective_date: string;
  profile_revision_hash: string;
  profile_updated_at: string;
  generation_timezone: string;
  status: DailyFortuneArtifactStatus;
  lease_token: string | null;
  lease_epoch: number;
  lease_expires_at: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  fact_contract_version: string | null;
  fact_hash: string | null;
  fact_snapshot_json: DailyFortuneFactPackage | null;
  day_context_json: Record<string, DailyFortuneJsonValue> | null;
  content_json: DailyFortuneAiContent | null;
  prompt_version: string | null;
  output_schema_version: string | null;
  generation_config_version: string | null;
  model_id: string | null;
  created_at: string;
  ready_at: string | null;
}

export interface ClaimDailyFortuneArtifactInput {
  generationKey: string;
  userId: string;
  profileId: string;
  effectiveDate: string;
  profileRevisionHash: string;
  profileUpdatedAt: string;
  generationTimezone: string;
  leaseTtlSeconds?: number;
  maxActiveGenerations?: number;
}

export interface DailyFortuneClaimResult {
  outcome: DailyFortuneClaimOutcome;
  artifactId: string | null;
  status: DailyFortuneArtifactStatus | null;
  leaseToken: string | null;
  leaseEpoch: number;
  leaseExpiresAt: string | null;
  nextAttemptAt: string | null;
}

export interface FinalizeDailyFortuneArtifactInput {
  artifactId: string;
  userId: string;
  leaseToken: string;
  leaseEpoch: number;
  factContractVersion: string;
  factHash: string;
  factSnapshot: DailyFortuneFactPackage;
  dayContext: Record<string, DailyFortuneJsonValue>;
  content: DailyFortuneAiContent;
  promptVersion: string;
  outputSchemaVersion: string;
  generationConfigVersion: string;
  modelId: string;
}

export interface MarkDailyFortuneRetryWaitInput {
  artifactId: string;
  userId: string;
  leaseToken: string;
  leaseEpoch: number;
  retryAfterSeconds: number;
}

export interface ReleaseDailyFortuneGenerationInput {
  artifactId: string;
  userId: string;
  leaseToken: string;
  leaseEpoch: number;
}

interface ClaimRpcRow {
  claim_outcome: DailyFortuneClaimOutcome;
  artifact_id: string | null;
  artifact_status: DailyFortuneArtifactStatus | null;
  claim_lease_token: string | null;
  claim_lease_epoch: number | string;
  claim_lease_expires_at: string | null;
  claim_next_attempt_at: string | null;
}

const ARTIFACT_COLUMNS = [
  'id',
  'generation_key',
  'user_id',
  'profile_id',
  'effective_date',
  'profile_revision_hash',
  'profile_updated_at',
  'generation_timezone',
  'status',
  'lease_token',
  'lease_epoch',
  'lease_expires_at',
  'attempt_count',
  'next_attempt_at',
  'fact_contract_version',
  'fact_hash',
  'fact_snapshot_json',
  'day_context_json',
  'content_json',
  'prompt_version',
  'output_schema_version',
  'generation_config_version',
  'model_id',
  'created_at',
  'ready_at',
].join(',');

const CLAIM_OUTCOMES = new Set<DailyFortuneClaimOutcome>([
  'owner',
  'owner_takeover',
  'ready',
  'join',
  'wait',
  'busy',
]);

export class DailyFortuneArtifactRepositoryError extends Error {
  constructor(
    public readonly operation: string,
    message: string,
    public readonly databaseCode?: string,
  ) {
    super(message);
    this.name = 'DailyFortuneArtifactRepositoryError';
  }
}

export class DailyFortuneArtifactRepository {
  async claim(input: ClaimDailyFortuneArtifactInput): Promise<DailyFortuneClaimResult> {
    const leaseTtlSeconds = input.leaseTtlSeconds ?? 45;
    const maxActiveGenerations = input.maxActiveGenerations
      ?? configuredPositiveInt('DAILY_FORTUNE_MAX_ACTIVE_GENERATIONS', 20);

    const { data, error } = await supabase.rpc('claim_daily_fortune_artifact', {
      p_generation_key: input.generationKey,
      p_user_id: input.userId,
      p_profile_id: input.profileId,
      p_effective_date: input.effectiveDate,
      p_profile_revision_hash: input.profileRevisionHash,
      p_profile_updated_at: input.profileUpdatedAt,
      p_generation_timezone: input.generationTimezone,
      p_lease_ttl_seconds: leaseTtlSeconds,
      p_max_active_generations: maxActiveGenerations,
    });

    if (error) {
      throw repositoryError('claim', error);
    }

    const row = firstRpcRow<ClaimRpcRow>(data);
    if (!row || !CLAIM_OUTCOMES.has(row.claim_outcome)) {
      throw new DailyFortuneArtifactRepositoryError(
        'claim',
        '日运生成 claim RPC 返回了无效结果',
      );
    }

    const leaseEpoch = Number(row.claim_lease_epoch);
    if (!Number.isSafeInteger(leaseEpoch) || leaseEpoch < 0) {
      throw new DailyFortuneArtifactRepositoryError(
        'claim',
        '日运生成 claim RPC 返回了无效 lease epoch',
      );
    }

    if (
      (row.claim_outcome === 'owner' || row.claim_outcome === 'owner_takeover')
      && (!row.artifact_id || !row.claim_lease_token)
    ) {
      throw new DailyFortuneArtifactRepositoryError(
        'claim',
        '日运生成 owner claim 缺少 artifact 或 lease token',
      );
    }

    return {
      outcome: row.claim_outcome,
      artifactId: row.artifact_id,
      status: row.artifact_status,
      leaseToken: row.claim_lease_token,
      leaseEpoch,
      leaseExpiresAt: row.claim_lease_expires_at,
      nextAttemptAt: row.claim_next_attempt_at,
    };
  }

  async findById(userId: string, artifactId: string): Promise<DailyFortuneArtifactRow | null> {
    const { data, error } = await supabase
      .from('daily_fortune_artifacts')
      .select(ARTIFACT_COLUMNS)
      .eq('user_id', userId)
      .eq('id', artifactId)
      .maybeSingle();

    if (error) {
      throw repositoryError('findById', error);
    }

    return data ? toArtifactRow(data as unknown as Record<string, unknown>) : null;
  }

  async findReadyByIdentity(input: {
    userId: string;
    profileId: string;
    effectiveDate: string;
    profileRevisionHash: string;
  }): Promise<DailyFortuneArtifactRow | null> {
    const { data, error } = await supabase
      .from('daily_fortune_artifacts')
      .select(ARTIFACT_COLUMNS)
      .eq('user_id', input.userId)
      .eq('profile_id', input.profileId)
      .eq('effective_date', input.effectiveDate)
      .eq('profile_revision_hash', input.profileRevisionHash)
      .eq('status', 'ready')
      .maybeSingle();

    if (error) {
      throw repositoryError('findReadyByIdentity', error);
    }

    return data ? toArtifactRow(data as unknown as Record<string, unknown>) : null;
  }

  async finalize(input: FinalizeDailyFortuneArtifactInput): Promise<boolean> {
    const { data, error } = await supabase.rpc('finalize_daily_fortune_artifact', {
      p_artifact_id: input.artifactId,
      p_user_id: input.userId,
      p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch,
      p_fact_contract_version: input.factContractVersion,
      p_fact_hash: input.factHash,
      p_fact_snapshot_json: input.factSnapshot,
      p_day_context_json: input.dayContext,
      p_content_json: input.content,
      p_prompt_version: input.promptVersion,
      p_output_schema_version: input.outputSchemaVersion,
      p_generation_config_version: input.generationConfigVersion,
      p_model_id: input.modelId,
    });

    if (error) {
      throw repositoryError('finalize', error);
    }

    return data === true;
  }

  async markRetryWait(input: MarkDailyFortuneRetryWaitInput): Promise<boolean> {
    const { data, error } = await supabase.rpc('mark_daily_fortune_retry_wait', {
      p_artifact_id: input.artifactId,
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

  async release(input: ReleaseDailyFortuneGenerationInput): Promise<boolean> {
    const { data, error } = await supabase.rpc('release_daily_fortune_generation', {
      p_artifact_id: input.artifactId,
      p_user_id: input.userId,
      p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch,
    });

    if (error) {
      throw repositoryError('release', error);
    }

    return data === true;
  }
}

function firstRpcRow<T>(data: unknown): T | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  return data[0] as T;
}

function toArtifactRow(data: Record<string, unknown>): DailyFortuneArtifactRow {
  const leaseEpoch = Number(data.lease_epoch);
  const attemptCount = Number(data.attempt_count);
  if (!Number.isSafeInteger(leaseEpoch) || !Number.isSafeInteger(attemptCount)) {
    throw new DailyFortuneArtifactRepositoryError(
      'decode',
      '日运 artifact 的计数字段无效',
    );
  }
  return {
    ...(data as unknown as DailyFortuneArtifactRow),
    lease_epoch: leaseEpoch,
    attempt_count: attemptCount,
  };
}

function configuredPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new DailyFortuneArtifactRepositoryError(
      'configuration',
      `${name} 必须是正整数`,
    );
  }
  return parsed;
}

function repositoryError(operation: string, error: { message: string; code?: string }): Error {
  return new DailyFortuneArtifactRepositoryError(
    operation,
    `日运 artifact ${operation} 失败: ${error.message}`,
    error.code,
  );
}

export const dailyFortuneArtifactRepository = new DailyFortuneArtifactRepository();
