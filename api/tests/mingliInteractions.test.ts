const assert = require('node:assert/strict');

const {
  buildDailyLuckData,
} = require('../src/utils/baziCalculator.ts');

const {
  buildMingliFactPanel,
  buildMingliGanZhiEffectsBrief,
  buildNatalMingliInteractions,
  buildTimingMingliInteractions,
  isStemControlClash,
  isElementControlPair,
} = require('../src/utils/mingliInteractionEngine.ts');

function pillar(stem: string, branch: string, tenGod = '测试') {
  return {
    name: '',
    stem,
    stemElement: '',
    branch,
    branchElement: '',
    ganZhi: `${stem}${branch}`,
    tenGod,
    hiddenStems: [],
    lifecycle: '',
    voidInfo: '',
    naYin: '',
    shenSha: [],
  };
}

function hasRelation(items: any[], relation: string, predicate: (item: any) => boolean = () => true): boolean {
  return items.some(item => item.relation === relation && predicate(item));
}

function assertSameSet(actual: string[], expected: string[], message: string): void {
  assert.deepEqual([...actual].sort(), [...expected].sort(), message);
}

function assertIncludesAll(actual: string[], expected: string[], message: string): void {
  const missing = expected.filter(label => !actual.includes(label));
  assert.deepEqual(missing, [], message);
}

function chartWithBranches(left: string, right: string) {
  return {
    year: pillar('甲', left),
    month: pillar('乙', right),
    day: pillar('丙', '辰', '日主'),
    time: pillar('丁', '酉'),
  };
}

function chartWithStems(left: string, right: string) {
  return {
    year: pillar(left, '子'),
    month: pillar(right, '丑'),
    day: pillar('丙', '辰', '日主'),
    time: pillar('丁', '酉'),
  };
}

async function main(): Promise<void> {
  [
    ['甲', '己', '甲己合土'],
    ['乙', '庚', '乙庚合金'],
    ['丙', '辛', '丙辛合水'],
    ['丁', '壬', '丁壬合木'],
    ['戊', '癸', '戊癸合火'],
  ].forEach(([left, right, label]) => {
    const panel = buildMingliFactPanel(buildNatalMingliInteractions(chartWithStems(left, right)));
    assert.ok(panel.heavenlyStemNatal.includes(label), `应识别天干五合：${label}`);
  });

  [
    ['甲', '戊', '甲克戊'],
    ['乙', '己', '乙克己'],
    ['丙', '庚', '丙克庚'],
    ['丁', '辛', '丁克辛'],
    ['戊', '壬', '戊克壬'],
    ['己', '癸', '己克癸'],
    ['甲', '庚', '庚克甲'],
    ['乙', '辛', '辛克乙'],
    ['丙', '壬', '壬克丙'],
    ['丁', '癸', '癸克丁'],
  ].forEach(([left, right, label]) => {
    const panel = buildMingliFactPanel(buildNatalMingliInteractions(chartWithStems(left, right)));
    assert.ok(panel.heavenlyStemNatal.includes(label), `应识别天干同阴阳相克：${label}`);
  });

  [
    ['子', '丑', '子丑六合土'],
    ['寅', '亥', '寅亥六合木'],
    ['卯', '戌', '卯戌六合火'],
    ['辰', '酉', '辰酉六合金'],
    ['巳', '申', '巳申六合水'],
    ['午', '未', '午未六合土'],
  ].forEach(([left, right, label]) => {
    const panel = buildMingliFactPanel(buildNatalMingliInteractions(chartWithBranches(left, right)));
    assert.ok(panel.earthlyBranchNatal.includes(label), `应识别地支六合：${label}`);
  });

  [
    ['子', '午', '子午相冲'],
    ['丑', '未', '丑未相冲'],
    ['寅', '申', '寅申相冲'],
    ['卯', '酉', '卯酉相冲'],
    ['辰', '戌', '辰戌相冲'],
    ['巳', '亥', '巳亥相冲'],
  ].forEach(([left, right, label]) => {
    const panel = buildMingliFactPanel(buildNatalMingliInteractions(chartWithBranches(left, right)));
    assert.ok(panel.earthlyBranchNatal.includes(label), `应识别地支六冲：${label}`);
  });

  [
    ['子', '未', '子未相害'],
    ['丑', '午', '丑午相害'],
    ['寅', '巳', '寅巳相害'],
    ['卯', '辰', '卯辰相害'],
    ['申', '亥', '申亥相害'],
    ['酉', '戌', '酉戌相害'],
  ].forEach(([left, right, label]) => {
    const panel = buildMingliFactPanel(buildNatalMingliInteractions(chartWithBranches(left, right)));
    assert.ok(panel.earthlyBranchNatal.includes(label), `应识别地支六害：${label}`);
  });

  [
    ['子', '酉', '子酉相破'],
    ['卯', '午', '卯午相破'],
    ['辰', '丑', '辰丑相破'],
    ['寅', '亥', '寅亥相破'],
    ['巳', '申', '巳申相破'],
    ['未', '戌', '未戌相破'],
  ].forEach(([left, right, label]) => {
    const panel = buildMingliFactPanel(buildNatalMingliInteractions(chartWithBranches(left, right)));
    assert.ok(panel.earthlyBranchNatal.includes(label), `应识别地支六破：${label}`);
  });

  [
    ['子', '卯', '子卯相刑'],
    ['寅', '巳', '寅刑巳'],
    ['巳', '申', '巳刑申'],
    ['申', '寅', '申刑寅'],
    ['丑', '戌', '丑刑戌'],
    ['戌', '未', '戌刑未'],
    ['丑', '未', '丑刑未'],
  ].forEach(([left, right, label]) => {
    const panel = buildMingliFactPanel(buildNatalMingliInteractions(chartWithBranches(left, right)));
    assert.ok(panel.earthlyBranchNatal.includes(label), `应识别地支刑：${label}`);
  });

  ['辰', '午', '酉', '亥'].forEach((branch) => {
    const panel = buildMingliFactPanel(buildNatalMingliInteractions(chartWithBranches(branch, branch)));
    assert.ok(panel.earthlyBranchNatal.includes(`${branch}${branch}自刑`), `应识别地支自刑：${branch}${branch}自刑`);
  });

  [
    ['寅', '丑', '寅丑暗合'],
    ['卯', '申', '卯申暗合'],
    ['巳', '酉', '巳酉暗合'],
    ['午', '亥', '午亥暗合'],
    ['子', '巳', '子巳暗合'],
    ['寅', '午', '寅午暗合'],
  ].forEach(([left, right, label]) => {
    const panel = buildMingliFactPanel(buildNatalMingliInteractions(chartWithBranches(left, right)));
    assert.ok(panel.earthlyBranchNatal.includes(label), `应识别地支暗合：${label}`);
  });
  const unmatchedHiddenCombinationPanel = buildMingliFactPanel(buildNatalMingliInteractions(chartWithBranches('寅', '辰')));
  assert.ok(!unmatchedHiddenCombinationPanel.earthlyBranchNatal.includes('寅丑暗合'), '未见丑时不应展示寅丑暗合');

  const denseChart = {
    year: pillar('甲', '巳'),
    month: pillar('己', '申'),
    day: pillar('庚', '亥', '日主'),
    time: pillar('丙', '寅'),
  };
  const denseInteractions = buildNatalMingliInteractions(denseChart);

  assert.ok(
    hasRelation(denseInteractions, 'stem_five_combination', (item) =>
      item.participants.some((participant: any) => participant.stem === '甲') &&
      item.participants.some((participant: any) => participant.stem === '己') &&
      item.factLabel === '甲木己土相合'),
    '应识别甲己天干五合'
  );
  assert.ok(
    hasRelation(denseInteractions, 'branch_six_combination', (item) =>
      item.participants.some((participant: any) => participant.branch === '巳') &&
      item.participants.some((participant: any) => participant.branch === '申') &&
      item.factLabel === '巳火申金相合'),
    '应识别巳申地支六合'
  );
  assert.ok(
    hasRelation(denseInteractions, 'branch_clash', (item) =>
      item.participants.some((participant: any) => participant.branch === '巳') &&
      item.participants.some((participant: any) => participant.branch === '亥') &&
      item.factLabel === '巳火亥水相冲'),
    '应识别巳亥冲'
  );
  assert.ok(
    hasRelation(denseInteractions, 'branch_piercing', (item) =>
      item.participants.some((participant: any) => participant.branch === '申') &&
      item.participants.some((participant: any) => participant.branch === '亥') &&
      item.factLabel === '申金亥水相穿'),
    '应识别申亥六穿/六害'
  );
  assert.ok(
    hasRelation(denseInteractions, 'branch_three_punishment', (item) =>
      item.participants.map((participant: any) => participant.branch).sort().join('') === ['寅', '巳', '申'].sort().join('') &&
      item.factLabel === '寅木巳火申金三刑'),
    '应识别寅巳申三刑'
  );
  assert.ok(isStemControlClash('丙', '庚'), '应按显式规则识别丙庚天干相克冲');
  assert.ok(isElementControlPair('丙', '庚'), '天干相克冲也应符合五行相克关系');

  const harmonyChart = {
    year: pillar('壬', '亥'),
    month: pillar('乙', '卯'),
    day: pillar('丁', '未', '日主'),
    time: pillar('癸', '丑'),
  };
  const harmonyInteractions = buildNatalMingliInteractions(harmonyChart);
  assert.ok(
    hasRelation(harmonyInteractions, 'branch_three_harmony', (item) =>
      item.centerBranch === '卯' &&
      item.transformElement === '木' &&
      item.factLabel === '亥水卯木未土三合'),
    '应识别亥卯未三合木局并保留中神'
  );

  const derivedChart = {
    year: pillar('甲', '午'),
    month: pillar('乙', '戌'),
    day: pillar('丙', '亥', '日主'),
    time: pillar('丁', '子'),
  };
  const derivedInteractions = buildNatalMingliInteractions(derivedChart);
  assert.ok(
    hasRelation(derivedInteractions, 'branch_half_harmony', (item) =>
      item.factLabel === '午火戌土半合火局' &&
      item.shortLabel === '午戌半合火局'),
    '应识别午戌半合火局'
  );
  assert.ok(
    hasRelation(derivedInteractions, 'branch_hidden_combination', (item) =>
      item.factLabel === '午火亥水暗合' &&
      item.shortLabel === '午亥暗合'),
    '应识别午亥暗合'
  );
  assert.ok(
    hasRelation(derivedInteractions, 'branch_hidden_meeting', (item) =>
      item.factLabel === '午火亥水暗会' &&
      item.shortLabel === '午亥暗会'),
    '应识别午亥暗会'
  );

  const archHarmonyInteractions = buildNatalMingliInteractions({
    year: pillar('壬', '亥'),
    month: pillar('甲', '未'),
    day: pillar('丁', '巳', '日主'),
    time: pillar('癸', '丑'),
  });
  assert.ok(
    hasRelation(archHarmonyInteractions, 'branch_arch_harmony', (item) =>
      item.factLabel === '亥水未土拱合卯木' &&
      item.shortLabel === '亥未拱合卯' &&
      item.missingBranch === '卯'),
    '应识别亥未拱合卯'
  );

  const archMeetingInteractions = buildNatalMingliInteractions({
    year: pillar('壬', '寅'),
    month: pillar('甲', '辰'),
    day: pillar('丁', '申', '日主'),
    time: pillar('癸', '酉'),
  });
  assert.ok(
    hasRelation(archMeetingInteractions, 'branch_arch_meeting', (item) =>
      item.factLabel === '寅木辰土拱会卯木' &&
      item.shortLabel === '寅辰拱会木局' &&
      item.missingBranch === '卯'),
    '应识别寅辰拱会木局'
  );

  const timingChart = {
    year: pillar('庚', '子'),
    month: pillar('乙', '亥'),
    day: pillar('辛', '卯', '日主'),
    time: pillar('丁', '未'),
  };
  const timingInteractions = buildTimingMingliInteractions(timingChart, {
    dayun: { stem: '癸', branch: '酉', ganZhi: '癸酉', tenGod: '食神' },
    liunian: { year: 2026, stem: '丙', branch: '午', ganZhi: '丙午', tenGodTop: '正官', tenGodBottom: '七杀' },
    liuyue: { month: 2, stem: '己', branch: '卯', ganZhi: '己卯', tenGod: '偏印', tenGodBottom: '偏财' },
    liuri: { date: '2026-05-17', stem: '甲', branch: '戌', ganZhi: '甲戌', tenGodTop: '正财', tenGodBottom: '正印' },
  });

  assert.ok(
    hasRelation(timingInteractions, 'branch_clash', (item) =>
      item.scope === 'dayun_to_natal' &&
      item.source?.branch === '酉' &&
      item.targets.some((target: any) => target.branch === '卯')),
    '应识别大运酉冲原局卯'
  );
  assert.ok(
    hasRelation(timingInteractions, 'branch_clash', (item) =>
      item.scope === 'liunian_to_natal' &&
      item.source?.branch === '午' &&
      item.targets.some((target: any) => target.branch === '子')),
    '应识别流年午冲原局子'
  );
  assert.ok(
    hasRelation(timingInteractions, 'branch_three_harmony', (item) =>
      item.scope === 'liuyue_to_natal' &&
      item.source?.branch === '卯' &&
      item.targets.some((target: any) => target.branch === '未')),
    '应识别流月卯与原局亥未补成三合'
  );
  assert.ok(
    hasRelation(timingInteractions, 'branch_clash', (item) =>
      item.scope === 'liuyue_to_dayun' &&
      item.source?.branch === '卯' &&
      item.targets.some((target: any) => target.branch === '酉')),
    '应识别流月卯冲大运酉'
  );
  assert.ok(
    hasRelation(timingInteractions, 'branch_six_combination', (item) =>
      item.scope === 'liuri_to_liuyue' &&
      item.source?.branch === '戌' &&
      item.targets.some((target: any) => target.branch === '卯')),
    '应识别流日戌合流月卯'
  );
  assert.ok(
    hasRelation(timingInteractions, 'branch_piercing', (item) =>
      item.scope === 'liuri_to_dayun' &&
      item.source?.branch === '戌' &&
      item.targets.some((target: any) => target.branch === '酉')),
    '应识别流日戌穿大运酉'
  );
  assert.ok(
    hasRelation(timingInteractions, 'stem_control_clash', (item) =>
      item.shortLabel === '丙克庚' &&
      item.displayGroup === 'heavenly_stem_luck'),
    '天干克冲应给出可展示短文本'
  );
  const panel = buildMingliFactPanel([...timingInteractions, ...buildNatalMingliInteractions(timingChart)]);
  assert.ok(panel.heavenlyStemLuck.includes('丙克庚'), '运势天干面板应包含丙克庚');
  assert.ok(panel.earthlyBranchLuck.some((label: string) => label.includes('相冲')), '运势地支面板应包含冲类短文本');

  const appCaseOneChart = {
    year: pillar('丙', '子'),
    month: pillar('庚', '寅'),
    day: pillar('丙', '子', '日主'),
    time: pillar('甲', '午'),
  };
  const appCaseOnePanel = buildMingliFactPanel([
    ...buildTimingMingliInteractions(appCaseOneChart, {
      dayun: { stem: '癸', branch: '巳', ganZhi: '癸巳' },
      liunian: { stem: '丙', branch: '午', ganZhi: '丙午' },
      liuyue: { stem: '戊', branch: '戌', ganZhi: '戊戌' },
    }),
    ...buildNatalMingliInteractions(appCaseOneChart),
  ]);
  assertSameSet(appCaseOnePanel.heavenlyStemLuck, ['甲克戊', '丙克庚', '戊癸合火', '癸克丙'], '案例1天干运势应对齐目标细盘口径');
  assertSameSet(appCaseOnePanel.earthlyBranchLuck, ['寅刑巳', '午午自刑', '子午相冲', '寅巳相害', '寅午戌三合火', '巳午半会火', '寅午暗合', '子巳暗合', '子巳暗会'], '案例1地支运势应对齐目标细盘口径');
  assertSameSet(appCaseOnePanel.heavenlyStemNatal, ['丙克庚', '庚克甲'], '案例1天干本命应对齐目标细盘口径');
  assertSameSet(appCaseOnePanel.earthlyBranchNatal, ['子午相冲', '寅午半合火局', '寅午暗合'], '案例1地支本命应对齐目标细盘口径');

  const appCaseTwoChart = {
    year: pillar('辛', '巳'),
    month: pillar('甲', '午'),
    day: pillar('己', '未', '日主'),
    time: pillar('戊', '辰'),
  };
  const appCaseTwoPanel = buildMingliFactPanel([
    ...buildTimingMingliInteractions(appCaseTwoChart, {
      dayun: { stem: '丁', branch: '酉', ganZhi: '丁酉' },
      liunian: { stem: '丙', branch: '午', ganZhi: '丙午' },
    }),
    ...buildNatalMingliInteractions(appCaseTwoChart),
  ]);
  assertSameSet(appCaseTwoPanel.heavenlyStemLuck, ['丁克辛', '丙辛合水'], '案例2天干运势应对齐目标细盘口径');
  assertSameSet(appCaseTwoPanel.earthlyBranchLuck, ['午午自刑', '辰酉六合金', '午未六合土', '巳午未会南方火局', '巳酉半合金局', '巳酉暗合'], '案例2地支运势应对齐目标细盘口径');
  assertSameSet(appCaseTwoPanel.heavenlyStemNatal, ['甲克戊', '甲己合土', '辛克甲'], '案例2天干本命应对齐目标细盘口径');
  assertSameSet(appCaseTwoPanel.earthlyBranchNatal, ['午未六合土', '巳午未会南方火局', '未辰暗会'], '案例2地支本命应对齐目标细盘口径');

  const appCaseThreeChart = {
    year: pillar('丙', '子'),
    month: pillar('丁', '酉'),
    day: pillar('丁', '卯', '日主'),
    time: pillar('戊', '申'),
  };
  const appCaseThreePanel = buildMingliFactPanel([
    ...buildTimingMingliInteractions(appCaseThreeChart, {
      dayun: { stem: '甲', branch: '午', ganZhi: '甲午' },
      liunian: { stem: '丙', branch: '午', ganZhi: '丙午' },
      liuyue: { stem: '戊', branch: '戌', ganZhi: '戊戌' },
    }),
    ...buildNatalMingliInteractions(appCaseThreeChart),
  ]);
  assertSameSet(appCaseThreePanel.heavenlyStemLuck, ['甲克戊'], '案例3天干运势应对齐目标细盘口径');
  assertSameSet(appCaseThreePanel.earthlyBranchLuck, ['午午自刑', '子午相冲', '卯戌六合火', '酉戌相害', '卯午相破', '申酉戌会西方金局', '午戌半合火局'], '案例3地支运势应对齐目标细盘口径');
  assertSameSet(appCaseThreePanel.heavenlyStemNatal, [], '案例3天干本命应对齐目标细盘口径');
  assertSameSet(appCaseThreePanel.earthlyBranchNatal, ['子卯相刑', '卯酉相冲', '子酉相破', '申子半合水局', '申酉半会金', '卯申暗合', '卯申暗会'], '案例3地支本命应对齐目标细盘口径');

  const appCaseFourChart = {
    year: pillar('庚', '辰'),
    month: pillar('壬', '午'),
    day: pillar('癸', '卯', '日主'),
    time: pillar('己', '未'),
  };
  const appCaseFourPanel = buildMingliFactPanel([
    ...buildTimingMingliInteractions(appCaseFourChart, {
      dayun: { stem: '己', branch: '卯', ganZhi: '己卯' },
      liunian: { stem: '丙', branch: '午', ganZhi: '丙午' },
    }),
    ...buildNatalMingliInteractions(appCaseFourChart),
  ]);
  assertSameSet(appCaseFourPanel.heavenlyStemLuck, ['丙克庚', '己克癸', '壬克丙', '癸克丙', '己克壬'], '案例4天干运势应对齐目标细盘口径');
  assertSameSet(appCaseFourPanel.earthlyBranchLuck, ['午午自刑', '午未六合土', '卯辰相害', '卯午相破', '卯未半合木局', '午未半会火', '卯辰半会木', '卯未见壬暗合木局'], '案例4地支运势应对齐目标细盘口径');
  assertSameSet(appCaseFourPanel.heavenlyStemNatal, ['己克癸', '己克壬'], '案例4天干本命应对齐目标细盘口径');
  assertSameSet(appCaseFourPanel.earthlyBranchNatal, ['午未六合土', '卯辰相害', '卯午相破', '卯未半合木局', '午未半会火', '卯辰半会木', '卯未见壬暗合木局', '未辰暗会'], '案例4地支本命应对齐目标细盘口径');

  const xiaonandouGengziChart = {
    year: pillar('乙', '亥'),
    month: pillar('丙', '戌'),
    day: pillar('庚', '子', '日主'),
    time: pillar('丁', '亥'),
  };
  const xiaonandouNatal = buildNatalMingliInteractions(xiaonandouGengziChart);
  assert.deepEqual(
    buildMingliGanZhiEffectsBrief(xiaonandouNatal),
    {
      heavenly_stems: ['乙庚合金', '丁克庚', '丙克庚'],
      earthly_branches: ['亥子半会水', '亥亥自刑'],
    },
    'Ziping brief 干支摘要应直接消费命理事实层本命 interaction'
  );
  const xiaonandouCaseOnePanel = buildMingliFactPanel([
    ...buildTimingMingliInteractions(xiaonandouGengziChart, {
      dayun: { stem: '戊', branch: '寅', ganZhi: '戊寅' },
      liunian: { stem: '乙', branch: '未', ganZhi: '乙未' },
      liuyue: { stem: '甲', branch: '申', ganZhi: '甲申' },
    }),
    ...xiaonandouNatal,
  ]);
  assertIncludesAll(xiaonandouCaseOnePanel.heavenlyStemLuck, ['甲克戊', '庚克甲', '乙庚合金'], '小南斗1995庚子案例1天干运势不能漏项');
  assertIncludesAll(
    xiaonandouCaseOnePanel.earthlyBranchLuck,
    ['申刑寅', '戌刑未', '寅申相冲', '寅亥六合木', '子未相害', '申亥相害', '未戌相破', '寅亥相破', '申戌拱会金局', '申子半合水局', '寅戌拱合午', '亥未拱合卯', '亥未见乙暗合木局', '寅戌见丁暗合火局'],
    '小南斗1995庚子案例1地支运势不能漏项'
  );
  assertSameSet(xiaonandouCaseOnePanel.heavenlyStemNatal, ['乙庚合金', '丙克庚', '丁克庚'], '小南斗1995庚子案例1天干本命应对齐');
  assertSameSet(xiaonandouCaseOnePanel.earthlyBranchNatal, ['亥子半会水', '亥亥自刑'], '小南斗1995庚子案例1地支本命应对齐');

  const xiaonandouCaseTwoPanel = buildMingliFactPanel([
    ...buildTimingMingliInteractions(xiaonandouGengziChart, {
      dayun: { stem: '癸', branch: '未', ganZhi: '癸未' },
      liunian: { stem: '丙', branch: '午', ganZhi: '丙午' },
      liuyue: { stem: '辛', branch: '卯', ganZhi: '辛卯' },
    }),
    ...xiaonandouNatal,
  ]);
  assertIncludesAll(xiaonandouCaseTwoPanel.heavenlyStemLuck, ['丙克庚', '丁克辛', '辛克乙', '癸克丁', '丙辛合水'], '小南斗1995庚子案例2天干运势不能漏项');
  assertIncludesAll(
    xiaonandouCaseTwoPanel.earthlyBranchLuck,
    ['戌刑未', '子卯相刑', '子午相冲', '卯戌六合火', '午未六合土', '子未相害', '未戌相破', '亥卯未三合木', '午戌半合火局', '亥未见乙暗合木局', '午未半会火', '午亥暗合', '午亥暗会'],
    '小南斗1995庚子案例2地支运势不能漏项'
  );
  assert.ok(xiaonandouCaseTwoPanel.earthlyBranchLuck.includes('卯午相破'), '完整规则应额外识别卯午相破');
  assertSameSet(xiaonandouCaseTwoPanel.heavenlyStemNatal, ['乙庚合金', '丙克庚', '丁克庚'], '小南斗1995庚子案例2天干本命应对齐');
  assertSameSet(xiaonandouCaseTwoPanel.earthlyBranchNatal, ['亥子半会水', '亥亥自刑'], '小南斗1995庚子案例2地支本命应对齐');

  const mixedGroupInteractions = buildTimingMingliInteractions({
    year: pillar('庚', '亥'),
    month: pillar('乙', '辰'),
    day: pillar('辛', '子', '日主'),
    time: pillar('丁', '巳'),
  }, {
    dayun: { stem: '癸', branch: '未', ganZhi: '癸未', tenGod: '食神' },
    liuyue: { month: 2, stem: '己', branch: '卯', ganZhi: '己卯', tenGod: '偏印', tenGodBottom: '偏财' },
  });
  assert.ok(
    hasRelation(mixedGroupInteractions, 'branch_three_harmony', (item) =>
      item.scope === 'liuyue_to_mixed' &&
      item.comparedAgainst === 'natal_and_timing' &&
      item.participants.some((participant: any) => participant.type === 'dayun' && participant.branch === '未') &&
      item.participants.some((participant: any) => participant.type === 'natal_pillar' && participant.branch === '亥')),
    '应识别流月 + 大运 + 原局共同补成三合'
  );

  const daily = buildDailyLuckData('辛', '2026-05-17');
  assert.equal(daily.ganZhi, '辛卯');
  assert.equal(daily.stem, '辛');
  assert.equal(daily.branch, '卯');
  assert.ok(
    timingInteractions.every((item: any) => item.ruleVersion === 'mingli_interactions_v1'),
    '全部事实必须带规则版本'
  );

  console.log('mingli interaction validation passed');
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
