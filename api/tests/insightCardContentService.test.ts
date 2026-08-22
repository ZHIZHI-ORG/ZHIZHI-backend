import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.INSIGHT_CONTENT_AI_MODEL ||= 'gemini-test';

const { createInsightCardContentService } = require('../src/services/insightCardContentService') as typeof import('../src/services/insightCardContentService');
const { InsightCardContentRepositoryError } = require('../src/database/repositories/InsightCardContentRepository') as typeof import('../src/database/repositories/InsightCardContentRepository');
const { InsightCardContentAiAttemptError } = require('../src/utils/insightCardContentAi') as typeof import('../src/utils/insightCardContentAi');
const { DailyFortuneAiError } = require('../src/utils/dailyFortuneAi') as typeof import('../src/utils/dailyFortuneAi');

const userId = '00000000-0000-4000-8000-000000000001';
const profileId = '00000000-0000-4000-8000-000000000002';
const batchId = '00000000-0000-4000-8000-000000000003';
const largeDetailId = '00000000-0000-4000-8000-000000000004';
const mediumDetailId = '00000000-0000-4000-8000-000000000005';
const followUpId = '00000000-0000-4000-8000-000000000006';
const clientRequestId = '00000000-0000-4000-8000-000000000007';
const parentFollowUpId = '00000000-0000-4000-8000-000000000008';
const mediumItemId = '00000000-0000-4000-8000-000000000009';

const metrics = {
  provider_calls: 1,
  input_bytes: 74_000,
  duration_ms: 20,
  prompt_tokens: 18_500,
  output_tokens: 800,
  thinking_tokens: 200,
  billed_output_tokens: 1_000,
  total_tokens: 19_500,
  provider_response_bytes: 3_000,
};

const foundationRefs = ['F2', 'F3', 'F4', 'F5'];
const mediumRefs = [...foundationRefs, 'F1'];
const largeRefs = [...foundationRefs, 'natal:test', 'time:test'];
const foundationFacts = [
  { ref: 'F2', source: 'month_command', fact_payload: { value: { month_branch: '卯' } } },
  { ref: 'F3', source: 'day_master_capacity', fact_payload: { value: { day_master: '庚' } } },
  { ref: 'F4', source: 'pattern_candidates', fact_payload: { value: { regular: [] } } },
  { ref: 'F5', source: 'yongshen_basis', fact_payload: { value: { notes: ['依据材料'] } } },
];

function repeatedText(length: number): string {
  return '这'.repeat(length);
}

function detailRow(sourceType: 'medium' | 'large', ready = false): any {
  const id = sourceType === 'large' ? largeDetailId : mediumDetailId;
  const sourceItemId = sourceType === 'large' ? 'candidate-1' : mediumItemId;
  const factRefs = sourceType === 'large' ? largeRefs : mediumRefs;
  const sourceItem = sourceType === 'large'
    ? {
        question: '未来三个月我该把精力放在哪个工作选择上？',
        preview: '这条判断聚焦当前节奏与选择边界。',
        body: '先看机会是否满足资源和时间条件，再决定是否投入。',
        event_hypothesis: { fact_refs: ['natal:test', 'time:test'] },
      }
    : {
        title: '工作节奏的稳定方式',
        preview: '你更适合先确认边界，再持续推进一个明确目标。',
        fact_refs: ['F1'],
      };
  return {
    id,
    generation_key: 'x'.repeat(64),
    user_id: userId,
    profile_id: profileId,
    source_type: sourceType,
    source_batch_id: batchId,
    source_item_id: sourceItemId,
    source_item_snapshot_json: sourceItem,
    selected_fact_snapshot_json: {
      version: 'selected_fact_snapshot_v2',
      facts: [
        ...foundationFacts,
        ...(sourceType === 'large'
          ? [
              { ref: 'natal:test', source: 'natal_pillar', canonical_text: '月柱丁卯' },
              { ref: 'time:test', source: 'timeline_window', canonical_text: '未来三个月窗口' },
            ]
          : [{ ref: 'F1', source: 'natal_pillar', canonical_text: '月柱丁卯' }]),
      ],
    },
    grounding_context_snapshot_json: { current_goal: '产品上线', mbti: 'INTJ' },
    fact_refs_json: factRefs,
    status: ready ? 'ready' : 'generating',
    lease_token: ready ? null : 'lease',
    lease_epoch: 1,
    lease_expires_at: ready ? null : '2026-08-16T12:02:30.000Z',
    attempt_count: 1,
    provider_attempt_count: ready ? 1 : 0,
    provider_input_bytes: ready ? metrics.input_bytes : 0,
    provider_prompt_tokens: ready ? metrics.prompt_tokens : 0,
    provider_billed_output_tokens: ready ? metrics.billed_output_tokens : 0,
    next_attempt_at: null,
    detail_json: ready ? {
      detail_id: id,
      source_type: sourceType,
      source_batch_id: batchId,
      source_item_id: sourceItemId,
      title: sourceType === 'large' ? sourceItem.question : sourceItem.title,
      preview: sourceItem.preview,
      body: repeatedText(sourceType === 'large' ? 620 : 300),
      fact_refs: sourceType === 'large' ? ['natal:test', 'time:test'] : ['F1'],
      suggested_follow_ups: ['这条判断在现实中怎样验证？', '我现在最值得先做哪一步？'],
      follow_ups: [],
    } : null,
    contract_version: 'insight_card_content_v2',
    prompt_version: sourceType === 'large' ? 'insight_large_detail_prompt_v4' : 'insight_medium_detail_prompt_v4',
    output_schema_version: 'insight_card_detail_output_v2',
    model_id: ready ? 'gemini-test' : 'pending',
    generation_metrics_json: ready ? metrics : null,
    last_error_code: null,
    last_error_stage: null,
    ready_at: ready ? '2026-08-16T12:00:00.000Z' : null,
    created_at: '2026-08-16T12:00:00.000Z',
    updated_at: '2026-08-16T12:00:00.000Z',
  };
}

async function verifyDetailGeneration(sourceType: 'medium' | 'large') {
  let row = detailRow(sourceType);
  let generatedInput: any;
  const expectedTitle = sourceType === 'large'
    ? row.source_item_snapshot_json.question
    : row.source_item_snapshot_json.title;
  const body = repeatedText(sourceType === 'large' ? 620 : 300);
  const usedRefs = sourceType === 'large' ? ['natal:test', 'time:test'] : ['F1'];
  const service = createInsightCardContentService({
    repository: {
      claimDetail: async () => ({ outcome: 'owner', generationId: row.id, status: 'generating', leaseToken: 'lease', leaseEpoch: 1, leaseExpiresAt: '2026-08-16T12:02:30.000Z', nextAttemptAt: null }),
      findDetail: async () => row,
      findReadyConversation: async () => [],
      finalizeDetail: async (input: any) => {
        row = {
          ...row,
          status: 'ready',
          lease_token: null,
          ready_at: '2026-08-16T12:00:10.000Z',
          model_id: input.modelId,
          generation_metrics_json: input.metrics,
          provider_attempt_count: 1,
          detail_json: {
            detail_id: row.id,
            source_type: sourceType,
            source_batch_id: batchId,
            source_item_id: row.source_item_id,
            ...input.detail,
          },
        };
        return true;
      },
    } as any,
    generateDetail: async (input: any) => {
      generatedInput = input;
      return {
        content: {
          body,
          fact_refs: usedRefs,
          suggested_follow_ups: ['这条判断在现实中怎样验证？', '我现在最值得先做哪一步？'],
        },
        modelId: 'gemini-test',
        promptVersion: sourceType === 'large' ? 'insight_large_detail_prompt_v4' : 'insight_medium_detail_prompt_v4',
        schemaVersion: 'insight_card_detail_output_v2',
        metrics,
      } as any;
    },
  });

  const result = await service.resolveDetail(userId, {
    source_type: sourceType,
    source_batch_id: batchId,
    source_item_id: row.source_item_id,
  });
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') {
    assert.equal(result.detail.title, expectedTitle);
    assert.equal(result.detail.preview, row.source_item_snapshot_json.preview);
    assert.equal(result.detail.body, body);
    assert.equal(result.detail.suggested_follow_ups.length, 2);
  }
  assert.equal(generatedInput.sourceType, sourceType);
  assert.deepEqual(
    generatedInput.selectedFactSnapshot.facts.slice(0, 4).map((fact: any) => fact.source),
    ['month_command', 'day_master_capacity', 'pattern_candidates', 'yongshen_basis'],
  );
  assert.deepEqual(generatedInput.allowedFactRefs, sourceType === 'large' ? largeRefs : mediumRefs);
  return row;
}

async function main() {
  const largeReady = await verifyDetailGeneration('large');
  const mediumReady = await verifyDetailGeneration('medium');
  assert.equal(largeReady.provider_attempt_count, 1, '大卡500–800字详情必须在点击后真实生成');
  assert.equal(mediumReady.provider_attempt_count, 1, '中卡约300字详情必须在点击后真实生成');

  let readyGenerateCalls = 0;
  const cached = detailRow('large', true);
  const cachedService = createInsightCardContentService({
    repository: {
      claimDetail: async () => ({ outcome: 'ready', generationId: largeDetailId, status: 'ready', leaseToken: null, leaseEpoch: 1, leaseExpiresAt: null, nextAttemptAt: null }),
      findDetail: async () => cached,
      findReadyConversation: async () => [{
        follow_up_id: followUpId, parent_follow_up_id: null, question: '之前的问题',
        answer: '之前已经持久化的真实回答。', fact_refs: ['time:test'],
        created_at: '2026-08-16T12:01:00.000Z',
      }],
    } as any,
    generateDetail: async () => { readyGenerateCalls += 1; throw new Error('READY must not regenerate'); },
  });
  const cachedResult = await cachedService.resolveDetail(userId, {
    source_type: 'large', source_batch_id: batchId, source_item_id: 'candidate-1',
  });
  assert.equal(cachedResult.status, 'ready');
  assert.equal(readyGenerateCalls, 0, '同一大卡重复打开必须读取持久化详情，不重复付费');
  if (cachedResult.status === 'ready') assert.equal(cachedResult.detail.follow_ups.length, 1);

  let follow = {
    id: followUpId, generation_key: 'y'.repeat(64), user_id: userId, detail_id: mediumDetailId,
    parent_follow_up_id: parentFollowUpId, client_request_id: clientRequestId,
    normalized_question_hash: 'z'.repeat(64), question: '结合我的当前目标，最值得观察什么？',
    status: 'generating', lease_token: 'lease-follow', lease_epoch: 1,
    lease_expires_at: '2026-08-16T12:02:30.000Z', attempt_count: 1, provider_attempt_count: 0,
    provider_input_bytes: 0, provider_prompt_tokens: 0, provider_billed_output_tokens: 0,
    next_attempt_at: null, input_snapshot_json: null, answer_json: null,
    contract_version: 'insight_card_content_v2', prompt_version: 'insight_card_follow_up_prompt_v4',
    output_schema_version: 'insight_card_follow_up_output_v1', model_id: 'pending',
    generation_metrics_json: null, last_error_code: null, last_error_stage: null, ready_at: null,
    created_at: '2026-08-16T12:00:00.000Z', updated_at: '2026-08-16T12:00:00.000Z',
  } as any;
  let ancestryInput: any;
  let generatedHistory: any;
  const followService = createInsightCardContentService({
    repository: {
      claimFollowUp: async () => ({ outcome: 'owner', generationId: followUpId, status: 'generating', leaseToken: 'lease-follow', leaseEpoch: 1, leaseExpiresAt: '2026-08-16T12:02:30.000Z', nextAttemptAt: null }),
      findFollowUp: async () => follow,
      findDetail: async () => mediumReady,
      findReadyConversation: async () => [],
      findReadyAncestry: async (...args: any[]) => {
        ancestryInput = args;
        return [{ follow_up_id: parentFollowUpId, parent_follow_up_id: null, question: '上一个问题',
          answer: '上一个已完成的回答', fact_refs: ['F1'], created_at: '2026-08-16T11:59:00.000Z' }];
      },
      finalizeFollowUp: async (input: any) => {
        follow = { ...follow, status: 'ready', lease_token: null, input_snapshot_json: input.inputSnapshot,
          answer_json: { follow_up_id: followUpId, detail_id: mediumDetailId,
            parent_follow_up_id: parentFollowUpId, question: follow.question, ...input.answer },
          model_id: input.modelId, generation_metrics_json: input.metrics, ready_at: '2026-08-16T12:00:10.000Z' };
        return true;
      },
    } as any,
    generateFollowUp: async (input: any) => {
      generatedHistory = input.conversationHistory;
      return {
        content: { answer: repeatedText(220), fact_refs: ['F1'] },
        inputSnapshot: { selected_fact_snapshot: input.selectedFactSnapshot },
        modelId: 'gemini-test', promptVersion: 'insight_card_follow_up_prompt_v4',
        schemaVersion: 'insight_card_follow_up_output_v1', metrics,
      } as any;
    },
  });
  const followResult = await followService.resolveFollowUp(userId, {
    detail_id: mediumDetailId, client_request_id: clientRequestId,
    question: '  结合我的当前目标，最值得观察什么？  ', parent_follow_up_id: parentFollowUpId,
  });
  assert.equal(followResult.status, 'ready');
  assert.deepEqual(ancestryInput, [userId, mediumDetailId, parentFollowUpId, 2]);
  assert.equal(generatedHistory.length, 1, '追问只携带当前分支最近两轮，不跨卡扩散上下文');
  assert.deepEqual(
    mediumReady.selected_fact_snapshot_json.facts.slice(0, 4).map((fact: any) => fact.source),
    ['month_command', 'day_master_capacity', 'pattern_candidates', 'yongshen_basis'],
  );

  const retryingMedium = detailRow('medium');
  let failureUsage: any;
  const failingService = createInsightCardContentService({
    repository: {
      claimDetail: async () => ({ outcome: 'owner', generationId: mediumDetailId, status: 'generating', leaseToken: 'lease', leaseEpoch: 1, leaseExpiresAt: '2026-08-16T12:02:30.000Z', nextAttemptAt: null }),
      findDetail: async () => retryingMedium,
      markRetryWait: async (input: any) => { failureUsage = input; return true; },
    } as any,
    generateDetail: async () => {
      throw new InsightCardContentAiAttemptError(
        new DailyFortuneAiError('timeout', 'provider timeout', true), 1, 4_321, metrics,
      );
    },
  });
  const failedAttempt = await failingService.resolveDetail(userId, {
    source_type: 'medium', source_batch_id: batchId, source_item_id: mediumItemId,
  });
  assert.equal(failedAttempt.status, 'retry_wait');
  assert.equal(failureUsage.providerInputBytes, 4_321);
  assert.equal(failureUsage.providerPromptTokens, metrics.prompt_tokens);
  assert.equal(failureUsage.providerBilledOutputTokens, metrics.billed_output_tokens);

  let disabledClaims = 0;
  const disabledService = createInsightCardContentService({
    generationEnabled: () => false,
    repository: { claimDetail: async () => { disabledClaims += 1; throw new Error('must not claim'); } } as any,
  });
  const disabled = await disabledService.resolveDetail(userId, {
    source_type: 'large', source_batch_id: batchId, source_item_id: 'candidate-1',
  });
  assert.deepEqual(disabled, { status: 'unavailable', cause: 'GENERATION_DISABLED', retryable: false });
  assert.equal(disabledClaims, 0, '紧急开关必须在数据库 claim 和 provider 调用之前生效');

  for (const databaseCode of ['P4291', 'P4292']) {
    let generationCalls = 0;
    const limitedService = createInsightCardContentService({
      repository: { claimDetail: async () => {
        throw new InsightCardContentRepositoryError('claimDetail', 'detail limit', databaseCode);
      } } as any,
      generateDetail: async () => { generationCalls += 1; throw new Error('must not generate'); },
    });
    await assert.rejects(
      () => limitedService.resolveDetail(userId, {
        source_type: 'large', source_batch_id: batchId, source_item_id: 'candidate-1',
      }),
      (error: any) => error.databaseCode === databaseCode,
    );
    assert.equal(generationCalls, 0, '共享详情限额必须在大小卡 provider 调用之前中止');
  }

  console.log('✓ insight service generates and caches V2 large/medium bodies, reuses frozen facts, bounds follow-ups, and records cost');
}

void main();
