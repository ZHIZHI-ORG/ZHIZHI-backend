import assert from 'node:assert/strict';
import { hashMediumInsightFactSnapshot, MediumInsightFactError, projectMediumInsightFacts } from '../src/services/mediumInsightFactProjector';

function summaryMaterialsFixture(evidence = 'fixture') {
  return {
    supporting_materials: [{ kind: 'element', value: '火', sources: [`调候:${evidence}`] }],
    opposing_materials: [{ kind: 'ten_god', value: '正官', sources: [`格局冲突:${evidence}`] }],
    conflicting_materials: [],
  };
}

function fixture(overrides: Record<string, unknown> = {}) {
  const interaction = (id: string, horizon: string) => ({
    id, scope: horizon, relation: 'branch_clash', relation_name: '冲', fact_label: '作用关系',
    short_label: '冲', display_group: 'fixture', aliases: [], participants: [{
      type: 'natal_pillar', pillar: 'day', label: '日柱', stem: '庚', branch: '申',
      gan_zhi: '庚申', ten_gods: ['日主'],
    }], source: null, targets: [], transform_element: null, center_branch: null,
    activated_palaces: ['day'], target_part: 'branch', intensity: 0.8,
    time_horizon: horizon, adjacent: true, full_match: true, missing_branch: null,
    seen_stem: null, compared_against: 'fixture', rule_version: 'v1',
  });
  return {
    profile: {
      id: '00000000-0000-4000-8000-000000000001', owner_user_id: '00000000-0000-4000-8000-000000000002',
      is_owner: true, name: '本人', birth_year: 1990, birth_month: 1, birth_day: 1,
      is_lunar: false, birth_timezone: 'Asia/Hong_Kong', full_chart: {},
      created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-13T00:00:00.000Z',
      ...overrides,
    } as any,
    facts: {
      contract_version: 'daily_fortune_ai_first_v3', effective_date: '2026-08-13',
      timezone: 'Asia/Hong_Kong', day_boundary: 'zi_chu_23_local',
      profile: { birth_date: '1990-01-01', birth_timezone: 'Asia/Hong_Kong' },
      natal: {
        day_master: '庚', day_master_element: '金',
        pillars: ['甲子', '丁卯', '庚申'].map((gan_zhi, index) => ({
          position: ['year', 'month', 'day'][index], gan_zhi, hidden_stems: [],
        })),
      },
      timing: {
        dayun: { gan_zhi: '壬午', stem: '壬', branch: '午', hidden_stems: [], start_date: '2024-02-01', end_date: '2034-02-01', start_year: 2024, end_year: 2033, age_start: 34, age_end: 43 },
        liunian: { gan_zhi: '丙午', stem: '丙', branch: '午', hidden_stems: [] },
        liuyue: { gan_zhi: '乙未', stem: '乙', branch: '未', hidden_stems: [] },
        liuri: { gan_zhi: '己丑', stem: '己', branch: '丑', hidden_stems: [] },
      },
      mingli_interactions: {
        rule_version: 'v1', natal: [interaction('natal-1', 'baseline')],
        timing: [interaction('dayun-1', 'ten_years'), interaction('year-1', 'year'), interaction('day-1', 'day')],
      },
      user_context: {
        declared: {
          mbti: 'INTJ', life_stage: { primary: '创业期', tags: ['创始人'] },
          work_study: { mode: 'career', career_status: '创业', occupation: '产品负责人', industry: 'AI', study_status: null, school: '测试大学', current_goal: '产品上线' },
          relationship: { status: 'single', current_focus: '稳定关系' },
        },
        zhizhi_understanding: { snapshot_version: 'u1', current_focus: ['事业'], expression_preferences: ['直接'], behavior_signals: ['常看职业卡'], updated_at: '2026-08-13T00:00:00.000Z' },
      },
    } as any,
    zipingStructureFacts: {
      method_version: 'ziping_structure_v2_fact_layer',
      hour_precision: 'known', observed_pillars: ['year', 'month', 'day', 'time'],
      month_command: { month_branch: '卯', command_stem: '乙', command_ten_god: '正财' },
      day_master_facts: { day_master: '庚', element: '金', season_state: { month_branch: '卯', state: '囚', basis: 'fixture' } },
      pattern_candidates: { regular: [{ name: '正财格候选', status: 'candidate' }], mixed_qi: [], auxiliary: [], usable_god_materials_for_lu_ren: [], notes: [] },
      yongshen_basis_facts: {
        pattern: { pattern_conflicts: [] },
        summary_materials: summaryMaterialsFixture(),
        notes: ['事实材料'],
      },
    } as any,
  };
}

const base = fixture();
const projection = projectMediumInsightFacts(base);
assert.equal(projection.snapshot.facts.some((fact) => fact.canonical_source.includes('year-1')), false);
assert.equal(projection.snapshot.facts.some((fact) => fact.canonical_source.includes('day-1')), false);
assert.equal(projection.snapshot.facts.some((fact) => fact.canonical_source.includes('dayun-1')), true);
assert.equal(projection.snapshot.facts.some((fact) => fact.source === 'month_command'), true);
assert.equal(projection.snapshot.facts.some((fact) => fact.source === 'day_master_capacity'), true);
assert.equal(projection.snapshot.facts.some((fact) => fact.source === 'pattern_candidates'), true);
assert.equal(projection.snapshot.facts.some((fact) => fact.source === 'yongshen_basis'), true);
assert.equal(projection.groundingContext.user_context.declared.mbti, 'INTJ');
assert.equal(projection.groundingContext.user_context.declared.work_study.occupation, '产品负责人');
assert.equal(projection.groundingContext.user_context.declared.work_study.school, '测试大学');
assert.equal(projection.groundingContext.user_context.declared.relationship.current_focus, '稳定关系');
assert.deepEqual(projection.groundingContext.user_context.zhizhi_understanding.behavior_signals, ['常看职业卡']);
const dayunFact = projection.snapshot.facts.find((fact) => fact.source === 'dayun')!;
assert.ok(dayunFact.canonical_text.includes('2024-02-01至2034-02-01'));
assert.equal(JSON.stringify(dayunFact).includes('lifecycle'), false, '中卡不得传十二长生');
const yongshenFact = projection.snapshot.facts.find((fact) => fact.source === 'yongshen_basis')!;
assert.equal(
  Object.prototype.hasOwnProperty.call((yongshenFact.fact_payload as any).value, 'summary_materials'),
  false,
  '新生成的大/中卡 AI 投影不得携带 summary_materials',
);
assert.deepEqual(
  base.zipingStructureFacts.yongshen_basis_facts.summary_materials,
  summaryMaterialsFixture(),
  'projector 不得 mutation canonical yongshen facts',
);

const oversizedSummary = fixture();
oversizedSummary.zipingStructureFacts.yongshen_basis_facts.summary_materials = summaryMaterialsFixture('重复汇总'.repeat(14_000));
assert.doesNotThrow(
  () => projectMediumInsightFacts(oversizedSummary),
  '96KB structure ceiling 必须按实际发送给 AI 的收窄 payload 计算',
);

const contextChanged = fixture();
contextChanged.facts.user_context.declared.life_stage.primary = '过渡期';
contextChanged.profile.updated_at = '2026-08-13T01:00:00.000Z';
const changedProjection = projectMediumInsightFacts(contextChanged);
assert.equal(hashMediumInsightFactSnapshot(projection.snapshot), hashMediumInsightFactSnapshot(changedProjection.snapshot));
assert.notDeepEqual(projection.groundingContext, changedProjection.groundingContext);

const unknownHour = fixture();
unknownHour.zipingStructureFacts.hour_precision = 'unknown';
unknownHour.zipingStructureFacts.observed_pillars = ['year', 'month', 'day'];
unknownHour.zipingStructureFacts.pattern_candidates.regular = [];
const unknownProjection = projectMediumInsightFacts(unknownHour);
const unknownDayun = unknownProjection.snapshot.facts.find((fact) => fact.source === 'dayun')!;
assert.ok(unknownDayun.conditions.includes('unknown_hour_dayun_boundary_approximate'));
assert.equal(JSON.stringify(unknownDayun).includes('2024-02-01'), false);
const unknownDayunInteraction = unknownProjection.snapshot.facts.find((fact) => fact.source === 'dayun_interaction')!;
assert.ok(unknownDayunInteraction.conditions.includes('unknown_hour_dayun_boundary_approximate'));
const unknownPattern = unknownProjection.snapshot.facts.find((fact) => fact.source === 'pattern_candidates')!;
assert.ok(unknownPattern.canonical_text.includes('已知三柱范围内'));
assert.ok(unknownPattern.conditions.includes('unknown_hour'));

assert.throws(() => projectMediumInsightFacts(fixture({ is_owner: false })), MediumInsightFactError);
console.log('✓ medium insight fact projection excludes short timing and keeps soft context outside fact hash');
