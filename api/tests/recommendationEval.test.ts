import assert from 'node:assert/strict';

const {
  RecommendationAiError,
  generateRecommendationCandidatesWithAi,
} = require('../src/utils/recommendationAi.ts') as typeof import('../src/utils/recommendationAi');
const {
  recommendationStructuralCorpus,
} = require('../evals/recommendationStructuralCorpus.ts') as typeof import('../evals/recommendationStructuralCorpus');

type EvalCase = typeof recommendationStructuralCorpus[number];

const QUESTION_JOBS = ['describe', 'explain', 'forecast', 'compare', 'act'];
const EVENT_FAMILIES = [
  'baseline_pattern',
  'cycle_background',
  'direct_activation',
  'opportunity',
  'friction',
  'adjustment',
  'new_connection',
  'relationship_progress',
  'commitment',
];

function response(content: unknown) {
  return {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text: JSON.stringify(content) }] },
    }],
  };
}

function pillars(unknownHour: boolean) {
  const base = [
    { position: 'year', gan_zhi: '乙亥', stem: '乙', branch: '亥', hidden_stems: [] },
    { position: 'month', gan_zhi: '甲申', stem: '甲', branch: '申', hidden_stems: [] },
    { position: 'day', gan_zhi: '乙酉', stem: '乙', branch: '酉', hidden_stems: [] },
  ];
  return unknownHour
    ? base
    : [...base, { position: 'hour', gan_zhi: '丁亥', stem: '丁', branch: '亥', hidden_stems: [] }];
}

function preferenceContext(item: EvalCase) {
  const signal = {
    dimension: 'domain',
    key: item.domain,
    exposures: 5,
    opens: 3,
    smoothed_open_rate: 0.444,
  };
  const sessionOpen = {
    candidate_id: 'previous-card',
    content_profile: {
      domain: item.domain,
      topic_key: item.topicKey,
      question_job: item.questionJob,
      content_horizon: item.horizon,
    },
    opened_at: '2026-08-08T08:00:00.000Z',
  };
  return {
    recent_14d: item.preferenceWindow === 'recent' ? [signal] : [],
    long_term_90d: item.preferenceWindow === 'long_term' ? [signal] : [],
    current_session_opens: item.preferenceWindow === 'session' ? [sessionOpen] : [],
  };
}

function inputFor(item: EvalCase, overrides: Record<string, unknown> = {}): any {
  const facts = [
    { ref: 'natal:pillar:day', valid_from: '1995-08-12', valid_until: null },
    { ref: 'timing:dayun', valid_from: '2020-01-01', valid_until: '2029-12-31' },
    { ref: 'timing:liunian', valid_from: '2026-01-01', valid_until: '2026-12-31' },
    { ref: 'timing:liuyue', valid_from: '2026-08-07', valid_until: '2026-09-06' },
    { ref: 'timing:liuri', valid_from: '2026-08-08', valid_until: '2026-08-08' },
  ];
  return {
    contract_version: 'recommendation_ai_v1',
    taxonomy_version: 'recommendation_taxonomy_v1',
    effective_date: '2026-08-08',
    timezone: 'Asia/Hong_Kong',
    fortune_facts: {
      contract_version: 'daily_fortune_ai_first_v2',
      effective_date: '2026-08-08',
      timezone: 'Asia/Hong_Kong',
      natal: { pillars: pillars(item.unknownHour) },
      timing: { liuyue: { gan_zhi: '丙戌' } },
      mingli_interactions: {
        timing: [{ id: 'liuyue-to-day', fact_label: '流月作用日支' }],
      },
    },
    forecast_windows: [],
    available_fact_refs: facts,
    relationship_status: item.relationshipStatus,
    preference_context: preferenceContext(item),
    content_history: [{
      semantic_key: 'love:love_overview:describe:baseline:baseline_pattern',
      surface: 'deck',
      exposed: true,
      opened: false,
      last_seen_at: '2026-08-07T08:00:00.000Z',
    }],
    ...overrides,
  };
}

function rawCard(item: EvalCase, index: number, factRefs = [item.factRef]) {
  return {
    content_profile: {
      domain: item.domain,
      topic_key: item.topicKey,
      question_job: index === 0 ? item.questionJob : QUESTION_JOBS[index % QUESTION_JOBS.length],
      content_horizon: item.horizon,
    },
    selection_role: item.expectedSelectionRole,
    event_hypothesis: {
      event_family: EVENT_FAMILIES[index % EVENT_FAMILIES.length],
      claim_mode: item.horizon === 'baseline' ? 'description' : 'conditional',
      summary: `基于本次事实的第 ${index + 1} 个条件性现实题材假设。`,
      fact_refs: factRefs,
    },
    question: `当前阶段你最值得留意的${item.domain}变化是什么？`,
    preview: `这张卡只引用本次确定性命理事实，并围绕${item.domain}提供条件性的观察方向。`,
    body: '这是一段用于离线结构验收的完整说明。它只描述在已知事实范围内可以进一步查看的可能变化，不把任何现实事件写成已经发生或必然发生，并保留用户条件和时间窗口。',
  };
}

function validOutput(item: EvalCase, factRefs = [item.factRef]) {
  return {
    deck_cards: Array.from({ length: 6 }, (_, index) => rawCard(item, index, factRefs)),
    center_cards: Array.from({ length: 3 }, (_, index) => rawCard(item, index + 6, factRefs)),
  };
}

async function expectAiError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    assert.fail(`expected RecommendationAiError(${code})`);
  } catch (error) {
    assert.ok(error instanceof RecommendationAiError);
    assert.equal((error as { code: string }).code, code);
  }
}

async function evaluateCase(item: EvalCase): Promise<void> {
  let captured: any;
  let sequence = 0;
  const generated = await generateRecommendationCandidatesWithAi(
    inputFor(item),
    {
      async generate(request: unknown) {
        captured = request;
        return response(validOutput(item));
      },
    },
    () => `eval-${item.id}-${sequence++}`,
  );

  assert.equal(generated.deck_cards.length, 6, item.id);
  assert.equal(generated.center_cards.length, 3, item.id);
  assert.equal(captured.generationConfig.responseMimeType, 'application/json', item.id);
  assert.equal(captured.generationConfig.candidateCount, 1, item.id);

  const sentInput = JSON.parse(captured.userPrompt.split('recommendation_input:\n')[1]);
  const sentPositions = sentInput.fortune_facts.natal.pillars.map((pillar: { position: string }) => pillar.position);
  assert.equal(sentPositions.includes('hour'), !item.unknownHour, `${item.id}: actual pillars must be preserved`);
  assert.equal(sentInput.relationship_status, item.relationshipStatus, item.id);
  assert.deepEqual(sentInput.preference_context, preferenceContext(item), item.id);
  assert.equal(sentInput.available_fact_refs.some((fact: { ref: string }) => fact.ref === item.factRef), true, item.id);

  const allCards = [...generated.deck_cards, ...generated.center_cards];
  const ids = new Set(allCards.map((card) => card.candidate_id));
  assert.equal(ids.size, 9, `${item.id}: IDs must be unique`);
  allCards.forEach((card, index) => {
    const expectedSurface = index < 6 ? 'deck' : 'center';
    const expectedPosition = index < 6 ? index : index - 6;
    assert.equal(card.surface, expectedSurface, item.id);
    assert.equal(card.position, expectedPosition, item.id);
    assert.equal(card.selection_role, item.expectedSelectionRole, item.id);
    assert.deepEqual(card.event_hypothesis.fact_refs, [item.factRef], item.id);
    assert.deepEqual(card.validity, {
      valid_from: item.expectedValidity.validFrom,
      valid_until: item.expectedValidity.validUntil,
    }, item.id);
  });
}

async function main(): Promise<void> {
  const originalRecommendationModel = process.env.RECOMMENDATION_AI_MODEL;
  const originalDailyModel = process.env.DAILY_FORTUNE_AI_MODEL;
  process.env.RECOMMENDATION_AI_MODEL = 'recommendation-offline-eval';
  delete process.env.DAILY_FORTUNE_AI_MODEL;

  try {
    assert.equal(recommendationStructuralCorpus.length, 100);
    for (const item of recommendationStructuralCorpus) {
      await evaluateCase(item);
    }

    const sample = recommendationStructuralCorpus[0];
    await expectAiError(
      generateRecommendationCandidatesWithAi(inputFor(sample), {
        async generate() {
          return response(validOutput(sample, ['invented:fact:ref']));
        },
      }),
      'invalid_schema',
    );

    await expectAiError(
      generateRecommendationCandidatesWithAi(inputFor(sample, {
        available_fact_refs: [
          { ref: 'window:a', valid_from: '2026-01-01', valid_until: '2026-01-31' },
          { ref: 'window:b', valid_from: '2026-02-01', valid_until: '2026-02-28' },
        ],
      }), {
        async generate() {
          return response(validOutput(sample, ['window:a', 'window:b']));
        },
      }),
      'invalid_schema',
    );

    await expectAiError(
      generateRecommendationCandidatesWithAi(inputFor(sample, {
        available_fact_refs: [{
          ref: 'inverted:window',
          valid_from: '2026-09-01',
          valid_until: '2026-08-01',
        }],
      }), {
        async generate() {
          return response(validOutput(sample, ['inverted:window']));
        },
      }),
      'invalid_schema',
    );

    const wrongTopicForDomain = validOutput(sample) as any;
    wrongTopicForDomain.deck_cards[0].content_profile = {
      ...wrongTopicForDomain.deck_cards[0].content_profile,
      domain: 'love',
      topic_key: 'career_direction',
    };
    await expectAiError(
      generateRecommendationCandidatesWithAi(inputFor(sample), {
        async generate() {
          return response(wrongTopicForDomain);
        },
      }),
      'invalid_schema',
    );

    console.log(`Recommendation offline structural evaluation passed (${recommendationStructuralCorpus.length} cases)`);
  } finally {
    if (originalRecommendationModel === undefined) delete process.env.RECOMMENDATION_AI_MODEL;
    else process.env.RECOMMENDATION_AI_MODEL = originalRecommendationModel;
    if (originalDailyModel === undefined) delete process.env.DAILY_FORTUNE_AI_MODEL;
    else process.env.DAILY_FORTUNE_AI_MODEL = originalDailyModel;
  }
}

void main();
