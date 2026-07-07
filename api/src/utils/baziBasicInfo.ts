import type { BaziProfile } from '../models/BaziProfile';

type TimeBasis = 'standard_time' | 'true_solar_time';

interface BaziBasicInfoInput {
  profile: BaziProfile;
  chart: any;
}

interface TenGodFact {
  source: '天干' | '地支藏干';
  stem: string;
  ten_god: string;
  qi?: '主气' | '中气' | '余气';
}

interface BaziBasicPillar {
  position: 'year' | 'month' | 'day' | 'hour';
  gan_zhi: string;
  ten_gods: TenGodFact[];
  lifecycle: string;
  self_sitting: string;
  na_yin: string;
  xun_kong: string;
}

export interface BaziBasicInfoResult {
  method_version: 'bazi_basic_info_v1';
  field_labels: {
    gan_zhi: '干支';
    ten_gods: '十神';
    lifecycle: '星运';
    self_sitting: '自坐';
    na_yin: '纳音';
    xun_kong: '空亡';
  };
  birth_info: {
    birth_datetime: string;
    true_solar_datetime: string | null;
    gender: string;
    time_precision: 'known' | 'unknown_hour';
  };
  pillars: BaziBasicPillar[];
}

const FIELD_LABELS: BaziBasicInfoResult['field_labels'] = {
  gan_zhi: '干支',
  ten_gods: '十神',
  lifecycle: '星运',
  self_sitting: '自坐',
  na_yin: '纳音',
  xun_kong: '空亡',
};

const POSITIONS: BaziBasicPillar['position'][] = ['year', 'month', 'day', 'hour'];

export function buildBaziBasicInfo({ profile, chart }: BaziBasicInfoInput): BaziBasicInfoResult {
  return {
    method_version: 'bazi_basic_info_v1',
    field_labels: FIELD_LABELS,
    birth_info: {
      birth_datetime: formatBirthDateTime(profile),
      true_solar_datetime: resolveTrueSolarDateTime(profile, chart),
      gender: profile.gender || '',
      time_precision: hasKnownBirthHour(profile) ? 'known' : 'unknown_hour',
    },
    pillars: positionsForProfile(profile).map((position) => buildPillar(position, resolveChartPillar(chart, position))),
  };
}

function positionsForProfile(profile: BaziProfile): BaziBasicPillar['position'][] {
  return hasKnownBirthHour(profile) ? POSITIONS : ['year', 'month', 'day'];
}

function resolveChartPillar(chart: any, position: BaziBasicPillar['position']): any {
  if (position === 'hour') return chart?.hour || chart?.time || {};
  return chart?.[position] || {};
}

function buildPillar(position: BaziBasicPillar['position'], pillar: any): BaziBasicPillar {
  return {
    position,
    gan_zhi: pillar.ganZhi || pillar.gan_zhi || `${pillar.stem || ''}${pillar.branch || ''}`,
    ten_gods: buildTenGods(pillar),
    lifecycle: pillar.lifecycle || '',
    self_sitting: pillar.selfSitting || pillar.self_sitting || '',
    na_yin: pillar.naYin || pillar.na_yin || '',
    xun_kong: pillar.voidInfo || pillar.xunKong || pillar.xun_kong || '',
  };
}

function buildTenGods(pillar: any): TenGodFact[] {
  const facts: TenGodFact[] = [];
  const stem = pillar.stem || '';
  const stemTenGod = pillar.tenGod || pillar.ten_god || '';

  if (stem || stemTenGod) {
    facts.push({
      source: '天干',
      stem,
      ten_god: stemTenGod,
    });
  }

  const hiddenStems = pillar.hiddenStems || pillar.hidden_stems || [];
  hiddenStems.forEach((hidden: any, index: number) => {
    facts.push({
      source: '地支藏干',
      qi: hidden.qi || qiLabel(index, hiddenStems.length),
      stem: hidden.stem || '',
      ten_god: hidden.tenGod || hidden.ten_god || '',
    });
  });

  return facts;
}

function qiLabel(index: number, total: number): TenGodFact['qi'] {
  if (index === 0) return '主气';
  if (total >= 3 && index === 1) return '中气';
  return '余气';
}

function resolveTrueSolarDateTime(profile: BaziProfile, chart: any): string | null {
  const timeBasis = resolveTimeBasis(profile, chart);
  if (timeBasis !== 'true_solar_time') return null;

  return profile.true_solar_time
    || formatNormalizedDateTime(chart?.calculationInfo?.trueSolarTime?.corrected)
    || null;
}

function resolveTimeBasis(profile: BaziProfile, chart: any): TimeBasis {
  return profile.time_basis
    || chart?.calculationInfo?.trueSolarTime?.timeBasis
    || 'standard_time';
}

function formatBirthDateTime(profile: BaziProfile): string {
  const date = `${profile.birth_year}-${pad2(profile.birth_month)}-${pad2(profile.birth_day)}`;
  if (!hasKnownBirthHour(profile)) return date;
  return `${date} ${pad2(profile.birth_hour)}:${pad2(profile.birth_minute ?? 0)}`;
}

function hasKnownBirthHour(profile: BaziProfile): profile is BaziProfile & { birth_hour: number } {
  return profile.birth_hour !== null && profile.birth_hour !== undefined;
}

function formatNormalizedDateTime(time: any): string | null {
  if (!time) return null;
  return `${time.year}-${pad2(time.month)}-${pad2(time.day)} ${pad2(time.hour)}:${pad2(time.minute)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
