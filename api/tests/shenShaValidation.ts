const assert = require('node:assert/strict');

const { calculateShenSha } = require('../src/utils/shenShaCalculator.ts');
const { calculateFullChart } = require('../src/utils/baziCalculator.ts');

function assertIncludesAll(actual: string[], expected: string[], label: string): void {
  expected.forEach((item) => {
    assert.ok(
      actual.includes(item),
      `${label} 缺少 ${item}，实际为: ${actual.join('、') || '空'}`
    );
  });
}

function assertPillarHasShenSha(
  result: { year: string[]; month: string[]; day: string[]; time: string[] },
  pillar: 'year' | 'month' | 'day' | 'time',
  expected: string,
  label: string,
): void {
  assert.ok(
    result[pillar].includes(expected),
    `${label} 应包含 ${expected}，实际为: ${result[pillar].join('、') || '空'}`
  );
}

async function main(): Promise<void> {
  const baseFormulaCases = [
    {
      label: '文昌贵人-甲见巳',
      pillars: { yearGan: '丙', yearZhi: '巳', monthGan: '辛', monthZhi: '寅', dayGan: '甲', dayZhi: '辰', timeGan: '癸', timeZhi: '未' },
      pillar: 'year',
      shenSha: '文昌贵人',
    },
    {
      label: '阳刃-壬见子',
      pillars: { yearGan: '甲', yearZhi: '寅', monthGan: '乙', monthZhi: '卯', dayGan: '壬', dayZhi: '申', timeGan: '丙', timeZhi: '子' },
      pillar: 'time',
      shenSha: '阳刃',
    },
    {
      label: '红艳-庚见戌',
      pillars: { yearGan: '甲', yearZhi: '子', monthGan: '乙', monthZhi: '戌', dayGan: '庚', dayZhi: '辰', timeGan: '丙', timeZhi: '寅' },
      pillar: 'month',
      shenSha: '红艳',
    },
    {
      label: '孤辰-申年见亥',
      pillars: { yearGan: '甲', yearZhi: '申', monthGan: '乙', monthZhi: '子', dayGan: '丙', dayZhi: '辰', timeGan: '丁', timeZhi: '亥' },
      pillar: 'time',
      shenSha: '孤辰',
    },
    {
      label: '寡宿-巳年见辰',
      pillars: { yearGan: '甲', yearZhi: '巳', monthGan: '乙', monthZhi: '辰', dayGan: '丙', dayZhi: '午', timeGan: '丁', timeZhi: '申' },
      pillar: 'month',
      shenSha: '寡宿',
    },
    {
      label: '大耗-子年见巳',
      pillars: { yearGan: '甲', yearZhi: '子', monthGan: '乙', monthZhi: '巳', dayGan: '丙', dayZhi: '午', timeGan: '丁', timeZhi: '申' },
      pillar: 'month',
      shenSha: '大耗',
    },
    {
      label: '大耗-子年见未',
      pillars: { yearGan: '甲', yearZhi: '子', monthGan: '乙', monthZhi: '未', dayGan: '丙', dayZhi: '午', timeGan: '丁', timeZhi: '申' },
      pillar: 'month',
      shenSha: '大耗',
    },
    {
      label: '将星-子日见子',
      pillars: { yearGan: '甲', yearZhi: '子', monthGan: '乙', monthZhi: '寅', dayGan: '丙', dayZhi: '子', timeGan: '丁', timeZhi: '辰' },
      pillar: 'year',
      shenSha: '将星',
    },
    {
      label: '华盖-申日见辰',
      pillars: { yearGan: '甲', yearZhi: '子', monthGan: '乙', monthZhi: '辰', dayGan: '丙', dayZhi: '申', timeGan: '丁', timeZhi: '未' },
      pillar: 'month',
      shenSha: '华盖',
    },
    {
      label: '驿马-丑日见亥',
      pillars: { yearGan: '甲', yearZhi: '子', monthGan: '乙', monthZhi: '寅', dayGan: '丙', dayZhi: '丑', timeGan: '丁', timeZhi: '亥' },
      pillar: 'time',
      shenSha: '驿马',
    },
    {
      label: '劫煞-卯日见申',
      pillars: { yearGan: '甲', yearZhi: '申', monthGan: '乙', monthZhi: '子', dayGan: '丙', dayZhi: '卯', timeGan: '丁', timeZhi: '辰' },
      pillar: 'year',
      shenSha: '劫煞',
    },
    {
      label: '亡神-午日见巳',
      pillars: { yearGan: '甲', yearZhi: '巳', monthGan: '乙', monthZhi: '子', dayGan: '丙', dayZhi: '午', timeGan: '丁', timeZhi: '辰' },
      pillar: 'year',
      shenSha: '亡神',
    },
    {
      label: '天德-戌月见丙',
      pillars: { yearGan: '丙', yearZhi: '子', monthGan: '乙', monthZhi: '戌', dayGan: '辛', dayZhi: '丑', timeGan: '丁', timeZhi: '寅' },
      pillar: 'year',
      shenSha: '天德',
    },
    {
      label: '月德-酉月见庚',
      pillars: { yearGan: '甲', yearZhi: '子', monthGan: '乙', monthZhi: '酉', dayGan: '辛', dayZhi: '丑', timeGan: '庚', timeZhi: '寅' },
      pillar: 'time',
      shenSha: '月德',
    },
  ] as const;

  baseFormulaCases.forEach(({ label, pillars, pillar, shenSha }) => {
    const result = calculateShenSha(pillars);
    assertPillarHasShenSha(result, pillar, shenSha, label);
  });

  const base1995 = calculateShenSha({
    yearGan: '乙',
    yearZhi: '亥',
    monthGan: '丙',
    monthZhi: '戌',
    dayGan: '庚',
    dayZhi: '子',
    timeGan: '丁',
    timeZhi: '亥',
  });

  assert.deepEqual(base1995, {
    year: ['文昌贵人', '亡神'],
    month: ['红艳', '寡宿', '天德', '月德'],
    day: [],
    time: ['文昌贵人', '亡神'],
  });

  const chart1995 = await calculateFullChart(1995, 11, 5, 22, 30, false, 1, 1);
  assertIncludesAll(chart1995.year.shenSha, ['国印贵人', '太极贵人', '文昌贵人', '亡神'], '1995 年柱');
  assertIncludesAll(chart1995.month.shenSha, ['红艳', '寡宿', '天德', '月德', '金舆', '文星贵人'], '1995 月柱');
  assertIncludesAll(chart1995.day.shenSha, ['太极贵人', '桃花'], '1995 日柱');
  assertIncludesAll(chart1995.time.shenSha, ['国印贵人', '太极贵人', '文昌贵人', '亡神'], '1995 时柱');
  assert.ok(!chart1995.month.shenSha.includes('德秀贵人'), '1995 月柱不应包含德秀贵人');
  assert.ok(!chart1995.time.shenSha.includes('德秀贵人'), '1995 时柱不应包含德秀贵人');
  assert.ok(!chart1995.year.shenSha.includes('天厨贵人'), '1995 年柱不应包含天厨贵人');
  assert.ok(!chart1995.time.shenSha.includes('天厨贵人'), '1995 时柱不应包含天厨贵人');
  assert.ok(!chart1995.day.shenSha.includes('天乙贵人'), '1995 日柱不应包含天乙贵人');
  assert.ok(!chart1995.month.shenSha.includes('天喜'), '1995 月柱不应包含天喜');
  assert.ok(!chart1995.year.shenSha.includes('红鸾'), '1995 年柱不应包含红鸾');
  assert.ok(!chart1995.day.shenSha.includes('红鸾'), '1995 日柱不应包含红鸾');
  assert.ok(chart1995.month.shenSha.includes('天罗'), '1995 月柱应包含天罗');
  assert.ok(!chart1995.year.shenSha.includes('天罗'), '1995 年柱不应包含天罗');
  assert.ok(!chart1995.time.shenSha.includes('天罗'), '1995 时柱不应包含天罗');

  const chart2001 = await calculateFullChart(2001, 6, 25, 8, 45, false, 2, 1);
  assertIncludesAll(chart2001.year.shenSha, ['驿马', '国印贵人'], '2001 年柱');
  assertIncludesAll(chart2001.month.shenSha, ['桃花'], '2001 月柱');
  assertIncludesAll(chart2001.day.shenSha, ['太极贵人', '天印贵人'], '2001 日柱');
  assertIncludesAll(chart2001.time.shenSha, ['红艳', '寡宿', '太极贵人'], '2001 时柱');
  assert.ok(!chart2001.month.shenSha.includes('天乙贵人'), '2001 月柱不应包含天乙贵人');
  assert.ok(!chart2001.time.shenSha.includes('天喜'), '2001 时柱不应包含天喜');
  assert.ok(!chart2001.time.shenSha.includes('德秀贵人'), '2001 时柱不应包含德秀贵人');
  assert.ok(chart2001.time.shenSha.includes('地网'), '2001 时柱应包含地网');
  assert.ok(!chart2001.year.shenSha.includes('地网'), '2001 年柱不应包含地网');

  const chart1990 = await calculateFullChart(1990, 1, 1, 12, 0, false, 1, 1);
  assertIncludesAll(chart1990.day.shenSha, ['红艳', '学堂', '正学堂'], '1990-01-01 12:00 日柱');

  const chart1980 = await calculateFullChart(1980, 2, 21, 12, 0, false, 1, 1);
  assertIncludesAll(chart1980.month.shenSha, ['天印贵人'], '1980-02-21 12:00 月柱');
  assertIncludesAll(chart1980.day.shenSha, ['天印贵人'], '1980-02-21 12:00 日柱');

  const chart1980GuoYin = await calculateFullChart(1980, 1, 2, 12, 0, false, 1, 1);
  assertIncludesAll(chart1980GuoYin.day.shenSha, ['国印贵人'], '1980-01-02 12:00 日柱');

  const chart1980JinYu = await calculateFullChart(1980, 2, 1, 12, 0, false, 1, 1);
  assertIncludesAll(chart1980JinYu.day.shenSha, ['金舆'], '1980-02-01 12:00 日柱');

  console.log('shenSha validation passed');
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
