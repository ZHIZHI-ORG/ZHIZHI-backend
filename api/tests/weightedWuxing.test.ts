const assert = require('node:assert/strict');

const {
  calculateFullChart,
  calculateWeightedWuxingFromChart,
  buildDailyLuckListForMonth,
  ensureChartLuckMetadata,
} = require('../src/utils/baziCalculator.ts');

async function main(): Promise<void> {
  const chart1995 = await calculateFullChart(1995, 11, 5, 22, 30, false, 1, 1);
  assert.deepEqual(
    chart1995.majorCycles[1].hiddenStems,
    [{ stem: '辛', tenGod: '劫财', element: '金' }],
    '大运应包含地支藏干，供前端点击后展示'
  );
  assert.equal(chart1995.majorCycles[1].lifecycle, '帝旺', '大运星运应随接口返回给前端');
  assert.equal(chart1995.majorCycles[1].selfSitting, '绝', '大运自坐应随接口返回给前端');
  assert.equal(chart1995.majorCycles[1].naYin, '泉中水', '大运纳音应随接口返回给前端');
  assertFullTenGodDisplay(chart1995.majorCycles[1].tenGod, '大运十神应返回全称');
  assert.deepEqual(
    chart1995.majorCycles[1].annualLuck[0].hiddenStems,
    [{ stem: '辛', tenGod: '劫财', element: '金' }],
    '流年应包含地支藏干，主星只展示天干十神'
  );
  assert.equal(chart1995.majorCycles[1].annualLuck[0].lifecycle, '帝旺', '流年星运应随接口返回给前端');
  assert.equal(chart1995.majorCycles[1].annualLuck[0].selfSitting, '绝', '流年自坐应随接口返回给前端');
  assert.equal(chart1995.majorCycles[1].annualLuck[0].naYin, '泉中水', '流年纳音应随接口返回给前端');
  assertFullTenGodDisplay(chart1995.majorCycles[1].annualLuck[0].tenGodTop, '流年天干十神应返回全称');
  assertFullTenGodDisplay(chart1995.majorCycles[1].annualLuck[0].tenGodBottom, '流年地支主气十神应返回全称');
  assert.deepEqual(
    chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0].hiddenStems,
    [
      { stem: '甲', tenGod: '偏财', element: '木' },
      { stem: '丙', tenGod: '七杀', element: '火' },
      { stem: '戊', tenGod: '偏印', element: '土' },
    ],
    '流月应包含地支藏干，供前端藏干行展示'
  );
  assert.equal(chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0].lifecycle, '绝', '流月星运应随接口返回给前端');
  assert.equal(chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0].selfSitting, '长生', '流月自坐应随接口返回给前端');
  assert.equal(chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0].naYin, '城头土', '流月纳音应随接口返回给前端');
  assertFullTenGodDisplay(chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0].tenGod, '流月天干十神应返回全称');
  assertFullTenGodDisplay(chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0].tenGodBottom, '流月地支主气十神应返回全称');
  const dailyLuckForMonth = buildDailyLuckListForMonth(
    chart1995.dayMaster,
    chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0],
    chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0].startDate
  );
  assert.ok(dailyLuckForMonth.length > 1, '流日列表应按选中流月返回整段日期，而不是只返回 selected_day 一天');
  assert.equal(dailyLuckForMonth[0].date, chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0].startDate);
  assert.equal(
    dailyLuckForMonth[dailyLuckForMonth.length - 1].date,
    previousYmd(chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0].endDate),
    '流日列表应覆盖到下一流月开始日前一天'
  );
  assertFullTenGodDisplay(dailyLuckForMonth[0].tenGodTop, '流日天干十神应返回全称');
  assertFullTenGodDisplay(dailyLuckForMonth[0].tenGodBottom, '流日地支主气十神应返回全称');

  const legacyChart = JSON.parse(JSON.stringify(chart1995));
  const legacyCycle = legacyChart.majorCycles[1];
  const legacyAnnual = legacyCycle.annualLuck[0];
  const legacyMonthly = legacyAnnual.monthlyLuck[0];
  legacyAnnual.hiddenStems = legacyAnnual.hiddenStems.map((item: any) => ({ stem: item.stem }));
  legacyAnnual.lifecycle = '';
  legacyAnnual.selfSitting = '';
  legacyAnnual.naYin = '';
  legacyMonthly.hiddenStems = legacyMonthly.hiddenStems.map((item: any) => ({ stem: item.stem }));
  legacyMonthly.lifecycle = '';
  legacyMonthly.selfSitting = '';
  legacyMonthly.naYin = '';

  const upgradedChart = ensureChartLuckMetadata(legacyChart, chart1995.dayMaster);
  assert.deepEqual(
    upgradedChart.majorCycles[1].annualLuck[0].hiddenStems,
    chart1995.majorCycles[1].annualLuck[0].hiddenStems,
    '旧 full_chart 的流年藏干应在读路径补齐十神和五行'
  );
  assert.equal(upgradedChart.majorCycles[1].annualLuck[0].lifecycle, '帝旺', '旧 full_chart 的流年星运应在读路径补齐');
  assert.equal(upgradedChart.majorCycles[1].annualLuck[0].selfSitting, '绝', '旧 full_chart 的流年自坐应在读路径补齐');
  assert.equal(upgradedChart.majorCycles[1].annualLuck[0].naYin, '泉中水', '旧 full_chart 的流年纳音应在读路径补齐');
  assert.deepEqual(
    upgradedChart.majorCycles[1].annualLuck[0].monthlyLuck[0].hiddenStems,
    chart1995.majorCycles[1].annualLuck[0].monthlyLuck[0].hiddenStems,
    '旧 full_chart 的流月藏干应在读路径补齐十神和五行'
  );
  assert.equal(upgradedChart.majorCycles[1].annualLuck[0].monthlyLuck[0].lifecycle, '绝', '旧 full_chart 的流月星运应在读路径补齐');
  assert.equal(upgradedChart.majorCycles[1].annualLuck[0].monthlyLuck[0].selfSitting, '长生', '旧 full_chart 的流月自坐应在读路径补齐');
  assert.equal(upgradedChart.majorCycles[1].annualLuck[0].monthlyLuck[0].naYin, '城头土', '旧 full_chart 的流月纳音应在读路径补齐');

  assert.deepEqual(chart1995.wuxing, {
    金: 1,
    木: 1,
    水: 3,
    火: 2,
    土: 1,
    dominant: '水',
    lacking: [],
  });

  const weighted = chart1995.weightedWuxing;
  assert.equal(weighted.methodVersion, 'weighted_wuxing_v2_9');
  assert.equal(weighted.dominant, '火');
  assert.equal(weighted.weakest, '木');
  assert.equal(weighted.balanceIndex, 0.83);
  assert.equal(weighted.dayMasterStrength.label, 'weak');
  assert.equal(weighted.dayMasterStrength.score, -43);
  assert.deepEqual(weighted.scores, {
    木: { raw: 1.16, percent: 10.63 },
    火: { raw: 3.16, percent: 28.89 },
    土: { raw: 2.2, percent: 20.12 },
    金: { raw: 1.72, percent: 15.76 },
    水: { raw: 2.69, percent: 24.6 },
  });
  assert.ok(weighted.contributions.some((item: any) => item.source === 'month_hidden_main' && item.element === '土'));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'day_hidden_main' && item.element === '水' && item.score === 1.5));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'month_hidden_middle' && item.element === '金' && item.score === 0.62));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'elemental_rooted_penetration' && item.element === '木'));
  assert.ok(!weighted.contributions.some((item: any) => item.source.endsWith('_branch')));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'rooted_penetration'));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'stem_combination_bind'));
  assert.ok(!weighted.contributions.some((item: any) => item.source === 'rooting'));
  assert.ok(!weighted.contributions.some((item: any) => item.source === 'penetration'));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'generating_flow'));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'draining_flow'));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'controlling_flow'));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'controlling_drain'));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'restraining_flow'));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'direct_stem_control'));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'stem_combination_bind_drain'));
  assert.ok(weighted.contributions.some((item: any) => item.source === 'partial_three_meeting' && item.note.includes('相邻')));
  assert.ok(weighted.majorFactors.includes('月令戌土主导季节气势'));

  const fallback = calculateWeightedWuxingFromChart({
    dayMaster: chart1995.dayMaster,
    year: chart1995.year,
    month: chart1995.month,
    day: chart1995.day,
    time: chart1995.time,
  });
  assert.deepEqual(fallback.scores, weighted.scores);

  const unknownHour = await calculateFullChart(1995, 11, 5, undefined, 0, false, 1, 1);
  assert.equal(unknownHour.weightedWuxing.methodVersion, 'weighted_wuxing_v2_9');
  assert.ok(unknownHour.weightedWuxing.contributions.length > 0);

  const transformChart = await calculateFullChart(1980, 1, 13, 12, 0, false, 1, 1);
  assert.ok(
    transformChart.weightedWuxing.contributions.some((item: any) => item.source === 'stem_combination_transform_drain'),
    '合化应折减参与天干原气'
  );
  assert.ok(
    transformChart.weightedWuxing.contributions.some((item: any) => item.source === 'six_combination_transform_drain'),
    '六合化气应折减参与地支非化神藏干'
  );

  const clashChart = await calculateFullChart(1980, 1, 3, 12, 0, false, 1, 1);
  assert.ok(
    clashChart.weightedWuxing.contributions.some((item: any) => item.source === 'directional_branch_clash'),
    '六冲应按强弱方向削弱真实藏干'
  );

  const meetingChart = await calculateFullChart(1980, 1, 3, 6, 0, false, 1, 1);
  assert.ok(
    meetingChart.weightedWuxing.contributions.some((item: any) =>
      item.source === 'three_meeting' || item.source === 'partial_three_meeting' || item.source === 'three_harmony'
    ),
    '应识别三会、半会或三合关系'
  );
  assert.ok(
    meetingChart.weightedWuxing.contributions.some((item: any) => item.source === 'three_harmony_transform_drain'),
    '三合成局应折减参与地支非化神藏干'
  );

  console.log('weighted wuxing validation passed');
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});

function previousYmd(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assertFullTenGodDisplay(value: string, message: string): void {
  const fullNames = new Set(['比肩', '劫财', '食神', '伤官', '偏财', '正财', '七杀', '正官', '偏印', '正印']);
  const parts = value.split('\n').filter(Boolean);
  assert.ok(parts.length > 0, message);
  for (const part of parts) {
    assert.ok(fullNames.has(part), `${message}，实际为 ${value}`);
  }
}
