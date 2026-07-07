const assert = require('node:assert/strict');

const {
  calculateFullChart,
} = require('../src/utils/baziCalculator.ts');

const {
  buildBaziBasicInfo,
} = require('../src/utils/baziBasicInfo.ts');

const {
  buildMingliAiContext,
} = require('../src/utils/mingliAiContext.ts');

function profile(overrides: any = {}) {
  return {
    id: 'profile-1995',
    owner_user_id: 'user-1',
    is_owner: true,
    name: '测试命盘',
    gender: 'male',
    birth_year: 1995,
    birth_month: 11,
    birth_day: 5,
    birth_hour: 22,
    birth_minute: 30,
    is_lunar: false,
    birth_timezone: 'Asia/Shanghai',
    time_basis: 'standard_time',
    true_solar_time: null,
    true_solar_correction_minutes: 0,
    created_at: '2026-06-05T00:00:00Z',
    updated_at: '2026-06-05T00:00:00Z',
    ...overrides,
  };
}

async function main(): Promise<void> {
  const chart1995 = await calculateFullChart(1995, 11, 5, 22, 30, false, 1, 1);
  const baziBasicInfo = buildBaziBasicInfo({
    profile: profile(),
    chart: chart1995,
  });

  const context = buildMingliAiContext({
    baziBasicInfo,
    zipingStructure: chart1995.zipingAiBrief,
  });

  assert.equal(context.method_version, 'mingli_ai_context_v1');
  assert.equal(context.bazi_basic_info.method_version, 'bazi_basic_info_v1');
  assert.equal(context.ziping_structure.method_version, 'ziping_ai_brief_v1');
  assert.deepEqual(
    context.bazi_basic_info.pillars.map((pillar: any) => pillar.gan_zhi),
    ['乙亥', '丙戌', '庚子', '丁亥'],
    '组合包应包含八字基础信息'
  );
  assert.deepEqual(
    context.ziping_structure.pattern_candidates,
    [
      { name: '杂气正官格候选', confidence: 'high' },
      { name: '杂气偏印格候选', confidence: 'low' },
    ],
    '组合包应包含子平结构精简结果'
  );

  const serialized = JSON.stringify(context);
  [
    'majorCycles',
    'annualLuck',
    'monthlyLuck',
    'weightedWuxing',
    'wuxing_analysis',
    'patternCandidates',
    'zipingStructureFacts',
  ].forEach((forbidden) => {
    assert.ok(!serialized.includes(forbidden), `AI 组合包不应混入全量内部字段：${forbidden}`);
  });

  const unknownHourContext = buildMingliAiContext({
    baziBasicInfo: buildBaziBasicInfo({
      profile: profile({
        birth_hour: null,
        birth_minute: null,
      }),
      chart: chart1995,
    }),
    zipingStructure: null,
  });
  assert.equal(unknownHourContext.bazi_basic_info.birth_info.time_precision, 'unknown_hour');
  assert.deepEqual(
    unknownHourContext.bazi_basic_info.pillars.map((pillar: any) => pillar.position),
    ['year', 'month', 'day'],
    '未知时辰 AI 组合包不应包含默认午时柱'
  );
  assert.equal(
    unknownHourContext.ziping_structure,
    null,
    '未知时辰 AI 组合包不应包含默认午时推导出的子平结构'
  );

  console.log('mingli AI context validation passed');
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
