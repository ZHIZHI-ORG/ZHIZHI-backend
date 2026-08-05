import assert from 'node:assert/strict';
import type {
  RecommendationBatchRow,
} from '../src/database/repositories/RecommendationRepository';
import type { RecommendationAiOutput } from '../src/models/Recommendation';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const {
  createRecommendationService,
} = require('../src/services/recommendationService') as typeof import('../src/services/recommendationService');
const { DailyFortuneAiError } = require('../src/utils/dailyFortuneAi') as typeof import('../src/utils/dailyFortuneAi');

const now = new Date('2026-08-03T12:00:00.000Z');
const userId = '00000000-0000-4000-8000-000000000001';
const profileId = '00000000-0000-4000-8000-000000000002';
const rootBatchId = '00000000-0000-4000-8000-000000000003';
const nextBatchId = '00000000-0000-4000-8000-000000000004';
const thirdBatchId = '00000000-0000-4000-8000-000000000006';
const fourthBatchId = '00000000-0000-4000-8000-000000000007';

function run(name: string, test: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(test)
    .then(() => console.log(`✓ ${name}`))
    .catch((error) => {
      console.error(`✗ ${name}`);
      throw error;
    });
}

function bundle(relationshipStatus: string | null = null) {
  const participant = {
    type: 'natal_pillar',
    pillar: 'day',
    label: '日柱',
    stem: '己',
    branch: '丑',
    gan_zhi: '己丑',
    ten_gods: ['日主'],
  };
  const timingParticipant = {
    type: 'liuyue',
    pillar: null,
    label: '流月',
    stem: '乙',
    branch: '未',
    gan_zhi: '乙未',
    ten_gods: ['七杀'],
  };
  return {
    profile: {
      id: profileId,
      owner_user_id: userId,
      is_owner: true,
      name: '测试档案',
      gender: 'female',
      birth_year: 1992,
      birth_month: 6,
      birth_day: 8,
      birth_hour: null,
      birth_minute: null,
      is_lunar: false,
      birth_timezone: 'Asia/Shanghai',
      birth_region: '上海',
      mbti: 'INTJ',
      full_chart: { fixture: true },
      daily_fortune_context: {
        life_stage: { primary: '创业阶段', tags: ['产品验证'] },
        work_study: { mode: 'career', current_goal: '完成 MVP 上线' },
        relationship: { status: relationshipStatus, current_focus: null },
        zhizhi_understanding: {
          snapshot_version: 'understanding-v1',
          current_focus: ['事业推进'],
          expression_preferences: ['直接'],
          behavior_signals: ['偏好具体时间点'],
          updated_at: '2026-08-02T00:00:00.000Z',
        },
      },
      updated_at: '2026-08-01T00:00:00.000Z',
      created_at: '2026-08-01T00:00:00.000Z',
    },
    chart: {
      day_master: '己',
      day_master_element: '土',
      pillars: [
        pillar('year', '甲', '子'),
        pillar('month', '乙', '未'),
        pillar('day', '己', '丑'),
      ],
      mingli_facts: {
        rule_version: 'mingli_interactions_v1',
        natal_interactions: [],
      },
    },
    timeline: {
      active_luck_context: {
        dayun: timing('丁卯', '丁', '卯', {
          start_year: 2024,
          end_year: 2033,
        }),
        liunian: timing('丙午', '丙', '午', { year: 2026 }),
        liuyue: timing('乙未', '乙', '未', {
          start_date: '2026-07-07',
          end_date: '2026-08-07',
        }),
        liuri: timing('己丑', '己', '丑', { date: '2026-08-03' }),
      },
      timing_interactions: [
        interaction('liuyue-to-day-branch', timingParticipant, participant),
      ],
    },
  } as any;
}

function pillar(position: string, stem: string, branch: string) {
  return {
    position,
    stem,
    branch,
    ten_god: '比肩',
    hidden_stems: [{ stem, ten_god: '比肩', element: '土' }],
  };
}

function timing(gan_zhi: string, stem: string, branch: string, extra: Record<string, unknown>) {
  return {
    gan_zhi,
    stem,
    branch,
    hidden_stems: [{ stem, ten_god: '比肩', element: '土' }],
    ...extra,
  };
}

function interaction(id: string, source: unknown, target: unknown) {
  return {
    id,
    scope: 'liuyue_to_natal',
    relation: 'branch_clash',
    relation_name: '冲',
    fact_label: '流月冲日支',
    short_label: '冲',
    display_group: 'earthly_branch_luck',
    aliases: ['六冲'],
    participants: [source, target],
    source,
    targets: [target],
    transform_element: null,
    center_branch: null,
    activated_palaces: ['day'],
    domain_candidates: ['love'],
    intensity: 0.9,
    time_horizon: 'month',
    evidence: '测试事实证据',
    adjacent: false,
    full_match: true,
    missing_branch: null,
    seen_stem: null,
    compared_against: 'natal_and_timing',
    rule_version: 'mingli_interactions_v1',
  };
}

function generatedPool(): RecommendationAiOutput {
  const makeCandidate = (poolPosition: number) => ({
    candidate_id: `candidate-${poolPosition}`,
    pool_position: poolPosition,
    semantic_key: `${poolPosition % 2 === 0 ? 'love' : 'career'}:topic:${poolPosition}`,
    primary_time_window_key: 'liuyue:2026-07-07:乙未',
    referenced_window_keys: ['liuyue:2026-07-07:乙未'],
    content_profile: {
      domain: poolPosition % 2 === 0 ? 'love' as const : 'career' as const,
      topic_key: poolPosition % 2 === 0 ? 'relationship_progress' as const : 'career_direction' as const,
      question_job: 'forecast' as const,
      content_horizon: 'month' as const,
    },
    selection_role: poolPosition === 0 ? 'p1_mingli_change' as const : 'p3_diversity' as const,
    event_hypothesis: {
      event_family: 'relationship_progress' as const,
      claim_mode: 'conditional' as const,
      summary: '关系节奏可能因流月变化而出现调整。',
      fact_refs: [
        'time:liuyue:2026-07-07:乙未:interaction:liuyue-to-day-branch',
        'time:liuyue:2026-07-07:乙未:timing',
      ],
    },
    validity: { valid_from: '2026-07-07', valid_until: '2026-08-07' },
    question: '这个月关系节奏会怎么变化？',
    preview: '流月与日支的作用让关系中的回应方式值得留意。',
    body: '流月变化会让既有互动节奏更容易被放大。如果目前有伴侣，可以先确认双方对时间和回应的期待；如果单身，则留意新互动是否稳定推进。',
  });
  return {
    candidates: Array.from({ length: 30 }, (_, index) => makeCandidate(index)),
    generation_metrics: {
      model_id: 'gemini-test-pinned',
      outcome: 'success',
      input_json_bytes: 1000,
      request_bytes: 1200,
      provider_response_bytes: 2400,
      output_text_bytes: 2000,
      prompt_token_count: 300,
      cached_content_token_count: 0,
      candidates_token_count: 600,
      thoughts_token_count: 0,
      total_token_count: 900,
      latency_ms: 500,
      finish_reason: 'STOP',
    },
  };
}

function displayCards(deckCount = 6, centerCount = 3) {
  const candidates = generatedPool().candidates;
  return {
    deck_cards: candidates.slice(0, deckCount).map((candidate, position) => ({
      ...candidate,
      position,
      surface: 'deck' as const,
    })),
    center_cards: candidates.slice(deckCount, deckCount + centerCount).map((candidate, position) => ({
      ...candidate,
      position,
      surface: 'center' as const,
    })),
  };
}

function batchRow(overrides: Partial<RecommendationBatchRow> = {}): RecommendationBatchRow {
  return {
    id: rootBatchId,
    generation_key: 'generation-key',
    user_id: userId,
    profile_id: profileId,
    after_batch_id: null,
    effective_date: '2026-08-03',
    profile_revision_hash: 'profile-revision-a',
    profile_updated_at: '2026-08-01T00:00:00.000Z',
    generation_timezone: 'Asia/Hong_Kong',
    input_hash: 'input-hash',
    valid_until: '2026-08-03T15:00:00.000Z',
    status: 'ready',
    lease_token: null,
    lease_epoch: 1,
    lease_expires_at: null,
    attempt_count: 1,
    next_attempt_at: null,
    input_snapshot_json: null,
    cards_json: displayCards(),
    candidate_pool_json: null,
    generation_kind: 'ai',
    pool_source_batch_id: null,
    selection_context_json: null,
    generation_metrics_json: null,
    prompt_version: 'recommendation_prompt_v2',
    output_schema_version: 'recommendation_output_v1',
    taxonomy_version: 'recommendation_taxonomy_v1',
    model_id: 'gemini-test-pinned',
    created_at: '2026-08-03T10:00:00.000Z',
    ready_at: '2026-08-03T10:00:01.000Z',
    ...overrides,
  };
}

function preferenceSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    recent_14d: [],
    long_term_90d: [],
    current_session_opens: [],
    content_history: [],
    time_window_history: [],
    ...overrides,
  } as any;
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    claim: async () => ({
      outcome: 'owner',
      batchId: nextBatchId,
      status: 'generating',
      leaseToken: '00000000-0000-4000-8000-000000000005',
      leaseEpoch: 1,
      leaseExpiresAt: '2026-08-03T12:01:00.000Z',
      nextAttemptAt: null,
    }),
    findById: async (_userId: string, id: string) => batchRow({ id }),
    finalize: async () => true,
    createPoolContinuation: async () => nextBatchId,
    markRetryWait: async () => true,
    release: async () => true,
    getPreferenceSnapshot: async () => preferenceSnapshot(),
    recordEvent: async () => 'recorded',
    ...overrides,
  } as any;
}

function input(after_batch_id: string | null = null) {
  return {
    bazi_profile_id: profileId,
    timezone: 'Asia/Hong_Kong',
    session_id: 'session-current',
    after_batch_id,
    request_id: 'request-test-1',
  };
}

async function main(): Promise<void> {
  await run('一个 owner claim 用当前事实、关系现实、长期偏好与本会话打开行为只调用一次 AI', async () => {
    let capturedInput: any;
    let claimInput: any;
    let finalizedInput: any;
    let preferenceQuery: any;
    const engineDates: string[] = [];
    const service = createRecommendationService({
      batches: repository({
        claim: async (value: unknown) => {
          claimInput = value;
          return {
            outcome: 'owner', batchId: nextBatchId, status: 'generating',
            leaseToken: '00000000-0000-4000-8000-000000000005', leaseEpoch: 1,
            leaseExpiresAt: '2026-08-03T12:01:00.000Z', nextAttemptAt: null,
          };
        },
        finalize: async (value: unknown) => {
          finalizedInput = value;
          return true;
        },
        getPreferenceSnapshot: async (value: unknown) => {
          preferenceQuery = value;
          return preferenceSnapshot({
            recent_14d: [{
              dimension: 'domain', key: 'love', exposures: 1, opens: 1,
            }],
            long_term_90d: [
              { dimension: 'domain', key: 'love', exposures: 2, opens: 1 },
              { dimension: 'topic_key', key: 'career_direction', exposures: 3, opens: 1 },
            ],
            current_session_opens: [{
              candidate_id: 'deck-card-0',
              content_profile: {
                domain: 'love',
                topic_key: 'relationship_progress',
                question_job: 'forecast',
                content_horizon: 'month',
              },
              primary_time_window_key: 'liuyue:2026-07-07:乙未',
              referenced_window_keys: ['liuyue:2026-07-07:乙未'],
              opened_at: '2026-08-03T11:00:00.000Z',
            }],
            content_history: [{
              semantic_key: 'love:relationship_progress:forecast:month:relationship_progress',
              surface: 'deck',
              exposed: true,
              opened: true,
              last_seen_at: '2026-08-03T11:00:00.000Z',
            }],
            time_window_history: [{
              window_key: 'liuyue:2026-07-07:乙未',
              primary_exposures: 2,
              primary_opens: 1,
              last_primary_exposed_at: '2026-08-03T10:00:00.000Z',
              last_primary_opened_at: '2026-08-03T11:00:00.000Z',
            }],
          });
        },
      }),
      getEngineBundle: async (_userId: string, _profileId: string, effectiveDate: string) => {
        engineDates.push(effectiveDate);
        return bundle(null);
      },
      getUser: async () => null,
      generateCandidates: async (value: unknown) => {
        capturedInput = value;
        return generatedPool();
      },
      now: () => now,
      generationEnabled: () => true,
    });

    const result = await service.resolveRecommendations(userId, input());
    assert.equal(result.status, 'ready');
    assert.equal((result as any).batch.batch_id, nextBatchId);
    assert.equal(capturedInput.reality_context.relationship.status, 'unknown');
    assert.equal(capturedInput.reality_context.relationship.declared_status, null);
    assert.equal(capturedInput.reality_context.personality.mbti, 'INTJ');
    assert.deepEqual(
      capturedInput.reality_context.personality.jungian_function_order,
      ['Ni', 'Te', 'Fi', 'Se', 'Ne', 'Ti', 'Fe', 'Si'],
    );
    assert.equal(capturedInput.reality_context.life_stage.primary, '创业阶段');
    assert.equal(capturedInput.reality_context.work_study.current_goal, '完成 MVP 上线');
    assert.deepEqual(capturedInput.reality_context.saved_understanding.current_focus, ['事业推进']);
    assert.deepEqual(
      capturedInput.reality_context.saved_understanding.behavior_signals,
      ['偏好具体时间点'],
    );
    const currentFactsJson = JSON.stringify(capturedInput.fortune_facts);
    assert.equal(currentFactsJson.includes('domain_candidates'), false);
    assert.equal(currentFactsJson.includes('activated_palaces'), false);
    assert.equal(currentFactsJson.includes('intensity'), false);
    assert.equal(currentFactsJson.includes('fact_label'), false);
    assert.equal(currentFactsJson.includes('user_context'), false);
    assert.equal(currentFactsJson.includes('element'), false);
    assert.equal(currentFactsJson.includes('timing'), false);
    const currentLiuyue = capturedInput.time_windows.find(
      (window: any) => window.kind === 'liuyue' && window.is_current,
    );
    assert.equal(
      currentLiuyue.interactions[0].relation,
      'branch_clash',
      '推荐 AI 仍必须收到可复算的作用关系',
    );
    const timeWindowsJson = JSON.stringify(capturedInput.time_windows);
    assert.equal(timeWindowsJson.includes('source'), false);
    assert.equal(timeWindowsJson.includes('targets'), false);
    assert.equal(timeWindowsJson.includes('element'), false);
    assert.equal(timeWindowsJson.includes('domain_candidates'), false);
    assert.equal(timeWindowsJson.includes('activated_palaces'), false);
    assert.equal(timeWindowsJson.includes('intensity'), false);
    assert.equal(timeWindowsJson.includes('fact_label'), false);
    assert.equal(
      capturedInput.time_windows.some((window: any) => window.kind === 'liuri'),
      false,
      '推荐大卡不接收流日窗口',
    );
    assert.deepEqual(
      capturedInput.preference_context.current_session_opens.map((item: any) => item.candidate_id),
      ['deck-card-0'],
    );
    assert.deepEqual(capturedInput.time_window_history, [{
      window_key: 'liuyue:2026-07-07:乙未',
      primary_exposures: 2,
      primary_opens: 1,
      last_primary_exposed_at: '2026-08-03T10:00:00.000Z',
      last_primary_opened_at: '2026-08-03T11:00:00.000Z',
    }]);
    assert.ok(capturedInput.preference_context.long_term_90d.some(
      (signal: any) => signal.dimension === 'domain' && signal.key === 'love' && signal.opens > 0,
    ));
    assert.equal(
      capturedInput.preference_context.long_term_90d.find(
        (signal: any) => signal.dimension === 'domain' && signal.key === 'love',
      ).smoothed_open_rate,
      0.333,
    );
    assert.ok(capturedInput.available_fact_refs.some((ref: any) => (
      ref.ref === 'time:liuyue:2026-07-07:乙未:interaction:liuyue-to-day-branch'
      && ref.valid_from === '2026-07-07'
      && ref.valid_until === '2026-08-06'
    )));
    assert.deepEqual(
      capturedInput.time_windows.map((window: any) => window.kind).sort(),
      ['dayun', 'liunian', 'liuyue'],
      '没有完整时间线 fixture 时仍复用当前三层硬事实，不制造流日或下月特例',
    );
    assert.deepEqual(engineDates, ['2026-08-03'], '推荐不得为下一个流月再次调用事实引擎');
    assert.equal(claimInput.afterBatchId, null);
    assert.equal(claimInput.generationTimezone, 'Asia/Hong_Kong');
    assert.equal(claimInput.validUntil, '2026-08-03T15:00:00.000Z');
    assert.equal(claimInput.leaseTtlSeconds, 150);
    assert.deepEqual(preferenceQuery, {
      userId,
      profileId,
      sessionId: 'session-current',
      now: now.toISOString(),
    });
    assert.deepEqual(finalizedInput.inputSnapshot, capturedInput);
    assert.equal(finalizedInput.candidatePool.pool_version, 'recommendation_pool_v2');
    assert.equal(finalizedInput.candidatePool.candidates.length, 30);
    assert.equal(finalizedInput.cards.deck_cards.length, 10);
    assert.equal(finalizedInput.cards.center_cards.length, 0);
    assert.equal(finalizedInput.selectionContext.source, 'ai_generation');
    assert.equal(finalizedInput.generationMetrics.total_token_count, 900);
    assert.equal(finalizedInput.outputSchemaVersion, 'recommendation_output_v3');
  });

  await run('30 张池分三批各展示 10 张大卡，前批打开会重排下一批，第三批后才调用新 AI', async () => {
    const rows = new Map<string, RecommendationBatchRow>();
    const continuationInputs: any[] = [];
    let preferenceStage = 0;
    let secondAiInput: any;
    let aiCalls = 0;
    let claims = 0;
    const service = createRecommendationService({
      batches: repository({
        findById: async (_userId: string, id: string) => rows.get(id) || null,
        createPoolContinuation: async (value: any) => {
          continuationInputs.push(value);
          assert.equal(value.rootBatchId, rootBatchId);
          const id = value.parentBatchId === rootBatchId ? nextBatchId : thirdBatchId;
          const root = rows.get(rootBatchId) as RecommendationBatchRow;
          rows.set(id, batchRow({
            id,
            generation_key: `${root.generation_key}:pool:${continuationInputs.length + 1}`,
            after_batch_id: value.parentBatchId,
            profile_revision_hash: root.profile_revision_hash,
            profile_updated_at: root.profile_updated_at,
            generation_timezone: root.generation_timezone,
            effective_date: root.effective_date,
            input_hash: root.input_hash,
            valid_until: root.valid_until,
            cards_json: value.cards,
            candidate_pool_json: null,
            generation_kind: 'pool',
            pool_source_batch_id: rootBatchId,
            selection_context_json: value.selectionContext,
            prompt_version: root.prompt_version,
            output_schema_version: 'recommendation_output_v3',
            taxonomy_version: root.taxonomy_version,
            model_id: root.model_id,
          }));
          return id;
        },
        claim: async (value: any) => {
          claims += 1;
          const id = claims === 1 ? rootBatchId : fourthBatchId;
          rows.set(id, batchRow({
            id,
            after_batch_id: value.afterBatchId,
            profile_revision_hash: value.profileRevisionHash,
            profile_updated_at: value.profileUpdatedAt,
            generation_timezone: value.generationTimezone,
            effective_date: value.effectiveDate,
            valid_until: value.validUntil,
            status: 'generating',
            cards_json: null,
            candidate_pool_json: null,
            selection_context_json: null,
            prompt_version: null,
            output_schema_version: null,
            taxonomy_version: null,
            model_id: null,
          }));
          return {
            outcome: 'owner', batchId: id, status: 'generating',
            leaseToken: '00000000-0000-4000-8000-000000000005', leaseEpoch: 1,
            leaseExpiresAt: '2026-08-03T12:02:30.000Z', nextAttemptAt: null,
          };
        },
        finalize: async (value: any) => {
          const source = rows.get(value.batchId) as RecommendationBatchRow;
          rows.set(value.batchId, batchRow({
            ...source,
            status: 'ready',
            lease_token: null,
            lease_expires_at: null,
            cards_json: value.cards,
            candidate_pool_json: value.candidatePool,
            selection_context_json: value.selectionContext,
            prompt_version: value.promptVersion,
            output_schema_version: value.outputSchemaVersion,
            taxonomy_version: value.taxonomyVersion,
            model_id: value.modelId,
          }));
          return true;
        },
        getPreferenceSnapshot: async () => {
          if (preferenceStage === 0) return preferenceSnapshot();
          const candidateId = preferenceStage === 1 ? 'candidate-1' : 'candidate-27';
          return preferenceSnapshot({
            current_session_opens: [{
              candidate_id: candidateId,
              content_profile: {
                domain: 'career',
                topic_key: 'career_direction',
                question_job: 'forecast',
                content_horizon: 'month',
              },
              primary_time_window_key: 'liuyue:2026-07-07:乙未',
              referenced_window_keys: ['liuyue:2026-07-07:乙未'],
              opened_at: '2026-08-03T11:30:00.000Z',
            }],
          });
        },
      }),
      getEngineBundle: async () => bundle(null),
      getUser: async () => null,
      generateCandidates: async (value: any) => {
        aiCalls += 1;
        if (aiCalls === 2) secondAiInput = value;
        const pool = generatedPool();
        pool.candidates[10] = {
          ...pool.candidates[10],
          selection_role: 'p1_mingli_change',
        };
        return pool;
      },
      now: () => now,
      generationEnabled: () => true,
    });

    const first = await service.resolveRecommendations(userId, input());
    assert.equal(first.status, 'ready');
    assert.equal((first as any).batch.batch_id, rootBatchId);
    assert.equal((first as any).batch.deck_cards.length, 10);
    assert.equal((first as any).batch.center_cards.length, 0);
    assert.equal(aiCalls, 1);
    preferenceStage = 1;
    const second = await service.resolveRecommendations(userId, input(rootBatchId));
    assert.equal(second.status, 'ready');
    assert.equal((second as any).batch.batch_id, nextBatchId);
    assert.equal((second as any).batch.after_batch_id, rootBatchId);
    assert.equal(claims, 1);
    assert.equal(aiCalls, 1);
    assert.equal((second as any).batch.deck_cards.length, 10);
    assert.equal((second as any).batch.center_cards.length, 0);
    assert.equal(
      (second as any).batch.deck_cards[0].pool_position,
      10,
      '同等展示适配度下，P1 命理变化不能被兴趣命中的 P3 内容压后',
    );
    assert.ok(
      (second as any).batch.deck_cards.some((card: any) => card.pool_position === 27),
      '第一批打开的事业卡应让同类未展示内容进入第二批',
    );
    assert.deepEqual(
      new Set((second as any).batch.deck_cards.map((card: any) => card.candidate_id)),
      new Set(['candidate-10', 'candidate-11', 'candidate-13', 'candidate-15', 'candidate-17',
        'candidate-19', 'candidate-21', 'candidate-23', 'candidate-25', 'candidate-27']),
    );
    assert.equal(continuationInputs[0].selectionContext.source, 'pool_continuation');
    assert.deepEqual(
      continuationInputs[0].selectionContext.preference_context.current_session_opens
        .map((item: any) => item.candidate_id),
      ['candidate-1'],
    );

    preferenceStage = 2;
    const third = await service.resolveRecommendations(userId, input(nextBatchId));
    assert.equal(third.status, 'ready');
    assert.equal((third as any).batch.batch_id, thirdBatchId);
    assert.equal((third as any).batch.after_batch_id, nextBatchId);
    assert.equal((third as any).batch.deck_cards.length, 10);
    assert.equal((third as any).batch.center_cards.length, 0);
    assert.equal(
      (third as any).batch.deck_cards[0].pool_position,
      29,
      '第二批打开的事业卡应继续影响第三批剩余卡片顺序',
    );
    assert.equal(aiCalls, 1, '完整三批必须只消费一次 AI 生成');
    assert.equal(claims, 1, '第二、第三批都不能 claim 新 AI generation');
    assert.deepEqual(
      continuationInputs.map((value) => ({
        parentBatchId: value.parentBatchId,
        rootBatchId: value.rootBatchId,
      })),
      [
        { parentBatchId: rootBatchId, rootBatchId },
        { parentBatchId: nextBatchId, rootBatchId },
      ],
    );

    const displayed = [first, second, third].flatMap(
      (batch) => (batch as any).batch.deck_cards,
    );
    assert.equal(displayed.length, 30);
    assert.equal(new Set(displayed.map((card: any) => card.candidate_id)).size, 30);
    assert.deepEqual(
      displayed.map((card: any) => card.pool_position)
        .sort((left: number, right: number) => left - right),
      Array.from({ length: 30 }, (_, index) => index),
    );

    const fourth = await service.resolveRecommendations(userId, input(thirdBatchId));
    assert.equal(fourth.status, 'ready');
    assert.equal((fourth as any).batch.batch_id, fourthBatchId);
    assert.equal((fourth as any).batch.after_batch_id, thirdBatchId);
    assert.equal((fourth as any).batch.deck_cards.length, 10);
    assert.equal((fourth as any).batch.center_cards.length, 0);
    assert.equal(aiCalls, 2, '第三批耗尽后才允许第二次 AI 调用');
    assert.equal(claims, 2);
    assert.deepEqual(
      secondAiInput.preference_context.current_session_opens.map((item: any) => item.candidate_id),
      ['candidate-27'],
    );
  });

  await run('已有 in-flight successor 只返回 generating，绝不重复调用 AI', async () => {
    let aiCalls = 0;
    const service = createRecommendationService({
      batches: repository({
        claim: async () => ({
          outcome: 'join', batchId: nextBatchId, status: 'generating', leaseToken: null,
          leaseEpoch: 1, leaseExpiresAt: '2026-08-03T12:01:00.000Z', nextAttemptAt: null,
        }),
      }),
      getEngineBundle: async () => bundle('单身'),
      getUser: async () => null,
      generateCandidates: async () => {
        aiCalls += 1;
        return generatedPool();
      },
      now: () => now,
      generationEnabled: () => true,
    });
    const result = await service.resolveRecommendations(userId, input(rootBatchId));
    assert.equal(result.status, 'generating');
    assert.equal(result.generation_id, nextBatchId);
    assert.equal(aiCalls, 0);
  });

  await run('完整时间线缺失时只复用当前大运流年流月，不制造下月特例或流日窗口', async () => {
    const currentOnly = bundle(null);
    currentOnly.timeline.active_luck_context.liuyue.end_date = null;
    const engineDates: string[] = [];
    let capturedInput: any;
    const service = createRecommendationService({
      batches: repository(),
      getEngineBundle: async (_userId: string, _profileId: string, effectiveDate: string) => {
        engineDates.push(effectiveDate);
        return currentOnly;
      },
      getUser: async () => null,
      generateCandidates: async (value: unknown) => {
        capturedInput = value;
        return generatedPool();
      },
      now: () => now,
      generationEnabled: () => true,
    });

    const result = await service.resolveRecommendations(userId, input());
    assert.equal(result.status, 'ready');
    assert.deepEqual(engineDates, ['2026-08-03']);
    assert.equal(capturedInput.forecast_windows, undefined);
    assert.deepEqual(
      capturedInput.time_windows.map((window: any) => window.kind).sort(),
      ['dayun', 'liunian', 'liuyue'],
    );
    assert.equal(
      capturedInput.time_windows.some((window: any) => window.kind === 'liuri'),
      false,
    );
  });

  await run('未婚不能被服务端擅自等同为当前单身', async () => {
    let capturedInput: any;
    const service = createRecommendationService({
      batches: repository(),
      getEngineBundle: async () => bundle('未婚'),
      getUser: async () => null,
      generateCandidates: async (value: unknown) => {
        capturedInput = value;
        return generatedPool();
      },
      now: () => now,
      generationEnabled: () => true,
    });

    const result = await service.resolveRecommendations(userId, input());
    assert.equal(result.status, 'ready');
    assert.equal(capturedInput.reality_context.relationship.status, 'unknown');
  });

  await run('501 条更新行为后，90 天内更早的打开信号仍通过聚合进入 AI', async () => {
    // The service must never receive this raw list. It models an active user
    // whose 501 newer exposures would previously push an older in-window open
    // beyond the old raw-event cap. The database RPC aggregates all 90 days.
    const newerRawEvents = Array.from({ length: 501 }, (_, index) => `newer-${index}`);
    let capturedInput: any;
    const service = createRecommendationService({
      batches: repository({
        getPreferenceSnapshot: async () => preferenceSnapshot({
          long_term_90d: [{
            dimension: 'topic_key',
            key: 'learning_strengths',
            exposures: newerRawEvents.length + 1,
            opens: 1,
          }],
        }),
      }),
      getEngineBundle: async () => bundle(null),
      getUser: async () => null,
      generateCandidates: async (value: unknown) => {
        capturedInput = value;
        return generatedPool();
      },
      now: () => now,
      generationEnabled: () => true,
    });

    const result = await service.resolveRecommendations(userId, input());
    assert.equal(newerRawEvents.length, 501);
    assert.equal(result.status, 'ready');
    assert.deepEqual(
      capturedInput.preference_context.long_term_90d,
      [{
        dimension: 'topic_key',
        key: 'learning_strengths',
        exposures: 502,
        opens: 1,
        smoothed_open_rate: 0.004,
      }],
    );
  });

  await run('档案或现实上下文修订后，同一天不会复用旧 READY，而是从新 revision 的 root 重新生成', async () => {
    const bundleA = bundle(null);
    bundleA.profile.updated_at = '2026-08-01T00:00:00.000Z';
    const bundleB = bundle(null);
    bundleB.profile.updated_at = '2026-08-03T11:30:00.000Z';
    bundleB.profile.daily_fortune_context.relationship.status = '恋爱中';

    let currentBundle = bundleA;
    const claims: any[] = [];
    const service = createRecommendationService({
      batches: repository({
        findById: async (_userId: string, id: string) => {
          const claim = id === rootBatchId ? claims[0] : claims[1];
          return batchRow({
            id,
            profile_revision_hash: claim?.profileRevisionHash || 'unclaimed-revision',
            profile_updated_at: claim?.profileUpdatedAt || currentBundle.profile.updated_at,
          });
        },
        claim: async (value: unknown) => {
          claims.push(value);
          return {
            outcome: 'owner',
            batchId: claims.length === 1 ? rootBatchId : nextBatchId,
            status: 'generating',
            leaseToken: '00000000-0000-4000-8000-000000000005',
            leaseEpoch: 1,
            leaseExpiresAt: '2026-08-03T12:02:30.000Z',
            nextAttemptAt: null,
          };
        },
      }),
      getEngineBundle: async () => currentBundle,
      getUser: async () => null,
      generateCandidates: async () => generatedPool(),
      now: () => now,
      generationEnabled: () => true,
    });

    const first = await service.resolveRecommendations(userId, input());
    currentBundle = bundleB;
    const second = await service.resolveRecommendations(userId, input(rootBatchId));

    assert.equal(first.status, 'ready');
    assert.equal((first as any).batch.batch_id, rootBatchId);
    assert.equal(second.status, 'ready');
    assert.equal((second as any).batch.batch_id, nextBatchId);
    assert.equal(claims.length, 2);
    assert.notEqual(claims[0].profileRevisionHash, claims[1].profileRevisionHash);
    assert.equal(claims[1].afterBatchId, null);
    assert.equal(claims[1].profileUpdatedAt, '2026-08-03T11:30:00.000Z');
  });

  await run('跨日、未就绪或不同档案的前一批都会退回当天 root，不把今天事实接到无效卡组', async () => {
    const invalidPriors = [
      batchRow({
        effective_date: '2026-08-02',
        valid_until: '2026-08-02T15:00:00.000Z',
      }),
      batchRow({
        status: 'generating',
        lease_expires_at: '2026-08-03T12:02:30.000Z',
      }),
      batchRow({
        profile_id: '00000000-0000-4000-8000-000000000088',
      }),
      batchRow({
        generation_timezone: 'America/New_York',
      }),
    ];

    for (const prior of invalidPriors) {
      let claimInput: any;
      const service = createRecommendationService({
        batches: repository({
          findById: async (_userId: string, id: string) => (
            id === rootBatchId ? prior : batchRow({ id })
          ),
          claim: async (value: unknown) => {
            claimInput = value;
            return {
              outcome: 'owner', batchId: nextBatchId, status: 'generating',
              leaseToken: '00000000-0000-4000-8000-000000000005', leaseEpoch: 1,
              leaseExpiresAt: '2026-08-03T12:02:30.000Z', nextAttemptAt: null,
            };
          },
        }),
        getEngineBundle: async () => bundle(null),
        getUser: async () => null,
        generateCandidates: async () => generatedPool(),
        now: () => now,
        generationEnabled: () => true,
      });

      const result = await service.resolveRecommendations(userId, input(rootBatchId));
      assert.equal(result.status, 'ready');
      assert.equal(claimInput.afterBatchId, null);
    }
  });

  await run('大运 ten_years 作用使用完整大运窗口，不被误缩成流年', async () => {
    let capturedInput: any;
    const dayunBundle = bundle(null);
    dayunBundle.timeline.timing_interactions[0].scope = 'dayun_to_natal';
    dayunBundle.timeline.timing_interactions[0].time_horizon = 'ten_years';
    const service = createRecommendationService({
      batches: repository(),
      getEngineBundle: async () => dayunBundle,
      getUser: async () => null,
      generateCandidates: async (value: unknown) => {
        capturedInput = value;
        return generatedPool();
      },
      now: () => now,
      generationEnabled: () => true,
    });
    await service.resolveRecommendations(userId, input());
    assert.deepEqual(
      capturedInput.available_fact_refs.find((ref: any) => (
        ref.ref === 'time:dayun:2024:丁卯:interaction:liuyue-to-day-branch'
      )),
      {
        ref: 'time:dayun:2024:丁卯:interaction:liuyue-to-day-branch',
        valid_from: '2024-01-01',
        valid_until: '2033-12-31',
      },
    );
  });

  await run('AI 失败进入 retry_wait，后续 GET 只读状态且不再触发 AI', async () => {
    let retryInput: any;
    let aiCalls = 0;
    const service = createRecommendationService({
      batches: repository({
        markRetryWait: async (value: unknown) => {
          retryInput = value;
          return true;
        },
        findById: async () => batchRow({
          id: nextBatchId,
          status: 'retry_wait',
          next_attempt_at: '2026-08-03T12:01:00.000Z',
          cards_json: null,
          prompt_version: null,
          taxonomy_version: null,
          model_id: null,
        }),
      }),
      getEngineBundle: async () => bundle(null),
      getUser: async () => null,
      generateCandidates: async () => {
        aiCalls += 1;
        throw new DailyFortuneAiError('timeout', 'timed out', true);
      },
      now: () => now,
      generationEnabled: () => true,
    });
    const generated = await service.resolveRecommendations(userId, input());
    assert.equal(generated.status, 'retry_wait');
    assert.equal(generated.cause, 'AI_TIMEOUT');
    assert.equal(aiCalls, 1);
    assert.deepEqual(retryInput, {
      batchId: nextBatchId,
      userId,
      leaseToken: '00000000-0000-4000-8000-000000000005',
      leaseEpoch: 1,
      retryAfterSeconds: 60,
    });
    const polled = await service.getRecommendationBatch(userId, nextBatchId);
    assert.equal(polled.status, 'retry_wait');
    assert.equal(aiCalls, 1);
  });

  await run('feature flag 关闭时不 claim、不调用 AI，并明确返回不可用', async () => {
    let claims = 0;
    let aiCalls = 0;
    const service = createRecommendationService({
      batches: repository({ claim: async () => { claims += 1; throw new Error('must not claim'); } }),
      getEngineBundle: async () => bundle(null),
      getUser: async () => null,
      generateCandidates: async () => { aiCalls += 1; return generatedPool(); },
      now: () => now,
      generationEnabled: () => false,
    });
    const result = await service.resolveRecommendations(userId, input());
    assert.equal(result.status, 'unavailable');
    assert.equal(result.cause, 'GENERATION_DISABLED');
    assert.equal(result.retryable, false);
    assert.equal(claims, 0);
    assert.equal(aiCalls, 0);
  });

  await run('每 24 小时新批次配额耗尽时不再调用 AI，但不把它伪装成命理判断', async () => {
    let aiCalls = 0;
    const service = createRecommendationService({
      batches: repository({
        claim: async () => ({
          outcome: 'daily_limit', batchId: null, status: null, leaseToken: null,
          leaseEpoch: 0, leaseExpiresAt: null, nextAttemptAt: null,
        }),
      }),
      getEngineBundle: async () => bundle(null),
      getUser: async () => null,
      generateCandidates: async () => { aiCalls += 1; return generatedPool(); },
      now: () => now,
      generationEnabled: () => true,
    });
    const result = await service.resolveRecommendations(userId, input());
    assert.equal(result.status, 'unavailable');
    assert.equal(result.cause, 'DAILY_BATCH_LIMIT_REACHED');
    assert.equal(result.retryable, false);
    assert.equal(aiCalls, 0);
  });

  await run('同一槽位已耗尽重试次数时不再重复调用 AI', async () => {
    let aiCalls = 0;
    const service = createRecommendationService({
      batches: repository({
        claim: async () => ({
          outcome: 'attempt_limit', batchId: nextBatchId, status: 'retry_wait', leaseToken: null,
          leaseEpoch: 3, leaseExpiresAt: null, nextAttemptAt: null,
        }),
      }),
      getEngineBundle: async () => bundle(null),
      getUser: async () => null,
      generateCandidates: async () => { aiCalls += 1; return generatedPool(); },
      now: () => now,
      generationEnabled: () => true,
    });
    const result = await service.resolveRecommendations(userId, input());
    assert.equal(result.status, 'unavailable');
    assert.equal(result.cause, 'GENERATION_ATTEMPT_LIMIT_REACHED');
    assert.equal(result.retryable, false);
    assert.equal(aiCalls, 0);
  });

  await run('项目全局 provider 预算耗尽时不再调用 AI，也不改写命理或兴趣判断', async () => {
    let aiCalls = 0;
    const service = createRecommendationService({
      batches: repository({
        claim: async () => ({
          outcome: 'global_limit', batchId: null, status: null, leaseToken: null,
          leaseEpoch: 0, leaseExpiresAt: null, nextAttemptAt: null,
        }),
      }),
      getEngineBundle: async () => bundle(null),
      getUser: async () => null,
      generateCandidates: async () => { aiCalls += 1; return generatedPool(); },
      now: () => now,
      generationEnabled: () => true,
    });
    const result = await service.resolveRecommendations(userId, input());
    assert.equal(result.status, 'unavailable');
    assert.equal(result.cause, 'GLOBAL_GENERATION_BUDGET_REACHED');
    assert.equal(result.retryable, false);
    assert.equal(aiCalls, 0);
  });

  await run('不可重试的 AI 配置错误释放 lease，不把已知错误留在 retry_wait', async () => {
    let releases = 0;
    let retryWaits = 0;
    const service = createRecommendationService({
      batches: repository({
        release: async (value: unknown) => {
          releases += 1;
          assert.deepEqual(value, {
            batchId: nextBatchId,
            userId,
            leaseToken: '00000000-0000-4000-8000-000000000005',
            leaseEpoch: 1,
          });
          return true;
        },
        markRetryWait: async () => { retryWaits += 1; return true; },
      }),
      getEngineBundle: async () => bundle(null),
      getUser: async () => null,
      generateCandidates: async () => {
        throw new DailyFortuneAiError('configuration', 'model is missing', false);
      },
      now: () => now,
      generationEnabled: () => true,
    });
    const result = await service.resolveRecommendations(userId, input());
    assert.equal(result.status, 'unavailable');
    assert.equal(result.cause, 'AI_CONFIGURATION');
    assert.equal(result.retryable, false);
    assert.equal(releases, 1);
    assert.equal(retryWaits, 0);
  });

  await run('资料在 AI 生成期间变更而 finalize 被拦截时，旧 worker 释放 lease 且不返回旧正文', async () => {
    let released: any;
    const service = createRecommendationService({
      batches: repository({
        finalize: async () => false,
        findById: async (_userId: string, id: string) => batchRow({
          id,
          status: 'generating',
          cards_json: null,
          prompt_version: null,
          taxonomy_version: null,
          model_id: null,
        }),
        release: async (value: unknown) => {
          released = value;
          return true;
        },
      }),
      getEngineBundle: async () => bundle(null),
      getUser: async () => null,
      generateCandidates: async () => generatedPool(),
      now: () => now,
      generationEnabled: () => true,
    });

    const result = await service.resolveRecommendations(userId, input());
    assert.equal(result.status, 'unavailable');
    assert.equal(result.cause, 'FINALIZE_FENCED');
    assert.deepEqual(released, {
      batchId: nextBatchId,
      userId,
      leaseToken: '00000000-0000-4000-8000-000000000005',
      leaseEpoch: 1,
    });
  });

  await run('行为只把客户端提供的最小事件身份交给 RPC，标签不能由客户端伪造', async () => {
    let recordInput: any;
    const service = createRecommendationService({
      batches: repository({
        recordEvent: async (value: unknown) => {
          recordInput = value;
          return 'duplicate';
        },
      }),
    });
    const result = await service.recordRecommendationEvent(userId, {
      event_id: '00000000-0000-4000-8000-000000000010',
      batch_id: nextBatchId,
      candidate_id: 'deck-card-0',
      event_type: 'open',
      session_id: 'session-current',
    });
    assert.deepEqual(recordInput, {
      eventId: '00000000-0000-4000-8000-000000000010',
      userId,
      batchId: nextBatchId,
      candidateId: 'deck-card-0',
      eventType: 'open',
      sessionId: 'session-current',
    });
    assert.deepEqual(result, { accepted: true, duplicate: true });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
