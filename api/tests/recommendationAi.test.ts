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
      contract_version: 'daily_fortune_ai_first_v3',
      natal: { pillars: [{ position: 'day', gan_zhi: '乙酉' }] },
      mingli_interactions: { natal: [] },
    },
    time_windows: [{
      window_key: 'liuyue:2026-08-07:丙戌',
      kind: 'liuyue',
      bucket: 'recent_12_liuyue',
      detail_level: 'evidence',
      parent_window_keys: ['dayun:2020:乙酉', 'liunian:2026:丙午'],
      is_current: true,
      target_window: { valid_from: '2026-08-07', valid_until: '2026-09-06' },
      timing: { gan_zhi: '丙戌', stem: '丙', branch: '戌', hidden_stems: [] },
      interaction_rule_version: 'mingli_interactions_v1',
      interactions: [],
    }],
    available_fact_refs: [
      { ref: 'natal:pillar:day', valid_from: '1995-08-12', valid_until: null },
      {
        ref: 'time:liuyue:2026-08-07:丙戌:timing',
        valid_from: '2026-08-07',
        valid_until: '2026-09-06',
      },
    ],
    reality_context: {
      personality: {
        mbti: 'INTJ',
        jungian_function_order: ['Ni', 'Te', 'Fi', 'Se', 'Ne', 'Ti', 'Fe', 'Si'],
      },
      life_stage: { primary: null, tags: [] },
      work_study: {
        mode: null,
        career_status: null,
        occupation: null,
        industry: null,
        study_status: null,
        school: null,
        current_goal: null,
      },
      relationship: { status: 'unknown', declared_status: null, current_focus: null },
      saved_understanding: {
        snapshot_version: null,
        current_focus: [],
        expression_preferences: [],
        behavior_signals: [],
        updated_at: null,
      },
    },
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
        primary_time_window_key: 'liuyue:2026-08-07:丙戌',
        referenced_window_keys: ['liuyue:2026-08-07:丙戌'],
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
    time_window_history: [{
      window_key: 'liuyue:2026-08-07:丙戌',
      primary_exposures: 2,
      primary_opens: 1,
      last_primary_exposed_at: '2026-08-02T10:00:00.000Z',
      last_primary_opened_at: '2026-08-02T10:01:00.000Z',
    }],
  };
}

function rawCard(index: number, overrides: Record<string, unknown> = {}) {
  return {
    primary_time_window_key: 'liuyue:2026-08-07:丙戌',
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
      fact_refs: ['F1', 'F2'],
    },
    question: `下个月这件事会怎样发展 ${index}？`,
    preview: `这张卡片根据当前流月和原局事实，说明接下来值得留意的变化 ${index}。`,
    body: `这里是完整解释 ${index}。它会把命理事实转成用户可理解的现实问题，同时保持条件化表达并给出观察角度。`,
    ...overrides,
  };
}

function validContent() {
  return {
    candidates: Array.from({ length: 30 }, (_, index) => rawCard(index)),
  };
}

function providerResponse(content: unknown) {
  return {
    usageMetadata: {
      promptTokenCount: 1200,
      cachedContentTokenCount: 100,
      candidatesTokenCount: 2400,
      thoughtsTokenCount: 300,
      totalTokenCount: 3900,
    },
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
    const ids = Array.from({ length: 30 }, (_, index) => `candidate-${index + 1}`);
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
    assert.equal(capturedRequest.maxProviderResponseBytes, 256 * 1024);
    assert.equal(capturedRequest.generationConfig.candidateCount, 1);
    assert.equal(capturedRequest.generationConfig.maxOutputTokens, 16384);
    assert.equal(capturedRequest.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(
      capturedRequest.generationConfig.responseJsonSchema
        .properties.candidates.items.properties.event_hypothesis.properties.fact_refs.items.enum,
      ['F1', 'F2'],
      'Gemini can only select short aliases for facts available in this request',
    );
    assert.equal(
      capturedRequest.generationConfig.responseJsonSchema
        .properties.candidates.items.properties.content_profile.properties.topic_key.enum.length,
      30,
      'Gemini receives the fixed taxonomy so labels remain valid',
    );
    assert.equal(
      capturedRequest.generationConfig.responseJsonSchema.properties.candidates.minItems,
      undefined,
      '30-card cardinality stays in prompt and server validation to avoid Gemini schema rejection',
    );
    assert.equal(
      capturedRequest.generationConfig.responseJsonSchema.properties.candidates.maxItems,
      undefined,
    );
    assert.ok(capturedRequest.systemPrompt.startsWith(RECOMMENDATION_SYSTEM_PROMPT));
    assert.ok(capturedRequest.systemPrompt.includes('open 只是弱正向兴趣'));
    assert.ok(capturedRequest.systemPrompt.includes('smoothed_open_rate'));
    assert.ok(capturedRequest.systemPrompt.includes('reality_context.relationship.status 为 unknown'));
    assert.ok(capturedRequest.systemPrompt.includes('荣格八维功能顺序'));
    assert.ok(capturedRequest.systemPrompt.includes('不是人格诊断或固定模板'));
    assert.ok(capturedRequest.systemPrompt.includes('以真实行为和明确资料为准'));
    assert.ok(capturedRequest.userPrompt.startsWith(RECOMMENDATION_DEVELOPER_PROMPT));
    assert.ok(capturedRequest.userPrompt.includes('30 张完整的上方推荐大卡候选'));
    assert.ok(capturedRequest.systemPrompt.includes('命理事实决定哪些题材有资格出现'));
    assert.ok(capturedRequest.userPrompt.includes('争吵、分手风险、新桃花'));
    assert.ok(capturedRequest.userPrompt.includes('不输出 candidate_id、position、surface、validity'));
    const promptInput = JSON.parse(capturedRequest.userPrompt.split('recommendation_input:\n')[1]);
    const expectedInput = recommendationInput();
    const { available_fact_refs: _expectedRefs, ...expectedWithoutRefs } = expectedInput;
    const { available_fact_refs: providerRefs, ...promptWithoutRefs } = promptInput;
    assert.deepEqual(promptWithoutRefs, expectedWithoutRefs, '事实、兴趣和历史必须原样进入同一次 AI 调用');
    assert.deepEqual(providerRefs, [
      {
        ref: 'F1',
        source_ref: 'natal:pillar:day',
        valid_from: '1995-08-12',
        valid_until: null,
      },
      {
        ref: 'F2',
        source_ref: 'time:liuyue:2026-08-07:丙戌:timing',
        valid_from: '2026-08-07',
        valid_until: '2026-09-06',
      },
    ]);

    assert.equal(generated.candidates.length, 30);
    assert.deepEqual(
      generated.candidates.map((card: any) => card.candidate_id),
      Array.from({ length: 30 }, (_, index) => `candidate-${index + 1}`),
    );
    assert.deepEqual(
      generated.candidates.map((card: any) => card.pool_position),
      Array.from({ length: 30 }, (_, index) => index),
    );
    assert.ok(generated.candidates.every((card: any) => card.surface === undefined));
    assert.ok(generated.candidates.every((card: any) => card.position === undefined));
    assert.equal(generated.candidates[0].primary_time_window_key, 'liuyue:2026-08-07:丙戌');
    assert.deepEqual(
      generated.candidates[0].referenced_window_keys,
      ['liuyue:2026-08-07:丙戌'],
    );
    assert.deepEqual(generated.candidates[0].validity, {
      valid_from: '2026-08-07',
      valid_until: '2026-09-06',
    });
    assert.equal(generated.candidates[0].semantic_key, 'love:relationship_progress:forecast:month:relationship_progress');
    assert.equal(generated.generation_metrics.model_id, 'gemini-recommendation-test-pinned');
    assert.equal(generated.generation_metrics.prompt_token_count, 1200);
    assert.equal(generated.generation_metrics.cached_content_token_count, 100);
    assert.equal(generated.generation_metrics.candidates_token_count, 2400);
    assert.equal(generated.generation_metrics.thoughts_token_count, 300);
    assert.equal(generated.generation_metrics.total_token_count, 3900);
    assert.equal(generated.generation_metrics.finish_reason, 'STOP');
    assert.ok(generated.generation_metrics.input_json_bytes > 0);
    assert.ok(generated.generation_metrics.request_bytes > 0);

    // This intentionally contains wording that the prompt tells the model not
    // to produce. It is accepted here to prove that the server does not add a
    // keyword blacklist or a second semantic judge after the model response.
    const mechanicalOnly = validContent();
    mechanicalOnly.candidates[0] = rawCard(0, {
      body: '你们一定会分手，这段文字故意测试服务端不会用关键词判断命理语义，而只保存结构正确且引用存在的模型输出。',
    });
    const idsForSemanticPass = Array.from({ length: 30 }, (_, index) => `semantic-${index}`);
    const semanticPass = await generateRecommendationCandidatesWithAi(
      recommendationInput(),
      { async generate() { return providerResponse(mechanicalOnly); } },
      () => idsForSemanticPass.shift() as string,
    );
    assert.ok(semanticPass.candidates[0].body.includes('一定会分手'));

    const unknownRef = validContent();
    unknownRef.candidates[0].event_hypothesis.fact_refs = ['does-not-exist'];
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(unknownRef); } },
      ),
      'invalid_schema',
    );

    const inventedPrimaryWindow = validContent();
    inventedPrimaryWindow.candidates[0].primary_time_window_key = 'liuyue:2099-01-01:甲子';
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(inventedPrimaryWindow); } },
      ),
      'invalid_schema',
    );

    const wrongPrimaryGranularity = validContent();
    wrongPrimaryGranularity.candidates[0].content_profile = {
      ...wrongPrimaryGranularity.candidates[0].content_profile,
      content_horizon: 'year',
    };
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(wrongPrimaryGranularity); } },
      ),
      'invalid_schema',
    );

    const natalBaseline = validContent();
    natalBaseline.candidates[0] = rawCard(0, {
      primary_time_window_key: 'natal',
      content_profile: {
        domain: 'love',
        topic_key: 'love_overview',
        question_job: 'describe',
        content_horizon: 'baseline',
      },
      event_hypothesis: {
        event_family: 'baseline_pattern',
        claim_mode: 'description',
        summary: '原局事实支持的长期关系模式与偏好说明。',
        fact_refs: ['F1'],
      },
    });
    const natalPass = await generateRecommendationCandidatesWithAi(
      recommendationInput(),
      { async generate() { return providerResponse(natalBaseline); } },
    );
    assert.equal(natalPass.candidates[0].primary_time_window_key, null);
    assert.deepEqual(natalPass.candidates[0].referenced_window_keys, []);

    const extraProperty = validContent() as any;
    extraProperty.candidates[0].rank_score = 1;
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(extraProperty); } },
      ),
      'invalid_schema',
    );

    const tooFewCandidates = validContent();
    tooFewCandidates.candidates = tooFewCandidates.candidates.slice(0, 29);
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(tooFewCandidates); } },
      ),
      'invalid_schema',
    );

    const tooManyCandidates = validContent();
    tooManyCandidates.candidates.push(rawCard(30));
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(tooManyCandidates); } },
      ),
      'invalid_schema',
    );

    const futureFactReference = validContent();
    futureFactReference.candidates[0].event_hypothesis.fact_refs = [
      'F3',
    ];
    futureFactReference.candidates[0].primary_time_window_key = 'liuyue:2026-09-07:丁亥';
    const inputWithFutureFact: any = recommendationInput();
    inputWithFutureFact.available_fact_refs.push({
      ref: 'time:liuyue:2026-09-07:丁亥:timing',
      valid_from: '2026-09-07',
      valid_until: '2026-10-07',
    });
    inputWithFutureFact.time_windows.push({
      window_key: 'liuyue:2026-09-07:丁亥',
      kind: 'liuyue',
      bucket: 'recent_12_liuyue',
      detail_level: 'evidence',
      parent_window_keys: ['dayun:2020:乙酉', 'liunian:2026:丙午'],
      is_current: false,
      target_window: { valid_from: '2026-09-07', valid_until: '2026-10-07' },
      timing: { gan_zhi: '丁亥', stem: '丁', branch: '亥', hidden_stems: [] },
      interaction_rule_version: 'mingli_interactions_v1',
      interactions: [],
    });
    const futurePass = await generateRecommendationCandidatesWithAi(
      inputWithFutureFact,
      { async generate() { return providerResponse(futureFactReference); } },
    );
    assert.deepEqual(futurePass.candidates[0].validity, {
      valid_from: '2026-09-07',
      valid_until: '2026-10-07',
    }, '今天展示的卡可以引用通用未来流月事实窗口');

    const noSharedTargetWindow = validContent();
    noSharedTargetWindow.candidates[0].event_hypothesis.fact_refs = [
      'F4',
      'F3',
    ];
    noSharedTargetWindow.candidates[0].primary_time_window_key = 'liuyue:2026-09-07:丁亥';
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
    invalidEnum.candidates[0].selection_role = 'p0_semantic_guard';
    await expectAiError(
      generateRecommendationCandidatesWithAi(
        recommendationInput(),
        { async generate() { return providerResponse(invalidEnum); } },
      ),
      'invalid_schema',
    );

    const mismatchedTopic = validContent() as any;
    mismatchedTopic.candidates[0].content_profile = {
      ...mismatchedTopic.candidates[0].content_profile,
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
