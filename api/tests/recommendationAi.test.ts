const assert = require('node:assert/strict');

const {
  RECOMMENDATION_CONTRACT_VERSION,
  RECOMMENDATION_TAXONOMY_VERSION,
} = require('../src/models/Recommendation.ts');
const {
  RECOMMENDATION_DEVELOPER_PROMPT,
  RECOMMENDATION_RESPONSE_SCHEMA,
  RECOMMENDATION_SYSTEM_PROMPT,
  RecommendationAiError,
  generateRecommendationCandidatesWithAi,
} = require('../src/utils/recommendationAi.ts');

function recommendationInput() {
  return {
    contract_version: RECOMMENDATION_CONTRACT_VERSION,
    taxonomy_version: RECOMMENDATION_TAXONOMY_VERSION,
    effective_date: '2026-08-08',
    timezone: 'Asia/Hong_Kong',
    // The generator does not recalculate or reinterpret these facts. They are
    // passed verbatim to Gemini, while available_fact_refs is the traceable
    // citation set that the server can mechanically validate.
    fortune_facts: {
      contract_version: 'daily_fortune_ai_first_v2',
      natal: { pillars: [{ position: 'day', gan_zhi: '乙酉' }] },
      timing: { liuyue: { gan_zhi: '丙戌' } },
      mingli_interactions: { timing: [{ id: 'liuyue-to-day-branch' }] },
    },
    forecast_windows: [],
    available_fact_refs: [
      { ref: 'natal:pillar:day', valid_from: '1995-08-12', valid_until: null },
      { ref: 'timing:liuyue', valid_from: '2026-08-07', valid_until: '2026-09-06' },
      {
        ref: 'interaction:liuyue-to-day-branch',
        valid_from: '2026-08-07',
        valid_until: '2026-09-06',
      },
    ],
    relationship_status: 'unknown',
    preference_context: {
      recent_14d: [{
        dimension: 'domain', key: 'love', exposures: 4, opens: 2, smoothed_open_rate: 0.375,
      }],
      long_term_90d: [{
        dimension: 'topic_key', key: 'career_direction', exposures: 8, opens: 3, smoothed_open_rate: 0.333,
      }],
      current_session_opens: [{
        candidate_id: 'previous-card',
        content_profile: {
          domain: 'love',
          topic_key: 'relationship_progress',
          question_job: 'forecast',
          content_horizon: 'month',
        },
        opened_at: '2026-08-03T10:00:00.000Z',
      }],
    },
    content_history: [{
      semantic_key: 'love:relationship_progress:forecast:month:relationship_progress',
      surface: 'deck',
      exposed: true,
      opened: true,
      last_seen_at: '2026-08-02T10:00:00.000Z',
    }],
  };
}

function rawCard(index: number, overrides: Record<string, unknown> = {}) {
  return {
    content_profile: {
      domain: index % 2 === 0 ? 'love' : 'career',
      topic_key: index % 2 === 0 ? 'relationship_progress' : 'career_direction',
      question_job: 'forecast',
      content_horizon: 'month',
    },
    selection_role: index === 0 ? 'p1_mingli_change' : 'p3_diversity',
    event_hypothesis: {
      event_family: index === 0 ? 'relationship_progress' : 'adjustment',
      claim_mode: 'conditional',
      summary: `流月引动下值得留意的关系与节奏变化 ${index}`,
      fact_refs: ['natal:pillar:day', 'timing:liuyue'],
    },
    question: `下个月这件事会怎样发展 ${index}？`,
    preview: `这张卡片根据当前流月和原局事实，说明接下来值得留意的变化 ${index}。`,
    body: `这里是完整解释 ${index}。它会把命理事实转成用户可理解的现实问题，同时保持条件化表达并给出观察角度。`,
    ...overrides,
  };
}

function validContent() {
  return {
    deck_cards: Array.from({ length: 6 }, (_, index) => rawCard(index)),
    center_cards: Array.from({ length: 3 }, (_, index) => rawCard(index + 6)),
  };
}

function providerResponse(content: unknown) {
  return {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text: JSON.stringify(content) }] },
    }],
  };
}

async function expectAiError(promise: Promise<unknown>, code: string): Promise<any> {
  try {
    await promise;
    assert.fail(`expected RecommendationAiError(${code})`);
  } catch (error) {
    assert.ok(error instanceof RecommendationAiError);
    const aiError = error as { code: string };
    assert.equal(aiError.code, code);
    return aiError;
  }
}

async function main(): Promise<void> {
  const originalRecommendationModel = process.env.RECOMMENDATION_AI_MODEL;
  const originalRecommendationTimeout = process.env.RECOMMENDATION_AI_TIMEOUT_MS;
  const originalDailyModel = process.env.DAILY_FORTUNE_AI_MODEL;
  const originalDailyTimeout = process.env.DAILY_FORTUNE_AI_TIMEOUT_MS;
  process.env.RECOMMENDATION_AI_MODEL = 'gemini-recommendation-test-pinned';
  delete process.env.RECOMMENDATION_AI_TIMEOUT_MS;
  delete process.env.DAILY_FORTUNE_AI_MODEL;
  delete process.env.DAILY_FORTUNE_AI_TIMEOUT_MS;

  try {
    let calls = 0;
    let capturedRequest: any;
    const ids = Array.from({ length: 9 }, (_, index) => `candidate-${index + 1}`);
    const generated = await generateRecommendationCandidatesWithAi(
      recommendationInput(),
      {
        async generate(request: any) {
          calls += 1;
          capturedRequest = request;
          return providerResponse(validContent());
        },
      },
      () => ids.shift() as string,
    );

    assert.equal(calls, 1, '一批卡片只能发起一次 Gemini 调用');
    assert.equal(capturedRequest.model, 'gemini-recommendation-test-pinned');
    assert.equal(capturedRequest.timeoutMs, 90_000);
    assert.equal(capturedRequest.generationConfig.candidateCount, 1);
    assert.equal(capturedRequest.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(capturedRequest.generationConfig.responseJsonSchema, RECOMMENDATION_RESPONSE_SCHEMA);
    assert.ok(capturedRequest.systemPrompt.startsWith(RECOMMENDATION_SYSTEM_PROMPT));
    assert.ok(capturedRequest.systemPrompt.includes('open 只是弱正向兴趣'));
    assert.ok(capturedRequest.systemPrompt.includes('smoothed_open_rate'));
    assert.ok(capturedRequest.systemPrompt.includes('relationship_status 为 unknown'));
    assert.ok(capturedRequest.userPrompt.startsWith(RECOMMENDATION_DEVELOPER_PROMPT));
    assert.ok(capturedRequest.systemPrompt.includes('命理事实决定哪些题材有资格出现'));
    assert.ok(capturedRequest.userPrompt.includes('争吵、分手风险、新桃花'));
    assert.ok(capturedRequest.userPrompt.includes('不输出 candidate_id、position、surface、validity'));
    const promptInput = JSON.parse(capturedRequest.userPrompt.split('recommendation_input:\n')[1]);
    assert.deepEqual(promptInput, recommendationInput(), '事实、兴趣和历史必须原样进入同一次 AI 调用');

    assert.equal(generated.deck_cards.length, 6);
    assert.equal(generated.center_cards.length, 3);
    assert.deepEqual(generated.deck_cards.map((card: any) => card.candidate_id), [
      'candidate-1', 'candidate-2', 'candidate-3', 'candidate-4', 'candidate-5', 'candidate-6',
    ]);
    assert.deepEqual(generated.center_cards.map((card: any) => card.candidate_id), [
      'candidate-7', 'candidate-8', 'candidate-9',
    ]);
    assert.deepEqual(generated.deck_cards.map((card: any) => card.position), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(generated.center_cards.map((card: any) => card.position), [0, 1, 2]);
    assert.ok(generated.deck_cards.every((card: any) => card.surface === 'deck'));
    assert.ok(generated.center_cards.every((card: any) => card.surface === 'center'));
    assert.deepEqual(generated.deck_cards[0].validity, {
      valid_from: '2026-08-07',
      valid_until: '2026-09-06',
    });
    assert.equal(generated.deck_cards[0].semantic_key, 'love:relationship_progress:forecast:month:relationship_progress');

    // This intentionally contains wording that the prompt tells the model not
    // to produce. It is accepted here to prove that the server does not add a
    // keyword blacklist or a second semantic judge after the model response.
    const mechanicalOnly = validContent();
    mechanicalOnly.deck_cards[0] = rawCard(0, {
      body: '你们一定会分手，这段文字故意测试服务端不会用关键词判断命理语义，而只保存结构正确且引用存在的模型输出。',
    });
    const idsForSemanticPass = Array.from({ length: 9 }, (_, index) => `semantic-${index}`);
    const semanticPass = await generateRecommendationCandidatesWithAi(
      recommendationInput(),
      { async generate() { return providerResponse(mechanicalOnly); } },
      () => idsForSemanticPass.shift() as string,
    );
    assert.ok(semanticPass.deck_cards[0].body.includes('一定会分手'));

    const unknownRef = validContent();
    unknownRef.deck_cards[0].event_hypothesis.fact_refs = ['does-not-exist'];
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(unknownRef); } },
      ),
      'invalid_schema',
    );

    const extraProperty = validContent() as any;
    extraProperty.deck_cards[0].rank_score = 1;
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(extraProperty); } },
      ),
      'invalid_schema',
    );

    const tooFewCenterCards = validContent();
    tooFewCenterCards.center_cards = tooFewCenterCards.center_cards.slice(0, 2);
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(tooFewCenterCards); } },
      ),
      'invalid_schema',
    );

    const tooManyDeckCards = validContent();
    tooManyDeckCards.deck_cards.push(rawCard(9));
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(tooManyDeckCards); } },
      ),
      'invalid_schema',
    );

    const futureFactReference = validContent();
    futureFactReference.deck_cards[0].event_hypothesis.fact_refs = ['forecast:next_liuyue:timing:liuyue'];
    const inputWithFutureFact: any = recommendationInput();
    inputWithFutureFact.available_fact_refs.push({
      ref: 'forecast:next_liuyue:timing:liuyue',
      valid_from: '2026-08-09',
      valid_until: '2026-09-06',
    });
    inputWithFutureFact.forecast_windows = [{
      window_key: 'next_liuyue',
      label: '下一个流月',
      target_window: { valid_from: '2026-08-09', valid_until: '2026-09-06' },
      fact_ref_prefix: 'forecast:next_liuyue:',
      fortune_facts: {
        contract_version: 'daily_fortune_ai_first_v2',
        effective_date: '2026-08-09',
        timing: { liuyue: { gan_zhi: '丁亥' } },
      },
    }];
    const futurePass = await generateRecommendationCandidatesWithAi(
      inputWithFutureFact,
      { async generate() { return providerResponse(futureFactReference); } },
    );
    assert.deepEqual(futurePass.deck_cards[0].validity, {
      valid_from: '2026-08-09',
      valid_until: '2026-09-06',
    }, '今天展示的卡可以引用下一个流月的事实窗口');

    const noSharedTargetWindow = validContent();
    noSharedTargetWindow.deck_cards[0].event_hypothesis.fact_refs = [
      'timing:past',
      'forecast:next_liuyue:timing:liuyue',
    ];
    inputWithFutureFact.available_fact_refs.push({
      ref: 'timing:past',
      valid_from: '2026-08-01',
      valid_until: '2026-08-02',
    });
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        inputWithFutureFact,
        { async generate() { return providerResponse(noSharedTargetWindow); } },
      ),
      'invalid_schema',
    );

    process.env.RECOMMENDATION_AI_TIMEOUT_MS = '100001';
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(validContent()); } },
      ),
      'configuration',
    );
    delete process.env.RECOMMENDATION_AI_TIMEOUT_MS;

    const invalidEnum = validContent() as any;
    invalidEnum.deck_cards[0].selection_role = 'p0_semantic_guard';
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(invalidEnum); } },
      ),
      'invalid_schema',
    );

    const mismatchedTopic = validContent() as any;
    mismatchedTopic.deck_cards[0].content_profile = {
      ...mismatchedTopic.deck_cards[0].content_profile,
      domain: 'love',
      topic_key: 'career_direction',
    };
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(mismatchedTopic); } },
      ),
      'invalid_schema',
    );

    console.log('recommendation AI contract validation passed');
  } finally {
    restoreEnv('RECOMMENDATION_AI_MODEL', originalRecommendationModel);
    restoreEnv('RECOMMENDATION_AI_TIMEOUT_MS', originalRecommendationTimeout);
    restoreEnv('DAILY_FORTUNE_AI_MODEL', originalDailyModel);
    restoreEnv('DAILY_FORTUNE_AI_TIMEOUT_MS', originalDailyTimeout);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
