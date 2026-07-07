const assert = require('node:assert/strict');

const {
  calculateFullChart,
} = require('../src/utils/baziCalculator.ts');

const {
  buildPatternCandidates,
} = require('../src/utils/patternJudgement.ts');

function pillar(stem: string, branch: string, tenGod: string, hiddenStems: any[] = []) {
  return {
    name: '',
    stem,
    stemElement: '',
    branch,
    branchElement: '',
    ganZhi: `${stem}${branch}`,
    tenGod,
    hiddenStems,
    lifecycle: '',
    selfSitting: '',
    voidInfo: '',
    naYin: '',
    shenSha: [],
  };
}

function candidateIds(items: any[]): string[] {
  return items.map(item => item.id);
}

async function main(): Promise<void> {
  const zhengGuan = buildPatternCandidates({
    dayMaster: '甲',
    year: pillar('戊', '亥', '偏财', [{ stem: '壬', tenGod: '偏印', element: '水' }]),
    month: pillar('辛', '酉', '正官', [{ stem: '辛', tenGod: '正官', element: '金' }]),
    day: pillar('甲', '寅', '日主', [{ stem: '甲', tenGod: '比肩', element: '木' }]),
    time: pillar('丁', '卯', '伤官', [{ stem: '乙', tenGod: '劫财', element: '木' }]),
  });
  assert.equal(zhengGuan.methodVersion, 'pattern_candidates_v1');
  assert.deepEqual(candidateIds(zhengGuan.regular), ['zheng_guan_ge_candidate']);
  assert.equal(zhengGuan.regular[0].confidence, 'high', '月干透出格神应是高置信候选');
  assert.equal(zhengGuan.regular[0].penetration[0].position, 'month');
  assert.ok(zhengGuan.regular[0].notes.some((note: string) => note.includes('锁定为主格入口')));
  assert.deepEqual(
    candidateIds(zhengGuan.auxiliary).sort(),
    ['pian_cai_ge_wu_auxiliary_candidate', 'shang_guan_ge_ding_auxiliary_candidate'].sort(),
    '月令正官已透时，另透财星和食伤应进入辅助候选，不应并列抢主格'
  );
  assert.ok(
    zhengGuan.auxiliary
      .find((item: any) => item.tenGod === '偏财')
      .supportSignals.some((signal: string) => signal.includes('财生官'))
  );
  assert.ok(
    zhengGuan.auxiliary
      .find((item: any) => item.tenGod === '伤官')
      .downgradeSignals.some((signal: string) => signal.includes('破格风险'))
  );

  const dayStemDoesNotPenetrate = buildPatternCandidates({
    dayMaster: '甲',
    year: pillar('乙', '亥', '劫财', [{ stem: '壬', tenGod: '偏印', element: '水' }]),
    month: pillar('丁', '酉', '伤官', [{ stem: '辛', tenGod: '正官', element: '金' }]),
    day: pillar('辛', '寅', '日主', [{ stem: '甲', tenGod: '比肩', element: '木' }]),
    time: pillar('戊', '卯', '偏财', [{ stem: '乙', tenGod: '劫财', element: '木' }]),
  });
  assert.equal(dayStemDoesNotPenetrate.regular[0].id, 'zheng_guan_ge_candidate');
  assert.deepEqual(dayStemDoesNotPenetrate.regular[0].penetration, [], '日干不应作为格神透干证据');
  assert.equal(dayStemDoesNotPenetrate.regular[0].confidence, 'medium', '有月令主气根但无透干时应降为中置信');

  const mixedQi = buildPatternCandidates({
    dayMaster: '庚',
    year: pillar('丁', '亥', '正官', [{ stem: '壬', tenGod: '食神', element: '水' }, { stem: '甲', tenGod: '偏财', element: '木' }]),
    month: pillar('戊', '戌', '偏印', [
      { stem: '戊', tenGod: '偏印', element: '土' },
      { stem: '辛', tenGod: '劫财', element: '金' },
      { stem: '丁', tenGod: '正官', element: '火' },
    ]),
    day: pillar('庚', '子', '日主', [{ stem: '癸', tenGod: '伤官', element: '水' }]),
    time: pillar('戊', '寅', '偏印', [{ stem: '甲', tenGod: '偏财', element: '木' }, { stem: '丙', tenGod: '七杀', element: '火' }, { stem: '戊', tenGod: '偏印', element: '土' }]),
  });
  assert.deepEqual(mixedQi.regular, [], '杂气月不应同时生成普通月令主气格，避免 regular 与 mixed_qi 冲突');
  assert.deepEqual(
    candidateIds(mixedQi.mixedQi).sort(),
    ['za_qi_pian_yin_candidate', 'za_qi_zheng_guan_candidate'].sort(),
    '杂气月应生成全部非比劫藏干候选，且排除劫财'
  );
  assert.ok(mixedQi.mixedQi.every((item: any) => item.confidence === 'high'), '杂气藏干透出年干或时干时应为高置信候选');

  const activatedMixedQi = buildPatternCandidates({
    dayMaster: '甲',
    year: pillar('庚', '申', '七杀', [{ stem: '庚', tenGod: '七杀', element: '金' }, { stem: '壬', tenGod: '偏印', element: '水' }, { stem: '戊', tenGod: '偏财', element: '土' }]),
    month: pillar('丙', '辰', '食神', [
      { stem: '戊', tenGod: '偏财', element: '土' },
      { stem: '乙', tenGod: '劫财', element: '木' },
      { stem: '癸', tenGod: '正印', element: '水' },
    ]),
    day: pillar('甲', '子', '日主', [{ stem: '癸', tenGod: '正印', element: '水' }]),
    time: pillar('丁', '午', '伤官', [{ stem: '丁', tenGod: '伤官', element: '火' }, { stem: '己', tenGod: '正财', element: '土' }]),
  });
  assert.deepEqual(activatedMixedQi.regular, [], '辰戌丑未月的主气也应归入杂气候选体系');
  const zhengYinMixed = activatedMixedQi.mixedQi.find((item: any) => item.id === 'za_qi_zheng_yin_candidate');
  assert.ok(zhengYinMixed, '辰月余气癸水应生成杂气正印候选');
  assert.ok(
    zhengYinMixed.supportSignals.some((signal: string) => signal.includes('申子辰三合水局')),
    '杂气藏干不透时，应记录三合三会引动证据'
  );
  assert.equal(zhengYinMixed.confidence, 'medium');
  const hiddenOnlyMixedQi = buildPatternCandidates({
    dayMaster: '甲',
    year: pillar('庚', '子', '七杀', [{ stem: '癸', tenGod: '正印', element: '水' }]),
    month: pillar('丙', '辰', '食神', [
      { stem: '戊', tenGod: '偏财', element: '土' },
      { stem: '乙', tenGod: '劫财', element: '木' },
      { stem: '癸', tenGod: '正印', element: '水' },
    ]),
    day: pillar('甲', '卯', '日主', [{ stem: '乙', tenGod: '劫财', element: '木' }]),
    time: pillar('丁', '午', '伤官', [{ stem: '丁', tenGod: '伤官', element: '火' }, { stem: '己', tenGod: '正财', element: '土' }]),
  });
  const hiddenOnlyPianCai = hiddenOnlyMixedQi.mixedQi.find((item: any) => item.id === 'za_qi_pian_cai_candidate');
  assert.equal(hiddenOnlyPianCai.confidence, 'low', '杂气主气只藏月令且无透干、无会支、无同干根时应为低置信');

  const jianLu = buildPatternCandidates({
    dayMaster: '甲',
    year: pillar('庚', '子', '七杀', [{ stem: '癸', tenGod: '正印', element: '水' }]),
    month: pillar('丙', '寅', '食神', [{ stem: '甲', tenGod: '比肩', element: '木' }, { stem: '丙', tenGod: '食神', element: '火' }, { stem: '戊', tenGod: '偏财', element: '土' }]),
    day: pillar('甲', '辰', '日主', [{ stem: '戊', tenGod: '偏财', element: '土' }, { stem: '乙', tenGod: '劫财', element: '木' }, { stem: '癸', tenGod: '正印', element: '水' }]),
    time: pillar('戊', '辰', '偏财', [{ stem: '戊', tenGod: '偏财', element: '土' }, { stem: '乙', tenGod: '劫财', element: '木' }, { stem: '癸', tenGod: '正印', element: '水' }]),
  });
  assert.deepEqual(candidateIds(jianLu.regular), ['jian_lu_ge_candidate']);
  assert.ok(jianLu.regular[0].supportSignals.some((signal: string) => signal.includes('财官杀食伤')));
  assert.deepEqual(
    jianLu.usableGods.map((item: any) => `${item.position}:${item.tenGod}:${item.stem}`),
    ['year:七杀:庚', 'month:食神:丙', 'time:偏财:戊'],
    '建禄月应结构化输出另取财官杀食伤候选'
  );

  const jianLuBranchUsableGod = buildPatternCandidates({
    dayMaster: '甲',
    year: pillar('乙', '戌', '劫财', [{ stem: '戊', tenGod: '偏财', element: '土' }, { stem: '辛', tenGod: '正官', element: '金' }, { stem: '丁', tenGod: '伤官', element: '火' }]),
    month: pillar('壬', '寅', '偏印', [{ stem: '甲', tenGod: '比肩', element: '木' }, { stem: '丙', tenGod: '食神', element: '火' }, { stem: '戊', tenGod: '偏财', element: '土' }]),
    day: pillar('甲', '午', '日主', [{ stem: '丁', tenGod: '伤官', element: '火' }, { stem: '己', tenGod: '正财', element: '土' }]),
    time: pillar('癸', '亥', '正印', [{ stem: '壬', tenGod: '偏印', element: '水' }, { stem: '甲', tenGod: '比肩', element: '木' }]),
  });
  assert.deepEqual(candidateIds(jianLuBranchUsableGod.regular), ['jian_lu_ge_candidate']);
  assert.ok(
    jianLuBranchUsableGod.usableGods.some((item: any) =>
      item.source === 'three_harmony' &&
      item.label === '寅午戌三合火局' &&
      item.tenGod === '食伤'
    ),
    '建禄月应识别地支三合成局形成的会支用神候选'
  );

  const yangRen = buildPatternCandidates({
    dayMaster: '甲',
    year: pillar('庚', '子', '七杀', [{ stem: '癸', tenGod: '正印', element: '水' }]),
    month: pillar('丁', '卯', '伤官', [{ stem: '乙', tenGod: '劫财', element: '木' }]),
    day: pillar('甲', '辰', '日主', [{ stem: '戊', tenGod: '偏财', element: '土' }, { stem: '乙', tenGod: '劫财', element: '木' }, { stem: '癸', tenGod: '正印', element: '水' }]),
    time: pillar('戊', '辰', '偏财', [{ stem: '戊', tenGod: '偏财', element: '土' }, { stem: '乙', tenGod: '劫财', element: '木' }, { stem: '癸', tenGod: '正印', element: '水' }]),
  });
  assert.deepEqual(candidateIds(yangRen.regular).sort(), ['yang_ren_ge_candidate', 'yue_jie_ge_candidate'].sort());

  const chart1995 = await calculateFullChart(1995, 11, 5, 22, 30, false, 1, 1);
  assert.equal(chart1995.patternCandidates.methodVersion, 'pattern_candidates_v1');
  assert.deepEqual(chart1995.patternCandidates.regular, [], '戌月完整排盘不应重复输出普通偏印格');
  assert.ok(chart1995.patternCandidates.mixedQi.length >= 1, '戌月完整排盘结果应挂载杂气候选');

  console.log('pattern judgement validation passed');
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
