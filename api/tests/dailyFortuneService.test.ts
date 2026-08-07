import assert from 'node:assert/strict';
import type {
  DailyFortuneArtifactRow,
  FinalizeDailyFortuneArtifactInput,
} from '../src/database/repositories/DailyFortuneArtifactRepository';
import type { DailyFortuneAiContent } from '../src/models/DailyFortune';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.DAILY_FORTUNE_AI_MODEL ||= 'gemini-test-pinned';

const {
  buildDailyFortuneFactPackage,
  createDailyFortuneService,
  resolveDailyFortuneDate,
} = require('../src/services/dailyFortuneService') as typeof import('../src/services/dailyFortuneService');
const { DailyFortuneAiError } = require('../src/utils/dailyFortuneAi') as typeof import('../src/utils/dailyFortuneAi');

const now = new Date('2026-07-23T14:30:00.000Z');

const content: DailyFortuneAiContent = {
  overall: {
    headline: '先稳住节奏再推进',
    body: '今天适合先梳理任务和关系中的优先级，再处理真正影响结果的部分。面对临时变化时，越急着一次解决越容易遗漏细节，先确认边界、资源和对方预期，会让后续推进更顺。工作上的责任感会比较突出，沟通也更需要留出确认空间。把最重要的一件事拆成两个可以完成的动作，先完成验证，再决定是否扩大投入。',
  },
  selected_scenes: [
    {
      scene: 'career',
      headline: '责任增加先定边界',
      items: [
        {
          kind: 'possible_event',
          title: '临时任务需要接手',
          body: '工作中可能出现临时补位、信息补全或需要你做最终确认的情况。先问清交付标准和真正截止点，再决定自己承担到哪一步，能够避免因为默认全盘接下而挤压原有安排。完成关键节点后及时同步进度，让合作方知道下一步由谁推进。',
        },
        {
          kind: 'attention',
          title: '决定之前复核信息',
          body: '今天在判断优先级时容易受到现场压力影响，特别是多人同时给出意见时。适合把事实、假设和待确认项分开记录，先完成一次小范围验证，再给出最终答复。这样既不会拖慢进度，也能减少之后反复修改或重新解释的成本。',
        },
      ],
    },
    {
      scene: 'love',
      headline: '表达直接也要留白',
      items: [
        {
          kind: 'possible_event',
          title: '小分歧浮到表面',
          body: '亲密互动里可能因为时间安排、回应速度或对一件小事的理解不同而出现短暂分歧。先说明自己真正关心的点，再邀请对方补充感受，比急着证明谁更合理更有效。单身状态下，也适合观察对方是否愿意稳定回应，而不是只看一时热度。',
        },
        {
          kind: 'attention',
          title: '别替对方先下结论',
          body: '当对方表达得不够完整时，今天较容易根据语气或过去经验提前推断含义。可以用一句具体问题确认，例如现在需要被理解还是一起找办法。把猜测换成确认，会让交流更轻，也能避免把原本可处理的小问题扩大成态度层面的争执。',
        },
      ],
    },
  ],
};

async function run(name: string, test: () => void | Promise<void>): Promise<void> {
  try {
    await test();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function hiddenStems(branch: string) {
  const source: Record<string, Array<{ stem: string; ten_god: string; element: string }>> = {
    子: [{ stem: '癸', ten_god: '偏财', element: '水' }],
    丑: [
      { stem: '己', ten_god: '比肩', element: '土' },
      { stem: '癸', ten_god: '偏财', element: '水' },
      { stem: '辛', ten_god: '食神', element: '金' },
    ],
    寅: [
      { stem: '甲', ten_god: '正官', element: '木' },
      { stem: '丙', ten_god: '正印', element: '火' },
      { stem: '戊', ten_god: '劫财', element: '土' },
    ],
    卯: [{ stem: '乙', ten_god: '七杀', element: '木' }],
    午: [
      { stem: '丁', ten_god: '偏印', element: '火' },
      { stem: '己', ten_god: '比肩', element: '土' },
    ],
    未: [
      { stem: '己', ten_god: '比肩', element: '土' },
      { stem: '丁', ten_god: '偏印', element: '火' },
      { stem: '乙', ten_god: '七杀', element: '木' },
    ],
  };
  return source[branch] || [{ stem: '甲', ten_god: '正官', element: '木' }];
}

function pillar(
  position: 'year' | 'month' | 'day' | 'hour',
  stem: string,
  branch: string,
  tenGod: string,
) {
  return {
    position,
    stem,
    branch,
    ten_god: tenGod,
    stem_element: '土',
    branch_element: '土',
    hidden_stems: hiddenStems(branch),
  };
}

function timingPillar(
  ganZhi: string,
  stem: string,
  branch: string,
  extra: Record<string, unknown> = {},
) {
  return {
    gan_zhi: ganZhi,
    stem,
    branch,
    hidden_stems: hiddenStems(branch),
    ...extra,
  };
}

function participant(
  type: string,
  pillarPosition: string | null,
  stem: string,
  branch: string,
) {
  return {
    type,
    pillar: pillarPosition,
    label: pillarPosition || type,
    stem,
    branch,
    gan_zhi: `${stem}${branch}`,
    ten_gods: ['比肩'],
  };
}

function interaction(input: {
  id: string;
  scope: string;
  relation: string;
  participants: any[];
  source?: any;
  targets?: any[];
  full_match?: boolean;
  missing_branch?: string | null;
  seen_stem?: string | null;
}) {
  return {
    id: input.id,
    scope: input.scope,
    relation: input.relation,
    relation_name: input.relation === 'branch_arch_harmony' ? '拱合' : '冲',
    fact_label: input.relation === 'branch_arch_harmony' ? '地支拱合' : '地支相冲',
    short_label: input.relation === 'branch_arch_harmony' ? '拱合' : '冲',
    display_group: 'earthly_branch_luck',
    aliases: input.relation === 'branch_arch_harmony' ? ['三合拱局'] : ['六冲'],
    participants: input.participants,
    source: input.source || input.participants[0],
    targets: input.targets || input.participants.slice(1),
    transform_element: input.relation === 'branch_arch_harmony' ? '木' : null,
    center_branch: input.relation === 'branch_arch_harmony' ? '卯' : null,
    activated_palaces: ['day'],
    intensity: 0.8,
    time_horizon: input.scope === 'natal' ? 'long_term' : 'day',
    adjacent: false,
    full_match: input.full_match ?? true,
    missing_branch: input.missing_branch ?? null,
    seen_stem: input.seen_stem ?? null,
    compared_against: input.scope === 'natal' ? 'natal' : 'natal_and_timing',
    rule_version: 'mingli_interactions_v1',
  };
}

function engineBundle(pillarCount: 3 | 4 = 3, context: Record<string, unknown> = {}) {
  const pillars = [
    pillar('year', '甲', '子', '正官'),
    pillar('month', '乙', '未', '七杀'),
    pillar('day', '己', '丑', '日主'),
    ...(pillarCount === 4
      ? [pillar('hour', '丙', '寅', '正印')]
      : []),
  ];
  const natalDay = participant('natal_pillar', 'day', '己', '丑');
  const natalHour = participant('natal_pillar', 'hour', '丙', '寅');
  const liuri = participant('liuri', null, '己', '丑');
  return {
    profile: {
      id: 'profile-1',
      owner_user_id: 'user-1',
      is_owner: true,
      name: '测试档案',
      gender: 'female',
      birth_year: 1992,
      birth_month: 6,
      birth_day: 8,
      birth_hour: pillarCount === 4 ? 9 : null,
      birth_minute: pillarCount === 4 ? 30 : null,
      is_lunar: false,
      birth_timezone: 'Asia/Shanghai',
      birth_region: '上海',
      full_chart: { pillars: pillarCount },
      mbti: 'INFJ',
      daily_fortune_context: context,
      updated_at: '2026-07-20T00:00:00.000Z',
      created_at: '2026-07-01T00:00:00.000Z',
    },
    chart: {
      day_master: '己',
      day_master_element: '土',
      pillars,
      mingli_facts: {
        rule_version: 'mingli_interactions_v1',
        natal_interactions: [
          interaction({
            id: 'keep-day',
            scope: 'natal',
            relation: 'branch_arch_harmony',
            participants: [natalDay],
            full_match: false,
            missing_branch: '巳',
            seen_stem: '甲',
          }),
          ...(pillarCount === 4
            ? [interaction({
                id: 'hour-relation',
                scope: 'natal',
                relation: 'branch_clash',
                participants: [natalHour],
              })]
            : []),
        ],
      },
    },
    timeline: {
      active_luck_context: {
        dayun: timingPillar('丁卯', '丁', '卯', {
          ten_god: '偏印',
          start_year: 2024,
          end_year: 2033,
        }),
        liunian: timingPillar('丙午', '丙', '午', { ten_god_top: '正印', year: 2026 }),
        liuyue: timingPillar('乙未', '乙', '未', {
          ten_god: '七杀',
          month: 7,
          start_date: '2026-07-07',
          end_date: '2026-08-07',
        }),
        liuri: timingPillar('己丑', '己', '丑', { ten_god_top: '比肩', date: '2026-07-23' }),
      },
      timing_interactions: [
        interaction({
          id: 'timing-day',
          scope: 'liuri_to_natal',
          relation: 'branch_clash',
          participants: [liuri, natalDay],
          source: liuri,
          targets: [natalDay],
        }),
      ],
    },
  } as any;
}

function artifactRow(
  overrides: Partial<DailyFortuneArtifactRow> = {},
): DailyFortuneArtifactRow {
  return {
    id: 'artifact-1',
    generation_key: 'generation-key',
    user_id: 'user-1',
    profile_id: 'profile-1',
    effective_date: '2026-07-23',
    profile_revision_hash: 'revision',
    profile_updated_at: '2026-07-20T00:00:00.000Z',
    generation_timezone: 'Asia/Hong_Kong',
    status: 'ready',
    lease_token: null,
    lease_epoch: 1,
    lease_expires_at: null,
    attempt_count: 1,
    next_attempt_at: null,
    fact_contract_version: 'daily_fortune_ai_first_v3',
    fact_hash: 'fact-hash',
    fact_snapshot_json: null,
    day_context_json: {
      dayun: '丁卯',
      liunian: '丙午',
      liuyue: '乙未',
      liuri: '己丑',
    },
    content_json: content,
    prompt_version: 'daily_fortune_prompt_v7',
    output_schema_version: 'daily_fortune_output_v1',
    generation_config_version: 'daily_fortune_gemini_v2',
    model_id: 'gemini-test-pinned',
    created_at: '2026-07-23T14:30:00.000Z',
    ready_at: '2026-07-23T14:30:01.000Z',
    ...overrides,
  };
}

async function main(): Promise<void> {
  await run('子初 23:00 按请求时区切换有效日期', () => {
    assert.deepEqual(
      resolveDailyFortuneDate(
        new Date('2026-07-23T14:59:59.000Z'),
        'Asia/Hong_Kong',
      ),
      {
        effectiveDate: '2026-07-23',
        nextBoundaryAt: '2026-07-23T15:00:00.000Z',
      },
    );
    assert.deepEqual(
      resolveDailyFortuneDate(
        new Date('2026-07-23T15:00:00.000Z'),
        'Asia/Hong_Kong',
      ),
      {
        effectiveDate: '2026-07-24',
        nextBoundaryAt: '2026-07-24T15:00:00.000Z',
      },
    );
  });

  await run('三柱原样传递实际三柱、完整藏干和对应关系层', () => {
    const facts = buildDailyFortuneFactPackage(
      engineBundle(3),
      '2026-07-23',
      'Asia/Hong_Kong',
    );
    assert.deepEqual(facts.natal.pillars.map((pillar) => pillar.position), [
      'year',
      'month',
      'day',
    ]);
    assert.equal(JSON.stringify(facts).includes('hour_precision'), false);
    assert.equal(JSON.stringify(facts).includes('unknown_hour'), false);
    assert.deepEqual(
      facts.mingli_interactions.natal.map((item) => item.id),
      ['keep-day'],
    );
    assert.deepEqual(facts.mingli_interactions.timing.map((item) => item.id), ['timing-day']);
    assert.deepEqual(facts.mingli_interactions.natal[0], {
      id: 'keep-day',
      scope: 'natal',
      relation: 'branch_arch_harmony',
      relation_name: '拱合',
      fact_label: '地支拱合',
      short_label: '拱合',
      display_group: 'earthly_branch_luck',
      aliases: ['三合拱局'],
      participants: [participant('natal_pillar', 'day', '己', '丑')],
      source: participant('natal_pillar', 'day', '己', '丑'),
      targets: [],
      transform_element: '木',
      center_branch: '卯',
      activated_palaces: ['day'],
      target_part: 'branch',
      intensity: 0.8,
      time_horizon: 'long_term',
      adjacent: false,
      full_match: false,
      missing_branch: '巳',
      seen_stem: '甲',
      compared_against: 'natal',
      rule_version: 'mingli_interactions_v1',
    });
    for (const factPillar of [
      ...facts.natal.pillars,
      facts.timing.dayun,
      facts.timing.liunian,
      facts.timing.liuyue,
      facts.timing.liuri,
    ]) {
      assert.ok(factPillar.hidden_stems.length > 0);
      assert.ok(factPillar.hidden_stems.every((hidden) => (
        Boolean(hidden.stem) && Boolean(hidden.ten_god) && Boolean(hidden.element)
      )));
    }
    assert.equal(JSON.stringify(facts).includes('evidence'), false);
    assert.equal(JSON.stringify(facts).includes('domain_candidates'), false);
    assert.equal(facts.mingli_interactions.timing[0].target_part, 'branch');
    assert.equal(facts.timing.liuyue.start_date, '2026-07-07');
    assert.equal(facts.timing.liuyue.end_date, '2026-08-07');
    assert.equal(facts.timing.dayun.start_year, 2024);
    assert.equal(facts.timing.dayun.end_year, 2033);
    assert.equal(JSON.stringify(facts).includes('fact_panel'), false);
    assert.equal(JSON.stringify(facts).includes('mingli_ai_context'), false);
  });

  await run('四柱档案原样包含时柱', () => {
    const facts = buildDailyFortuneFactPackage(
      engineBundle(4),
      '2026-07-23',
      'Asia/Hong_Kong',
    );
    assert.deepEqual(facts.natal.pillars.map((pillar) => pillar.position), [
      'year',
      'month',
      'day',
      'hour',
    ]);
    assert.deepEqual(
      facts.mingli_interactions.natal.map((item) => item.id),
      ['hour-relation', 'keep-day'],
    );
  });

  await run('童限没有真实地支时不伪造藏干', () => {
    const bundle = engineBundle(3);
    bundle.timeline.active_luck_context.dayun = {
      gan_zhi: '童限',
      stem: '',
      branch: '',
      hidden_stems: [],
    };
    const facts = buildDailyFortuneFactPackage(
      bundle,
      '2026-07-23',
      'Asia/Hong_Kong',
    );
    assert.deepEqual(facts.timing.dayun, {
      gan_zhi: '童限',
      stem: null,
      branch: null,
      hidden_stems: [],
    });
  });

  await run('缺少真实地支的藏干时，在 claim 与 AI 之前失败', async () => {
    const broken = engineBundle(3);
    broken.timeline.active_luck_context.liuri.hidden_stems = [];
    let claimCalls = 0;
    let aiCalls = 0;
    const service = createDailyFortuneService({
      artifacts: {
        findReadyByIdentity: async () => null,
        claim: async () => {
          claimCalls += 1;
          throw new Error('facts must fail before claim');
        },
        findById: async () => null,
        finalize: async () => false,
        markRetryWait: async () => false,
      },
      getEngineBundle: async () => broken,
      getUser: async () => null,
      generateContent: async () => {
        aiCalls += 1;
        return content;
      },
      generationEnabled: () => true,
      now: () => now,
    });

    const result = await service.resolveDailyFortune('user-1', {
      bazi_profile_id: 'profile-1',
      timezone: 'Asia/Hong_Kong',
      request_id: 'request-1',
    });

    assert.deepEqual(result, {
      status: 'unavailable',
      message: '今日日运尚未生成',
      cause: 'FACTS_INCOMPLETE',
      next_action: 'RETRY_POST_LATER',
      retryable: true,
    });
    assert.equal(claimCalls, 0);
    assert.equal(aiCalls, 0);
  });

  await run('用户现实上下文进入事实包且不混入亲友档案', () => {
    const ownerFacts = buildDailyFortuneFactPackage(
      engineBundle(3, {
        life_stage: { primary: '职业转换期', tags: ['换岗准备'] },
        work_study: { mode: 'career', industry: '互联网', current_goal: '完成作品集' },
        relationship: { status: '恋爱中', current_focus: '沟通节奏' },
        zhizhi_understanding: {
          snapshot_version: 'v1',
          current_focus: ['减少无效加班'],
          expression_preferences: ['直接给行动建议'],
          behavior_signals: ['近期任务密集'],
          updated_at: '2026-07-22T08:00:00.000Z',
        },
      }),
      '2026-07-23',
      'Asia/Hong_Kong',
      {
        id: 'user-1',
        email: 'test@example.com',
        career: '产品经理',
        school: '知之大学',
        mbti: 'INTJ',
        is_active: true,
        is_email_verified: true,
        bazi_profile_count: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-07-22T00:00:00.000Z',
      },
    );
    assert.deepEqual(ownerFacts.user_context, {
      declared: {
        mbti: 'INFJ',
        life_stage: { primary: '职业转换期', tags: ['换岗准备'] },
        work_study: {
          mode: 'career',
          career_status: null,
          occupation: '产品经理',
          industry: '互联网',
          study_status: null,
          school: '知之大学',
          current_goal: '完成作品集',
        },
        relationship: { status: '恋爱中', current_focus: '沟通节奏' },
      },
      zhizhi_understanding: {
        snapshot_version: 'v1',
        current_focus: ['减少无效加班'],
        expression_preferences: ['直接给行动建议'],
        behavior_signals: ['近期任务密集'],
        updated_at: '2026-07-22T08:00:00.000Z',
      },
    });

    const friendBundle = engineBundle(3);
    friendBundle.profile.is_owner = false;
    friendBundle.profile.mbti = undefined;
    const friendFacts = buildDailyFortuneFactPackage(
      friendBundle,
      '2026-07-23',
      'Asia/Hong_Kong',
      {
        id: 'user-1',
        email: 'test@example.com',
        career: '产品经理',
        school: '知之大学',
        mbti: 'INTJ',
        is_active: true,
        is_email_verified: true,
        bazi_profile_count: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-07-22T00:00:00.000Z',
      },
    );
    assert.equal(friendFacts.user_context.declared.mbti, null);
    assert.equal(friendFacts.user_context.declared.work_study.occupation, null);
    assert.equal(friendFacts.user_context.declared.work_study.school, null);
  });

  await run('owner claim 只调用一次 AI，持久化成功后才返回 READY', async () => {
    let aiCalls = 0;
    let claimCalls = 0;
    let finalizedInput: FinalizeDailyFortuneArtifactInput | undefined;
    const artifacts = {
      findReadyByIdentity: async () => null,
      claim: async () => {
        claimCalls += 1;
        return {
          outcome: 'owner' as const,
          artifactId: 'artifact-1',
          status: 'generating' as const,
          leaseToken: 'lease-1',
          leaseEpoch: 1,
          leaseExpiresAt: '2026-07-23T14:31:00.000Z',
          nextAttemptAt: null,
        };
      },
      finalize: async (input: FinalizeDailyFortuneArtifactInput) => {
        finalizedInput = input;
        return true;
      },
      findById: async () => finalizedInput
        ? artifactRow({
            fact_snapshot_json: finalizedInput.factSnapshot,
            day_context_json: finalizedInput.dayContext,
            content_json: finalizedInput.content,
          })
        : null,
      markRetryWait: async () => true,
    };
    const service = createDailyFortuneService({
      artifacts,
      getEngineBundle: async () => engineBundle(3),
      getUser: async () => null,
      generateContent: async () => {
        aiCalls += 1;
        return content;
      },
      generationEnabled: () => true,
      now: () => now,
    });

    const result = await service.resolveDailyFortune('user-1', {
      bazi_profile_id: 'profile-1',
      timezone: 'Asia/Hong_Kong',
      request_id: 'request-1',
    });

    assert.equal(result.status, 'ready');
    assert.equal(aiCalls, 1);
    assert.equal(claimCalls, 1);
    assert.equal(finalizedInput?.content, content);
    assert.deepEqual(finalizedInput?.dayContext, {
      dayun: '丁卯',
      liunian: '丙午',
      liuyue: '乙未',
      liuri: '己丑',
    });
  });

  await run('现实上下文变更会生成新的同日缓存身份', async () => {
    const resolveRevisionHash = async (relationshipStatus: string) => {
      let receivedHash = '';
      const service = createDailyFortuneService({
        artifacts: {
          findReadyByIdentity: async () => null,
          claim: async (input: any) => {
            receivedHash = input.profileRevisionHash;
            return {
              outcome: 'join',
              artifactId: 'artifact-1',
              status: 'generating',
              leaseToken: null,
              leaseEpoch: 1,
              leaseExpiresAt: '2026-07-23T14:31:00.000Z',
              nextAttemptAt: null,
            };
          },
          findById: async () => null,
          finalize: async () => false,
          markRetryWait: async () => false,
        },
        getEngineBundle: async () => engineBundle(3, {
          relationship: { status: relationshipStatus },
        }),
        getUser: async () => null,
        generateContent: async () => content,
        generationEnabled: () => true,
        now: () => now,
      });
      await service.resolveDailyFortune('user-1', {
        bazi_profile_id: 'profile-1',
        timezone: 'Asia/Hong_Kong',
        request_id: 'request-1',
      });
      return receivedHash;
    };

    assert.notEqual(await resolveRevisionHash('恋爱中'), await resolveRevisionHash('单身'));
  });

  await run('join 只返回轮询状态，不重复调用 AI', async () => {
    let aiCalls = 0;
    const service = createDailyFortuneService({
      artifacts: {
        findReadyByIdentity: async () => null,
        claim: async () => ({
          outcome: 'join',
          artifactId: 'artifact-1',
          status: 'generating',
          leaseToken: null,
          leaseEpoch: 1,
          leaseExpiresAt: '2026-07-23T14:31:00.000Z',
          nextAttemptAt: null,
        }),
        findById: async () => null,
        finalize: async () => false,
        markRetryWait: async () => false,
      },
      getEngineBundle: async () => engineBundle(3),
      getUser: async () => null,
      generateContent: async () => {
        aiCalls += 1;
        return content;
      },
      generationEnabled: () => true,
      now: () => now,
    });

    const result = await service.resolveDailyFortune('user-1', {
      bazi_profile_id: 'profile-1',
      timezone: 'Asia/Hong_Kong',
      request_id: 'request-1',
    });

    assert.equal(result.status, 'generating');
    assert.equal(aiCalls, 0);
  });

  await run('AI 失败不写内容，只进入可重复请求状态', async () => {
    let retryMarks = 0;
    let finalizeCalls = 0;
    const service = createDailyFortuneService({
      artifacts: {
        findReadyByIdentity: async () => null,
        claim: async () => ({
          outcome: 'owner',
          artifactId: 'artifact-1',
          status: 'generating',
          leaseToken: 'lease-1',
          leaseEpoch: 1,
          leaseExpiresAt: '2026-07-23T14:31:00.000Z',
          nextAttemptAt: null,
        }),
        findById: async () => null,
        finalize: async () => {
          finalizeCalls += 1;
          return false;
        },
        markRetryWait: async () => {
          retryMarks += 1;
          return true;
        },
      },
      getEngineBundle: async () => engineBundle(3),
      getUser: async () => null,
      generateContent: async () => {
        throw new DailyFortuneAiError('timeout', 'timed out', true);
      },
      generationEnabled: () => true,
      now: () => now,
    });

    const result = await service.resolveDailyFortune('user-1', {
      bazi_profile_id: 'profile-1',
      timezone: 'Asia/Hong_Kong',
      request_id: 'request-1',
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.cause, 'AI_TIMEOUT');
    assert.equal(retryMarks, 1);
    assert.equal(finalizeCalls, 0);
  });

  await run('GET 轮询只读 artifact，不 claim 也不调用 AI', async () => {
    let claimCalls = 0;
    let aiCalls = 0;
    const service = createDailyFortuneService({
      artifacts: {
        findReadyByIdentity: async () => null,
        claim: async () => {
          claimCalls += 1;
          throw new Error('poll must not claim');
        },
        findById: async () => artifactRow({
          status: 'retry_wait',
          content_json: null,
          day_context_json: null,
          lease_expires_at: null,
          next_attempt_at: '2026-07-23T14:31:00.000Z',
          ready_at: null,
        }),
        finalize: async () => false,
        markRetryWait: async () => false,
      },
      getEngineBundle: async () => engineBundle(3),
      generateContent: async () => {
        aiCalls += 1;
        return content;
      },
      generationEnabled: () => true,
      now: () => now,
    });

    const result = await service.getDailyFortuneGeneration(
      'user-1',
      'artifact-1',
      'request-1',
    );

    assert.deepEqual(result, { status: 'missing', generation_id: 'artifact-1' });
    assert.equal(claimCalls, 0);
    assert.equal(aiCalls, 0);
  });

  await run('轮询跨过子初后不返回上一有效日正文', async () => {
    const service = createDailyFortuneService({
      artifacts: {
        findReadyByIdentity: async () => null,
        claim: async () => {
          throw new Error('poll must not claim');
        },
        findById: async () => artifactRow(),
        finalize: async () => false,
        markRetryWait: async () => false,
      },
      getEngineBundle: async () => engineBundle(3),
      generateContent: async () => content,
      generationEnabled: () => true,
      now: () => new Date('2026-07-23T15:00:01.000Z'),
    });

    const result = await service.getDailyFortuneGeneration(
      'user-1',
      'artifact-1',
      'request-1',
    );

    assert.deepEqual(result, { status: 'missing', generation_id: 'artifact-1' });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
