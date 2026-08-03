import assert from 'node:assert/strict';
import type { BaziProfile } from '../src/models/BaziProfile';
import type { DailyFortuneFactPackage } from '../src/models/DailyFortune';
import {
  buildRecommendationTimeWindows,
} from '../src/services/recommendationTimeWindows';
import {
  RECOMMENDATION_EVIDENCE_WINDOW_LIMIT,
  RECOMMENDATION_TIME_WINDOWS_BYTE_LIMIT,
} from '../src/models/Recommendation';
import {
  calculateFullChart,
  selectAnnualLuckByDate,
  selectMajorCycleByDate,
} from '../src/utils/baziCalculator';

const effectiveDate = '2026-08-03';

function pillar(name: string, stem: string, branch: string) {
  return {
    name,
    stem,
    branch,
    ganZhi: `${stem}${branch}`,
    tenGod: '比肩',
    hiddenStems: [{ stem, tenGod: '比肩', element: '木' }],
  };
}

function monthlyLuck(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return {
    month,
    monthInChinese: String(month),
    solarTerm: '测试节气',
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    stem: '甲',
    branch: '子',
    ganZhi: '甲子',
    tenGod: '比肩',
    tenGodBottom: '比肩',
    hiddenStems: [{ stem: '癸', tenGod: '正印', element: '水' }],
    lifecycle: '沐浴',
    selfSitting: '沐浴',
    naYin: '海中金',
    xun: '甲子',
    xunKong: '戌亥',
  };
}

function annualLuck(year: number) {
  return {
    year,
    age: year - 1992,
    stem: '甲',
    branch: '子',
    ganZhi: '甲子',
    tenGodTop: '比肩',
    tenGodBottom: '正印',
    hiddenStems: [{ stem: '癸', tenGod: '正印', element: '水' }],
    lifecycle: '沐浴',
    selfSitting: '沐浴',
    naYin: '海中金',
    xun: '甲子',
    xunKong: '戌亥',
    monthlyLuck: Array.from({ length: 12 }, (_, index) => monthlyLuck(year, index + 1)),
  };
}

function majorCycle(startYear: number, endYear: number) {
  return {
    startYear,
    endYear,
    age: startYear - 1992,
    endAge: endYear - 1992,
    stem: '甲',
    branch: '子',
    ganZhi: '甲子',
    tenGod: '比肩',
    hiddenStems: [{ stem: '癸', tenGod: '正印', element: '水' }],
    lifecycle: '沐浴',
    selfSitting: '沐浴',
    naYin: '海中金',
    xun: '甲子',
    xunKong: '戌亥',
    annualLuck: Array.from(
      { length: endYear - startYear + 1 },
      (_, index) => annualLuck(startYear + index),
    ),
  };
}

function profile(): BaziProfile {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    owner_user_id: '00000000-0000-4000-8000-000000000001',
    is_owner: true,
    name: '未知时辰测试档案',
    gender: undefined,
    birth_year: 1992,
    birth_month: 6,
    birth_day: 8,
    birth_hour: null,
    birth_minute: null,
    is_lunar: false,
    birth_timezone: 'Asia/Shanghai',
    full_chart: {
      dayMaster: '甲',
      year: pillar('年柱', '甲', '子'),
      month: pillar('月柱', '甲', '子'),
      day: pillar('日柱', '甲', '子'),
      // This is an internal calculator fallback and must never reach a
      // recommendation relation when birth_hour is unknown.
      time: pillar('时柱', '丙', '午'),
      majorCycles: [majorCycle(2024, 2027), majorCycle(2028, 2031)],
    },
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function currentTiming(gan_zhi: string, extra: Record<string, unknown>) {
  return {
    gan_zhi,
    stem: gan_zhi.slice(0, 1),
    branch: gan_zhi.slice(1),
    hidden_stems: [{ stem: '癸', ten_god: '正印', element: '水' }],
    ...extra,
  };
}

function currentFacts(): DailyFortuneFactPackage {
  return {
    contract_version: 'daily_fortune_ai_first_v2',
    effective_date: effectiveDate,
    timezone: 'Asia/Hong_Kong',
    day_boundary: 'zi_chu_23_local',
    profile: {
      birth_date: '1992-06-08',
      birth_timezone: 'Asia/Shanghai',
    },
    natal: {
      pillars: [
        { position: 'year', gan_zhi: '甲子', hidden_stems: [] },
        { position: 'month', gan_zhi: '甲子', hidden_stems: [] },
        { position: 'day', gan_zhi: '甲子', hidden_stems: [] },
      ],
      day_master: '甲',
      day_master_element: '木',
    },
    timing: {
      dayun: currentTiming('甲子', { start_year: 2024, end_year: 2027 }),
      liunian: currentTiming('甲子', { year: 2026 }),
      liuyue: currentTiming('甲子', {
        month: 8,
        start_date: '2026-08-01',
        end_date: '2026-09-01',
      }),
      liuri: currentTiming('甲子', { date: effectiveDate }),
    },
    mingli_interactions: {
      rule_version: 'mingli_interactions_v1',
      natal: [],
      timing: [],
    },
    user_context: {
      declared: {
        mbti: null,
        life_stage: { primary: null, tags: [] },
        work_study: {
          mode: null,
          career_status: null,
          occupation: null,
          industry: null,
          study_status: null,
          school: null,
          current_goal: null,
        },
        relationship: { status: null, current_focus: null },
      },
      zhizhi_understanding: {
        snapshot_version: null,
        current_focus: [],
        expression_preferences: [],
        behavior_signals: [],
        updated_at: null,
      },
    },
  };
}

async function main(): Promise<void> {
  const windows = buildRecommendationTimeWindows({
    profile: profile(),
    currentFacts: currentFacts(),
  });

  assert.equal(windows.filter((window) => window.kind === 'dayun').length, 2);
  assert.equal(
    windows.filter((window) => window.kind === 'liunian').length,
    3,
    '只传近期父流年和一个远期探索，不传全部流年索引',
  );
  assert.equal(
    windows.filter((window) => window.bucket === 'recent_12_liuyue').length,
    12,
  );
  assert.equal(
    windows.filter((window) => window.bucket === 'future_exploration').length,
    1,
  );
  assert.equal(
    windows.filter((window) => window.detail_level === 'evidence').length,
    RECOMMENDATION_EVIDENCE_WINDOW_LIMIT,
  );
  assert.ok(windows.filter((window) => window.bucket === 'dayun_index').every(
    (window) => window.interactions.length === 0 && window.timing.hidden_stems.length === 0,
  ));
  assert.equal(windows.some((window) => (window.kind as string) === 'liuri'), false);

  const horizonByKind = {
    dayun: 'ten_years',
    liunian: 'year',
    liuyue: 'month',
  } as const;
  for (const window of windows) {
    assert.ok(window.interactions.every(
      (interaction) => interaction.time_horizon === horizonByKind[window.kind],
    ));
    assert.ok(window.interactions.every((interaction) => (
      interaction.members.every((member) => member.pillar !== 'hour')
    )), '未知时辰不能让内部午时占位进入远期作用关系');
  }

  const serialized = JSON.stringify(windows);
  assert.equal(serialized.includes('daily_lucks'), false);
  assert.equal(serialized.includes('source'), false);
  assert.equal(serialized.includes('targets'), false);
  assert.equal(serialized.includes('element'), false);
  assert.ok(
    Buffer.byteLength(serialized, 'utf8') <= RECOMMENDATION_TIME_WINDOWS_BYTE_LIMIT,
  );

  const currentMonth = windows.find((window) => (
    window.kind === 'liuyue' && window.is_current
  ));
  assert.deepEqual(currentMonth?.target_window, {
    valid_from: '2026-08-01',
    valid_until: '2026-08-31',
  });
  assert.equal(currentMonth?.parent_window_keys.length, 2);

  const firstFar = windows.find((window) => window.bucket === 'future_exploration');
  assert.ok(firstFar);
  assert.equal(firstFar.kind, 'liunian', '未来 1–3 年应以流年而不是随机远期流月探索');
  const rotated = buildRecommendationTimeWindows({
    profile: profile(),
    currentFacts: currentFacts(),
    timeWindowHistory: [{
      window_key: firstFar.window_key,
      primary_exposures: 1,
      primary_opens: 0,
      last_primary_exposed_at: '2026-08-02T00:00:00.000Z',
      last_primary_opened_at: null,
    }],
  });
  const rotatedFar = rotated.find((window) => window.bucket === 'future_exploration');
  assert.ok(rotatedFar);
  assert.notEqual(
    rotatedFar.window_key,
    firstFar.window_key,
    '已作为主时间窗口展示过的远期内容应让位给未展示窗口',
  );

  const repeated = buildRecommendationTimeWindows({
    profile: profile(),
    currentFacts: currentFacts(),
    timeWindowHistory: [{
      window_key: firstFar.window_key,
      primary_exposures: 1,
      primary_opens: 0,
      last_primary_exposed_at: '2026-08-02T00:00:00.000Z',
      last_primary_opened_at: null,
    }],
  });
  assert.deepEqual(repeated, rotated, '相同事实和历史必须得到可回放的稳定窗口');

  const boundaryFacts = currentFacts();
  boundaryFacts.effective_date = '2027-08-03';
  boundaryFacts.timing.dayun = currentTiming('甲子', { start_year: 2024, end_year: 2027 });
  boundaryFacts.timing.liunian = currentTiming('甲子', { year: 2027 });
  boundaryFacts.timing.liuyue = currentTiming('甲子', {
    month: 8,
    start_date: '2027-08-01',
    end_date: '2027-09-01',
  });
  const boundaryWindows = buildRecommendationTimeWindows({
    profile: profile(),
    currentFacts: boundaryFacts,
  });
  assert.equal(
    boundaryWindows.filter((window) => (
      window.kind === 'dayun' && window.detail_level === 'evidence'
    )).length,
    2,
    '近期 12 月跨大运时必须给两个父大运完整证据',
  );
  assert.equal(
    boundaryWindows.filter((window) => window.bucket === 'future_exploration').length,
    0,
    '核心父层已经占满 16 个证据窗口时不再硬塞远期探索',
  );
  assert.equal(
    boundaryWindows.filter((window) => window.detail_level === 'evidence').length,
    RECOMMENDATION_EVIDENCE_WINDOW_LIMIT,
  );

  const realChart = await calculateFullChart(1995, 11, 5, 22, 30, false, 1, 1);
  const annual2026 = realChart.majorCycles
    .flatMap((cycle) => cycle.annualLuck)
    .find((annual) => annual.year === 2026);
  assert.ok(annual2026);
  assert.equal(annual2026.startDate, '2026-02-04');
  assert.equal(annual2026.endDate, '2027-02-04');
  assert.equal(annual2026.monthlyLuck[11].startDate, '2027-01-05');
  assert.equal(
    annual2026.monthlyLuck[11].endDate,
    '2027-02-04',
    '小寒月必须结束在下一公历年的立春，不能倒置回同年立春',
  );
  assert.equal(selectAnnualLuckByDate(realChart.majorCycles, '2027-01-10')?.year, 2026);
  assert.equal(selectAnnualLuckByDate(realChart.majorCycles, '2027-02-04')?.year, 2027);

  const firstRealCycle = realChart.majorCycles[1];
  assert.equal(firstRealCycle.startDate, realChart.startDate);
  assert.equal(
    selectMajorCycleByDate(
      realChart.majorCycles,
      previousCalendarDay(firstRealCycle.startDate as string),
    )?.ganZhi,
    '童限',
  );
  assert.equal(
    selectMajorCycleByDate(realChart.majorCycles, firstRealCycle.startDate as string)?.ganZhi,
    firstRealCycle.ganZhi,
    '换运日必须按精确起运日期切换，不能按公历 1 月 1 日切换',
  );

  console.log('Recommendation time window projection passed.');
}

function previousCalendarDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
