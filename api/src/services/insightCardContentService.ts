import { createHash } from 'node:crypto';
import {
  InsightCardContentRepository,
  InsightDetailRow,
  InsightFollowUpRow,
  insightCardContentRepository,
} from '../database/repositories/InsightCardContentRepository';
import {
  INSIGHT_CARD_CONTENT_CONTRACT_VERSION,
  INSIGHT_CARD_DETAIL_SCHEMA_VERSION,
  INSIGHT_CARD_FOLLOW_UP_PROMPT_VERSION,
  INSIGHT_CARD_FOLLOW_UP_SCHEMA_VERSION,
  INSIGHT_CARD_LARGE_DETAIL_PROMPT_VERSION,
  INSIGHT_CARD_MEDIUM_DETAIL_PROMPT_VERSION,
  INSIGHT_SOURCE_TYPES,
  InsightDetailContent,
  InsightDetailServiceResult,
  InsightFollowUpContent,
  InsightFollowUpServiceResult,
  ResolveInsightDetailRequest,
  ResolveInsightFollowUpRequest,
} from '../models/InsightCardContent';
import { DailyFortuneAiError } from '../utils/dailyFortuneAi';
import { NotFoundError, ValidationError } from '../utils/errors';
import {
  generateInsightDetailWithAi,
  generateInsightFollowUpWithAi,
  insightContentModelIdentity,
  InsightCardContentAiAttemptError,
  InsightCardContentValidationError,
} from '../utils/insightCardContentAi';

const RETRY_WAIT_SECONDS = 15;
const POLL_RETRY_MS = 1_500;

interface Dependencies {
  repository: Pick<InsightCardContentRepository,
    | 'claimDetail'
    | 'findDetail'
    | 'finalizeDetail'
    | 'claimFollowUp'
    | 'findFollowUp'
    | 'findReadyConversation'
    | 'findReadyAncestry'
    | 'finalizeFollowUp'
    | 'markRetryWait'
    | 'markFailed'>;
  generateDetail: typeof generateInsightDetailWithAi;
  generateFollowUp: typeof generateInsightFollowUpWithAi;
  now: () => Date;
  generationEnabled: () => boolean;
}

const defaults: Dependencies = {
  repository: insightCardContentRepository,
  generateDetail: generateInsightDetailWithAi,
  generateFollowUp: generateInsightFollowUpWithAi,
  now: () => new Date(),
  generationEnabled: () => process.env.INSIGHT_CONTENT_V2_ENABLED?.trim().toLowerCase() !== 'false',
};

export function createInsightCardContentService(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  return {
    resolveDetail: (userId: string, input: ResolveInsightDetailRequest) => (
      resolveDetail(dependencies, userId, input)
    ),
    pollDetail: (userId: string, generationId: string) => (
      pollDetail(dependencies, userId, generationId)
    ),
    resolveFollowUp: (userId: string, input: ResolveInsightFollowUpRequest) => (
      resolveFollowUp(dependencies, userId, input)
    ),
    pollFollowUp: (userId: string, generationId: string) => (
      pollFollowUp(dependencies, userId, generationId)
    ),
  };
}

const service = createInsightCardContentService();
export const resolveInsightCardDetail = service.resolveDetail;
export const pollInsightCardDetail = service.pollDetail;
export const resolveInsightCardFollowUp = service.resolveFollowUp;
export const pollInsightCardFollowUp = service.pollFollowUp;

async function resolveDetail(
  dependencies: Dependencies,
  userId: string,
  input: ResolveInsightDetailRequest,
): Promise<InsightDetailServiceResult> {
  validateDetailInput(userId, input);
  if (!dependencies.generationEnabled()) return unavailableDetail('GENERATION_DISABLED', false);
  const modelIdentity = insightContentModelIdentity();
  const promptVersion = detailPromptVersion(input.source_type);
  const generationKey = sha256([
    INSIGHT_CARD_CONTENT_CONTRACT_VERSION,
    promptVersion,
    INSIGHT_CARD_DETAIL_SCHEMA_VERSION,
    modelIdentity,
    input.source_type,
    userId,
    input.source_batch_id,
    input.source_item_id,
  ].join('|'));
  const claim = await dependencies.repository.claimDetail({
    userId,
    sourceType: input.source_type,
    sourceBatchId: input.source_batch_id,
    sourceItemId: input.source_item_id,
    generationKey,
    contractVersion: INSIGHT_CARD_CONTENT_CONTRACT_VERSION,
    promptVersion,
    outputSchemaVersion: INSIGHT_CARD_DETAIL_SCHEMA_VERSION,
    modelIdentity,
  });
  if (claim.outcome === 'failed') return unavailableDetail('GENERATION_FAILED', false, claim.generationId);
  if (claim.outcome === 'ready') {
    return readyDetail(dependencies, userId, await requiredDetail(dependencies, userId, claim.generationId));
  }
  if (claim.outcome === 'join' || claim.outcome === 'wait') {
    return pending(claim, dependencies.now()) as InsightDetailServiceResult;
  }
  if (!claim.leaseToken) return unavailableDetail('CLAIM_FAILED', true, claim.generationId);

  const row = await requiredDetail(dependencies, userId, claim.generationId);
  try {
    const generated = await dependencies.generateDetail({
      sourceType: row.source_type,
      sourceItem: row.source_item_snapshot_json,
      selectedFactSnapshot: row.selected_fact_snapshot_json,
      groundingContextSnapshot: row.grounding_context_snapshot_json,
      allowedFactRefs: requiredFactRefs(row.fact_refs_json),
    });
    const finalized = await dependencies.repository.finalizeDetail({
      detailId: row.id,
      userId,
      leaseToken: claim.leaseToken,
      leaseEpoch: claim.leaseEpoch,
      detail: {
        title: sourceTitle(row.source_type, row.source_item_snapshot_json),
        preview: sourcePreview(row.source_item_snapshot_json),
        ...generated.content,
        follow_ups: [],
      },
      modelId: generated.modelId,
      metrics: generated.metrics,
    });
    if (!finalized) return unavailableDetail('LEASE_LOST', true, row.id);
    return readyDetail(dependencies, userId, await requiredDetail(dependencies, userId, row.id));
  } catch (error) {
    return handleGenerationError(dependencies, 'detail', row.id, userId, claim, error) as Promise<InsightDetailServiceResult>;
  }
}

async function pollDetail(
  dependencies: Dependencies,
  userId: string,
  generationId: string,
): Promise<InsightDetailServiceResult> {
  if (!isUuid(generationId)) throw new ValidationError('generation_id 必须是 UUID');
  const row = await dependencies.repository.findDetail(userId, generationId);
  if (!row) throw new NotFoundError('详情不存在');
  if (!isCurrentDetail(row)) return unavailableDetail('STALE_CONTRACT', false, row.id);
  if (row.status === 'ready') return readyDetail(dependencies, userId, row);
  if (row.status === 'failed') return unavailableDetail('GENERATION_FAILED', false, row.id);
  return pendingFromRow(row, dependencies.now()) as InsightDetailServiceResult;
}

async function resolveFollowUp(
  dependencies: Dependencies,
  userId: string,
  rawInput: ResolveInsightFollowUpRequest,
): Promise<InsightFollowUpServiceResult> {
  const input = validateFollowUpInput(userId, rawInput);
  if (!dependencies.generationEnabled()) return unavailableFollowUp('GENERATION_DISABLED', false);
  const sourceDetail = await requiredDetail(dependencies, userId, input.detail_id);
  if (!isCurrentDetail(sourceDetail) || sourceDetail.status !== 'ready' || !sourceDetail.detail_json) {
    return unavailableFollowUp('STALE_OR_UNREADY_DETAIL', false);
  }
  const normalizedQuestionHash = sha256(normalizeQuestionForIdentity(input.question));
  const modelIdentity = insightContentModelIdentity();
  const generationKey = sha256([
    INSIGHT_CARD_CONTENT_CONTRACT_VERSION,
    INSIGHT_CARD_FOLLOW_UP_PROMPT_VERSION,
    INSIGHT_CARD_FOLLOW_UP_SCHEMA_VERSION,
    modelIdentity,
    input.client_request_id,
    userId,
    input.detail_id,
    input.parent_follow_up_id ?? 'root',
    normalizedQuestionHash,
  ].join('|'));
  const claim = await dependencies.repository.claimFollowUp({
    userId,
    detailId: input.detail_id,
    parentFollowUpId: input.parent_follow_up_id ?? null,
    clientRequestId: input.client_request_id,
    normalizedQuestionHash,
    question: input.question,
    generationKey,
    contractVersion: INSIGHT_CARD_CONTENT_CONTRACT_VERSION,
    promptVersion: INSIGHT_CARD_FOLLOW_UP_PROMPT_VERSION,
    outputSchemaVersion: INSIGHT_CARD_FOLLOW_UP_SCHEMA_VERSION,
    modelIdentity,
  });
  if (claim.outcome === 'failed') return unavailableFollowUp('GENERATION_FAILED', false, claim.generationId);
  if (claim.outcome === 'ready') {
    return readyFollowUp(await requiredFollowUp(dependencies, userId, claim.generationId));
  }
  if (claim.outcome === 'join' || claim.outcome === 'wait') {
    return pending(claim, dependencies.now()) as InsightFollowUpServiceResult;
  }
  if (!claim.leaseToken) return unavailableFollowUp('CLAIM_FAILED', true, claim.generationId);

  const [row, detail] = await Promise.all([
    requiredFollowUp(dependencies, userId, claim.generationId),
    requiredDetail(dependencies, userId, input.detail_id),
  ]);
  if (detail.status !== 'ready' || !detail.detail_json) {
    return failInvalidFollowUpSource(dependencies, row, userId, claim, 'DETAIL_NOT_READY');
  }
  try {
    const history = row.parent_follow_up_id
      ? await dependencies.repository.findReadyAncestry(userId, row.detail_id, row.parent_follow_up_id, 2)
      : [];
    if (row.parent_follow_up_id && !history.some((turn) => turn.follow_up_id === row.parent_follow_up_id)) {
      return failInvalidFollowUpSource(dependencies, row, userId, claim, 'PARENT_NOT_READY');
    }
    const generated = await dependencies.generateFollowUp({
      sourceItem: detail.source_item_snapshot_json,
      selectedFactSnapshot: detail.selected_fact_snapshot_json,
      groundingContextSnapshot: detail.grounding_context_snapshot_json,
      detailContent: detail.detail_json,
      conversationHistory: history,
      question: row.question,
      allowedFactRefs: requiredFactRefs(detail.fact_refs_json),
    });
    const finalized = await dependencies.repository.finalizeFollowUp({
      followUpId: row.id,
      userId,
      leaseToken: claim.leaseToken,
      leaseEpoch: claim.leaseEpoch,
      inputSnapshot: generated.inputSnapshot,
      answer: generated.content,
      modelId: generated.modelId,
      metrics: generated.metrics,
    });
    if (!finalized) return unavailableFollowUp('LEASE_LOST', true, row.id);
    return readyFollowUp(await requiredFollowUp(dependencies, userId, row.id));
  } catch (error) {
    return handleGenerationError(dependencies, 'follow_up', row.id, userId, claim, error) as Promise<InsightFollowUpServiceResult>;
  }
}

async function pollFollowUp(
  dependencies: Dependencies,
  userId: string,
  generationId: string,
): Promise<InsightFollowUpServiceResult> {
  if (!isUuid(generationId)) throw new ValidationError('generation_id 必须是 UUID');
  const row = await dependencies.repository.findFollowUp(userId, generationId);
  if (!row) throw new NotFoundError('追问不存在');
  if (!isCurrentFollowUp(row)) return unavailableFollowUp('STALE_CONTRACT', false, row.id);
  if (row.status === 'ready') return readyFollowUp(row);
  if (row.status === 'failed') return unavailableFollowUp('GENERATION_FAILED', false, row.id);
  return pendingFromRow(row, dependencies.now()) as InsightFollowUpServiceResult;
}

async function readyDetail(
  dependencies: Dependencies,
  userId: string,
  row: InsightDetailRow,
): Promise<InsightDetailServiceResult> {
  if (!isCurrentDetail(row) || row.status !== 'ready' || !row.detail_json) {
    return unavailableDetail('READY_PAYLOAD_INVALID', false, row.id);
  }
  const turns = (await dependencies.repository.findReadyConversation(userId, row.id))
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  return {
    status: 'ready',
    generation_id: row.id,
    detail: {
      ...row.detail_json,
      detail_id: row.id,
      source_type: row.source_type,
      source_batch_id: row.source_batch_id,
      source_item_id: row.source_item_id,
      follow_ups: turns.map((turn) => ({
        follow_up_id: turn.follow_up_id,
        parent_follow_up_id: turn.parent_follow_up_id,
        question: turn.question,
        answer: turn.answer,
        fact_refs: turn.fact_refs,
        created_at: turn.created_at,
      })),
    },
  };
}

function readyFollowUp(row: InsightFollowUpRow): InsightFollowUpServiceResult {
  if (!isCurrentFollowUp(row) || row.status !== 'ready' || !row.answer_json) {
    return unavailableFollowUp('READY_PAYLOAD_INVALID', false, row.id);
  }
  return {
    status: 'ready',
    generation_id: row.id,
    follow_up: {
      ...row.answer_json,
      follow_up_id: row.id,
      detail_id: row.detail_id,
      parent_follow_up_id: row.parent_follow_up_id,
      question: row.question,
    },
  };
}

async function requiredDetail(dependencies: Dependencies, userId: string, id: string) {
  const row = await dependencies.repository.findDetail(userId, id);
  if (!row) throw new NotFoundError('详情不存在');
  return row;
}

async function requiredFollowUp(dependencies: Dependencies, userId: string, id: string) {
  const row = await dependencies.repository.findFollowUp(userId, id);
  if (!row) throw new NotFoundError('追问不存在');
  return row;
}

function pending(
  claim: { outcome: string; generationId: string; leaseExpiresAt: string | null; nextAttemptAt: string | null },
  now: Date,
) {
  const waiting = claim.outcome === 'wait';
  return {
    status: waiting ? 'retry_wait' as const : 'generating' as const,
    generation_id: claim.generationId,
    next_action: waiting ? 'resume_post' as const : 'poll' as const,
    retry_after_ms: waiting && claim.nextAttemptAt
      ? Math.max(0, Date.parse(claim.nextAttemptAt) - now.getTime())
      : POLL_RETRY_MS,
  };
}

function pendingFromRow(row: InsightDetailRow | InsightFollowUpRow, now: Date) {
  const active = row.status === 'generating'
    && Boolean(row.lease_expires_at)
    && Date.parse(row.lease_expires_at!) > now.getTime();
  const retryWait = row.status === 'retry_wait';
  return {
    status: retryWait ? 'retry_wait' as const : 'generating' as const,
    generation_id: row.id,
    next_action: active ? 'poll' as const : 'resume_post' as const,
    retry_after_ms: retryWait && row.next_attempt_at
      ? Math.max(0, Date.parse(row.next_attempt_at) - now.getTime())
      : POLL_RETRY_MS,
  };
}

async function handleGenerationError(
  dependencies: Dependencies,
  kind: 'detail' | 'follow_up',
  id: string,
  userId: string,
  claim: { leaseToken: string | null; leaseEpoch: number },
  error: unknown,
) {
  const classified = classify(error);
  const validationError = insightValidationError(error);
  if (process.env.NODE_ENV === 'production' && validationError) {
    console.warn('[insight-content] AI output rejected', {
      kind,
      code: validationError.code,
      error_detail: validationError.message.replace(/\s+/g, ' ').slice(0, 240),
    });
  }
  if (!claim.leaseToken) {
    return kind === 'detail'
      ? unavailableDetail('CLAIM_FAILED', true, id)
      : unavailableFollowUp('CLAIM_FAILED', true, id);
  }
  if (classified.retryable && claim.leaseEpoch < 3) {
    await dependencies.repository.markRetryWait({
      kind, id, userId, leaseToken: claim.leaseToken, leaseEpoch: claim.leaseEpoch,
      retryAfterSeconds: RETRY_WAIT_SECONDS, errorCode: classified.code, errorStage: 'generate',
      providerCalls: classified.providerCalls, providerInputBytes: classified.providerInputBytes,
      providerPromptTokens: classified.providerPromptTokens,
      providerBilledOutputTokens: classified.providerBilledOutputTokens,
    });
    return {
      status: 'retry_wait' as const,
      generation_id: id,
      next_action: 'resume_post' as const,
      retry_after_ms: RETRY_WAIT_SECONDS * 1_000,
    };
  }
  await dependencies.repository.markFailed({
    kind, id, userId, leaseToken: claim.leaseToken, leaseEpoch: claim.leaseEpoch,
    errorCode: classified.code, errorStage: 'generate',
    providerCalls: classified.providerCalls, providerInputBytes: classified.providerInputBytes,
    providerPromptTokens: classified.providerPromptTokens,
    providerBilledOutputTokens: classified.providerBilledOutputTokens,
  });
  return kind === 'detail'
    ? unavailableDetail('GENERATION_FAILED', false, id)
    : unavailableFollowUp('GENERATION_FAILED', false, id);
}

function insightValidationError(error: unknown): InsightCardContentValidationError | null {
  if (error instanceof InsightCardContentValidationError) return error;
  if (error instanceof InsightCardContentAiAttemptError) {
    return insightValidationError(error.causeError);
  }
  return null;
}

async function failInvalidFollowUpSource(
  dependencies: Dependencies,
  row: InsightFollowUpRow,
  userId: string,
  claim: { leaseToken: string | null; leaseEpoch: number },
  code: string,
): Promise<InsightFollowUpServiceResult> {
  if (claim.leaseToken) {
    await dependencies.repository.markFailed({
      kind: 'follow_up', id: row.id, userId, leaseToken: claim.leaseToken,
      leaseEpoch: claim.leaseEpoch, errorCode: code, errorStage: 'source',
      providerCalls: 0, providerInputBytes: 0,
      providerPromptTokens: 0, providerBilledOutputTokens: 0,
    });
  }
  return unavailableFollowUp(code, false, row.id);
}

function validateDetailInput(userId: string, input: ResolveInsightDetailRequest): void {
  if (!isUuid(userId) || !isUuid(input.source_batch_id)) throw new ValidationError('用户或源批次 ID 无效');
  if (!INSIGHT_SOURCE_TYPES.includes(input.source_type as never)) throw new ValidationError('source_type 无效');
  const item = input.source_item_id?.trim();
  if (!item || Array.from(item).length > 128 || Buffer.byteLength(item, 'utf8') > 512) {
    throw new ValidationError('source_item_id 无效');
  }
}

function validateFollowUpInput(
  userId: string,
  input: ResolveInsightFollowUpRequest,
): ResolveInsightFollowUpRequest {
  if (!isUuid(userId) || !isUuid(input.detail_id) || !isUuid(input.client_request_id)) {
    throw new ValidationError('用户、详情或请求 ID 无效');
  }
  if (input.parent_follow_up_id && !isUuid(input.parent_follow_up_id)) {
    throw new ValidationError('parent_follow_up_id 无效');
  }
  if (typeof input.question !== 'string') throw new ValidationError('question 必须是文本');
  const question = input.question.trim().normalize('NFC');
  if (!question || Array.from(question).length > 200 || Buffer.byteLength(question, 'utf8') > 2_048) {
    throw new ValidationError('question 必须为1–200个字符');
  }
  return { ...input, question };
}

function normalizeQuestionForIdentity(question: string): string {
  return question.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

function requiredFactRefs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12
    || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new ValidationError('源卡缺少可引用的命理事实');
  }
  return [...new Set(value as string[])];
}

function isCurrentDetail(row: InsightDetailRow): boolean {
  return row.contract_version === INSIGHT_CARD_CONTENT_CONTRACT_VERSION
    && row.output_schema_version === INSIGHT_CARD_DETAIL_SCHEMA_VERSION
    && row.prompt_version === detailPromptVersion(row.source_type)
    && row.model_id === insightContentModelIdentity();
}

function isCurrentFollowUp(row: InsightFollowUpRow): boolean {
  return row.contract_version === INSIGHT_CARD_CONTENT_CONTRACT_VERSION
    && row.prompt_version === INSIGHT_CARD_FOLLOW_UP_PROMPT_VERSION
    && row.output_schema_version === INSIGHT_CARD_FOLLOW_UP_SCHEMA_VERSION
    && row.model_id === insightContentModelIdentity();
}

function unavailableDetail(cause: string, retryable: boolean, generationId?: string): InsightDetailServiceResult {
  return generationId
    ? { status: 'unavailable', cause, retryable, generation_id: generationId }
    : { status: 'unavailable', cause, retryable };
}

function unavailableFollowUp(cause: string, retryable: boolean, generationId?: string): InsightFollowUpServiceResult {
  return generationId
    ? { status: 'unavailable', cause, retryable, generation_id: generationId }
    : { status: 'unavailable', cause, retryable };
}

function classify(error: unknown): {
  code: string;
  retryable: boolean;
  providerCalls: number;
  providerInputBytes: number;
  providerPromptTokens: number;
  providerBilledOutputTokens: number;
} {
  if (error instanceof InsightCardContentAiAttemptError) {
    const cause = classify(error.causeError);
    return {
      ...cause,
      providerCalls: error.providerCalls,
      providerInputBytes: error.inputBytes,
      providerPromptTokens: error.metrics?.prompt_tokens ?? 0,
      providerBilledOutputTokens: error.metrics?.billed_output_tokens ?? 0,
    };
  }
  if (error instanceof DailyFortuneAiError) {
    return {
      code: error.code.toUpperCase(),
      retryable: error.retryable,
      providerCalls: error.code === 'configuration' || error.code === 'input_too_large' ? 0 : 1,
      providerInputBytes: 0,
      providerPromptTokens: 0,
      providerBilledOutputTokens: 0,
    };
  }
  if (error instanceof InsightCardContentValidationError) {
    const terminal = new Set([
      'SOURCE_FACTS_INCOMPLETE',
      'TIME_FACTS_INCOMPLETE',
      'BOUNDARY_VIOLATION',
    ]);
    return {
      code: error.code,
      retryable: !terminal.has(error.code),
      providerCalls: 1,
      providerInputBytes: 0,
      providerPromptTokens: 0,
      providerBilledOutputTokens: 0,
    };
  }
  return {
    code: 'INTERNAL', retryable: true, providerCalls: 0, providerInputBytes: 0,
    providerPromptTokens: 0, providerBilledOutputTokens: 0,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function detailPromptVersion(sourceType: 'large' | 'medium'): string {
  return sourceType === 'large'
    ? INSIGHT_CARD_LARGE_DETAIL_PROMPT_VERSION
    : INSIGHT_CARD_MEDIUM_DETAIL_PROMPT_VERSION;
}

function sourceTitle(sourceType: 'large' | 'medium', source: Record<string, unknown>): string {
  const value = sourceType === 'large' ? source.question : source.title;
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError('源卡标题无效');
  }
  return value.trim().normalize('NFC');
}

function sourcePreview(source: Record<string, unknown>): string {
  if (typeof source.preview !== 'string' || !source.preview.trim()) {
    throw new ValidationError('源卡预览无效');
  }
  return source.preview.trim().normalize('NFC');
}
