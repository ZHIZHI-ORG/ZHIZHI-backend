const assert = require('node:assert/strict');

const {
  calculateFullChart,
  calculateWeightedWuxingFromChart,
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
  assert.deepEqual(
    chart1995.majorCycles[1].annualLuck[0].hiddenStems,
    [{ stem: '辛', tenGod: '劫财', element: '金' }],
    '流年应包含地支藏干，主星只展示天干十神'
  );
  assert.equal(chart1995.majorCycles[1].annualLuck[0].lifecycle, '帝旺', '流年星运应随接口返回给前端');
  assert.equal(chart1995.majorCycles[1].annualLuck[0].selfSitting, '绝', '流年自坐应随接口返回给前端');
  assert.equal(chart1995.majorCycles[1].annualLuck[0].naYin, '泉中水', '流年纳音应随接口返回给前端');
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
