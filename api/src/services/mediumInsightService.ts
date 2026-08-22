import { randomUUID } from 'node:crypto';
import {
  MediumInsightBatchRow,
  MediumInsightRepository,
  mediumInsightRepository,
} from '../database/repositories/MediumInsightRepository';
import { userRepository } from '../database/repositories/UserRepository';
import {
  MEDIUM_INSIGHT_CONTRACT_VERSION,
  MEDIUM_INSIGHT_CONTEXT_VERSION,
  MEDIUM_INSIGHT_DOMAINS,
  MEDIUM_INSIGHT_EVENT_TYPES,
  MEDIUM_INSIGHT_FACT_VERSION,
  MEDIUM_INSIGHT_OUTPUT_SCHEMA_VERSION,
  MEDIUM_INSIGHT_PROMPT_VERSION,
  MediumInsightBatch,
  MediumInsightDomainCards,
  MediumInsightEventRequest,
  MediumInsightRecentCard,
  MediumInsightResolveRequest,
} from '../models/MediumInsight';
import { DailyFortuneAiError } from '../utils/dailyFortuneAi';
import { generateMediumInsightsWithAi } from '../utils/mediumInsightAi';
import { MediumInsightContentError } from '../utils/mediumInsightValidator';
import { NotFoundError, ValidationError } from '../utils/errors';
import { getBaziDailyFortuneEngineBundle } from './baziService';
import {
  buildDailyFortuneFactPackage,
  DailyFortuneFactError,
  resolveDailyFortuneDate,
} from './dailyFortuneService';
import {
  hashMediumInsightFactSnapshot,
  MediumInsightFactError,
  projectMediumInsightFacts,
} from './mediumInsightFactProjector';

const GENERATOR_VERSION = 'medium_generator_v5';
const POLL_RETRY_MS = 1_500;
const RETRY_WAIT_SECONDS = 15;

export type MediumInsightServiceResult =
  | { status: 'ready'; generation_id: string; batch: MediumInsightBatch }
  | {
      status: 'generating' | 'retry_wait'; generation_id: string; effective_date: string;
      next_action: 'poll' | 'resume_post'; retry_after_ms: number;
    }
  | {
      status: 'unavailable'; cause: string; retryable: boolean;
      generation_id?: string; next_refresh_at?: string;
    };

interface MediumInsightDependencies {
  batches: Pick<MediumInsightRepository,
    'claim' | 'findById' | 'findHead' | 'findRecentReady' | 'finalize' | 'markRetryWait' | 'markFailed' | 'recordEvent'>;
  getEngineBundle: typeof getBaziDailyFortuneEngineBundle;
  getUser: typeof userRepository.findById;
  generate: typeof generateMediumInsightsWithAi;
  now: () => Date;
  mode: () => 'off' | 'read_only' | 'on';
}

const defaultDependencies: MediumInsightDependencies = {
  batches: mediumInsightRepository,
  getEngineBundle: getBaziDailyFortuneEngineBundle,
  getUser: userRepository.findById.bind(userRepository),
  generate: generateMediumInsightsWithAi,
  now: () => new Date(),
  mode: readMode,
};

export function createMediumInsightService(overrides: Partial<MediumInsightDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return {
    resolveDaily: (userId: string, input: MediumInsightResolveRequest) => resolveDaily(dependencies, userId, input),
    poll: (userId: string, generationId: string) => poll(dependencies, userId, generationId),
    recordEvent: (userId: string, input: MediumInsightEventRequest) => recordEvent(dependencies, userId, input),
  };
}

const service = createMediumInsightService();
export const resolveMediumInsightDaily = service.resolveDaily;
export const pollMediumInsightDaily = service.poll;
export const recordMediumInsightEvent = service.recordEvent;

async function resolveDaily(
  dependencies: MediumInsightDependencies,
  userId: string,
  input: MediumInsightResolveRequest,
): Promise<MediumInsightServiceResult> {
  try {
    return await resolveDailyOnce(dependencies, userId, input);
  } catch (error) {
    if (isTargetDateRace(error)) return resolveDailyOnce(dependencies, userId, input);
    throw error;
  }
}

async function resolveDailyOnce(
  dependencies: MediumInsightDependencies,
  userId: string,
  input: MediumInsightResolveRequest,
): Promise<MediumInsightServiceResult> {
  validateResolveInput(userId, input);
  const mode = dependencies.mode();
  if (mode === 'off') return unavailable('GENERATION_DISABLED', false);
  const date = resolveDailyFortuneDate(dependencies.now(), input.timezone);
  if (mode === 'read_only') {
    const head = await dependencies.batches.findHead(userId, input.bazi_profile_id);
    if (!head || head.status !== 'ready' || !isCurrentReadyBatchVersion(head)) {
      return unavailable('READ_ONLY_MISS', false);
    }
    return ready(head, nextRefreshAt(dependencies.now(), input.timezone, head.effective_date), false);
  }

  const existingHead = await dependencies.batches.findHead(userId, input.bazi_profile_id);
  const targetDate = existingHead && existingHead.effective_date > date.effectiveDate
    ? existingHead.effective_date
    : date.effectiveDate;
  const [bundle, user] = await Promise.all([
    dependencies.getEngineBundle(userId, input.bazi_profile_id, targetDate),
    dependencies.getUser(userId),
  ]);
  if (!bundle.profile.is_owner) throw new NotFoundError('本人八字档案不存在');
  let projection;
  try {
    const facts = buildDailyFortuneFactPackage(bundle, targetDate, input.timezone, user);
    projection = projectMediumInsightFacts({
      profile: bundle.profile,
      facts,
      zipingStructureFacts: bundle.zipingStructureFacts,
    });
  } catch (error) {
    if (error instanceof MediumInsightFactError) {
      return unavailable(error.code, false);
    }
    if (error instanceof DailyFortuneFactError) {
      return unavailable('FACTS_INCOMPLETE', false);
    }
    throw error;
  }
  const { snapshot, groundingContext } = projection;
  const factHash = hashMediumInsightFactSnapshot(snapshot);
  const claim = await dependencies.batches.claim({
    userId,
    profileId: input.bazi_profile_id,
    candidateDate: date.effectiveDate,
    profileUpdatedAt: bundle.profile.updated_at,
    factHash,
    snapshot,
    groundingContext,
    timezone: input.timezone,
    sourceBoundaryAt: date.nextBoundaryAt,
    contractVersion: MEDIUM_INSIGHT_CONTRACT_VERSION,
    factProjectionVersion: MEDIUM_INSIGHT_FACT_VERSION,
    contextProjectionVersion: MEDIUM_INSIGHT_CONTEXT_VERSION,
    generatorVersion: GENERATOR_VERSION,
    promptVersion: MEDIUM_INSIGHT_PROMPT_VERSION,
    outputSchemaVersion: MEDIUM_INSIGHT_OUTPUT_SCHEMA_VERSION,
  });

  if (!claim.batchId) return unavailable(claim.outcome === 'busy' ? 'GENERATION_BUSY' : 'CLAIM_FAILED', true);
  if (claim.outcome === 'ready') {
    const row = await requiredBatch(dependencies, userId, claim.batchId);
    if (!isCurrentReadyBatchVersion(row)) return unavailable('STALE_CONTRACT', true, row.id);
    return ready(row, nextRefreshAt(dependencies.now(), input.timezone, row.effective_date), claim.timezoneChangePending);
  }
  if (claim.outcome === 'failed' || claim.outcome === 'fact_revision_exhausted') {
    return unavailable(
      claim.outcome === 'failed' ? 'GENERATION_FAILED_FOR_DATE' : 'FACT_REVISION_EXHAUSTED',
      false,
      claim.batchId,
      nextRefreshAt(dependencies.now(), input.timezone, claim.effectiveDate),
    );
  }
  if (claim.outcome === 'join' || claim.outcome === 'wait') {
    return pending({
      batchId: claim.batchId,
      effectiveDate: claim.effectiveDate,
      outcome: claim.outcome,
      nextAttemptAt: claim.nextAttemptAt,
    }, dependencies.now());
  }
  if ((claim.outcome !== 'owner' && claim.outcome !== 'owner_takeover') || !claim.leaseToken) {
    return unavailable('CLAIM_FAILED', true, claim.batchId);
  }

  const recentCards = recentCardsFromRows(
    await dependencies.batches.findRecentReady(userId, input.bazi_profile_id, claim.effectiveDate),
  );
  try {
    const generated = await dependencies.generate({ snapshot, groundingContext, recentCards });
    const domains = generated.output.domains.map((domain): MediumInsightDomainCards => ({
      domain: domain.domain,
      cards: domain.cards.map((card, position) => ({
        ...card,
        content_id: randomUUID(),
        position,
      })),
    }));
    const didFinalize = await dependencies.batches.finalize({
      batchId: claim.batchId,
      userId,
      leaseToken: claim.leaseToken,
      leaseEpoch: claim.leaseEpoch,
      domains,
      promptVersion: generated.promptVersion,
      outputSchemaVersion: generated.outputSchemaVersion,
      modelId: generated.modelId,
      metrics: generated.metrics,
    });
    if (!didFinalize) return unavailable('LEASE_LOST_OR_PROFILE_CHANGED', true, claim.batchId);
    const row = await requiredBatch(dependencies, userId, claim.batchId);
    return ready(row, nextRefreshAt(dependencies.now(), input.timezone, row.effective_date), claim.timezoneChangePending);
  } catch (error) {
    const classification = classifyGenerationError(error);
    if (classification.retryable && claim.leaseEpoch < 3) {
      await dependencies.batches.markRetryWait({
        batchId: claim.batchId, userId, leaseToken: claim.leaseToken, leaseEpoch: claim.leaseEpoch,
        retryAfterSeconds: RETRY_WAIT_SECONDS, errorCode: classification.code, errorStage: 'generate',
      });
      return {
        status: 'retry_wait', generation_id: claim.batchId, effective_date: claim.effectiveDate,
        next_action: 'resume_post', retry_after_ms: RETRY_WAIT_SECONDS * 1_000,
      };
    }
    await dependencies.batches.markFailed({
      batchId: claim.batchId, userId, leaseToken: claim.leaseToken, leaseEpoch: claim.leaseEpoch,
      errorCode: classification.code, errorStage: 'generate',
    });
    return unavailable('GENERATION_FAILED_FOR_DATE', false, claim.batchId,
      nextRefreshAt(dependencies.now(), input.timezone, claim.effectiveDate));
  }
}

async function poll(
  dependencies: MediumInsightDependencies,
  userId: string,
  generationId: string,
): Promise<MediumInsightServiceResult> {
  if (!isUuid(generationId)) throw new ValidationError('generation_id 必须是 UUID');
  const row = await dependencies.batches.findById(userId, generationId);
  if (!row) throw new NotFoundError('中卡批次不存在');
  if (!isCurrentBatchBaseVersion(row)) return unavailable('STALE_CONTRACT', false, row.id);
  const head = await dependencies.batches.findHead(userId, row.profile_id);
  if (!head || head.id !== row.id) return unavailable('STALE_GENERATION', true, row.id);
  if (row.status === 'ready') {
    return ready(row, nextRefreshAt(dependencies.now(), row.generation_timezone, row.effective_date), false);
  }
  if (row.status === 'failed') {
    return unavailable('GENERATION_FAILED_FOR_DATE', false, row.id,
      nextRefreshAt(dependencies.now(), row.generation_timezone, row.effective_date));
  }
  const now = dependencies.now().getTime();
  const active = row.status === 'generating'
    && row.lease_expires_at !== null
    && Date.parse(row.lease_expires_at) > now;
  const resumeAt = row.status === 'retry_wait' && row.next_attempt_at
    ? Math.max(0, Date.parse(row.next_attempt_at) - now)
    : 0;
  return {
    status: row.status,
    generation_id: row.id,
    effective_date: row.effective_date,
    next_action: active ? 'poll' : 'resume_post',
    retry_after_ms: active ? POLL_RETRY_MS : resumeAt,
  };
}

async function recordEvent(
  dependencies: MediumInsightDependencies,
  userId: string,
  input: MediumInsightEventRequest,
): Promise<{ accepted: true; duplicate: boolean }> {
  validateEvent(input);
  const result = await dependencies.batches.recordEvent(userId, input);
  return { accepted: true, duplicate: result === 'duplicate' };
}

function ready(row: MediumInsightBatchRow, refreshAt: string, timezoneChangePending: boolean): MediumInsightServiceResult {
  if (!row.cards_json) return unavailable('READY_PAYLOAD_INVALID', false, row.id);
  if (!isCurrentReadyBatchVersion(row)) return unavailable('STALE_CONTRACT', false, row.id);
  return {
    status: 'ready',
    generation_id: row.id,
    batch: {
      batch_id: row.id,
      bazi_profile_id: row.profile_id,
      effective_date: row.effective_date,
      timezone: row.generation_timezone,
      next_refresh_at: refreshAt,
      timezone_change_pending: timezoneChangePending,
      contract_version: row.contract_version as typeof MEDIUM_INSIGHT_CONTRACT_VERSION,
      domains: row.cards_json.domains,
    },
  };
}

function pending(
  claim: { batchId: string; effectiveDate: string; outcome: 'join' | 'wait'; nextAttemptAt: string | null },
  now: Date,
): MediumInsightServiceResult {
  const waitMs = claim.outcome === 'wait' && claim.nextAttemptAt
    ? Math.max(0, Date.parse(claim.nextAttemptAt) - now.getTime())
    : POLL_RETRY_MS;
  return {
    status: claim.outcome === 'wait' ? 'retry_wait' : 'generating',
    generation_id: claim.batchId,
    effective_date: claim.effectiveDate,
    next_action: claim.outcome === 'wait' ? 'resume_post' : 'poll',
    retry_after_ms: waitMs,
  };
}

function unavailable(
  cause: string,
  retryable: boolean,
  generationId?: string,
  nextRefreshAt?: string,
): MediumInsightServiceResult {
  return { status: 'unavailable', cause, retryable, generation_id: generationId, next_refresh_at: nextRefreshAt };
}

async function requiredBatch(
  dependencies: MediumInsightDependencies,
  userId: string,
  batchId: string,
): Promise<MediumInsightBatchRow> {
  const row = await dependencies.batches.findById(userId, batchId);
  if (!row) throw new NotFoundError('中卡批次不存在');
  return row;
}

function recentCardsFromRows(rows: MediumInsightBatchRow[]): MediumInsightRecentCard[] {
  const seenDates = new Set<string>();
  const cards: MediumInsightRecentCard[] = [];
  for (const row of rows) {
    if (!row.cards_json || seenDates.has(row.effective_date)) continue;
    seenDates.add(row.effective_date);
    for (const domain of row.cards_json.domains) {
      for (const card of domain.cards) cards.push({ domain: domain.domain, title: card.title, preview: card.preview });
    }
  }
  return cards;
}

function nextRefreshAt(now: Date, timezone: string, latestDate: string): string {
  let cursor = new Date(now);
  for (let day = 0; day < 4; day += 1) {
    const candidate = resolveDailyFortuneDate(cursor, timezone);
    if (candidate.effectiveDate > latestDate) return candidate.nextBoundaryAt;
    cursor = new Date(Date.parse(candidate.nextBoundaryAt) + 1_000);
  }
  throw new ValidationError('无法计算下一次中卡刷新时间');
}

function validateResolveInput(userId: string, input: MediumInsightResolveRequest): void {
  if (!isUuid(userId) || !isUuid(input.bazi_profile_id)) throw new ValidationError('用户或档案 ID 无效');
  if (!input.timezone || input.timezone.length > 128) throw new ValidationError('timezone 无效');
}

function validateEvent(input: MediumInsightEventRequest): void {
  if (!isUuid(input.event_id) || !isUuid(input.profile_id)) throw new ValidationError('事件或档案 ID 无效');
  if (!MEDIUM_INSIGHT_EVENT_TYPES.includes(input.event_type as never)) throw new ValidationError('事件类型无效');
  if (!input.session_id || input.session_id.length > 128) throw new ValidationError('session_id 无效');
  if (Number.isNaN(Date.parse(input.occurred_at))) throw new ValidationError('occurred_at 无效');
  const cardEvent = input.event_type === 'exposure' || input.event_type === 'open';
  if (cardEvent && (!input.batch_id || !input.content_id || !isUuid(input.batch_id) || !isUuid(input.content_id))) {
    throw new ValidationError('卡片事件缺少 batch_id 或 content_id');
  }
  if (input.event_type === 'batch_ready_presented' && (!input.batch_id || !isUuid(input.batch_id))) {
    throw new ValidationError('READY 呈现事件缺少 batch_id');
  }
}

function classifyGenerationError(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof DailyFortuneAiError) return { code: error.code.toUpperCase(), retryable: error.retryable };
  if (error instanceof MediumInsightContentError) return { code: error.code, retryable: true };
  return { code: 'GENERATION_INTERNAL', retryable: true };
}

function readMode(): 'off' | 'read_only' | 'on' {
  const mode = process.env.MEDIUM_INSIGHTS_V1_MODE?.trim();
  return mode === 'read_only' || mode === 'on' ? mode : 'off';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTargetDateRace(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'databaseCode' in error
    && (error as { databaseCode?: string }).databaseCode === '40001',
  );
}

function isCurrentBatchBaseVersion(row: MediumInsightBatchRow): boolean {
  return row.contract_version === MEDIUM_INSIGHT_CONTRACT_VERSION
    && row.fact_projection_version === MEDIUM_INSIGHT_FACT_VERSION
    && row.context_projection_version === MEDIUM_INSIGHT_CONTEXT_VERSION
    && row.generator_version === GENERATOR_VERSION
    && row.soft_context_snapshot_json?.version === MEDIUM_INSIGHT_CONTEXT_VERSION;
}

function isCurrentReadyBatchVersion(row: MediumInsightBatchRow): boolean {
  return isCurrentBatchBaseVersion(row)
    && row.prompt_version === MEDIUM_INSIGHT_PROMPT_VERSION
    && row.output_schema_version === MEDIUM_INSIGHT_OUTPUT_SCHEMA_VERSION;
}
