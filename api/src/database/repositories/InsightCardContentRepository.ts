import { supabase } from '../supabase';
import {
  InsightContentGenerationMetrics,
  InsightContentStatus,
  InsightConversationTurn,
  InsightDetailContent,
  InsightFollowUpContent,
  InsightSourceType,
} from '../../models/InsightCardContent';

export type InsightContentClaimOutcome =
  | 'owner'
  | 'owner_takeover'
  | 'ready'
  | 'join'
  | 'wait'
  | 'failed';

export interface InsightDetailRow {
  id: string;
  generation_key: string;
  user_id: string;
  profile_id: string;
  source_type: InsightSourceType;
  source_batch_id: string;
  source_item_id: string;
  source_item_snapshot_json: Record<string, unknown>;
  selected_fact_snapshot_json: unknown;
  grounding_context_snapshot_json: unknown;
  fact_refs_json: string[];
  status: InsightContentStatus;
  lease_token: string | null;
  lease_epoch: number;
  lease_expires_at: string | null;
  attempt_count: number;
  provider_attempt_count: number;
  provider_input_bytes: number;
  provider_prompt_tokens: number;
  provider_billed_output_tokens: number;
  next_attempt_at: string | null;
  detail_json: InsightDetailContent | null;
  contract_version: string;
  prompt_version: string;
  output_schema_version: string;
  model_id: string;
  generation_metrics_json: InsightContentGenerationMetrics | null;
  last_error_code: string | null;
  last_error_stage: string | null;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsightFollowUpRow {
  id: string;
  generation_key: string;
  user_id: string;
  detail_id: string;
  parent_follow_up_id: string | null;
  client_request_id: string;
  normalized_question_hash: string;
  question: string;
  status: InsightContentStatus;
  lease_token: string | null;
  lease_epoch: number;
  lease_expires_at: string | null;
  attempt_count: number;
  provider_attempt_count: number;
  provider_input_bytes: number;
  provider_prompt_tokens: number;
  provider_billed_output_tokens: number;
  next_attempt_at: string | null;
  input_snapshot_json: Record<string, unknown> | null;
  answer_json: InsightFollowUpContent | null;
  contract_version: string;
  prompt_version: string;
  output_schema_version: string;
  model_id: string;
  generation_metrics_json: InsightContentGenerationMetrics | null;
  last_error_code: string | null;
  last_error_stage: string | null;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsightContentClaimResult {
  outcome: InsightContentClaimOutcome;
  generationId: string;
  status: InsightContentStatus;
  leaseToken: string | null;
  leaseEpoch: number;
  leaseExpiresAt: string | null;
  nextAttemptAt: string | null;
}

interface ClaimRpcRow {
  claim_outcome: InsightContentClaimOutcome;
  generation_id: string;
  generation_status: InsightContentStatus;
  claim_lease_token: string | null;
  claim_lease_epoch: number | string;
  claim_lease_expires_at: string | null;
  claim_next_attempt_at: string | null;
}

const DETAIL_COLUMNS = [
  'id', 'generation_key', 'user_id', 'profile_id', 'source_type', 'source_batch_id',
  'source_item_id', 'source_item_snapshot_json', 'selected_fact_snapshot_json',
  'grounding_context_snapshot_json', 'fact_refs_json',
  'status', 'lease_token', 'lease_epoch', 'lease_expires_at', 'attempt_count',
  'provider_attempt_count', 'provider_input_bytes',
  'provider_prompt_tokens', 'provider_billed_output_tokens',
  'next_attempt_at', 'detail_json', 'contract_version', 'prompt_version',
  'output_schema_version', 'model_id', 'generation_metrics_json', 'last_error_code',
  'last_error_stage', 'ready_at', 'created_at', 'updated_at',
].join(',');

const FOLLOW_UP_COLUMNS = [
  'id', 'generation_key', 'user_id', 'detail_id', 'parent_follow_up_id',
  'client_request_id', 'normalized_question_hash', 'question', 'status', 'lease_token',
  'lease_epoch', 'lease_expires_at', 'attempt_count', 'provider_attempt_count', 'provider_input_bytes', 'next_attempt_at',
  'provider_prompt_tokens', 'provider_billed_output_tokens',
  'input_snapshot_json', 'answer_json', 'contract_version', 'prompt_version',
  'output_schema_version', 'model_id', 'generation_metrics_json', 'last_error_code',
  'last_error_stage', 'ready_at', 'created_at', 'updated_at',
].join(',');

export class InsightCardContentRepositoryError extends Error {
  constructor(
    public readonly operation: string,
    message: string,
    public readonly databaseCode?: string,
  ) {
    super(message);
    this.name = 'InsightCardContentRepositoryError';
  }
}

export class InsightCardContentRepository {
  async claimDetail(input: {
    userId: string;
    sourceType: InsightSourceType;
    sourceBatchId: string;
    sourceItemId: string;
    generationKey: string;
    contractVersion: string;
    promptVersion: string;
    outputSchemaVersion: string;
    modelIdentity: string;
  }): Promise<InsightContentClaimResult> {
    const { data, error } = await supabase.rpc('claim_insight_card_detail', {
      p_user_id: input.userId,
      p_source_type: input.sourceType,
      p_source_batch_id: input.sourceBatchId,
      p_source_item_id: input.sourceItemId,
      p_generation_key: input.generationKey,
      p_contract_version: input.contractVersion,
      p_prompt_version: input.promptVersion,
      p_output_schema_version: input.outputSchemaVersion,
      p_model_identity: input.modelIdentity,
      p_lease_ttl_seconds: configuredInt('INSIGHT_CONTENT_LEASE_TTL_SECONDS', 150, 130, 300),
      p_max_attempts: configuredInt('INSIGHT_CONTENT_MAX_ATTEMPTS', 3, 1, 3),
    });
    if (error) throw repositoryError('claimDetail', error);
    return decodeClaim(data, '详情');
  }

  async findDetail(userId: string, detailId: string): Promise<InsightDetailRow | null> {
    const { data, error } = await supabase.from('insight_card_details')
      .select(DETAIL_COLUMNS).eq('id', detailId).eq('user_id', userId).maybeSingle();
    if (error) throw repositoryError('findDetail', error);
    return data ? decodeDetail(data as unknown as InsightDetailRow) : null;
  }

  async finalizeDetail(input: {
    detailId: string;
    userId: string;
    leaseToken: string;
    leaseEpoch: number;
    detail: Omit<InsightDetailContent, 'detail_id' | 'source_type' | 'source_batch_id' | 'source_item_id'>;
    modelId: string;
    metrics: InsightContentGenerationMetrics;
  }): Promise<boolean> {
    const { data, error } = await supabase.rpc('finalize_insight_card_detail', {
      p_detail_id: input.detailId,
      p_user_id: input.userId,
      p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch,
      p_detail_content_json: input.detail,
      p_model_id: input.modelId,
      p_generation_metrics_json: input.metrics,
    });
    if (error) throw repositoryError('finalizeDetail', error);
    return data === true;
  }

  async claimFollowUp(input: {
    userId: string;
    detailId: string;
    parentFollowUpId: string | null;
    clientRequestId: string;
    normalizedQuestionHash: string;
    question: string;
    generationKey: string;
    contractVersion: string;
    promptVersion: string;
    outputSchemaVersion: string;
    modelIdentity: string;
  }): Promise<InsightContentClaimResult> {
    const { data, error } = await supabase.rpc('claim_insight_card_follow_up', {
      p_user_id: input.userId,
      p_detail_id: input.detailId,
      p_parent_follow_up_id: input.parentFollowUpId,
      p_client_request_id: input.clientRequestId,
      p_normalized_question_hash: input.normalizedQuestionHash,
      p_question: input.question,
      p_generation_key: input.generationKey,
      p_contract_version: input.contractVersion,
      p_prompt_version: input.promptVersion,
      p_output_schema_version: input.outputSchemaVersion,
      p_model_identity: input.modelIdentity,
      p_lease_ttl_seconds: configuredInt('INSIGHT_CONTENT_LEASE_TTL_SECONDS', 150, 130, 300),
      p_max_attempts: configuredInt('INSIGHT_CONTENT_MAX_ATTEMPTS', 3, 1, 3),
    });
    if (error) throw repositoryError('claimFollowUp', error);
    return decodeClaim(data, '追问');
  }

  async findFollowUp(userId: string, followUpId: string): Promise<InsightFollowUpRow | null> {
    const { data, error } = await supabase.from('insight_card_follow_ups')
      .select(FOLLOW_UP_COLUMNS).eq('id', followUpId).eq('user_id', userId).maybeSingle();
    if (error) throw repositoryError('findFollowUp', error);
    return data ? decodeFollowUp(data as unknown as InsightFollowUpRow) : null;
  }

  async findReadyConversation(userId: string, detailId: string): Promise<InsightConversationTurn[]> {
    const { data, error } = await supabase.from('insight_card_follow_ups')
      .select('id,parent_follow_up_id,question,answer_json,created_at')
      .eq('user_id', userId).eq('detail_id', detailId).eq('status', 'ready')
      .order('created_at', { ascending: false }).limit(32);
    if (error) throw repositoryError('findReadyConversation', error);
    return (data ?? []).map((value) => {
      const row = value as unknown as { id: string; parent_follow_up_id: string | null; question: string; answer_json: InsightFollowUpContent; created_at: string };
      return {
        follow_up_id: row.id,
        parent_follow_up_id: row.parent_follow_up_id,
        question: row.question,
        answer: row.answer_json.answer,
        fact_refs: row.answer_json.fact_refs,
        created_at: row.created_at,
      };
    });
  }

  /** Fetch only the selected branch so an old parent remains addressable after
   * the detail history list has grown beyond its UI retention window. */
  async findReadyAncestry(
    userId: string,
    detailId: string,
    parentFollowUpId: string,
    maximumDepth = 6,
  ): Promise<InsightConversationTurn[]> {
    const { data, error } = await supabase.rpc('get_insight_follow_up_ancestry', {
      p_user_id: userId,
      p_detail_id: detailId,
      p_parent_follow_up_id: parentFollowUpId,
      p_max_depth: maximumDepth,
    });
    if (error) throw repositoryError('findReadyAncestry', error);
    return ((data ?? []) as Array<{
      follow_up_id: string;
      parent_follow_up_id: string | null;
      question: string;
      answer_json: InsightFollowUpContent;
      created_at: string;
      chain_depth: number | string;
    }>).map((row) => ({
      follow_up_id: row.follow_up_id,
      parent_follow_up_id: row.parent_follow_up_id,
      question: row.question,
      answer: row.answer_json.answer,
      fact_refs: row.answer_json.fact_refs,
      created_at: row.created_at,
    }));
  }

  async finalizeFollowUp(input: {
    followUpId: string;
    userId: string;
    leaseToken: string;
    leaseEpoch: number;
    inputSnapshot: Record<string, unknown>;
    answer: { answer: string; fact_refs: string[] };
    modelId: string;
    metrics: InsightContentGenerationMetrics;
  }): Promise<boolean> {
    const { data, error } = await supabase.rpc('finalize_insight_card_follow_up', {
      p_follow_up_id: input.followUpId,
      p_user_id: input.userId,
      p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch,
      p_input_snapshot_json: input.inputSnapshot,
      p_answer_content_json: input.answer,
      p_model_id: input.modelId,
      p_generation_metrics_json: input.metrics,
    });
    if (error) throw repositoryError('finalizeFollowUp', error);
    return data === true;
  }

  async markRetryWait(input: {
    kind: 'detail' | 'follow_up'; id: string; userId: string; leaseToken: string;
    leaseEpoch: number; retryAfterSeconds: number; errorCode: string; errorStage: string;
    providerCalls: number; providerInputBytes: number;
    providerPromptTokens: number; providerBilledOutputTokens: number;
  }): Promise<boolean> {
    const { data, error } = await supabase.rpc('retry_insight_card_content_v2', {
      p_kind: input.kind,
      p_generation_id: input.id,
      p_user_id: input.userId,
      p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch,
      p_retry_after_seconds: input.retryAfterSeconds,
      p_error_code: input.errorCode,
      p_error_stage: input.errorStage,
      p_provider_calls: input.providerCalls,
      p_provider_input_bytes: input.providerInputBytes,
      p_provider_prompt_tokens: input.providerPromptTokens,
      p_provider_billed_output_tokens: input.providerBilledOutputTokens,
    });
    if (error) throw repositoryError('markRetryWait', error);
    return data === true;
  }

  async markFailed(input: {
    kind: 'detail' | 'follow_up'; id: string; userId: string; leaseToken: string;
    leaseEpoch: number; errorCode: string; errorStage: string;
    providerCalls: number; providerInputBytes: number;
    providerPromptTokens: number; providerBilledOutputTokens: number;
  }): Promise<boolean> {
    const { data, error } = await supabase.rpc('fail_insight_card_content_v2', {
      p_kind: input.kind,
      p_generation_id: input.id,
      p_user_id: input.userId,
      p_lease_token: input.leaseToken,
      p_lease_epoch: input.leaseEpoch,
      p_error_code: input.errorCode,
      p_error_stage: input.errorStage,
      p_provider_calls: input.providerCalls,
      p_provider_input_bytes: input.providerInputBytes,
      p_provider_prompt_tokens: input.providerPromptTokens,
      p_provider_billed_output_tokens: input.providerBilledOutputTokens,
    });
    if (error) throw repositoryError('markFailed', error);
    return data === true;
  }
}

export const insightCardContentRepository = new InsightCardContentRepository();

function decodeClaim(data: unknown, label: string): InsightContentClaimResult {
  const row = Array.isArray(data) && data.length === 1 ? data[0] as ClaimRpcRow : null;
  const outcomes = new Set<InsightContentClaimOutcome>(['owner', 'owner_takeover', 'ready', 'join', 'wait', 'failed']);
  if (!row || !outcomes.has(row.claim_outcome) || typeof row.generation_id !== 'string') {
    throw new InsightCardContentRepositoryError('decodeClaim', `${label} claim RPC 返回无效结果`);
  }
  const leaseEpoch = Number(row.claim_lease_epoch);
  if (!Number.isSafeInteger(leaseEpoch) || leaseEpoch < 0) {
    throw new InsightCardContentRepositoryError('decodeClaim', `${label} lease epoch 无效`);
  }
  return {
    outcome: row.claim_outcome,
    generationId: row.generation_id,
    status: row.generation_status,
    leaseToken: row.claim_lease_token,
    leaseEpoch,
    leaseExpiresAt: row.claim_lease_expires_at,
    nextAttemptAt: row.claim_next_attempt_at,
  };
}

function decodeDetail(row: InsightDetailRow): InsightDetailRow {
  return {
    ...row,
    lease_epoch: Number(row.lease_epoch),
    attempt_count: Number(row.attempt_count),
    provider_attempt_count: Number(row.provider_attempt_count),
    provider_input_bytes: Number(row.provider_input_bytes),
    provider_prompt_tokens: Number(row.provider_prompt_tokens),
    provider_billed_output_tokens: Number(row.provider_billed_output_tokens),
  };
}

function decodeFollowUp(row: InsightFollowUpRow): InsightFollowUpRow {
  return {
    ...row,
    lease_epoch: Number(row.lease_epoch),
    attempt_count: Number(row.attempt_count),
    provider_attempt_count: Number(row.provider_attempt_count),
    provider_input_bytes: Number(row.provider_input_bytes),
    provider_prompt_tokens: Number(row.provider_prompt_tokens),
    provider_billed_output_tokens: Number(row.provider_billed_output_tokens),
  };
}

function repositoryError(operation: string, error: { message?: string; code?: string }) {
  return new InsightCardContentRepositoryError(
    operation,
    error.message || '卡片内容数据库操作失败',
    error.code,
  );
}

function configuredInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}
