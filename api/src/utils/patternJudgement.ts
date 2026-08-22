import type { HiddenStemData, PillarData, WeightedWuxingAnalysis } from './baziCalculator';

export type PatternCandidateFamily = 'regular' | 'mixed_qi' | 'lu_ren' | 'auxiliary';
export type PatternCandidateStatus = 'candidate';
export type PatternCandidateConfidence = 'high' | 'medium' | 'low';
export type PatternCandidateEntry = 'month_command' | 'mixed_qi' | 'jian_lu' | 'yue_jie' | 'yang_ren' | 'visible_stem_auxiliary';
export type LuRenUsableGodSource = 'visible_stem' | 'three_harmony' | 'three_meeting';

export interface PatternStemEvidence {
  position: 'year' | 'month' | 'time';
  stem: string;
  tenGod: string;
  weight: 'strong' | 'medium' | 'late';
}

export interface PatternRootEvidence {
  position: 'year' | 'month' | 'day' | 'time';
  branch: string;
  stem: string;
  qi: 'main' | 'middle' | 'residual';
  weight: 'strong' | 'medium' | 'weak';
}

export interface PatternCandidate {
  id: string;
  name: string;
  family: PatternCandidateFamily;
  status: PatternCandidateStatus;
  confidence: PatternCandidateConfidence;
  entry: PatternCandidateEntry;
  tenGod: string;
  stem?: string;
  element?: string;
  monthBranch: string;
  evidence: string[];
  penetration: PatternStemEvidence[];
  roots: PatternRootEvidence[];
  supportSignals: string[];
  downgradeSignals: string[];
  notes: string[];
}

export interface PatternCandidatesResult {
  methodVersion: 'pattern_candidates_v1';
  regular: PatternCandidate[];
  mixedQi: PatternCandidate[];
  auxiliary: PatternCandidate[];
  usableGods: LuRenUsableGodCandidate[];
  notes: string[];
}

export interface LuRenUsableGodCandidate {
  id: string;
  tenGod: string;
  stem?: string;
  element?: string;
  source: LuRenUsableGodSource;
  position?: 'year' | 'month' | 'time';
  branches?: string[];
  label?: string;
  confidence: PatternCandidateConfidence;
  evidence: string[];
  notes: string[];
}

interface PatternCandidateChartInput {
  dayMaster: string;
  year: PillarData;
  month: PillarData;
  day: PillarData;
  /** Missing birth hour is represented by omission, never a synthetic noon pillar. */
  time?: PillarData;
  weightedWuxing?: WeightedWuxingAnalysis;
}

type PillarPosition = 'year' | 'month' | 'day' | 'time';

const PILLAR_LABELS: Record<PillarPosition, string> = {
  year: '年柱',
  month: '月柱',
  day: '日柱',
  time: '时柱',
};

const QI_LABELS: Record<number, PatternRootEvidence['qi']> = {
  0: 'main',
  1: 'middle',
  2: 'residual',
};

const QI_TEXT: Record<PatternRootEvidence['qi'], string> = {
  main: '主气',
  middle: '中气',
  residual: '余气',
};

const REGULAR_PATTERN_BY_TEN_GOD: Record<string, { id: string; name: string }> = {
  正官: { id: 'zheng_guan_ge_candidate', name: '正官格候选' },
  七杀: { id: 'qi_sha_ge_candidate', name: '七杀格候选' },
  正财: { id: 'zheng_cai_ge_candidate', name: '正财格候选' },
  偏财: { id: 'pian_cai_ge_candidate', name: '偏财格候选' },
  正印: { id: 'zheng_yin_ge_candidate', name: '正印格候选' },
  偏印: { id: 'pian_yin_ge_candidate', name: '偏印格候选' },
  食神: { id: 'shi_shen_ge_candidate', name: '食神格候选' },
  伤官: { id: 'shang_guan_ge_candidate', name: '伤官格候选' },
};

const MIXED_QI_PATTERN_BY_TEN_GOD: Record<string, { idPrefix: string; name: string }> = {
  正官: { idPrefix: 'za_qi_zheng_guan', name: '杂气正官格候选' },
  七杀: { idPrefix: 'za_qi_qi_sha', name: '杂气七杀格候选' },
  正财: { idPrefix: 'za_qi_zheng_cai', name: '杂气正财格候选' },
  偏财: { idPrefix: 'za_qi_pian_cai', name: '杂气偏财格候选' },
  正印: { idPrefix: 'za_qi_zheng_yin', name: '杂气正印格候选' },
  偏印: { idPrefix: 'za_qi_pian_yin', name: '杂气偏印格候选' },
  食神: { idPrefix: 'za_qi_shi_shen', name: '杂气食神格候选' },
  伤官: { idPrefix: 'za_qi_shang_guan', name: '杂气伤官格候选' },
};

const JIAN_LU_MONTH_BRANCH: Record<string, string> = {
  甲: '寅',
  乙: '卯',
  丙: '巳',
  丁: '午',
  戊: '巳',
  己: '午',
  庚: '申',
  辛: '酉',
  壬: '亥',
  癸: '子',
};

const YANG_REN_MONTH_BRANCH: Record<string, string> = {
  甲: '卯',
  丙: '午',
  戊: '午',
  庚: '酉',
  壬: '子',
};

const MIXED_QI_MONTH_BRANCHES = new Set(['辰', '戌', '丑', '未']);
const BI_JIE_TEN_GODS = new Set(['比肩', '劫财']);
const USEFUL_TEN_GODS_FOR_LU_REN = new Set(['正财', '偏财', '正官', '七杀', '食神', '伤官']);
const STEM_ID: Record<string, string> = {
  甲: 'jia',
  乙: 'yi',
  丙: 'bing',
  丁: 'ding',
  戊: 'wu',
  己: 'ji',
  庚: 'geng',
  辛: 'xin',
  壬: 'ren',
  癸: 'gui',
};

const GAN_WUXING: Record<string, string> = {
  甲: '木',
  乙: '木',
  丙: '火',
  丁: '火',
  戊: '土',
  己: '土',
  庚: '金',
  辛: '金',
  壬: '水',
  癸: '水',
};

const WUXING_GENERATES: Record<string, string> = {
  木: '火',
  火: '土',
  土: '金',
  金: '水',
  水: '木',
};

const WUXING_CONTROLS: Record<string, string> = {
  木: '土',
  土: '水',
  水: '火',
  火: '金',
  金: '木',
};

interface BranchCombinationRule {
  id: string;
  branches: string[];
  element: string;
  label: string;
}

const THREE_HARMONIES: BranchCombinationRule[] = [
  { id: 'shen_zi_chen', branches: ['申', '子', '辰'], element: '水', label: '申子辰三合水局' },
  { id: 'hai_mao_wei', branches: ['亥', '卯', '未'], element: '木', label: '亥卯未三合木局' },
  { id: 'yin_wu_xu', branches: ['寅', '午', '戌'], element: '火', label: '寅午戌三合火局' },
  { id: 'si_you_chou', branches: ['巳', '酉', '丑'], element: '金', label: '巳酉丑三合金局' },
];

const THREE_MEETINGS: BranchCombinationRule[] = [
  { id: 'yin_mao_chen', branches: ['寅', '卯', '辰'], element: '木', label: '寅卯辰三会木局' },
  { id: 'si_wu_wei', branches: ['巳', '午', '未'], element: '火', label: '巳午未三会火局' },
  { id: 'shen_you_xu', branches: ['申', '酉', '戌'], element: '金', label: '申酉戌三会金局' },
  { id: 'hai_zi_chou', branches: ['亥', '子', '丑'], element: '水', label: '亥子丑三会水局' },
];

export function buildPatternCandidates(chart: PatternCandidateChartInput): PatternCandidatesResult {
  const monthHidden = chart.month?.hiddenStems || [];
  const monthCommand = monthHidden[0];
  const regular: PatternCandidate[] = [];
  const mixedQi: PatternCandidate[] = [];
  const auxiliary: PatternCandidate[] = [];

  if (!chart.dayMaster || !chart.month?.branch || !monthCommand?.tenGod) {
    return {
      methodVersion: 'pattern_candidates_v1',
      regular,
      mixedQi,
      auxiliary,
      usableGods: [],
      notes: ['阶段一只生成候选；当前命盘缺少日主、月令或月支藏干十神，无法生成格局候选。'],
    };
  }

  let usableGods: LuRenUsableGodCandidate[] = [];
  if (MIXED_QI_MONTH_BRANCHES.has(chart.month.branch)) {
    mixedQi.push(...buildMixedQiCandidates(chart, monthHidden));
  } else {
    regular.push(...buildRegularCandidates(chart, monthCommand));
    auxiliary.push(...buildAuxiliaryCandidates(chart, monthCommand));
    if (regular.some(candidate => candidate.family === 'lu_ren')) {
      usableGods = buildLuRenUsableGodCandidates(chart);
    }
  }

  return {
    methodVersion: 'pattern_candidates_v1',
    regular,
    mixedQi,
    auxiliary,
    usableGods,
    notes: [
      '阶段一只生成基础格局和杂气格局候选，不判成格、败格、破格、救应。',
      '透干证据只统计年干、月干、时干；日干是日主，不作为格神透干证据。',
      '普通月以月令格神为主；非月令透干不越过月令主格，只进入辅助候选。',
      '神煞不参与格局候选定性。',
    ],
  };
}

function buildRegularCandidates(chart: PatternCandidateChartInput, monthCommand: HiddenStemData): PatternCandidate[] {
  const candidates: PatternCandidate[] = [];
  const monthBranch = chart.month.branch;
  const tenGod = monthCommand.tenGod;
  const regularPattern = REGULAR_PATTERN_BY_TEN_GOD[tenGod];

  if (regularPattern) {
    candidates.push(buildCandidate({
      chart,
      id: regularPattern.id,
      name: regularPattern.name,
      family: 'regular',
      entry: 'month_command',
      tenGod,
      stem: monthCommand.stem,
      element: monthCommand.element,
      baseEvidence: [`月令${monthBranch}${QI_TEXT.main}${monthCommand.stem}为${tenGod}`],
    }));
    return candidates;
  }

  if (tenGod === '比肩') {
    candidates.push(buildCandidate({
      chart,
      id: 'jian_lu_ge_candidate',
      name: '建禄格候选',
      family: 'lu_ren',
      entry: 'jian_lu',
      tenGod,
      stem: monthCommand.stem,
      element: monthCommand.element,
      baseEvidence: [
        JIAN_LU_MONTH_BRANCH[chart.dayMaster] === monthBranch
          ? `日主${chart.dayMaster}临官位在${monthBranch}，月令为建禄`
          : `月令${monthBranch}主气为比肩，按建禄体系生成候选`,
      ],
    }));
    return candidates;
  }

  if (tenGod === '劫财') {
    candidates.push(buildCandidate({
      chart,
      id: 'yue_jie_ge_candidate',
      name: '月劫格候选',
      family: 'lu_ren',
      entry: 'yue_jie',
      tenGod,
      stem: monthCommand.stem,
      element: monthCommand.element,
      baseEvidence: [`月令${monthBranch}${QI_TEXT.main}${monthCommand.stem}为劫财，进入月劫体系`],
    }));

    if (YANG_REN_MONTH_BRANCH[chart.dayMaster] === monthBranch) {
      candidates.push(buildCandidate({
        chart,
        id: 'yang_ren_ge_candidate',
        name: '阳刃格候选',
        family: 'lu_ren',
        entry: 'yang_ren',
        tenGod,
        stem: monthCommand.stem,
        element: monthCommand.element,
        baseEvidence: [`阳日主${chart.dayMaster}帝旺 / 羊刃位在${monthBranch}`],
      }));
    }
  }

  return candidates;
}

function buildAuxiliaryCandidates(chart: PatternCandidateChartInput, monthCommand: HiddenStemData): PatternCandidate[] {
  if (!REGULAR_PATTERN_BY_TEN_GOD[monthCommand.tenGod]) return [];

  const seen = new Set<string>();
  return (['year', 'month', 'time'] as const).flatMap((position) => {
    const pillar = chart[position];
    if (!pillar?.stem || !pillar.tenGod) return [];
    const auxiliaryPattern = REGULAR_PATTERN_BY_TEN_GOD[pillar.tenGod];
    if (!auxiliaryPattern) return [];
    if (pillar.stem === monthCommand.stem && pillar.tenGod === monthCommand.tenGod) return [];

    const key = `${pillar.stem}:${pillar.tenGod}`;
    if (seen.has(key)) return [];
    seen.add(key);

    const relation = auxiliaryRelationToMonthCommand(monthCommand.tenGod, pillar.tenGod);

    return [buildCandidate({
      chart,
      id: `${auxiliaryPattern.id.replace('_candidate', '')}_${STEM_ID[pillar.stem] || position}_auxiliary_candidate`,
      name: auxiliaryPattern.name.replace('格候选', '辅助候选'),
      family: 'auxiliary',
      entry: 'visible_stem_auxiliary',
      tenGod: pillar.tenGod,
      stem: pillar.stem,
      element: pillar.stemElement || hiddenElementForStem(chart, pillar.stem),
      baseEvidence: [
        `${PILLAR_LABELS[position]}天干${pillar.stem}透出${pillar.tenGod}`,
        `月令主气为${monthCommand.tenGod}，此透干不越过月令主格，只作为辅助候选`,
      ],
      extraSupportSignals: relation.supportSignals,
      extraDowngradeSignals: relation.downgradeSignals,
      extraNotes: [`辅助候选必须回到${monthCommand.tenGod}月令主格下判断作用，不单独定主格。`],
    })];
  });
}

function buildMixedQiCandidates(chart: PatternCandidateChartInput, monthHidden: HiddenStemData[]): PatternCandidate[] {
  return monthHidden
    .map((hidden, index) => ({ hidden, index }))
    .filter(({ hidden }) => hidden?.tenGod && !BI_JIE_TEN_GODS.has(hidden.tenGod))
    .map(({ hidden, index }) => {
      const pattern = MIXED_QI_PATTERN_BY_TEN_GOD[hidden.tenGod] || {
        idPrefix: `za_qi_${hidden.tenGod}`,
        name: `杂气${hidden.tenGod}格候选`,
      };
      const qi = QI_LABELS[index] || 'residual';
      return buildCandidate({
        chart,
        id: `${pattern.idPrefix}_candidate`,
        name: pattern.name,
        family: 'mixed_qi',
        entry: 'mixed_qi',
        tenGod: hidden.tenGod,
        stem: hidden.stem,
        element: hidden.element,
        baseEvidence: [`杂气月${chart.month.branch}${QI_TEXT[qi]}藏${hidden.stem}${hidden.tenGod}`],
      });
    });
}

function buildLuRenUsableGodCandidates(chart: PatternCandidateChartInput): LuRenUsableGodCandidate[] {
  const visibleCandidates: LuRenUsableGodCandidate[] = (['year', 'month', 'time'] as const)
    .flatMap((position) => {
      const pillar = chart[position];
      if (!pillar?.stem || !pillar.tenGod || !USEFUL_TEN_GODS_FOR_LU_REN.has(pillar.tenGod)) return [];
      return [{
        id: `lu_ren_${pillar.tenGod}_${position}_stem_candidate`,
        tenGod: pillar.tenGod,
        stem: pillar.stem,
        element: pillar.stemElement || hiddenElementForStem(chart, pillar.stem),
        source: 'visible_stem' as const,
        position,
        confidence: position === 'month' ? 'high' as const : 'medium' as const,
        evidence: [`${PILLAR_LABELS[position]}天干${pillar.stem}透出${pillar.tenGod}，可作为建禄月劫另取之神候选`],
        notes: ['阶段一只列出建禄月劫的可用之神候选，是否可用留到阶段二检查成败救应。'],
      }];
    });
  const branchCandidates = buildLuRenBranchUsableGodCandidates(chart);
  return [...visibleCandidates, ...branchCandidates];
}

function buildLuRenBranchUsableGodCandidates(chart: PatternCandidateChartInput): LuRenUsableGodCandidate[] {
  const dayElement = GAN_WUXING[chart.dayMaster];
  if (!dayElement) return [];

  const branches = [chart.year, chart.month, chart.day, chart.time]
    .map(pillar => pillar?.branch)
    .filter(Boolean);

  const harmonyCandidates = THREE_HARMONIES
    .filter(rule => rule.branches.every(branch => branches.includes(branch)))
    .flatMap(rule => buildLuRenBranchCandidate(rule, dayElement, 'three_harmony'));
  const meetingCandidates = THREE_MEETINGS
    .filter(rule => rule.branches.every(branch => branches.includes(branch)))
    .flatMap(rule => buildLuRenBranchCandidate(rule, dayElement, 'three_meeting'));

  return [...harmonyCandidates, ...meetingCandidates];
}

function buildLuRenBranchCandidate(
  rule: BranchCombinationRule,
  dayElement: string,
  source: Exclude<LuRenUsableGodSource, 'visible_stem'>,
): LuRenUsableGodCandidate[] {
  const tenGod = tenGodGroupForElement(dayElement, rule.element);
  if (!tenGod) return [];

  return [{
    id: `lu_ren_${source}_${rule.id}_${tenGod}_candidate`,
    tenGod,
    element: rule.element,
    source,
    branches: rule.branches,
    label: rule.label,
    confidence: 'medium',
    evidence: [`地支成${rule.label}，${rule.element}成势，可作为建禄月劫另取${tenGod}候选`],
    notes: ['会支只说明可用之神成势，是否真能成格仍需阶段二检查成败救应。'],
  }];
}

function buildCandidate(input: {
  chart: PatternCandidateChartInput;
  id: string;
  name: string;
  family: PatternCandidateFamily;
  entry: PatternCandidateEntry;
  tenGod: string;
  stem?: string;
  element?: string;
  baseEvidence: string[];
  extraSupportSignals?: string[];
  extraDowngradeSignals?: string[];
  extraNotes?: string[];
}): PatternCandidate {
  const penetration = input.stem ? findPenetration(input.chart, input.stem, input.tenGod) : [];
  const roots = input.stem ? findRoots(input.chart, input.stem) : [];
  const isAuxiliary = input.family === 'auxiliary';
  const supportSignals = [
    ...(isAuxiliary ? [] : buildSupportSignals(input.chart, input.tenGod)),
    ...(isAuxiliary ? [] : buildActivationSignals(input.chart, input.element)),
    ...(input.extraSupportSignals || []),
  ];
  const downgradeSignals = [
    ...(isAuxiliary ? [] : buildDowngradeSignals(input.chart, input.tenGod)),
    ...(input.extraDowngradeSignals || []),
  ];
  const notes = [
    '候选层只记录入口和证据，成败救应留到阶段二。',
    ...buildLockNotes(input.family, input.entry, penetration),
    ...(input.extraNotes || []),
  ];

  return {
    id: input.id,
    name: input.name,
    family: input.family,
    status: 'candidate',
    confidence: confidenceFor(input.entry, penetration, roots, supportSignals),
    entry: input.entry,
    tenGod: input.tenGod,
    stem: input.stem,
    element: input.element,
    monthBranch: input.chart.month.branch,
    evidence: [
      ...input.baseEvidence,
      ...penetration.map(item => `${PILLAR_LABELS[item.position]}天干${item.stem}透出${item.tenGod}`),
      ...roots.map(item => `${PILLAR_LABELS[item.position]}${item.branch}藏${QI_TEXT[item.qi]}${item.stem}为根`),
    ],
    penetration,
    roots,
    supportSignals,
    downgradeSignals,
    notes,
  };
}

function findPenetration(
  chart: PatternCandidateChartInput,
  stem: string,
  tenGod: string,
): PatternStemEvidence[] {
  return (['year', 'month', 'time'] as const)
    .filter(position => chart[position]?.stem === stem)
    .map(position => ({
      position,
      stem,
      tenGod,
      weight: position === 'month' ? 'strong' : position === 'year' ? 'medium' : 'late',
    }));
}

function findRoots(chart: PatternCandidateChartInput, stem: string): PatternRootEvidence[] {
  return (['month', 'day', 'time', 'year'] as const).flatMap((position) => {
    const pillar = chart[position];
    if (!pillar) return [];
    const index = (pillar?.hiddenStems || []).findIndex(hidden => hidden.stem === stem);
    if (index < 0) return [];
    const qi = QI_LABELS[index] || 'residual';
    return [{
      position,
      branch: pillar.branch,
      stem,
      qi,
      weight: position === 'month' || qi === 'main' ? 'strong' : qi === 'middle' ? 'medium' : 'weak',
    }];
  });
}

function hiddenElementForStem(chart: PatternCandidateChartInput, stem: string): string | undefined {
  return GAN_WUXING[stem] || (['year', 'month', 'day', 'time'] as const)
    .flatMap(position => chart[position]?.hiddenStems || [])
    .find(hidden => hidden.stem === stem)?.element;
}

function auxiliaryRelationToMonthCommand(
  monthTenGod: string,
  auxiliaryTenGod: string,
): { supportSignals: string[]; downgradeSignals: string[] } {
  const supportSignals: string[] = [];
  const downgradeSignals: string[] = [];

  if (monthTenGod === '正官') {
    if (auxiliaryTenGod === '正财' || auxiliaryTenGod === '偏财') {
      supportSignals.push('财星透出，按财生官归入正官格助力，不另立财格主格');
    }
    if (auxiliaryTenGod === '正印' || auxiliaryTenGod === '偏印') {
      supportSignals.push('印星透出，按官印相生或护官归入正官格助力，不另立印格主格');
    }
    if (auxiliaryTenGod === '食神' || auxiliaryTenGod === '伤官') {
      downgradeSignals.push('食伤透出，先记录为正官格破格风险，是否有印制留到成败救应');
    }
    if (auxiliaryTenGod === '七杀') {
      downgradeSignals.push('七杀透出，阶段二需检查官杀混杂是否有清');
    }
  }

  if (monthTenGod === '七杀') {
    if (auxiliaryTenGod === '食神') supportSignals.push('食神透出，按食神制杀归入七杀格成格助力');
    if (auxiliaryTenGod === '正印' || auxiliaryTenGod === '偏印') supportSignals.push('印星透出，按杀印相生归入七杀格成格助力');
    if (auxiliaryTenGod === '正财' || auxiliaryTenGod === '偏财') downgradeSignals.push('财星透出，阶段二需检查财星生杀而无制');
    if (auxiliaryTenGod === '正官') downgradeSignals.push('正官透出，阶段二需检查官杀混杂是否有清');
  }

  if (monthTenGod === '正财' || monthTenGod === '偏财') {
    if (auxiliaryTenGod === '食神' || auxiliaryTenGod === '伤官') supportSignals.push('食伤透出，按食伤生财归入财格助力');
    if (auxiliaryTenGod === '正官') supportSignals.push('正官透出，按财生官归入财格后续成格线索');
    if (auxiliaryTenGod === '比肩' || auxiliaryTenGod === '劫财') downgradeSignals.push('比劫透出，阶段二需检查争财');
    if (auxiliaryTenGod === '七杀') downgradeSignals.push('七杀透出，阶段二需检查财党杀');
  }

  if (monthTenGod === '正印' || monthTenGod === '偏印') {
    if (auxiliaryTenGod === '正官' || auxiliaryTenGod === '七杀') supportSignals.push('官杀透出，按官杀生印归入印格助力');
    if (auxiliaryTenGod === '正财' || auxiliaryTenGod === '偏财') downgradeSignals.push('财星透出，阶段二需检查财星破印');
    if (monthTenGod === '偏印' && auxiliaryTenGod === '食神') downgradeSignals.push('食神透出，阶段二需检查枭印夺食');
  }

  if (monthTenGod === '食神') {
    if (auxiliaryTenGod === '正财' || auxiliaryTenGod === '偏财') supportSignals.push('财星透出，按食神生财归入食神格助力');
    if (auxiliaryTenGod === '七杀') supportSignals.push('七杀透出，按食神制杀归入食神格助力');
    if (auxiliaryTenGod === '偏印') downgradeSignals.push('偏印透出，阶段二需检查枭印夺食');
    if (auxiliaryTenGod === '伤官') downgradeSignals.push('伤官透出，阶段二需检查食伤混杂');
  }

  if (monthTenGod === '伤官') {
    if (auxiliaryTenGod === '正财' || auxiliaryTenGod === '偏财') supportSignals.push('财星透出，按伤官生财归入伤官格助力');
    if (auxiliaryTenGod === '正印' || auxiliaryTenGod === '偏印') supportSignals.push('印星透出，按伤官配印归入伤官格救应线索');
    if (auxiliaryTenGod === '正官') downgradeSignals.push('正官透出，阶段二需检查伤官见官');
    if (auxiliaryTenGod === '七杀') supportSignals.push('七杀透出，阶段二可检查伤官驾杀条件');
  }

  return { supportSignals, downgradeSignals };
}

function tenGodGroupForElement(dayElement: string, element: string): string | null {
  if (WUXING_GENERATES[dayElement] === element) return '食伤';
  if (WUXING_CONTROLS[dayElement] === element) return '财星';
  if (WUXING_CONTROLS[element] === dayElement) return '官杀';
  return null;
}

function buildLockNotes(
  family: PatternCandidateFamily,
  entry: PatternCandidateEntry,
  penetration: PatternStemEvidence[],
): string[] {
  if (family !== 'regular' || entry !== 'month_command' || penetration.length === 0) return [];
  return ['月令格神已透，阶段一锁定为主格入口；非月令透干只作为辅助候选。'];
}

function buildSupportSignals(chart: PatternCandidateChartInput, tenGod: string): string[] {
  const visibleTenGods = [chart.year, chart.month, chart.time]
    .map(pillar => pillar?.tenGod)
    .filter((value): value is string => Boolean(value));
  const allHiddenTenGods = (['year', 'month', 'day', 'time'] as const)
    .flatMap(position => chart[position]?.hiddenStems || [])
    .map(hidden => hidden.tenGod);
  const allTenGods = [...visibleTenGods, ...allHiddenTenGods];
  const signals: string[] = [];

  if (tenGod === '正官') addIfSeen(signals, allTenGods, ['正财', '偏财'], '财星出现，可作为生官候选证据');
  if (tenGod === '正官') addIfSeen(signals, allTenGods, ['正印', '偏印'], '印星出现，可作为护官候选证据');
  if (tenGod === '七杀') addIfSeen(signals, allTenGods, ['食神'], '食神出现，可作为制杀候选证据');
  if (tenGod === '七杀') addIfSeen(signals, allTenGods, ['正印', '偏印'], '印星出现，可作为化杀候选证据');
  if (tenGod === '正财' || tenGod === '偏财') addIfSeen(signals, allTenGods, ['食神', '伤官'], '食伤出现，可作为生财候选证据');
  if (tenGod === '正印' || tenGod === '偏印') addIfSeen(signals, allTenGods, ['正官', '七杀'], '官杀出现，可作为生印候选证据');
  if (tenGod === '食神' || tenGod === '伤官') addIfSeen(signals, allTenGods, ['正财', '偏财'], '财星出现，可作为食伤生财候选证据');
  if (tenGod === '比肩' || tenGod === '劫财') {
    const usefulVisible = visibleTenGods.filter(visible => USEFUL_TEN_GODS_FOR_LU_REN.has(visible));
    if (usefulVisible.length > 0) {
      signals.push(`建禄月劫需另取财官杀食伤，当前天干可见${[...new Set(usefulVisible)].join('、')}`);
    }
  }

  return signals;
}

function buildActivationSignals(chart: PatternCandidateChartInput, element?: string): string[] {
  if (!element) return [];
  const branches = [chart.year, chart.month, chart.day, chart.time].map(pillar => pillar?.branch).filter(Boolean);
  return [...THREE_HARMONIES, ...THREE_MEETINGS]
    .filter(rule => rule.element === element && rule.branches.every(branch => branches.includes(branch)))
    .map(rule => `${rule.label}引动${element}`);
}

function buildDowngradeSignals(chart: PatternCandidateChartInput, tenGod: string): string[] {
  const visibleTenGods = [chart.year, chart.month, chart.time]
    .map(pillar => pillar?.tenGod)
    .filter(Boolean);
  const signals: string[] = [];
  const dayStrength = chart.weightedWuxing?.dayMasterStrength?.label;

  if (tenGod === '正官' && visibleTenGods.includes('伤官')) signals.push('伤官透出，阶段二需检查伤官见官');
  if (tenGod === '七杀' && visibleTenGods.some(item => item === '正财' || item === '偏财')) signals.push('财星透出，阶段二需检查财党杀');
  if ((tenGod === '正财' || tenGod === '偏财') && visibleTenGods.some(item => item === '比肩' || item === '劫财')) signals.push('比劫透出，阶段二需检查争财');
  if (tenGod === '食神' && visibleTenGods.includes('偏印')) signals.push('偏印透出，阶段二需检查夺食');
  if (tenGod === '伤官' && visibleTenGods.includes('正官')) signals.push('正官透出，阶段二需检查伤官见官');
  if ((tenGod === '正财' || tenGod === '偏财' || tenGod === '七杀') && dayStrength === 'extremely_weak') {
    signals.push('日主极弱，阶段二需检查承载能力');
  }

  return signals;
}

function addIfSeen(signals: string[], allTenGods: string[], targets: string[], label: string): void {
  if (targets.some(target => allTenGods.includes(target))) signals.push(label);
}

function confidenceFor(
  entry: PatternCandidateEntry,
  penetration: PatternStemEvidence[],
  roots: PatternRootEvidence[],
  supportSignals: string[],
): PatternCandidateConfidence {
  if (entry === 'visible_stem_auxiliary') {
    if (penetration.some(item => item.position === 'month')) return 'high';
    if (penetration.length > 0) return 'medium';
    return roots.length > 0 ? 'low' : 'low';
  }
  if (penetration.some(item => item.position === 'month')) return 'high';
  if (penetration.length > 0) return 'high';
  if (entry === 'mixed_qi') {
    if (supportSignals.some(signal => signal.includes('三合') || signal.includes('三会'))) return 'medium';
    if (roots.length > 1) return 'medium';
    return 'low';
  }
  if (roots.some(item => item.position === 'month' && item.qi === 'main')) return 'medium';
  if (roots.length > 1) return 'medium';
  return 'low';
}
