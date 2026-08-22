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
    ['乙庚合金', '丁克庚', '丙克庚'],
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

  const onlyHourCompletesSupport = {
    dayMaster: '甲',
    dayMasterElement: '木',
    year: pillar('丙', '午', '食神', [
      { stem: '丁', tenGod: '伤官', element: '火' },
      { stem: '己', tenGod: '正财', element: '土' },
    ]),
    month: pillar('戊', '戌', '偏财', [
      { stem: '戊', tenGod: '偏财', element: '土' },
      { stem: '辛', tenGod: '正官', element: '金' },
      { stem: '丁', tenGod: '伤官', element: '火' },
    ]),
    day: pillar('甲', '申', '日主', [
      { stem: '庚', tenGod: '七杀', element: '金' },
    ]),
    time: pillar('庚', '寅', '七杀', [
      { stem: '甲', tenGod: '比肩', element: '木' },
      { stem: '丙', tenGod: '食神', element: '火' },
      { stem: '戊', tenGod: '偏财', element: '土' },
    ]),
  };
  const knownHourFacts = buildZipingStructureFacts({
    ...onlyHourCompletesSupport,
    patternCandidates: buildPatternCandidates(onlyHourCompletesSupport),
  });
  const { time: _unknownInternalNoon, ...threePillarInput } = onlyHourCompletesSupport;
  const threePillarFacts = buildZipingStructureFacts({
    ...threePillarInput,
    patternCandidates: buildPatternCandidates(threePillarInput),
  });
  const threePillarJson = JSON.stringify(threePillarFacts);
  assert.equal(knownHourFacts.hour_precision, 'known');
  assert.deepEqual(knownHourFacts.observed_pillars, ['year', 'month', 'day', 'time']);
  assert.equal(threePillarFacts.hour_precision, 'unknown');
  assert.deepEqual(threePillarFacts.observed_pillars, ['year', 'month', 'day']);
  assert.ok(!threePillarJson.includes('"position":"time"') && !threePillarJson.includes('"branch_position":"time"'));
  assert.ok(!threePillarJson.includes('时柱'), '三柱结构不得序列化内部中午占位或时柱证据');
  assert.ok(!threePillarJson.includes('follow_weak_material') && !threePillarJson.includes('follow_strong_material'));
  assert.ok(!threePillarJson.includes('limited_support') && !threePillarJson.includes('without_wealth'));
  assert.ok(!threePillarJson.includes('日主无根气事实') && !threePillarJson.includes('财星材料未见'));
  assert.ok(threePillarFacts.notes.some((note: string) => note.includes('已知三柱范围内未见')));

  const hourOnlyRootWealthOfficer = {
    dayMaster: '甲',
    dayMasterElement: '木',
    year: pillar('丙', '午', '食神', [{ stem: '丁', tenGod: '伤官', element: '火' }]),
    month: pillar('丙', '午', '食神', [{ stem: '丁', tenGod: '伤官', element: '火' }]),
    day: pillar('甲', '午', '日主', [{ stem: '丁', tenGod: '伤官', element: '火' }]),
    time: pillar('庚', '寅', '七杀', [
      { stem: '甲', tenGod: '比肩', element: '木' },
      { stem: '戊', tenGod: '偏财', element: '土' },
      { stem: '辛', tenGod: '正官', element: '金' },
    ]),
  };
  const allFourEvidence = buildZipingStructureFacts({
    ...hourOnlyRootWealthOfficer,
    patternCandidates: buildPatternCandidates(hourOnlyRootWealthOfficer),
  });
  assert.ok(allFourEvidence.day_master_facts.roots.some((fact: any) => fact.branch_position === 'time'));
  assert.ok(allFourEvidence.day_master_facts.pressure_facts.wealth.some((fact: any) => fact.position === 'time'));
  assert.ok(allFourEvidence.day_master_facts.pressure_facts.officer_killing.some((fact: any) => fact.position === 'time'));
  const { time: _onlyHourEvidence, ...knownThreePillars } = hourOnlyRootWealthOfficer;
  const withoutUnknownHour = buildZipingStructureFacts({
    ...knownThreePillars,
    patternCandidates: buildPatternCandidates(knownThreePillars),
  });
  const withoutUnknownHourJson = JSON.stringify(withoutUnknownHour);
  assert.equal(withoutUnknownHour.day_master_facts.roots.length, 0);
  assert.equal(withoutUnknownHour.day_master_facts.pressure_facts.wealth.length, 0);
  assert.equal(withoutUnknownHour.day_master_facts.pressure_facts.officer_killing.length, 0);
  assert.ok(!/\u65e0根|\u65e0财|\u65e0官|\u4ece弱|\u4ece强|follow_weak|follow_strong|without_wealth|limited_support/.test(withoutUnknownHourJson));

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
    ['丁壬合木', '乙克己', '己克壬'],
    '合干应列入 heavenly_stems'
  );
  assert.deepEqual(
    chart1980.zipingAiBrief.gan_zhi_effects.earthly_branches,
    ['丑未相冲', '午未六合土', '酉丑半合金局', '丑刑未', '丑午相害', '午未半会火'],
    '多项地支作用应完整列出，不使用等N项截断'
  );
  assert.ok(!JSON.stringify(chart1980.zipingAiBrief.gan_zhi_effects).includes('等'), '干支作用 JSON 不应截断为等N项');

  const coPresenceWithoutStemControl = {
    dayMaster: '甲',
    dayMasterElement: '木',
    year: pillar('甲', '子', '比肩'),
    month: pillar('甲', '午', '比肩'),
    day: pillar('甲', '辰', '日主'),
    time: pillar('甲', '酉', '比肩'),
  };
  const coPresenceFacts = buildZipingStructureFacts({
    ...coPresenceWithoutStemControl,
    patternCandidates: buildPatternCandidates(coPresenceWithoutStemControl),
  });
  assert.deepEqual(
    coPresenceFacts.yongshen_basis_facts.tongguan.conflict_facts,
    [],
    '五行同时出现但没有相邻显干相克时，不得生成通关冲突候选',
  );
  assert.deepEqual(
    coPresenceFacts.yongshen_basis_facts.tongguan.mediating_elements_by_rule,
    [],
    '没有显式相克时不得继续派生通关中介元素',
  );

  const adjacentMetalControlsWood = {
    dayMaster: '丙',
    dayMasterElement: '火',
    year: pillar('庚', '子', '偏财'),
    month: pillar('甲', '午', '偏印'),
    day: pillar('丙', '辰', '日主'),
    time: pillar('丁', '酉', '劫财'),
  };
  const explicitControlFacts = buildZipingStructureFacts({
    ...adjacentMetalControlsWood,
    patternCandidates: buildPatternCandidates(adjacentMetalControlsWood),
  });
  assert.deepEqual(
    explicitControlFacts.yongshen_basis_facts.tongguan.conflict_facts,
    [{
      elements: ['金', '木'],
      source_relations: ['庚金克甲木'],
      mediating_element_by_rule: '水',
    }],
    '相邻显干庚克甲只保留一个金木冲突候选',
  );
  assert.deepEqual(
    explicitControlFacts.yongshen_basis_facts.tongguan.mediating_elements_by_rule,
    [{ element: '水', basis: '金木交战取水通关' }],
    '显式金克木继续派生水通关材料',
  );

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
