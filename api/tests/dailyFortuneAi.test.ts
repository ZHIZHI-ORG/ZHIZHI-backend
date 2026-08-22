const assert = require('node:assert/strict');

const {
  DAILY_FORTUNE_DEVELOPER_PROMPT,
  DAILY_FORTUNE_SYSTEM_PROMPT,
  DailyFortuneAiError,
  GeminiDailyFortuneTransport,
  generateDailyFortuneWithAi,
} = require('../src/utils/dailyFortuneAi.ts');

function facts(pillars: Array<Record<string, unknown>>) {
  return {
    contract_version: 'daily_fortune_ai_first_v3',
    effective_date: '2026-07-23',
    timezone: 'Asia/Hong_Kong',
    day_boundary: 'zi_chu_23_local',
    profile: {
      gender: 'female',
      birth_date: '1995-08-12',
      birth_place: '广州',
      birth_timezone: 'Asia/Shanghai',
    },
    natal: {
      pillars,
      day_master: '乙木',
      day_master_element: '木',
    },
    timing: {
      dayun: timingPillar('丁亥', '丁', '亥'),
      liunian: timingPillar('丙午', '丙', '午'),
      liuyue: timingPillar('乙未', '乙', '未'),
      liuri: timingPillar('己丑', '己', '丑'),
    },
    mingli_interactions: {
      rule_version: 'mingli_interactions_v1',
      natal: [interaction('natal-arch', 'natal', 'branch_arch_harmony', false)],
      timing: [interaction('today-clash', 'liuri_to_natal', 'branch_clash', true)],
    },
    user_context: {
      declared: {
        mbti: 'INTJ',
        life_stage: { primary: '职业转换期', tags: ['换岗准备'] },
        work_study: {
          mode: 'career',
          career_status: null,
          occupation: '产品经理',
          industry: '互联网',
          study_status: null,
          school: null,
          current_goal: '完成作品集',
        },
        relationship: { status: null, current_focus: null },
      },
      zhizhi_understanding: {
        snapshot_version: 'v1',
        current_focus: ['减少无效加班'],
        expression_preferences: ['直接给行动建议'],
        behavior_signals: [],
        updated_at: '2026-07-22T08:00:00.000Z',
      },
    },
  };
}

function hiddenStems(branch: string) {
  return [{
    stem: branch === '午' ? '丁' : '甲',
    ten_god: branch === '午' ? '食神' : '正官',
    element: branch === '午' ? '火' : '木',
  }];
}

function natalPillar(position: string, stem: string, branch: string) {
  return {
    position,
    gan_zhi: `${stem}${branch}`,
    stem,
    branch,
    hidden_stems: hiddenStems(branch),
  };
}

function timingPillar(ganZhi: string, stem: string, branch: string) {
  return {
    gan_zhi: ganZhi,
    stem,
    branch,
    hidden_stems: hiddenStems(branch),
  };
}

function interaction(id: string, scope: string, relation: string, fullMatch: boolean) {
  const source = {
    type: scope === 'natal' ? 'natal_pillar' : 'liuri',
    pillar: scope === 'natal' ? 'day' : null,
    label: scope === 'natal' ? '日柱' : '流日',
    stem: '乙',
    branch: '酉',
    gan_zhi: '乙酉',
    ten_gods: ['日主'],
  };
  return {
    id,
    scope,
    relation,
    relation_name: relation === 'branch_arch_harmony' ? '拱合' : '冲',
    fact_label: relation === 'branch_arch_harmony' ? '地支拱合' : '地支相冲',
    short_label: relation === 'branch_arch_harmony' ? '拱合' : '冲',
    display_group: 'earthly_branch_luck',
    aliases: relation === 'branch_arch_harmony' ? ['三合拱局'] : ['六冲'],
    participants: [source],
    source,
    targets: [],
    transform_element: relation === 'branch_arch_harmony' ? '木' : null,
    center_branch: relation === 'branch_arch_harmony' ? '卯' : null,
    activated_palaces: ['day'],
    target_part: 'branch',
    intensity: 0.8,
    time_horizon: scope === 'natal' ? 'long_term' : 'day',
    adjacent: false,
    full_match: fullMatch,
    missing_branch: relation === 'branch_arch_harmony' ? '亥' : null,
    seen_stem: null,
    compared_against: scope === 'natal' ? 'natal' : 'natal_and_timing',
    rule_version: 'mingli_interactions_v1',
  };
}

function repeat(value: string, count: number): string {
  return value.repeat(count);
}

function validContent() {
  return {
    overall: {
      headline: '先理顺节奏再向前推进',
      body: repeat('今天适合先确认重点，再把注意力放到真正需要推进的事情上。', 10),
    },
    selected_scenes: [
      {
        scene: 'career',
        headline: '合作节奏需要重新对齐',
        items: [
          {
            kind: 'possible_event',
            title: '临时任务可能增加',
            body: repeat('当安排突然改变时，容易感到原有节奏被打断。先确认优先级，再决定投入顺序。', 4),
          },
          {
            kind: 'attention',
            title: '沟通细节容易反复',
            body: repeat('涉及多人协作时，口头理解可能出现偏差。把关键决定写下来，能减少后续来回确认。', 4),
          },
        ],
      },
      {
        scene: 'health',
        headline: '精力分配需要留出余地',
        items: [
          {
            kind: 'attention',
            title: '下午精力可能回落',
            body: repeat('连续处理高消耗任务后，注意力容易变得分散。把重要工作提前，并安排短暂休息。', 4),
          },
          {
            kind: 'possible_event',
            title: '睡眠节奏容易延后',
            body: repeat('如果晚上持续接收信息，身体可能难以及时安静下来。提前结束输入有助于收束状态。', 4),
          },
        ],
      },
    ],
  };
}

function providerResponse(content: unknown, finishReason = 'STOP') {
  return {
    candidates: [{
      finishReason,
      content: {
        parts: [{ text: JSON.stringify(content) }],
      },
    }],
  };
}

async function expectAiError(
  promise: Promise<unknown>,
  code: string
): Promise<any> {
  try {
    await promise;
    assert.fail(`expected DailyFortuneAiError(${code})`);
  } catch (error) {
    assert.ok(error instanceof DailyFortuneAiError);
    const aiError = error as {
      code: string;
      retryable: boolean;
      providerStatus?: number;
      finishReason?: string;
    };
    assert.equal(aiError.code, code);
    return aiError;
  }
}

async function main(): Promise<void> {
  const originalModel = process.env.DAILY_FORTUNE_AI_MODEL;
  const originalTimeout = process.env.DAILY_FORTUNE_AI_TIMEOUT_MS;
  const originalApiKey = process.env.GEMINI_API_KEY;
  process.env.DAILY_FORTUNE_AI_MODEL = 'gemini-test-pinned';
  delete process.env.DAILY_FORTUNE_AI_TIMEOUT_MS;

  try {
    let capturedRequest: any;
    const threePillars = [
      natalPillar('year', '乙', '亥'),
      natalPillar('month', '甲', '申'),
      natalPillar('day', '乙', '酉'),
    ];
    const content = validContent();
    const generated = await generateDailyFortuneWithAi(
      facts(threePillars),
      {
        async generate(request: any) {
          capturedRequest = request;
          return providerResponse(content);
        },
      }
    );

    assert.deepEqual(generated, content);
    assert.equal(capturedRequest.model, 'gemini-test-pinned');
    assert.equal(capturedRequest.timeoutMs, 90000);
    assert.equal(capturedRequest.generationConfig.candidateCount, 1);
    assert.equal(capturedRequest.generationConfig.maxOutputTokens, 16384);
    assert.equal(capturedRequest.generationConfig.thinkingConfig.thinkingLevel, 'low');
    assert.equal(capturedRequest.generationConfig.temperature, 0);
    assert.equal(capturedRequest.generationConfig.responseMimeType, 'application/json');
    assert.ok(capturedRequest.systemPrompt.includes('不猜测、不补齐、不暗示时柱'));
    assert.ok(capturedRequest.systemPrompt.includes('user_context_for_grounding 不是命理事实'));
    assert.ok(capturedRequest.userPrompt.includes('branch_arch_harmony'));
    assert.ok(capturedRequest.systemPrompt.includes('不能在正文中直接写出 MBTI、INTJ、ENTP 等类型名称'));
    assert.ok(capturedRequest.systemPrompt.includes('可以帮助 Top 2 在多个有命理支持的候选之间取舍'));
    assert.ok(capturedRequest.systemPrompt.includes('现实具体度按已知资料逐级落地'));
    assert.ok(capturedRequest.systemPrompt.includes('current_goal'));
    assert.ok(capturedRequest.userPrompt.includes('先根据 fortune_facts_without_user_context 建立五场景候选及支持链'));
    assert.ok(capturedRequest.userPrompt.includes('不可混写事实层级'));
    assert.ok(capturedRequest.systemPrompt.includes('可以在事实之上做二次命理归纳'));
    assert.ok(capturedRequest.userPrompt.includes('综合解释必须能从输入逐项还原'));
    assert.ok(capturedRequest.userPrompt.includes('如果今天涉及……'));
    assert.ok(capturedRequest.systemPrompt.includes('直接展示给普通用户'));
    assert.ok(capturedRequest.systemPrompt.includes('第一句会单独成为首页按钮文字'));
    assert.ok(capturedRequest.systemPrompt.includes('命理判断的准确性高于文案形式'));
    assert.ok(capturedRequest.systemPrompt.includes('不得先写现实结论'));
    assert.ok(capturedRequest.systemPrompt.includes('每一组现实判断都必须'));
    assert.ok(capturedRequest.userPrompt.includes('具体命理事实 → 关系是否完整有效'));
    assert.ok(capturedRequest.userPrompt.includes('五个场景真正竞争'));
    assert.ok(capturedRequest.userPrompt.includes('直接作用原局柱位的完整流运关系'));
    assert.ok(capturedRequest.userPrompt.includes('同一时间来源、同一原局目标、同一作用部位的多标签只算一个触发'));
    assert.ok(capturedRequest.userPrompt.includes('full_match 只表示规则成员齐全'));
    assert.ok(capturedRequest.userPrompt.includes('不得仅据此写“强烈、强旺、极强、彻底”'));
    assert.ok(capturedRequest.userPrompt.includes('必须保留“半合、半会、拱合、拱会、暗合、暗会”等限定词'));
    assert.ok(capturedRequest.userPrompt.includes('X关系成员齐全，可作为Y倾向的辅助材料'));
    assert.ok(capturedRequest.userPrompt.includes('是否成化与强弱，本层不判断'));
    assert.ok(capturedRequest.userPrompt.includes('AI 输入不提供展示标签、合化结果或强度分数'));
    assert.ok(capturedRequest.userPrompt.includes('不得去掉限定词写成完整三合、三会'));
    assert.ok(capturedRequest.userPrompt.includes('activated_palaces 为空的关系，只能作为流运背景'));
    assert.ok(capturedRequest.userPrompt.includes('没有“强证据准入门槛”'));
    assert.ok(capturedRequest.userPrompt.includes('不按固定条数计分'));
    assert.ok(capturedRequest.userPrompt.includes('降低确定性并写清成立条件，不要禁止输出'));
    assert.ok(capturedRequest.userPrompt.includes('宫位是增强解释的线索，不是缺少就禁止判断的门槛'));
    assert.ok(capturedRequest.userPrompt.includes('普通压力或单一七杀不能直接推导具体身体症状'));
    assert.ok(capturedRequest.userPrompt.includes('出现财星也不等于进账'));
    assert.ok(capturedRequest.systemPrompt.includes('不得先写现实结论，再从输入中寻找'));
    assert.ok(capturedRequest.userPrompt.includes('第一句会被首页单独展示'));
    assert.ok(capturedRequest.userPrompt.includes('目标为 26–30 个 Unicode 字符'));
    assert.ok(capturedRequest.userPrompt.includes('紧接的第二句必须写出'));
    assert.ok(capturedRequest.userPrompt.includes('往前预测一步'));
    assert.ok(capturedRequest.userPrompt.includes('用户可提前观察的一个信号'));
    assert.ok(capturedRequest.userPrompt.includes('用一句白话接住用户'));
    assert.ok(capturedRequest.userPrompt.includes('最后才检查长度与语言'));
    assert.ok(capturedRequest.userPrompt.includes('不得擅自写“午后”'));
    assert.ok(capturedRequest.userPrompt.includes('user_context_for_grounding'));
    assert.ok(capturedRequest.userPrompt.startsWith(DAILY_FORTUNE_DEVELOPER_PROMPT));
    assert.ok(capturedRequest.systemPrompt.startsWith(DAILY_FORTUNE_SYSTEM_PROMPT));
    const threePillarFactJson = capturedRequest.userPrompt
      .split('fortune_facts_without_user_context:\n')[1]
      .split('\n\n以下资料用于判断已有命理信号')[0];
    const projectedFacts = JSON.parse(threePillarFactJson);
    assert.deepEqual(
      projectedFacts.natal.pillars,
      threePillars,
      '三柱事实必须原样进入 prompt'
    );
    assert.equal(projectedFacts.user_context, undefined);
    for (const interaction of [
      ...projectedFacts.mingli_interactions.natal,
      ...projectedFacts.mingli_interactions.timing,
    ]) {
      assert.equal('fact_label' in interaction, false);
      assert.equal('short_label' in interaction, false);
      assert.equal('display_group' in interaction, false);
      assert.equal('aliases' in interaction, false);
      assert.equal('transform_element' in interaction, false);
      assert.equal('intensity' in interaction, false);
      assert.equal(typeof interaction.relation, 'string');
      assert.ok(Array.isArray(interaction.participants));
    }
    assert.equal(capturedRequest.userPrompt.includes('domain_candidates'), false);
    assert.equal(capturedRequest.userPrompt.includes('测试用命理作用证据'), false);

    const generatedWithGeminiThoughtMetadata = await generateDailyFortuneWithAi(
      facts(threePillars),
      {
        async generate() {
          return {
            candidates: [{
              finishReason: 'STOP',
              content: {
                parts: [
                  { text: '内部思考摘要', thought: true, thoughtSignature: 'thought-signature' },
                  { text: JSON.stringify(content), thoughtSignature: 'final-signature' },
                ],
              },
            }],
          };
        },
      }
    );
    assert.deepEqual(generatedWithGeminiThoughtMetadata, content);

    const fourPillars = [
      ...threePillars,
      natalPillar('hour', '丁', '亥'),
    ];
    await generateDailyFortuneWithAi(facts(fourPillars), {
      async generate(request: any) {
        const fourPillarFactJson = request.userPrompt
          .split('fortune_facts_without_user_context:\n')[1]
          .split('\n\n以下资料用于判断已有命理信号')[0];
        assert.deepEqual(
          JSON.parse(fourPillarFactJson).natal.pillars,
          fourPillars,
          '四柱事实必须原样进入 prompt'
        );
        return providerResponse(validContent());
      },
    });

    const duplicateScenes = validContent();
    duplicateScenes.selected_scenes[1].scene = 'career';
    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), {
        async generate() {
          return providerResponse(duplicateScenes);
        },
      }),
      'invalid_schema'
    );

    const extraAction = validContent() as any;
    extraAction.overall.action = '不允许出现的字段';
    const extraActionResult = await generateDailyFortuneWithAi(facts(threePillars), {
      async generate() {
        return providerResponse(extraAction);
      },
    });
    assert.equal((extraActionResult.overall as any).action, undefined);

    const oneItem = validContent();
    oneItem.selected_scenes[0].items = [oneItem.selected_scenes[0].items[0]] as any;
    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), {
        async generate() {
          return providerResponse(oneItem);
        },
      }),
      'invalid_schema'
    );

    const shortItemBody = validContent();
    shortItemBody.selected_scenes[0].items[0].body = '文';
    const shortItemResult = await generateDailyFortuneWithAi(facts(threePillars), {
      async generate() {
        return providerResponse(shortItemBody);
      },
    });
    assert.equal(shortItemResult.selected_scenes[0].items[0].body, '文');

    const emptyItemBody = validContent();
    emptyItemBody.selected_scenes[0].items[0].body = '   ';
    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), {
        async generate() {
          return providerResponse(emptyItemBody);
        },
      }),
      'invalid_schema'
    );

    const longSceneHeadline = validContent();
    longSceneHeadline.selected_scenes[0].headline = repeat('标', 30);
    const longHeadlineResult = await generateDailyFortuneWithAi(facts(threePillars), {
      async generate() {
        return providerResponse(longSceneHeadline);
      },
    });
    assert.equal(longHeadlineResult.selected_scenes[0].headline.length, 30);

    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), {
        async generate() {
          return {
            candidates: [
              providerResponse(validContent()).candidates[0],
              providerResponse(validContent()).candidates[0],
            ],
          };
        },
      }),
      'candidate'
    );

    const finishError = await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), {
        async generate() {
          return providerResponse(validContent(), 'MAX_TOKENS');
        },
      }),
      'finish_reason'
    );
    assert.equal(finishError.finishReason, 'MAX_TOKENS');

    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), {
        async generate() {
          return {
            candidates: [{
              finishReason: 'STOP',
              content: {
                parts: [{ text: `\`\`\`json\n${JSON.stringify(validContent())}\n\`\`\`` }],
              },
            }],
          };
        },
      }),
      'invalid_json'
    );

    process.env.GEMINI_API_KEY = 'test-key';
    let rateLimitCalls = 0;
    const rateLimitTransport = new GeminiDailyFortuneTransport(
      async () => {
        rateLimitCalls += 1;
        return new Response(
          JSON.stringify({ error: { message: 'rate limit' } }),
          { status: 429, headers: { 'content-type': 'application/json' } }
        );
      }
    );
    const rateLimit = await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), rateLimitTransport),
      'provider_rate_limit'
    );
    assert.equal(rateLimit.retryable, true);
    assert.equal(rateLimit.providerStatus, 429);
    assert.equal(rateLimit.providerDetail, 'rate limit');
    assert.equal(rateLimitCalls, 1, 'provider 失败时不得在同一请求内自动重试');

    let unavailableCalls = 0;
    const unavailableTransport = new GeminiDailyFortuneTransport(
      async () => {
        unavailableCalls += 1;
        return new Response('upstream unavailable', { status: 503 });
      }
    );
    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), unavailableTransport),
      'provider_unavailable'
    );
    assert.equal(unavailableCalls, 3, 'transient 5xx receives two bounded retries');

    const authTransport = new GeminiDailyFortuneTransport(
      async () => new Response('unauthorized', { status: 401 })
    );
    const auth = await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), authTransport),
      'provider_auth'
    );
    assert.equal(auth.retryable, false);

    let networkCalls = 0;
    const networkTransport = new GeminiDailyFortuneTransport(
      async () => {
        networkCalls += 1;
        throw new TypeError('connection reset');
      }
    );
    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), networkTransport),
      'network'
    );
    assert.equal(networkCalls, 3, 'transient network failures receive two bounded retries');

    let recoveredNetworkCalls = 0;
    const recoveredNetworkTransport = new GeminiDailyFortuneTransport(
      async () => {
        recoveredNetworkCalls += 1;
        if (recoveredNetworkCalls === 1) throw new TypeError('connection reset');
        return new Response(JSON.stringify(providerResponse(validContent())), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    );
    const recovered = await generateDailyFortuneWithAi(
      facts(threePillars),
      recoveredNetworkTransport,
    );
    assert.equal(recoveredNetworkCalls, 2);
    assert.equal(recovered.overall.headline, validContent().overall.headline);

    const tooLargeTransport = new GeminiDailyFortuneTransport(
      async () => new Response('', {
        status: 200,
        headers: { 'content-length': String((256 * 1024) + 1) },
      })
    );
    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), tooLargeTransport),
      'response_too_large'
    );

    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), {
        async generate() {
          return {
            promptFeedback: { blockReason: 'SAFETY' },
            candidates: [],
          };
        },
      }),
      'provider_blocked'
    );

    delete process.env.DAILY_FORTUNE_AI_MODEL;
    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), {
        async generate() {
          assert.fail('transport must not run without a configured model');
        },
      }),
      'configuration'
    );

    process.env.DAILY_FORTUNE_AI_MODEL = 'gemini-test-pinned';
    process.env.DAILY_FORTUNE_AI_TIMEOUT_MS = 'invalid';
    await expectAiError(
      generateDailyFortuneWithAi(facts(threePillars), {
        async generate() {
          assert.fail('transport must not run with invalid timeout configuration');
        },
      }),
      'configuration'
    );

    console.log('daily fortune AI contract validation passed');
  } finally {
    restoreEnv('DAILY_FORTUNE_AI_MODEL', originalModel);
    restoreEnv('DAILY_FORTUNE_AI_TIMEOUT_MS', originalTimeout);
    restoreEnv('GEMINI_API_KEY', originalApiKey);
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
