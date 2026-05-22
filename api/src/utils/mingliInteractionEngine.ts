import {
  AnnualLuckData,
  BRANCH_CLASHES,
  BRANCH_HARMS,
  BRANCH_PUNISHMENTS,
  BRANCH_SIX_COMBINATIONS,
  BRANCH_THREE_HARMONIES,
  BRANCH_THREE_MEETINGS,
  FullChartResult,
  GAN_WUXING,
  MajorCycleData,
  MonthlyLuckData,
  PillarData,
  STEM_COMBINATIONS,
  WUXING_CONTROLS,
  WuxingElement,
  ZHI_HIDDEN_STEMS,
  ZHI_WUXING,
} from './baziCalculator';

export const MINGLI_INTERACTION_RULE_VERSION = 'mingli_interactions_v1';

export type NatalPillarPosition = 'year' | 'month' | 'day' | 'hour';
export type MingliInteractionScope =
  | 'natal'
  | 'dayun_to_natal'
  | 'liunian_to_natal'
  | 'liunian_to_dayun'
  | 'liunian_to_mixed'
  | 'liuyue_to_natal'
  | 'liuyue_to_dayun'
  | 'liuyue_to_liunian'
  | 'liuyue_to_mixed'
  | 'liuri_to_natal'
  | 'liuri_to_dayun'
  | 'liuri_to_liunian'
  | 'liuri_to_liuyue'
  | 'liuri_to_mixed';
export type MingliParticipantType = 'natal_pillar' | 'dayun' | 'liunian' | 'liuyue' | 'liuri';

export type MingliRelationType =
  | 'stem_five_combination'
  | 'stem_control_clash'
  | 'branch_six_combination'
  | 'branch_clash'
  | 'branch_three_harmony'
  | 'branch_half_harmony'
  | 'branch_arch_harmony'
  | 'branch_seen_stem_hidden_harmony'
  | 'branch_three_meeting'
  | 'branch_arch_meeting'
  | 'branch_three_punishment'
  | 'branch_punishment'
  | 'branch_self_punishment'
  | 'branch_piercing'
  | 'branch_break'
  | 'branch_hidden_combination'
  | 'branch_hidden_meeting'
  | 'branch_same';

export interface MingliParticipant {
  type: MingliParticipantType;
  pillar?: NatalPillarPosition;
  label: string;
  stem?: string;
  branch?: string;
  ganZhi?: string;
  tenGods?: string[];
}

export interface MingliInteraction {
  id: string;
  scope: MingliInteractionScope;
  relation: MingliRelationType;
  relationName: string;
  factLabel: string;
  shortLabel: string;
  displayGroup: 'heavenly_stem_luck' | 'earthly_branch_luck' | 'heavenly_stem_natal' | 'earthly_branch_natal';
  aliases: string[];
  participants: MingliParticipant[];
  source?: MingliParticipant;
  targets: MingliParticipant[];
  transformElement?: WuxingElement;
  centerBranch?: string;
  activatedPalaces: NatalPillarPosition[];
  domainCandidates: string[];
  intensity: number;
  timeHorizon: 'long_term' | 'ten_years' | 'year' | 'month' | 'day';
  evidence: string;
  adjacent: boolean;
  fullMatch: boolean;
  missingBranch?: string;
  seenStem?: string;
  comparedAgainst: 'natal' | 'timing' | 'natal_and_timing';
  ruleVersion: typeof MINGLI_INTERACTION_RULE_VERSION;
}

export interface TimingInteractionContext {
  dayun?: Partial<MajorCycleData> | null;
  liunian?: Partial<AnnualLuckData> | null;
  liuyue?: Partial<MonthlyLuckData> | null;
  liuri?: {
    date?: string;
    stem?: string;
    branch?: string;
    ganZhi?: string;
    tenGodTop?: string;
    tenGodBottom?: string;
  } | null;
}

interface BranchGroupRule {
  branches: [string, string, string];
  relation: MingliRelationType;
  relationName: string;
  aliases: string[];
  transformElement?: WuxingElement;
  centerBranch?: string;
  baseIntensity: number;
}

interface DerivedBranchRule {
  branches: [string, string];
  relation: MingliRelationType;
  relationName: string;
  aliases: string[];
  transformElement?: WuxingElement;
  centerBranch?: string;
  missingBranch?: string;
  baseIntensity: number;
}

interface SeenStemHiddenHarmonyRule extends DerivedBranchRule {
  seenStem: string;
}

interface PairRule {
  relation: MingliRelationType;
  relationName: string;
  aliases: string[];
  pair: [string, string];
  transformElement?: WuxingElement;
  baseIntensity: number;
}

export interface MingliFactPanel {
  heavenlyStemLuck: string[];
  earthlyBranchLuck: string[];
  heavenlyStemNatal: string[];
  earthlyBranchNatal: string[];
}

const BRANCH_BREAKS: Array<[string, string]> = [
  ['子', '酉'],
  ['卯', '午'],
  ['辰', '丑'],
  ['寅', '亥'],
  ['巳', '申'],
  ['未', '戌'],
];

const BRANCH_SELF_PUNISHMENTS = ['辰', '午', '酉', '亥'];

const BRANCH_HIDDEN_COMBINATIONS: Array<[string, string]> = [
  ['卯', '申'],
  ['巳', '酉'],
  ['午', '亥'],
  ['子', '巳'],
  ['寅', '午'],
];

const BRANCH_HIDDEN_MEETINGS: Array<[string, string]> = [
  ['子', '巳'],
  ['午', '亥'],
  ['卯', '申'],
  ['未', '辰'],
  ['辰', '丑'],
  ['酉', '寅'],
];

const STEM_CONTROL_CLASHES: Array<[string, string]> = [
  ['甲', '庚'],
  ['甲', '戊'],
  ['丙', '庚'],
  ['丙', '壬'],
  ['戊', '壬'],
  ['乙', '辛'],
  ['乙', '己'],
  ['丁', '癸'],
  ['丁', '辛'],
  ['己', '癸'],
];

const NATAL_PILLARS: Array<{ key: 'year' | 'month' | 'day' | 'time'; position: NatalPillarPosition; label: string }> = [
  { key: 'year', position: 'year', label: '年柱' },
  { key: 'month', position: 'month', label: '月柱' },
  { key: 'day', position: 'day', label: '日柱' },
  { key: 'time', position: 'hour', label: '时柱' },
];

const PILLAR_ORDER: Record<NatalPillarPosition, number> = {
  year: 0,
  month: 1,
  day: 2,
  hour: 3,
};

const PALACE_DOMAIN_MAP: Record<NatalPillarPosition, string[]> = {
  year: ['family_origin', 'elders', 'early_context'],
  month: ['career', 'social_role', 'parents'],
  day: ['relationship', 'inner_state', 'partnership'],
  hour: ['future', 'output', 'children', 'later_life'],
};

const pairRules: PairRule[] = [
  ...STEM_COMBINATIONS.map((rule) => ({
    relation: 'stem_five_combination' as const,
    relationName: '天干五合',
    aliases: ['五合'],
    pair: rule.stems,
    transformElement: rule.element,
    baseIntensity: 0.66,
  })),
  ...STEM_CONTROL_CLASHES.map((pair) => ({
    relation: 'stem_control_clash' as const,
    relationName: '天干相克冲',
    aliases: ['天干克', '天干冲'],
    pair,
    baseIntensity: 0.58,
  })),
  ...BRANCH_SIX_COMBINATIONS.map((rule) => ({
    relation: 'branch_six_combination' as const,
    relationName: '地支六合',
    aliases: ['六合'],
    pair: rule.branches,
    transformElement: rule.element,
    baseIntensity: 0.68,
  })),
  ...BRANCH_CLASHES.map((pair) => ({
    relation: 'branch_clash' as const,
    relationName: '地支六冲',
    aliases: ['六冲'],
    pair,
    baseIntensity: 0.78,
  })),
  ...BRANCH_HARMS.map((pair) => ({
    relation: 'branch_piercing' as const,
    relationName: '地支六穿',
    aliases: ['六穿', '六害'],
    pair,
    baseIntensity: 0.62,
  })),
  ...BRANCH_BREAKS.map((pair) => ({
    relation: 'branch_break' as const,
    relationName: '地支相破',
    aliases: ['相破'],
    pair,
    baseIntensity: 0.56,
  })),
  ...BRANCH_HIDDEN_COMBINATIONS.map((pair) => ({
    relation: 'branch_hidden_combination' as const,
    relationName: '地支暗合',
    aliases: ['暗合'],
    pair,
    baseIntensity: 0.46,
  })),
  ...BRANCH_HIDDEN_MEETINGS.map((pair) => ({
    relation: 'branch_hidden_meeting' as const,
    relationName: '地支暗会',
    aliases: ['暗会'],
    pair,
    baseIntensity: 0.42,
  })),
  ...BRANCH_PUNISHMENTS.map((pair) => ({
    relation: 'branch_punishment' as const,
    relationName: '地支刑',
    aliases: ['刑'],
    pair,
    baseIntensity: 0.60,
  })),
];

const branchGroupRules: BranchGroupRule[] = [
  ...BRANCH_THREE_HARMONIES.map((rule) => ({
    branches: rule.branches,
    relation: 'branch_three_harmony' as const,
    relationName: '地支三合',
    aliases: ['三合'],
    transformElement: rule.element,
    centerBranch: rule.center,
    baseIntensity: 0.84,
  })),
  ...BRANCH_THREE_MEETINGS.map((rule) => ({
    branches: rule.branches,
    relation: 'branch_three_meeting' as const,
    relationName: '地支三会',
    aliases: ['三会'],
    transformElement: rule.element,
    baseIntensity: 0.80,
  })),
  {
    branches: ['丑', '未', '戌'],
    relation: 'branch_three_punishment',
    relationName: '地支三刑',
    aliases: ['三刑'],
    baseIntensity: 0.76,
  },
  {
    branches: ['寅', '巳', '申'],
    relation: 'branch_three_punishment',
    relationName: '地支三刑',
    aliases: ['三刑'],
    baseIntensity: 0.76,
  },
];

const derivedBranchRules: DerivedBranchRule[] = buildDerivedBranchRules();

export function buildMingliFactPanel(interactions: MingliInteraction[]): MingliFactPanel {
  const suppressKeys = panelSuppressionKeys(interactions);
  return interactions.reduce<MingliFactPanel>((panel, item) => {
    if (item.relation === 'branch_same') return panel;
    if (suppressKeys.has(panelInteractionKey(item))) return panel;
    const target =
      item.displayGroup === 'heavenly_stem_luck' ? panel.heavenlyStemLuck :
      item.displayGroup === 'earthly_branch_luck' ? panel.earthlyBranchLuck :
      item.displayGroup === 'heavenly_stem_natal' ? panel.heavenlyStemNatal :
      panel.earthlyBranchNatal;
    if (!target.includes(item.shortLabel)) target.push(item.shortLabel);
    return panel;
  }, {
    heavenlyStemLuck: [],
    earthlyBranchLuck: [],
    heavenlyStemNatal: [],
    earthlyBranchNatal: [],
  });
}

export function buildNatalMingliInteractions(chart: Partial<FullChartResult>): MingliInteraction[] {
  const participants = getNatalParticipants(chart);
  const interactions: MingliInteraction[] = [];
  const seen = new Set<string>();

  appendPairInteractions(interactions, seen, 'natal', participants, participants, undefined);
  appendNatalGroupInteractions(interactions, seen, participants);
  appendNatalSelfPunishments(interactions, seen, participants);
  appendNatalSameBranchInteractions(interactions, seen, participants);
  appendDerivedBranchInteractions(interactions, seen, 'natal', participants, participants, undefined);
  appendSeenStemHiddenHarmonyInteractions(interactions, seen, 'natal', participants, participants, participants, undefined);

  return sortInteractions(interactions);
}

export function buildTimingMingliInteractions(
  chart: Partial<FullChartResult>,
  context: TimingInteractionContext,
): MingliInteraction[] {
  const natalParticipants = getNatalParticipants(chart);
  const interactions: MingliInteraction[] = [];
  const seen = new Set<string>();

  const layers = [
    timingParticipant('dayun', context.dayun),
    timingParticipant('liunian', context.liunian),
    timingParticipant('liuyue', context.liuyue),
    timingParticipant('liuri', context.liuri),
  ].filter((item): item is MingliParticipant => Boolean(item));

  layers.forEach((source, index) => {
    const priorParticipants = [...natalParticipants, ...layers.slice(0, index)];
    appendLayeredPairInteractions(interactions, seen, source, priorParticipants);
    appendLayeredGroupCompletions(interactions, seen, source, priorParticipants);
    appendLayeredSelfPunishments(interactions, seen, source, priorParticipants);
    appendLayeredSameBranchInteractions(interactions, seen, source, priorParticipants);
    appendLayeredDerivedBranchInteractions(interactions, seen, source, priorParticipants);
    appendLayeredSeenStemHiddenHarmonyInteractions(interactions, seen, source, priorParticipants);
  });

  return sortInteractions(interactions);
}

function getNatalParticipants(chart: Partial<FullChartResult>): MingliParticipant[] {
  return NATAL_PILLARS
    .map<MingliParticipant | null>(({ key, position, label }) => {
      const pillar = chart[key] as PillarData | undefined;
      if (!pillar?.stem && !pillar?.branch) return null;
      return {
        type: 'natal_pillar' as const,
        pillar: position,
        label,
        stem: pillar?.stem || '',
        branch: pillar?.branch || '',
        ganZhi: pillar?.ganZhi || `${pillar?.stem || ''}${pillar?.branch || ''}`,
        tenGods: compact([pillar?.tenGod, ...(pillar?.hiddenStems || []).map(item => item.tenGod)]),
      };
    })
    .filter((item): item is MingliParticipant => Boolean(item));
}

function timingParticipant(
  type: Exclude<MingliParticipantType, 'natal_pillar'>,
  item?: Partial<MajorCycleData | AnnualLuckData | MonthlyLuckData> | null,
): MingliParticipant | null {
  if (!item?.stem && !item?.branch && !item?.ganZhi) return null;
  const labelMap: Record<Exclude<MingliParticipantType, 'natal_pillar'>, string> = {
    dayun: '大运',
    liunian: '流年',
    liuyue: '流月',
    liuri: '流日',
  };
  const tenGods = compact([
    (item as Partial<MajorCycleData>).tenGod,
    (item as Partial<AnnualLuckData>).tenGodTop,
    (item as Partial<AnnualLuckData>).tenGodBottom,
    (item as Partial<MonthlyLuckData>).tenGod,
    (item as Partial<MonthlyLuckData>).tenGodBottom,
    (item as { tenGodTop?: string }).tenGodTop,
    (item as { tenGodBottom?: string }).tenGodBottom,
  ]);
  return {
    type,
    label: labelMap[type],
    stem: item.stem || item.ganZhi?.[0] || '',
    branch: item.branch || item.ganZhi?.[1] || '',
    ganZhi: item.ganZhi || `${item.stem || ''}${item.branch || ''}`,
    tenGods,
  };
}

function appendPairInteractions(
  output: MingliInteraction[],
  seen: Set<string>,
  scope: MingliInteractionScope,
  leftParticipants: MingliParticipant[],
  rightParticipants: MingliParticipant[],
  source?: MingliParticipant,
): void {
  leftParticipants.forEach((left, leftIndex) => {
    rightParticipants.forEach((right, rightIndex) => {
      if (scope === 'natal' && rightIndex <= leftIndex) return;
      if (participantKey(left) === participantKey(right)) return;

      pairRules.forEach((rule) => {
        const leftValue = isStemRule(rule.relation) ? left.stem : left.branch;
        const rightValue = isStemRule(rule.relation) ? right.stem : right.branch;
        if (!leftValue || !rightValue || !matchesPair(rule.pair, leftValue, rightValue)) return;
        pushInteraction(output, seen, buildPairInteraction(scope, rule, left, right, source));
      });
    });
  });
}

function appendLayeredPairInteractions(
  output: MingliInteraction[],
  seen: Set<string>,
  source: MingliParticipant,
  priorParticipants: MingliParticipant[],
): void {
  const natalTargets = priorParticipants.filter(item => item.type === 'natal_pillar');
  if (natalTargets.length) {
    appendPairInteractions(output, seen, scopeForTargets(source, natalTargets), [source], natalTargets, source);
  }

  priorParticipants
    .filter(item => item.type !== 'natal_pillar')
    .forEach((target) => {
      appendPairInteractions(output, seen, scopeForTargets(source, [target]), [source], [target], source);
    });
}

function appendDerivedBranchInteractions(
  output: MingliInteraction[],
  seen: Set<string>,
  scope: MingliInteractionScope,
  leftParticipants: MingliParticipant[],
  rightParticipants: MingliParticipant[],
  source?: MingliParticipant,
): void {
  leftParticipants.forEach((left, leftIndex) => {
    rightParticipants.forEach((right, rightIndex) => {
      if (scope === 'natal' && rightIndex <= leftIndex) return;
      if (participantKey(left) === participantKey(right)) return;
      if (!left.branch || !right.branch) return;

      derivedBranchRules.forEach((rule) => {
        if (!matchesPair(rule.branches, left.branch || '', right.branch || '')) return;
        pushInteraction(output, seen, buildDerivedBranchInteraction(scope, rule, left, right, source));
      });
    });
  });
}

function appendLayeredDerivedBranchInteractions(
  output: MingliInteraction[],
  seen: Set<string>,
  source: MingliParticipant,
  priorParticipants: MingliParticipant[],
): void {
  const natalTargets = priorParticipants.filter(item => item.type === 'natal_pillar');
  if (natalTargets.length) {
    appendDerivedBranchInteractions(output, seen, scopeForTargets(source, natalTargets), [source], natalTargets, source);
  }

  priorParticipants
    .filter(item => item.type !== 'natal_pillar')
    .forEach((target) => {
      appendDerivedBranchInteractions(output, seen, scopeForTargets(source, [target]), [source], [target], source);
    });
}

function appendSeenStemHiddenHarmonyInteractions(
  output: MingliInteraction[],
  seen: Set<string>,
  scope: MingliInteractionScope,
  leftParticipants: MingliParticipant[],
  rightParticipants: MingliParticipant[],
  visibleStemParticipants: MingliParticipant[],
  source?: MingliParticipant,
): void {
  leftParticipants.forEach((left, leftIndex) => {
    rightParticipants.forEach((right, rightIndex) => {
      if (scope === 'natal' && rightIndex <= leftIndex) return;
      if (participantKey(left) === participantKey(right)) return;
      if (!left.branch || !right.branch) return;

      buildSeenStemHiddenHarmonyRules(left.branch, right.branch, visibleStemParticipants).forEach((rule) => {
        const seenStemParticipant = visibleStemParticipants.find(item => item.stem === rule.seenStem);
        if (!seenStemParticipant) return;
        pushInteraction(output, seen, buildSeenStemHiddenHarmonyInteraction(scope, rule, left, right, seenStemParticipant, source));
      });
    });
  });
}

function appendLayeredSeenStemHiddenHarmonyInteractions(
  output: MingliInteraction[],
  seen: Set<string>,
  source: MingliParticipant,
  priorParticipants: MingliParticipant[],
): void {
  const visibleStemParticipants = [source, ...priorParticipants];
  const natalTargets = priorParticipants.filter(item => item.type === 'natal_pillar');
  if (natalTargets.length) {
    appendSeenStemHiddenHarmonyInteractions(output, seen, scopeForTargets(source, natalTargets), [source], natalTargets, visibleStemParticipants, source);
  }

  priorParticipants
    .filter(item => item.type !== 'natal_pillar')
    .forEach((target) => {
      appendSeenStemHiddenHarmonyInteractions(output, seen, scopeForTargets(source, [target]), [source], [target], visibleStemParticipants, source);
    });
}

function buildPairInteraction(
  scope: MingliInteractionScope,
  rule: PairRule,
  left: MingliParticipant,
  right: MingliParticipant,
  source?: MingliParticipant,
): MingliInteraction {
  const actualSource = source || left;
  const targets = source ? [right] : [left, right].filter(item => item.type === 'natal_pillar');
  const participants = source ? [actualSource, right] : [left, right];
  const palaces = activatedPalaces(participants);
  const adjacent = areAdjacentNatalPillars(left, right);
  const factLabel = pairFactLabel(rule);
  const shortLabel = pairShortLabel(rule);
  const targetsComparedAgainst = comparedAgainst(targets);
  const transformText = rule.transformElement ? `，化${rule.transformElement}` : '';
  return {
    id: '',
    scope,
    relation: rule.relation,
    relationName: rule.relationName,
    factLabel,
    shortLabel,
    displayGroup: displayGroup(rule.relation, scope === 'natal' ? targetsComparedAgainst : 'timing'),
    aliases: rule.aliases,
    participants,
    source: scope === 'natal' ? undefined : actualSource,
    targets,
    transformElement: rule.transformElement,
    activatedPalaces: palaces,
    domainCandidates: domainCandidates(palaces),
    intensity: intensity(rule.baseIntensity, palaces, adjacent),
    timeHorizon: timeHorizon(scope),
    evidence: `${participantLabel(left)}与${participantLabel(right)}形成${rule.relationName}（${factLabel}${transformText}）。`,
    adjacent,
    fullMatch: true,
    comparedAgainst: targetsComparedAgainst,
    ruleVersion: MINGLI_INTERACTION_RULE_VERSION,
  };
}

function buildDerivedBranchInteraction(
  scope: MingliInteractionScope,
  rule: DerivedBranchRule,
  left: MingliParticipant,
  right: MingliParticipant,
  source?: MingliParticipant,
): MingliInteraction {
  const actualSource = source || left;
  const targets = source ? [right] : [left, right].filter(item => item.type === 'natal_pillar');
  const participants = source ? [actualSource, right] : [left, right];
  const palaces = activatedPalaces(participants);
  const adjacent = areAdjacentNatalPillars(left, right);
  const targetsComparedAgainst = comparedAgainst(targets);
  const factLabel = derivedBranchFactLabel(rule);
  const shortLabel = derivedBranchShortLabel(rule);
  const missingText = rule.missingBranch ? `，拱${rule.missingBranch}${ZHI_WUXING[rule.missingBranch] || ''}` : '';
  const transformText = rule.transformElement ? `，${rule.relation === 'branch_half_harmony' ? '半合' : '可引'}${rule.transformElement}局` : '';
  return {
    id: '',
    scope,
    relation: rule.relation,
    relationName: rule.relationName,
    factLabel,
    shortLabel,
    displayGroup: displayGroup(rule.relation, scope === 'natal' ? targetsComparedAgainst : 'timing'),
    aliases: rule.aliases,
    participants,
    source: scope === 'natal' ? undefined : actualSource,
    targets,
    transformElement: rule.transformElement,
    centerBranch: rule.centerBranch,
    activatedPalaces: palaces,
    domainCandidates: domainCandidates(palaces),
    intensity: intensity(rule.baseIntensity, palaces, adjacent),
    timeHorizon: timeHorizon(scope),
    evidence: `${participantLabel(left)}与${participantLabel(right)}形成${rule.relationName}（${factLabel}${missingText}${transformText}）。`,
    adjacent,
    fullMatch: false,
    missingBranch: rule.missingBranch,
    comparedAgainst: targetsComparedAgainst,
    ruleVersion: MINGLI_INTERACTION_RULE_VERSION,
  };
}

function buildSeenStemHiddenHarmonyInteraction(
  scope: MingliInteractionScope,
  rule: SeenStemHiddenHarmonyRule,
  left: MingliParticipant,
  right: MingliParticipant,
  seenStemParticipant: MingliParticipant,
  source?: MingliParticipant,
): MingliInteraction {
  const actualSource = source || left;
  const participants = uniqueParticipants(source ? [actualSource, left, right, seenStemParticipant] : [left, right, seenStemParticipant]);
  const targets = source
    ? uniqueParticipants([left, right, seenStemParticipant].filter(item => participantKey(item) !== participantKey(actualSource)))
    : participants.filter(item => item.type === 'natal_pillar');
  const palaces = activatedPalaces(participants);
  const adjacent = areAdjacentNatalPillars(left, right);
  const targetsComparedAgainst = comparedAgainst(targets);
  const factLabel = derivedBranchFactLabel(rule);
  const shortLabel = derivedBranchShortLabel(rule);
  return {
    id: '',
    scope,
    relation: rule.relation,
    relationName: rule.relationName,
    factLabel,
    shortLabel,
    displayGroup: displayGroup(rule.relation, scope === 'natal' ? targetsComparedAgainst : 'timing'),
    aliases: rule.aliases,
    participants,
    source: scope === 'natal' ? undefined : actualSource,
    targets,
    transformElement: rule.transformElement,
    centerBranch: rule.centerBranch,
    activatedPalaces: palaces,
    domainCandidates: domainCandidates(palaces),
    intensity: intensity(rule.baseIntensity, palaces, adjacent),
    timeHorizon: timeHorizon(scope),
    evidence: `${participantLabel(left)}与${participantLabel(right)}见${seenStemParticipant.label}${rule.seenStem}形成${rule.relationName}（${factLabel}）。`,
    adjacent,
    fullMatch: false,
    missingBranch: rule.missingBranch,
    seenStem: rule.seenStem,
    comparedAgainst: targetsComparedAgainst,
    ruleVersion: MINGLI_INTERACTION_RULE_VERSION,
  };
}

function appendNatalGroupInteractions(
  output: MingliInteraction[],
  seen: Set<string>,
  natalParticipants: MingliParticipant[],
): void {
  branchGroupRules.forEach((rule) => {
    const matched = matchRuleBranches(rule.branches, natalParticipants);
    if (!matched) return;
    pushInteraction(output, seen, buildGroupInteraction('natal', rule, matched));
  });
}

function appendLayeredGroupCompletions(
  output: MingliInteraction[],
  seen: Set<string>,
  source: MingliParticipant,
  priorParticipants: MingliParticipant[],
): void {
  if (!source.branch) return;
  branchGroupRules.forEach((rule) => {
    if (!rule.branches.includes(source.branch || '')) return;
    const requiredNatalBranches = rule.branches.filter(branch => branch !== source.branch);
    const matchGroups = matchRuleBranchCombinations(requiredNatalBranches, priorParticipants);
    matchGroups.forEach((matches) => {
      pushInteraction(output, seen, buildGroupInteraction(scopeForTargets(source, matches), rule, [source, ...matches], source));
    });
  });
}

function appendNatalSelfPunishments(
  output: MingliInteraction[],
  seen: Set<string>,
  natalParticipants: MingliParticipant[],
): void {
  BRANCH_SELF_PUNISHMENTS.forEach((branch) => {
    const matched = natalParticipants.filter(item => item.branch === branch);
    if (matched.length < 2) return;
    pushInteraction(output, seen, buildFixedBranchInteraction('natal', 'branch_self_punishment', '地支自刑', ['自刑'], matched));
  });
}

function appendLayeredSelfPunishments(
  output: MingliInteraction[],
  seen: Set<string>,
  source: MingliParticipant,
  priorParticipants: MingliParticipant[],
): void {
  if (!source.branch || !BRANCH_SELF_PUNISHMENTS.includes(source.branch)) return;
  const matched = priorParticipants.filter(item => item.branch === source.branch);
  if (!matched.length) return;
  pushInteraction(output, seen, buildFixedBranchInteraction(scopeForTargets(source, matched), 'branch_self_punishment', '地支自刑', ['自刑'], [source, ...matched], source));
}

function appendNatalSameBranchInteractions(
  output: MingliInteraction[],
  seen: Set<string>,
  natalParticipants: MingliParticipant[],
): void {
  const branchGroups = groupByBranch(natalParticipants);
  Object.values(branchGroups).forEach((matched) => {
    if (matched.length < 2) return;
    pushInteraction(output, seen, buildFixedBranchInteraction('natal', 'branch_same', '伏吟/同支', ['伏吟', '同支'], matched));
  });
}

function appendLayeredSameBranchInteractions(
  output: MingliInteraction[],
  seen: Set<string>,
  source: MingliParticipant,
  priorParticipants: MingliParticipant[],
): void {
  if (!source.branch) return;
  const matched = priorParticipants.filter(item => item.branch === source.branch);
  if (!matched.length) return;
  pushInteraction(output, seen, buildFixedBranchInteraction(scopeForTargets(source, matched), 'branch_same', '伏吟/同支', ['伏吟', '同支'], [source, ...matched], source));
}

function buildGroupInteraction(
  scope: MingliInteractionScope,
  rule: BranchGroupRule,
  participants: MingliParticipant[],
  source?: MingliParticipant,
): MingliInteraction {
  const palaces = activatedPalaces(participants);
  const targets = source ? participants.filter(item => participantKey(item) !== participantKey(source)) : participants;
  const factLabel = groupFactLabel(rule);
  const targetsComparedAgainst = comparedAgainst(targets);
  const centerText = rule.centerBranch ? `，中神为${rule.centerBranch}${ZHI_WUXING[rule.centerBranch] || ''}` : '';
  const transformText = rule.transformElement ? `，成${rule.transformElement}局` : '';
  return {
    id: '',
    scope,
    relation: rule.relation,
    relationName: rule.relationName,
    factLabel,
    shortLabel: groupShortLabel(rule),
    displayGroup: displayGroup(rule.relation, scope === 'natal' ? targetsComparedAgainst : 'timing'),
    aliases: rule.aliases,
    participants,
    source: scope === 'natal' ? undefined : source,
    targets,
    transformElement: rule.transformElement,
    centerBranch: rule.centerBranch,
    activatedPalaces: palaces,
    domainCandidates: domainCandidates(palaces),
    intensity: intensity(rule.baseIntensity, palaces, false),
    timeHorizon: timeHorizon(scope),
    evidence: `${participants.map(participantLabel).join('、')}形成${rule.relationName}（${factLabel}${centerText}${transformText}）。`,
    adjacent: false,
    fullMatch: true,
    comparedAgainst: targetsComparedAgainst,
    ruleVersion: MINGLI_INTERACTION_RULE_VERSION,
  };
}

function buildFixedBranchInteraction(
  scope: MingliInteractionScope,
  relation: MingliRelationType,
  relationName: string,
  aliases: string[],
  participants: MingliParticipant[],
  source?: MingliParticipant,
): MingliInteraction {
  const palaces = activatedPalaces(participants);
  const targets = source ? participants.filter(item => participantKey(item) !== participantKey(source)) : participants;
  const adjacent = participants.some((left, index) =>
    participants.slice(index + 1).some(right => areAdjacentNatalPillars(left, right)));
  const factLabel = fixedBranchFactLabel(relation, relationName, participants);
  const targetsComparedAgainst = comparedAgainst(targets);
  return {
    id: '',
    scope,
    relation,
    relationName,
    factLabel,
    shortLabel: fixedBranchShortLabel(relation, participants),
    displayGroup: displayGroup(relation, scope === 'natal' ? targetsComparedAgainst : 'timing'),
    aliases,
    participants,
    source: scope === 'natal' ? undefined : source,
    targets,
    activatedPalaces: palaces,
    domainCandidates: domainCandidates(palaces),
    intensity: intensity(relation === 'branch_same' ? 0.52 : 0.62, palaces, adjacent),
    timeHorizon: timeHorizon(scope),
    evidence: `${participants.map(participantLabel).join('、')}形成${relationName}（${factLabel}）。`,
    adjacent,
    fullMatch: true,
    comparedAgainst: targetsComparedAgainst,
    ruleVersion: MINGLI_INTERACTION_RULE_VERSION,
  };
}

function pushInteraction(output: MingliInteraction[], seen: Set<string>, interaction: MingliInteraction): void {
  const id = interactionId(interaction);
  if (seen.has(id)) return;
  seen.add(id);
  output.push({ ...interaction, id });
}

function interactionId(interaction: MingliInteraction): string {
  const participantPart = interaction.participants
    .map(participantKey)
    .sort()
    .join('__');
  return `${interaction.scope}:${interaction.relation}:${participantPart}`;
}

function participantKey(participant: MingliParticipant): string {
  return [
    participant.type,
    participant.pillar || '',
    participant.ganZhi || `${participant.stem || ''}${participant.branch || ''}`,
  ].join(':');
}

function uniqueParticipants(participants: MingliParticipant[]): MingliParticipant[] {
  const seen = new Set<string>();
  return participants.filter((participant) => {
    const key = participantKey(participant);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function participantLabel(participant: MingliParticipant): string {
  const ganZhi = participant.ganZhi || `${participant.stem || ''}${participant.branch || ''}`;
  return `${participant.label}${ganZhi}`;
}

function pairFactLabel(rule: PairRule): string {
  const [left, right] = rule.pair;
  const label = isStemRule(rule.relation)
    ? `${left}${GAN_WUXING[left] || ''}${right}${GAN_WUXING[right] || ''}`
    : `${left}${ZHI_WUXING[left] || ''}${right}${ZHI_WUXING[right] || ''}`;

  const suffixMap: Partial<Record<MingliRelationType, string>> = {
    stem_five_combination: '相合',
    stem_control_clash: '相克冲',
    branch_six_combination: '相合',
    branch_clash: '相冲',
    branch_punishment: '相刑',
    branch_piercing: '相穿',
    branch_break: '相破',
    branch_hidden_combination: '暗合',
    branch_hidden_meeting: '暗会',
  };

  return `${label}${suffixMap[rule.relation] || rule.relationName}`;
}

function pairShortLabel(rule: PairRule): string {
  const [left, right] = rule.pair;
  if (rule.relation === 'stem_five_combination') {
    return `${left}${right}合化${rule.transformElement || ''}`;
  }
  if (rule.relation === 'stem_control_clash') {
    return stemControlShortLabel(left, right);
  }
  if (rule.relation === 'branch_six_combination') {
    return `${left}${right}合化${rule.transformElement || ''}`;
  }
  if (rule.relation === 'branch_clash') return `${left}${right}相冲`;
  if (rule.relation === 'branch_piercing') return `${left}${right}相害`;
  if (rule.relation === 'branch_break') return `${left}${right}相破`;
  if (rule.relation === 'branch_punishment') return `${left}刑${right}`;
  if (rule.relation === 'branch_hidden_combination') return `${left}${right}暗合`;
  if (rule.relation === 'branch_hidden_meeting') return `${left}${right}暗会`;
  return `${left}${right}${rule.aliases[0] || rule.relationName}`;
}

function groupFactLabel(rule: BranchGroupRule): string {
  const label = rule.branches.map(branch => `${branch}${ZHI_WUXING[branch] || ''}`).join('');
  if (rule.relation === 'branch_three_harmony') return `${label}三合`;
  if (rule.relation === 'branch_three_meeting') return `${label}三会`;
  if (rule.relation === 'branch_three_punishment') return `${label}三刑`;
  return `${label}${rule.relationName}`;
}

function groupShortLabel(rule: BranchGroupRule): string {
  const branches = rule.branches.join('');
  if (rule.relation === 'branch_three_harmony') return `${branches}三合${rule.transformElement || ''}`;
  if (rule.relation === 'branch_three_meeting') return `${branches}会${meetingDirection(rule.transformElement)}${rule.transformElement || ''}局`;
  if (rule.relation === 'branch_three_punishment') return `${branches}三刑`;
  return `${branches}${rule.aliases[0] || rule.relationName}`;
}

function derivedBranchFactLabel(rule: DerivedBranchRule): string {
  const label = rule.branches.map(branch => `${branch}${ZHI_WUXING[branch] || ''}`).join('');
  if (rule.relation === 'branch_half_harmony') return `${label}半合${rule.transformElement || ''}局`;
  if (rule.relation === 'branch_arch_harmony') {
    return `${label}拱合${rule.missingBranch || ''}${rule.missingBranch ? ZHI_WUXING[rule.missingBranch] || '' : ''}`;
  }
  if (rule.relation === 'branch_arch_meeting') {
    return `${label}拱会${rule.missingBranch || ''}${rule.missingBranch ? ZHI_WUXING[rule.missingBranch] || '' : ''}`;
  }
  if (rule.relation === 'branch_seen_stem_hidden_harmony') return `${label}见${(rule as SeenStemHiddenHarmonyRule).seenStem}暗合${rule.transformElement || ''}局`;
  if (rule.relation === 'branch_hidden_combination') return `${label}暗合`;
  if (rule.relation === 'branch_hidden_meeting') return `${label}暗会`;
  return `${label}${rule.relationName}`;
}

function derivedBranchShortLabel(rule: DerivedBranchRule): string {
  const branches = rule.branches.join('');
  if (rule.relation === 'branch_half_harmony') return `${branches}半合${rule.transformElement || ''}局`;
  if (rule.relation === 'branch_arch_harmony') return `${branches}拱合${rule.missingBranch || ''}`;
  if (rule.relation === 'branch_arch_meeting') return `${branches}拱会${rule.missingBranch || ''}`;
  if (rule.relation === 'branch_seen_stem_hidden_harmony') return `${branches}见${(rule as SeenStemHiddenHarmonyRule).seenStem}暗合${rule.transformElement || ''}局`;
  if (rule.relation === 'branch_hidden_combination') return `${branches}暗合`;
  if (rule.relation === 'branch_hidden_meeting') return `${branches}暗会`;
  return `${branches}${rule.aliases[0] || rule.relationName}`;
}

function fixedBranchFactLabel(
  relation: MingliRelationType,
  relationName: string,
  participants: MingliParticipant[],
): string {
  const branches = Array.from(new Set(participants.map(item => item.branch).filter((branch): branch is string => Boolean(branch))));
  const label = branches.map(branch => `${branch}${ZHI_WUXING[branch] || ''}`).join('');
  if (relation === 'branch_self_punishment') return `${label}自刑`;
  if (relation === 'branch_same') return `${label}伏吟/同支`;
  return `${label}${relationName}`;
}

function fixedBranchShortLabel(relation: MingliRelationType, participants: MingliParticipant[]): string {
  const branches = Array.from(new Set(participants.map(item => item.branch).filter((branch): branch is string => Boolean(branch))));
  if (relation === 'branch_self_punishment') return `${branches[0] || ''}刑${branches[0] || ''}`;
  if (relation === 'branch_same') return `${branches.join('')}伏吟`;
  return `${branches.join('')}${relation}`;
}

function stemControlShortLabel(left: string, right: string): string {
  const leftElement = GAN_WUXING[left];
  const rightElement = GAN_WUXING[right];
  if (leftElement && rightElement && WUXING_CONTROLS[leftElement] === rightElement) return `${left}克${right}`;
  if (leftElement && rightElement && WUXING_CONTROLS[rightElement] === leftElement) return `${right}克${left}`;
  return `${left}${right}相克`;
}

function displayGroup(
  relation: MingliRelationType,
  targetsComparedAgainst: MingliInteraction['comparedAgainst'],
): MingliInteraction['displayGroup'] {
  const stem = isStemRule(relation);
  const natalOnly = targetsComparedAgainst === 'natal';
  if (stem) return natalOnly ? 'heavenly_stem_natal' : 'heavenly_stem_luck';
  return natalOnly ? 'earthly_branch_natal' : 'earthly_branch_luck';
}

function meetingDirection(element?: WuxingElement): string {
  const map: Partial<Record<WuxingElement, string>> = {
    木: '东方',
    火: '南方',
    金: '西方',
    水: '北方',
  };
  return element ? map[element] || '' : '';
}

function panelSuppressionKeys(interactions: MingliInteraction[]): Set<string> {
  const fullHarmony = interactions
    .filter(item => item.relation === 'branch_three_harmony')
    .map(item => ({
      displayGroup: item.displayGroup,
      transformElement: item.transformElement,
      branches: new Set(item.participants.map(participant => participant.branch).filter(Boolean)),
    }));
  const fullMeeting = interactions
    .filter(item => item.relation === 'branch_three_meeting')
    .map(item => ({
      displayGroup: item.displayGroup,
      transformElement: item.transformElement,
      branches: new Set(item.participants.map(participant => participant.branch).filter(Boolean)),
    }));
  const directHiddenCombinationKeys = new Set(interactions
    .filter(item => item.relation === 'branch_hidden_combination')
    .map(item => hiddenPairPanelKey(item, '暗合'))
    .filter((key): key is string => Boolean(key)));

  return interactions.reduce<Set<string>>((keys, item) => {
    if (
      (item.relation === 'branch_half_harmony' || item.relation === 'branch_arch_harmony' || item.relation === 'branch_seen_stem_hidden_harmony') &&
      fullHarmony.some(group => sameDerivedGroup(item, group))
    ) {
      keys.add(panelInteractionKey(item));
    }
    if (
      item.relation === 'branch_arch_meeting' &&
      fullMeeting.some(group => sameDerivedGroup(item, group))
    ) {
      keys.add(panelInteractionKey(item));
    }
    if (
      item.relation === 'branch_seen_stem_hidden_harmony' &&
      directHiddenCombinationKeys.has(hiddenPairPanelKey(item, '见') || '')
    ) {
      keys.add(panelInteractionKey(item));
    }
    return keys;
  }, new Set<string>());
}

function sameDerivedGroup(
  item: MingliInteraction,
  group: { displayGroup: MingliInteraction['displayGroup']; transformElement?: WuxingElement; branches: Set<string | undefined> },
): boolean {
  if (item.displayGroup !== group.displayGroup) return false;
  if (item.transformElement !== group.transformElement) return false;
  const branches = item.participants.map(participant => participant.branch).filter((branch): branch is string => Boolean(branch));
  return branches.every(branch => group.branches.has(branch));
}

function panelInteractionKey(item: MingliInteraction): string {
  return item.id || `${item.displayGroup}:${item.relation}:${item.shortLabel}:${item.participants.map(participantKey).sort().join('|')}`;
}

function hiddenPairPanelKey(item: MingliInteraction, marker: string): string | null {
  const index = item.shortLabel.indexOf(marker);
  if (index <= 0) return null;
  return `${item.displayGroup}:${item.shortLabel.slice(0, index)}`;
}

function buildDerivedBranchRules(): DerivedBranchRule[] {
  const rules: DerivedBranchRule[] = [];

  BRANCH_THREE_HARMONIES.forEach((rule) => {
    const [first, center, last] = rule.branches;
    rules.push({
      branches: [first, center],
      relation: 'branch_half_harmony',
      relationName: '地支半合',
      aliases: ['半合'],
      transformElement: rule.element,
      centerBranch: center,
      baseIntensity: 0.60,
    });
    rules.push({
      branches: [center, last],
      relation: 'branch_half_harmony',
      relationName: '地支半合',
      aliases: ['半合'],
      transformElement: rule.element,
      centerBranch: center,
      baseIntensity: 0.60,
    });
    rules.push({
      branches: [first, last],
      relation: 'branch_arch_harmony',
      relationName: '地支拱合',
      aliases: ['拱合'],
      transformElement: rule.element,
      centerBranch: center,
      missingBranch: center,
      baseIntensity: 0.50,
    });
  });

  BRANCH_THREE_MEETINGS.forEach((rule) => {
    const [first, center, last] = rule.branches;
    rules.push({
      branches: [first, last],
      relation: 'branch_arch_meeting',
      relationName: '地支拱会',
      aliases: ['拱会'],
      transformElement: rule.element,
      centerBranch: center,
      missingBranch: center,
      baseIntensity: 0.48,
    });
  });

  return rules;
}

function buildSeenStemHiddenHarmonyRules(
  leftBranch: string,
  rightBranch: string,
  visibleStemParticipants: MingliParticipant[],
): SeenStemHiddenHarmonyRule[] {
  const visibleStems = new Set(visibleStemParticipants.map(item => item.stem).filter((stem): stem is string => Boolean(stem)));
  const rules: SeenStemHiddenHarmonyRule[] = [];

  BRANCH_THREE_HARMONIES.forEach((rule) => {
    if (rule.element !== '木') return;
    if (!rule.branches.includes(leftBranch) || !rule.branches.includes(rightBranch) || leftBranch === rightBranch) return;
    const missingBranch = rule.branches.find(branch => branch !== leftBranch && branch !== rightBranch);
    if (!missingBranch) return;
    const seenStem = (ZHI_HIDDEN_STEMS[missingBranch] || []).find(stem => visibleStems.has(stem));
    if (!seenStem) return;
    rules.push({
      branches: canonicalPairForRule(rule.branches, leftBranch, rightBranch),
      relation: 'branch_seen_stem_hidden_harmony',
      relationName: '地支见干暗合局',
      aliases: ['见干暗合局'],
      transformElement: rule.element,
      centerBranch: rule.center,
      missingBranch,
      seenStem,
      baseIntensity: 0.54,
    });
  });

  return rules;
}

function canonicalPairForRule(ruleBranches: [string, string, string], leftBranch: string, rightBranch: string): [string, string] {
  return ruleBranches.filter(branch => branch === leftBranch || branch === rightBranch) as [string, string];
}

function matchesPair(pair: [string, string], left: string, right: string): boolean {
  return (pair[0] === left && pair[1] === right) || (pair[0] === right && pair[1] === left);
}

function matchRuleBranches(requiredBranches: string[], participants: MingliParticipant[]): MingliParticipant[] | null {
  const matched = requiredBranches.map(branch => participants.find(item => item.branch === branch) || null);
  if (matched.some(item => !item)) return null;
  return matched as MingliParticipant[];
}

function matchRuleBranchCombinations(requiredBranches: string[], participants: MingliParticipant[]): MingliParticipant[][] {
  if (!requiredBranches.length) return [[]];
  const candidateGroups = requiredBranches.map(branch => participants.filter(item => item.branch === branch));
  if (candidateGroups.some(group => group.length === 0)) return [];

  return candidateGroups.reduce<MingliParticipant[][]>((groups, candidates) => {
    const next: MingliParticipant[][] = [];
    groups.forEach((group) => {
      candidates.forEach((candidate) => {
        if (group.some(item => participantKey(item) === participantKey(candidate))) return;
        next.push([...group, candidate]);
      });
    });
    return next;
  }, [[]]);
}

function groupByBranch(participants: MingliParticipant[]): Record<string, MingliParticipant[]> {
  return participants.reduce<Record<string, MingliParticipant[]>>((acc, item) => {
    if (!item.branch) return acc;
    acc[item.branch] = acc[item.branch] || [];
    acc[item.branch].push(item);
    return acc;
  }, {});
}

function isStemRule(relation: MingliRelationType): boolean {
  return relation === 'stem_five_combination' || relation === 'stem_control_clash';
}

function areAdjacentNatalPillars(left: MingliParticipant, right: MingliParticipant): boolean {
  if (left.type !== 'natal_pillar' || right.type !== 'natal_pillar' || !left.pillar || !right.pillar) return false;
  return Math.abs(PILLAR_ORDER[left.pillar] - PILLAR_ORDER[right.pillar]) === 1;
}

function activatedPalaces(participants: MingliParticipant[]): NatalPillarPosition[] {
  const palaces = participants
    .filter(item => item.type === 'natal_pillar' && item.pillar)
    .map(item => item.pillar as NatalPillarPosition);
  return Array.from(new Set(palaces));
}

function domainCandidates(palaces: NatalPillarPosition[]): string[] {
  return Array.from(new Set(palaces.flatMap(palace => PALACE_DOMAIN_MAP[palace] || [])));
}

function intensity(base: number, palaces: NatalPillarPosition[], adjacent: boolean): number {
  const palaceBoost = palaces.reduce((max, palace) => {
    const value = palace === 'day' ? 0.08 : palace === 'month' ? 0.06 : palace === 'hour' ? 0.04 : 0.02;
    return Math.max(max, value);
  }, 0);
  const adjacentBoost = adjacent ? 0.03 : 0;
  return round2(Math.min(0.95, base + palaceBoost + adjacentBoost));
}

function timeHorizon(scope: MingliInteractionScope): MingliInteraction['timeHorizon'] {
  if (scope.startsWith('dayun')) return 'ten_years';
  if (scope.startsWith('liunian')) return 'year';
  if (scope.startsWith('liuyue')) return 'month';
  if (scope.startsWith('liuri')) return 'day';
  return 'long_term';
}

function scopeForTargets(source: MingliParticipant, targets: MingliParticipant[]): MingliInteractionScope {
  if (!targets.length || targets.every(item => item.type === 'natal_pillar')) {
    return `${source.type}_to_natal` as MingliInteractionScope;
  }

  const timingTargetTypes = Array.from(new Set(targets.filter(item => item.type !== 'natal_pillar').map(item => item.type)));
  const hasNatal = targets.some(item => item.type === 'natal_pillar');
  if (hasNatal || timingTargetTypes.length !== 1) {
    return `${source.type}_to_mixed` as MingliInteractionScope;
  }

  return `${source.type}_to_${timingTargetTypes[0]}` as MingliInteractionScope;
}

function comparedAgainst(targets: MingliParticipant[]): MingliInteraction['comparedAgainst'] {
  const hasNatal = targets.some(item => item.type === 'natal_pillar');
  const hasTiming = targets.some(item => item.type !== 'natal_pillar');
  if (hasNatal && hasTiming) return 'natal_and_timing';
  if (hasTiming) return 'timing';
  return 'natal';
}

function sortInteractions(interactions: MingliInteraction[]): MingliInteraction[] {
  return [...interactions].sort((left, right) => {
    if (right.intensity !== left.intensity) return right.intensity - left.intensity;
    return left.id.localeCompare(right.id);
  });
}

function compact(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isStemControlClash(leftStem: string, rightStem: string): boolean {
  return STEM_CONTROL_CLASHES.some(pair => matchesPair(pair, leftStem, rightStem));
}

export function isElementControlPair(leftStem: string, rightStem: string): boolean {
  const leftElement = GAN_WUXING[leftStem];
  const rightElement = GAN_WUXING[rightStem];
  if (!leftElement || !rightElement) return false;
  return WUXING_CONTROLS[leftElement] === rightElement || WUXING_CONTROLS[rightElement] === leftElement;
}
