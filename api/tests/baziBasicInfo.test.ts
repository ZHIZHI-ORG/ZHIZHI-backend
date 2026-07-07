const assert = require('node:assert/strict');

const {
  calculateFullChart,
} = require('../src/utils/baziCalculator.ts');

const {
  buildBaziBasicInfo,
} = require('../src/utils/baziBasicInfo.ts');

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
    true_solar_time: '1995-11-05 22:30',
    true_solar_correction_minutes: 0,
    created_at: '2026-06-05T00:00:00Z',
    updated_at: '2026-06-05T00:00:00Z',
    ...overrides,
  };
}

async function main(): Promise<void> {
  const chart1995 = await calculateFullChart(1995, 11, 5, 22, 30, false, 1, 1);
  const basicInfo = buildBaziBasicInfo({
    profile: profile(),
    chart: chart1995,
  });

  assert.equal(basicInfo.method_version, 'bazi_basic_info_v1');
  assert.deepEqual(
    basicInfo.field_labels,
    {
      gan_zhi: '干支',
      ten_gods: '十神',
      lifecycle: '星运',
      self_sitting: '自坐',
      na_yin: '纳音',
      xun_kong: '空亡',
    },
    '只保留用户确认的 6 个字段 label'
  );
  assert.deepEqual(
    basicInfo.birth_info,
    {
      birth_datetime: '1995-11-05 22:30',
      true_solar_datetime: null,
      gender: 'male',
      time_precision: 'known',
    },
    '标准时间排盘时不应把 corrected time 冒充真太阳时'
  );

  assert.equal(basicInfo.pillars.length, 4);
  assert.deepEqual(
    basicInfo.pillars.map((pillar: any) => pillar.gan_zhi),
    ['乙亥', '丙戌', '庚子', '丁亥'],
    '基础包应保留四柱干支'
  );

  const month = basicInfo.pillars[1];
  assert.deepEqual(
    month.ten_gods,
    [
      { source: '天干', stem: '丙', ten_god: '七杀' },
      { source: '地支藏干', qi: '主气', stem: '戊', ten_god: '偏印' },
      { source: '地支藏干', qi: '中气', stem: '辛', ten_god: '劫财' },
      { source: '地支藏干', qi: '余气', stem: '丁', ten_god: '正官' },
    ],
    '天干十神和地支藏干十神应并列在 ten_gods 中'
  );
  assert.equal(month.lifecycle, '衰');
  assert.equal(month.self_sitting, '墓');
  assert.equal(month.na_yin, '屋上土');
  assert.equal(month.xun_kong, '午未');

  const serialized = JSON.stringify(basicInfo);
  [
    'day_master',
    'element',
    'stem_element',
    'branch_element',
    'hidden_stems',
    'stem_ten_god',
    'branch_main_ten_god',
    'calendar',
    'timezone',
    'location',
    'wuxing',
    'luck',
    'pattern',
    'ziping',
  ].forEach((forbidden) => {
    assert.ok(!serialized.includes(forbidden), `八字基础包不应包含 ${forbidden}`);
  });

  const trueSolarInfo = buildBaziBasicInfo({
    profile: profile({
      time_basis: 'true_solar_time',
      true_solar_time: '1995-11-05 22:11',
      true_solar_correction_minutes: -19,
    }),
    chart: chart1995,
  });
  assert.equal(trueSolarInfo.birth_info.true_solar_datetime, '1995-11-05 22:11');

  const unknownHourInfo = buildBaziBasicInfo({
    profile: profile({
      birth_hour: null,
      birth_minute: null,
      true_solar_time: null,
    }),
    chart: chart1995,
  });
  assert.equal(unknownHourInfo.birth_info.birth_datetime, '1995-11-05');
  assert.equal(unknownHourInfo.birth_info.time_precision, 'unknown_hour');
  assert.deepEqual(
    unknownHourInfo.pillars.map((pillar: any) => pillar.position),
    ['year', 'month', 'day'],
    '时辰未知时基础包不应输出默认午时的 hour 柱'
  );

  console.log('bazi basic info validation passed');
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
