const assert = require('node:assert/strict');

const {
  calculateFullChart,
} = require('../src/utils/baziCalculator.ts');

const {
  buildPatternCandidates,
} = require('../src/utils/patternJudgement.ts');

const {
  buildZipingAiBrief,
  buildZipingStructureFacts,
} = require('../src/utils/zipingStructureFacts.ts');

function pillar(stem: string, branch: string, tenGod: string, hiddenStems: any[] = []) {
  const stemElement = elementForStem(stem);
  return {
    name: '',
    stem,
    stemElement,
    branch,
    branchElement: elementForBranch(branch),
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

async function main(): Promise<void> {
  const chart1995 = await calculateFullChart(1995, 11, 5, 22, 30, false, 1, 1);
  const ziping1995 = chart1995.zipingAiBrief;
  assert.equal(ziping1995.method_version, 'ziping_ai_brief_v1');
  assert.ok(ziping1995.month_command, 'AI payload 应显式输出月令司令与调候');
  assert.ok(ziping1995.day_master_capacity, 'AI payload 应显式输出日主承载力');
  assert.ok(ziping1995.pattern_candidates, 'AI payload 应显式输出格局候选');
  assert.ok(ziping1995.yongshen_arbitration_facts, 'AI payload 应显式输出用神仲裁事实');
  assert.ok(
    ziping1995.month_command.includes('庚金日主') && ziping1995.month_command.includes('戌月杂气月'),
    'AI payload 应压缩输出日主和月令入口'
  );
  assert.ok(
    ziping1995.month_command.includes('气候：月令火燥，原局另见寒湿'),
    'AI payload 应区分月令气候底色和原局额外气候材料'
  );
  assert.ok(
    ziping1995.pattern_candidates[0].name === '杂气正官格候选'
      && ziping1995.pattern_candidates[0].confidence === 'high'
      && ziping1995.pattern_candidates[1].name === '杂气偏印格候选'
      && ziping1995.pattern_candidates[1].confidence === 'low',
    'AI payload 应传递格局候选 confidence，并按 confidence 排序'
  );
  assert.deepEqual(
    ziping1995.gan_zhi_effects.heavenly_stems,
    ['乙庚合金', '丙火克庚金', '丁火克庚金'],
    'AI payload 应单独完整列出天干作用'
  );
  assert.deepEqual(
    ziping1995.gan_zhi_effects.earthly_branches,
    ['亥子半会水', '亥亥自刑'],
    'AI payload 应单独完整列出地支作用'
  );
  assert.ok(
    !ziping1995.yongshen_arbitration_facts.includes('干支见'),
    '用神仲裁事实不应再混入干支作用列表'
  );
  assert.ok(JSON.stringify(ziping1995).length < 1800, 'AI payload 不应输出长篇全量调试 JSON');
  assertNoForbiddenKeys(ziping1995);
  assertNoRuleLeakStrings(ziping1995);

  const regularInput = {
    dayMaster: '甲',
    dayMasterElement: '木',
    year: pillar('戊', '亥', '偏财', [{ stem: '壬', tenGod: '偏印', element: '水' }]),
    month: pillar('辛', '酉', '正官', [{ stem: '辛', tenGod: '正官', element: '金' }]),
    day: pillar('甲', '寅', '日主', [{ stem: '甲', tenGod: '比肩', element: '木' }]),
    time: pillar('丁', '卯', '伤官', [{ stem: '乙', tenGod: '劫财', element: '木' }]),
  };
  const patternCandidates = buildPatternCandidates(regularInput);
  assert.equal(patternCandidates.regular[0].confidence, 'high', '旧 pattern_candidates 置信度先保持不动');

  const zipingRegularFacts = buildZipingStructureFacts({
    ...regularInput,
    patternCandidates,
  });
  assert.equal(zipingRegularFacts.month_command.pattern_entry_hint, 'regular');
  assert.equal(zipingRegularFacts.month_command.penetrations[0].stem, '辛');
  assert.equal(zipingRegularFacts.pattern_candidates.regular[0].id, 'zheng_guan_ge_candidate');
  assert.equal(zipingRegularFacts.pattern_candidates.regular[0].confidence, 'high', '格局候选 confidence 是候选事实，可传给 AI');
  assert.ok(
    zipingRegularFacts.yongshen_basis_facts.pattern.rule_suggested_ten_gods.some((item: any) => item.ten_god === '正财'),
    '正官格候选应记录财生官材料'
  );
  assertNoForbiddenKeys(zipingRegularFacts);

  const zipingRegularBrief = buildZipingAiBrief(zipingRegularFacts);
  assert.ok(
    zipingRegularBrief.pattern_candidates.some((candidate: any) =>
      candidate.name === '正官格候选'
      && candidate.confidence === 'high'
    ),
    'AI payload 应压缩输出正官格候选'
  );
  assert.ok(
    zipingRegularBrief.pattern_candidates.some((candidate: any) =>
      candidate.name === '伤官辅助候选'
      && candidate.confidence
    ),
    '非月令透干应保留为辅助候选，即使自身 evidence 很强也不能抢主格'
  );
  assert.ok(JSON.stringify(zipingRegularBrief).length < 1800, '普通月 AI payload 也应保持短输出');
  assertNoForbiddenKeys(zipingRegularBrief);
  assertNoRuleLeakStrings(zipingRegularBrief);

  const chart1980 = await calculateFullChart(1980, 1, 13, 12, 0, false, 1, 1);
  assert.deepEqual(
    chart1980.zipingAiBrief.gan_zhi_effects.heavenly_stems,
    ['丁壬合木'],
    '合干应列入 heavenly_stems'
  );
  assert.deepEqual(
    chart1980.zipingAiBrief.gan_zhi_effects.earthly_branches,
    ['酉丑半合金', '午未半会火', '午未六合', '丑未冲', '丑午害', '丑未刑'],
    '多项地支作用应完整列出，不使用等N项截断'
  );
  assert.ok(!JSON.stringify(chart1980.zipingAiBrief.gan_zhi_effects).includes('等'), '干支作用 JSON 不应截断为等N项');

  console.log('ziping structure facts validation passed');
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});

function assertNoForbiddenKeys(value: any, path: string[] = []): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, [...path, String(index)]));
    return;
  }

  const forbiddenKeys = new Set(['score', 'weight', 'yongshen', 'xishen', 'jishen']);
  Object.keys(value).forEach((key) => {
    assert.ok(!forbiddenKeys.has(key), `事实层不应输出 ${[...path, key].join('.')}`);
    assertNoForbiddenKeys(value[key], [...path, key]);
  });
}

function assertNoRuleLeakStrings(value: any): void {
  const serialized = JSON.stringify(value);
  [
    '取水',
    '取金',
    '取木',
    '只走',
    '不并列',
    '取用材料',
    '冲突材料',
    '只列',
    '不定最终',
    '事实层不输出',
    '格局候选不是',
    '气候见寒、热、燥、湿',
    '帮身',
    '克泄耗',
  ].forEach((phrase) => {
    assert.ok(!serialized.includes(phrase), `AI payload 不应包含规则说明：${phrase}`);
  });
}

function elementForStem(stem: string): string {
  return {
    甲: '木',
    乙: '木',
    丙: '火',
    丁: '火',
    戊: '土',
    己: '土',
    庚: '金',
    辛: '金',
    壬: '水',
    癸: '水',
  }[stem] || '';
}

function elementForBranch(branch: string): string {
  return {
    子: '水',
    亥: '水',
    寅: '木',
    卯: '木',
    巳: '火',
    午: '火',
    申: '金',
    酉: '金',
    丑: '土',
    辰: '土',
    未: '土',
    戌: '土',
  }[branch] || '';
}
