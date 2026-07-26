import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const {
  projectChartToActualNatalPillars,
} = require('../src/services/baziService') as typeof import('../src/services/baziService');
const {
  buildNatalMingliInteractions,
  buildTimingMingliInteractions,
} = require('../src/utils/mingliInteractionEngine') as typeof import('../src/utils/mingliInteractionEngine');

function chart() {
  return {
    year: { stem: '甲', branch: '子', ganZhi: '甲子', tenGod: '正官', hiddenStems: [] },
    month: { stem: '丙', branch: '午', ganZhi: '丙午', tenGod: '正印', hiddenStems: [] },
    day: { stem: '己', branch: '丑', ganZhi: '己丑', tenGod: '日主', hiddenStems: [] },
    // This is the calculator's internal noon fallback for an unknown-hour profile.
    time: { stem: '乙', branch: '未', ganZhi: '乙未', tenGod: '七杀', hiddenStems: [] },
  };
}

function hasHourParticipant(interactions: Array<{ participants: Array<{ pillar?: string }> }>) {
  return interactions.some((item) => item.participants.some((participant) => participant.pillar === 'hour'));
}

function main(): void {
  const fullChart = chart();
  const fourPillarInteractions = buildNatalMingliInteractions(fullChart as any);
  assert.equal(hasHourParticipant(fourPillarInteractions), true);

  const threePillarChart = projectChartToActualNatalPillars(fullChart, false);
  assert.equal('time' in threePillarChart, false);
  assert.equal('hour' in threePillarChart, false);

  const threePillarInteractions = buildNatalMingliInteractions(threePillarChart as any);
  assert.equal(hasHourParticipant(threePillarInteractions), false);

  const timingInteractions = buildTimingMingliInteractions(threePillarChart as any, {
    liuri: { stem: '乙', branch: '未', ganZhi: '乙未' },
  });
  assert.equal(hasHourParticipant(timingInteractions), false);

  assert.equal(projectChartToActualNatalPillars(fullChart, true), fullChart);
  console.log('daily fortune actual-pillar boundary validation passed');
}

main();
