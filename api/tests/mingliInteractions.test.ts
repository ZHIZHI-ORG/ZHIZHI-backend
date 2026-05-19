const assert = require('node:assert/strict');

const {
  buildDailyLuckData,
} = require('../src/utils/baziCalculator.ts');

const {
  buildMingliFactPanel,
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

async function main(): Promise<void> {
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
      item.shortLabel === '寅辰拱会卯' &&
      item.missingBranch === '卯'),
    '应识别寅辰拱会卯'
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
  assertSameSet(appCaseOnePanel.heavenlyStemLuck, ['甲克戊', '丙克庚', '戊癸合化火'], '案例1天干运势应对齐目标细盘口径');
  assertSameSet(appCaseOnePanel.earthlyBranchLuck, ['寅刑巳', '午刑午', '子午相冲', '寅巳相害', '寅午戌三合火', '寅午暗合', '子巳暗合', '子巳暗会'], '案例1地支运势应对齐目标细盘口径');
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
  assertSameSet(appCaseTwoPanel.heavenlyStemLuck, ['丁克辛', '丙辛合化水'], '案例2天干运势应对齐目标细盘口径');
  assertSameSet(appCaseTwoPanel.earthlyBranchLuck, ['午刑午', '辰酉合化金', '午未合化土', '巳午未会南方火局', '巳酉半合金局', '巳酉暗合'], '案例2地支运势应对齐目标细盘口径');
  assertSameSet(appCaseTwoPanel.heavenlyStemNatal, ['甲克戊', '甲己合化土'], '案例2天干本命应对齐目标细盘口径');
  assertSameSet(appCaseTwoPanel.earthlyBranchNatal, ['午未合化土', '巳午未会南方火局', '未辰暗会'], '案例2地支本命应对齐目标细盘口径');

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
  assertSameSet(appCaseThreePanel.earthlyBranchLuck, ['午刑午', '子午相冲', '卯戌合化火', '酉戌相害', '卯午相破', '申酉戌会西方金局', '午戌半合火局'], '案例3地支运势应对齐目标细盘口径');
  assertSameSet(appCaseThreePanel.heavenlyStemNatal, [], '案例3天干本命应对齐目标细盘口径');
  assertSameSet(appCaseThreePanel.earthlyBranchNatal, ['子刑卯', '卯酉相冲', '子酉相破', '申子半合水局', '卯申暗合', '卯申暗会'], '案例3地支本命应对齐目标细盘口径');

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
  assertSameSet(appCaseFourPanel.heavenlyStemLuck, ['丙克庚', '己克癸', '壬克丙'], '案例4天干运势应对齐目标细盘口径');
  assertSameSet(appCaseFourPanel.earthlyBranchLuck, ['午刑午', '午未合化土', '卯辰相害', '卯午相破', '卯未半合木局', '卯未见壬暗合木局'], '案例4地支运势应对齐目标细盘口径');
  assertSameSet(appCaseFourPanel.heavenlyStemNatal, ['己克癸'], '案例4天干本命应对齐目标细盘口径');
  assertSameSet(appCaseFourPanel.earthlyBranchNatal, ['午未合化土', '卯辰相害', '卯午相破', '卯未半合木局', '卯未见壬暗合木局', '未辰暗会'], '案例4地支本命应对齐目标细盘口径');

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
