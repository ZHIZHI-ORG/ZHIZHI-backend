import assert from 'node:assert/strict';
import type { MediumInsightBatchRow } from '../src/database/repositories/MediumInsightRepository';
import { MEDIUM_INSIGHT_DOMAINS, MediumInsightAiOutput } from '../src/models/MediumInsight';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const { createMediumInsightService } = require('../src/services/mediumInsightService') as typeof import('../src/services/mediumInsightService');
const { DailyFortuneAiError } = require('../src/utils/dailyFortuneAi') as typeof import('../src/utils/dailyFortuneAi');

const userId = '00000000-0000-4000-8000-000000000001';
const profileId = '00000000-0000-4000-8000-000000000002';
const batchId = '00000000-0000-4000-8000-000000000003';
const now = new Date('2026-08-13T12:00:00.000Z');
const numbers = ['一', '二', '三', '四', '五', '六', '七', '八'];

function bundle(isOwner = true) {
  const pillar = (position: string, stem: string, branch: string) => ({
    position, stem, branch, ten_god: '比肩', hidden_stems: [{ stem, ten_god: '比肩', element: '金' }],
  });
  const timing = (gan_zhi: string, stem: string, branch: string) => ({
    gan_zhi, stem, branch, hidden_stems: [{ stem, ten_god: '比肩', element: '金' }],
  });
  return {
    profile: {
      id: profileId, owner_user_id: userId, is_owner: isOwner, name: '测试本人', gender: 'female',
      birth_year: 1992, birth_month: 6, birth_day: 8, birth_hour: null, birth_minute: null,
      is_lunar: false, birth_timezone: 'Asia/Hong_Kong', birth_region: '香港', full_chart: {},
      daily_fortune_context: { life_stage: { primary: '创业期' }, work_study: { mode: 'career' }, relationship: { status: 'single' } },
      updated_at: '2026-08-13T00:00:00.000Z', created_at: '2026-08-01T00:00:00.000Z',
    },
    chart: {
      day_master: '庚', day_master_element: '金',
      pillars: [pillar('year', '甲', '子'), pillar('month', '丁', '卯'), pillar('day', '庚', '申')],
      mingli_facts: { rule_version: 'v1', natal_interactions: [] },
    },
    timeline: {
      active_luck_context: {
        dayun: { ...timing('壬午', '壬', '午'), start_year: 2024, end_year: 2033 },
        liunian: { ...timing('丙午', '丙', '午'), year: 2026 },
        liuyue: { ...timing('乙未', '乙', '未'), start_date: '2026-08-07', end_date: '2026-09-07' },
        liuri: { ...timing('己丑', '己', '丑'), date: '2026-08-13' },
      },
      timing_interactions: [],
    },
    zipingStructureFacts: {
      method_version: 'ziping_structure_v2_fact_layer', hour_precision: 'unknown',
      observed_pillars: ['year', 'month', 'day'],
      month_command: { month_branch: '卯', command_stem: '乙', command_ten_god: '正财' },
      day_master_facts: { day_master: '庚', element: '金', season_state: { month_branch: '卯', state: '囚', basis: 'fixture' } },
      pattern_candidates: { regular: [], mixed_qi: [], auxiliary: [], usable_god_materials_for_lu_ren: [], notes: [] },
      yongshen_basis_facts: {
        summary_materials: {
          supporting_materials: [{ kind: 'element', value: '火', sources: ['调候:fixture'] }],
          opposing_materials: [{ kind: 'ten_god', value: '正官', sources: ['格局冲突:fixture'] }],
          conflicting_materials: [],
        },
        notes: ['fixture'],
      },
    },
  } as any;
}

const account = {
  id: userId, mbti: 'INTJ', career: '产品负责人', school: '测试大学',
};

function aiOutput(): MediumInsightAiOutput {
  return { domains: MEDIUM_INSIGHT_DOMAINS.map((domain) => ({
    domain,
    cards: numbers.map((number, index) => ({
      title: `命盘角度${number}`, preview: `从命盘事实看，第${number}种稳定反应能帮助你理解这个领域里的内在需要。`,
      content_type: ['pattern', 'self_explanation', 'strength', 'tension', 'fit'][index % 5] as any,
      fact_refs: [`F${(index % 5) + 1}`],
    })),
  })) };
}

function row(overrides: Partial<MediumInsightBatchRow> = {}): MediumInsightBatchRow {
  return {
    id: batchId, generation_key: 'key', user_id: userId, profile_id: profileId,
    effective_date: '2026-08-13', batch_revision: 0, supersedes_batch_id: null,
    generation_timezone: 'Asia/Hong_Kong', source_boundary_at: '2026-08-13T15:00:00.000Z',
    profile_updated_at: '2026-08-13T00:00:00.000Z', fact_hash: 'hash',
    fact_snapshot_json: {} as any, soft_context_snapshot_json: { version: 'medium_context_snapshot_v2', user_context: {} } as any,
    status: 'generating', lease_token: 'lease', lease_epoch: 1,
    lease_expires_at: '2026-08-13T12:02:30.000Z', attempt_count: 1, next_attempt_at: null,
    cards_json: null, contract_version: 'medium_insight_v2', fact_projection_version: 'medium_fact_snapshot_v2', context_projection_version: 'medium_context_snapshot_v2',
    prompt_version: null, output_schema_version: null, generator_version: 'medium_generator_v5', model_id: null,
    generation_metrics_json: null, last_error_code: null, last_error_stage: null, ready_at: null,
    created_at: '2026-08-13T12:00:00.000Z', updated_at: '2026-08-13T12:00:00.000Z',
    ...overrides,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  let stored = row();
  return {
    claim: async () => ({ outcome: 'owner', batchId, status: 'generating', effectiveDate: '2026-08-13', timezoneChangePending: false, leaseToken: 'lease', leaseEpoch: 1, leaseExpiresAt: '2026-08-13T12:02:30.000Z', nextAttemptAt: null }),
    findById: async () => stored,
    findHead: async () => null,
    findRecentReady: async () => [],
    finalize: async (input: any) => { stored = row({ status: 'ready', cards_json: { domains: input.domains }, prompt_version: input.promptVersion, output_schema_version: input.outputSchemaVersion, model_id: input.modelId, ready_at: now.toISOString() }); return true; },
    markRetryWait: async () => true,
    markFailed: async () => true,
    recordEvent: async () => 'recorded',
    ...overrides,
  } as any;
}

async function run(name: string, test: () => Promise<void>): Promise<void> {
  try { await test(); console.log(`✓ ${name}`); } catch (error) { console.error(`✗ ${name}`); throw error; }
}

async function main() {
  await run('owner claim generates and freezes exactly five domains by eight cards', async () => {
    let engineDate = '';
    const batches = repository();
    const service = createMediumInsightService({
      batches, now: () => now, mode: () => 'on',
      getUser: async () => account as any,
      getEngineBundle: async (_userId: string, _profileId: string, effectiveDate: string) => { engineDate = effectiveDate; return bundle(); },
      generate: async (input: any) => {
        assert.equal('soft_context' in input.snapshot, false);
        assert.equal(JSON.stringify(input.snapshot).includes('summary_materials'), false);
        assert.equal(input.groundingContext.user_context.declared.life_stage.primary, '创业期');
        assert.equal(input.groundingContext.user_context.declared.mbti, 'INTJ');
        assert.equal(input.groundingContext.user_context.declared.work_study.occupation, '产品负责人');
        return { output: aiOutput(), promptVersion: 'medium_insight_prompt_v7', outputSchemaVersion: 'medium_insight_output_v1', modelId: 'test', metrics: { provider_calls: 1, input_bytes: 1_000, duration_ms: 10, prompt_tokens: 1, output_tokens: 1, total_tokens: 2, provider_response_bytes: 100, repaired_cards: 0 } };
      },
    } as any);
    const result = await service.resolveDaily(userId, { bazi_profile_id: profileId, timezone: 'Asia/Hong_Kong' });
    assert.equal(engineDate, '2026-08-13');
    assert.equal(result.status, 'ready');
    if (result.status === 'ready') {
      assert.equal(result.batch.domains.length, 5);
      assert.ok(result.batch.domains.every((domain) => domain.cards.length === 8));
    }
  });

  await run('westward timezone never moves the effective date backward', async () => {
    let engineDate = '';
    const head = row({ effective_date: '2026-08-14', status: 'ready', cards_json: { domains: [] }, prompt_version: 'medium_insight_prompt_v7', output_schema_version: 'medium_insight_output_v1', model_id: 'test', ready_at: now.toISOString() });
    const service = createMediumInsightService({
      batches: repository({ findHead: async () => head, claim: async () => ({ outcome: 'ready', batchId, status: 'ready', effectiveDate: '2026-08-14', timezoneChangePending: true, leaseToken: null, leaseEpoch: 1, leaseExpiresAt: null, nextAttemptAt: null }), findById: async () => head }),
      now: () => now, mode: () => 'on', getUser: async () => account as any, getEngineBundle: async (_u: string, _p: string, date: string) => { engineDate = date; return bundle(); },
      generate: async () => { throw new Error('must not generate'); },
    } as any);
    const result = await service.resolveDaily(userId, { bazi_profile_id: profileId, timezone: 'America/Los_Angeles' });
    assert.equal(engineDate, '2026-08-14');
    assert.equal(result.status, 'ready');
  });

  await run('retryable provider failure enters retry_wait instead of mock fallback', async () => {
    let retryCalls = 0;
    const service = createMediumInsightService({
      batches: repository({ markRetryWait: async () => { retryCalls += 1; return true; } }),
      now: () => now, mode: () => 'on', getUser: async () => account as any, getEngineBundle: async () => bundle(),
      generate: async () => { throw new DailyFortuneAiError('timeout', 'timeout', true); },
    } as any);
    const result = await service.resolveDaily(userId, { bazi_profile_id: profileId, timezone: 'Asia/Hong_Kong' });
    assert.equal(result.status, 'retry_wait');
    assert.equal(retryCalls, 1);
  });

  await run('polling a superseded generation never returns stale READY content', async () => {
    const readyVersions = { prompt_version: 'medium_insight_prompt_v7', output_schema_version: 'medium_insight_output_v1', model_id: 'test', ready_at: now.toISOString() } as const;
    const old = row({ status: 'ready', cards_json: { domains: [] }, ...readyVersions });
    const newer = row({ id: '00000000-0000-4000-8000-000000000004', batch_revision: 1, status: 'ready', cards_json: { domains: [] }, ...readyVersions });
    const service = createMediumInsightService({ batches: repository({ findById: async () => old, findHead: async () => newer }), now: () => now } as any);
    const result = await service.poll(userId, batchId);
    assert.equal(result.status, 'unavailable');
    if (result.status === 'unavailable') assert.equal(result.cause, 'STALE_GENERATION');
  });

  await run('legacy or wrong-prompt READY rows never masquerade as the V2 contract', async () => {
    const oldV1 = row({
      status: 'ready', cards_json: { domains: [] }, contract_version: 'medium_insight_v1',
      fact_projection_version: 'medium_fact_snapshot_v1', context_projection_version: 'medium_context_snapshot_v1',
      generator_version: 'medium_generator_v3', prompt_version: 'medium_insight_prompt_v3',
      output_schema_version: 'medium_insight_output_v1', model_id: 'old-model', ready_at: now.toISOString(),
    });
    const readOnly = createMediumInsightService({
      batches: repository({ findHead: async () => oldV1 }), now: () => now, mode: () => 'read_only',
    } as any);
    const readOnlyResult = await readOnly.resolveDaily(userId, { bazi_profile_id: profileId, timezone: 'Asia/Hong_Kong' });
    assert.equal(readOnlyResult.status, 'unavailable');
    if (readOnlyResult.status === 'unavailable') assert.equal(readOnlyResult.cause, 'READ_ONLY_MISS');

    const pollOld = createMediumInsightService({
      batches: repository({ findById: async () => oldV1, findHead: async () => oldV1 }), now: () => now,
    } as any);
    const pollOldResult = await pollOld.poll(userId, batchId);
    assert.equal(pollOldResult.status, 'unavailable');
    if (pollOldResult.status === 'unavailable') assert.equal(pollOldResult.cause, 'STALE_CONTRACT');

    const wrongPrompt = row({
      status: 'ready', cards_json: { domains: [] }, prompt_version: 'medium_insight_prompt_v3',
      output_schema_version: 'medium_insight_output_v1', model_id: 'old-model', ready_at: now.toISOString(),
    });
    const pollWrongPrompt = createMediumInsightService({
      batches: repository({ findById: async () => wrongPrompt, findHead: async () => wrongPrompt }), now: () => now,
    } as any);
    const wrongPromptResult = await pollWrongPrompt.poll(userId, batchId);
    assert.equal(wrongPromptResult.status, 'unavailable');
    if (wrongPromptResult.status === 'unavailable') assert.equal(wrongPromptResult.cause, 'STALE_CONTRACT');
  });

  await run('user-context repository failures cannot silently generate without frozen context', async () => {
    let claimCalls = 0;
    const service = createMediumInsightService({
      batches: repository({ claim: async () => { claimCalls += 1; throw new Error('must not claim'); } }),
      now: () => now, mode: () => 'on', getEngineBundle: async () => bundle(),
      getUser: async () => { throw new Error('users table unavailable'); },
    } as any);
    await assert.rejects(
      () => service.resolveDaily(userId, { bazi_profile_id: profileId, timezone: 'Asia/Hong_Kong' }),
      /users table unavailable/,
    );
    assert.equal(claimCalls, 0);
  });
}

void main();
