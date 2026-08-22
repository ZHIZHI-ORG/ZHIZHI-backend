import type { HiddenStemData, PillarData } from './baziCalculator';
import type { LuRenUsableGodCandidate, PatternCandidate, PatternCandidatesResult } from './patternJudgement';
import {
  BRANCH_BREAKS,
  BRANCH_CLASHES,
  BRANCH_HARMS,
  BRANCH_PUNISHMENTS,
  BRANCH_SIX_COMBINATIONS,
  BRANCH_THREE_HARMONIES as THREE_HARMONIES,
  BRANCH_THREE_MEETINGS as THREE_MEETINGS,
  STEM_COMBINATIONS,
  buildCanonicalDerivedBranchRules,
  canonicalDerivedBranchLabel,
} from './ganZhiRelationRules';

type PillarPosition = 'year' | 'month' | 'day' | 'time';
type QiLevel = 'main_qi' | 'middle_qi' | 'residual_qi';

export interface ZipingStructureInput {
  dayMaster: string;
  dayMasterElement?: string;
  year: PillarData;
  month: PillarData;
  day: PillarData;
  /** Missing birth hour is represented by omission, never a synthetic noon pillar. */
  time?: PillarData;
  patternCandidates?: PatternCandidatesResult;
}

export interface ZipingStructureFactsResult {
  method_version: 'ziping_structure_v2_fact_layer';
  hour_precision: 'known' | 'unknown';
  observed_pillars: PillarPosition[];
  gan_zhi_effects: GanZhiEffectsFacts;
  month_command: MonthCommandFacts;
  day_master_facts: DayMasterFacts;
  pattern_candidates: PatternCandidatesFactLayer;
  yongshen_basis_facts: YongshenBasisFacts;
  notes: string[];
}

export interface ZipingAiBriefResult {
  method_version: 'ziping_ai_brief_v1';
  month_command: string;
  day_master_capacity: string;
  pattern_candidates: Array<{
    name: string;
    confidence: string;
  }>;
  gan_zhi_effects: {
    heavenly_stems: string[];
    earthly_branches: string[];
  };
  yongshen_arbitration_facts: string;
}

interface GanZhiRelationFact {
  type: string;
  relation_label: string;
  stems?: string[];
  branches?: string[];
  result_element?: string;
  missing_branch?: string;
  involves_month_branch: boolean;
  involves_day_branch: boolean;
  affected_hidden_stems: HiddenStemFact[];
  affected_pattern_candidates: string[];
  evidence: string[];
}

interface GanZhiEffectsFacts {
  relations: GanZhiRelationFact[];
  activated_elements: Array<{
    element: string;
    source: string;
    branches?: string[];
    stems?: string[];
  }>;
  damaged_targets: Array<{
    target_type: string;
    target: string;
    relation: string;
    branches: string[];
    affected_hidden_stems: HiddenStemFact[];
  }>;
  storage_events: Array<{
    branch: string;
    position: PillarPosition;
    storage_element: string;
    event: 'storage_present' | 'storage_clashed';
    evidence: string[];
  }>;
}

interface HiddenStemFact {
  position: PillarPosition;
  branch: string;
  stem: string;
  ten_god: string;
  element: string;
  qi_level: QiLevel;
}

interface MonthCommandFacts {
  month_branch: string;
  is_mixed_qi_month: boolean;
  command_stem: string;
  command_ten_god: string;
  command_basis: 'month_branch_main_qi_v1';
  hidden_stems: HiddenStemFact[];
  penetrations: PenetrationFact[];
  activated_by_relations: GanZhiRelationFact[];
  climate_facts: {
    cold_sources: string[];
    heat_sources: string[];
    dryness_sources: string[];
    dampness_sources: string[];
  };
  tiaohou_needs: Array<{
    need: string;
    suggested_elements_by_rule: string[];
    basis: string[];
  }>;
  pattern_entry_hint: 'regular' | 'mixed_qi' | 'lu_ren' | 'unknown';
  evidence: string[];
}

interface PenetrationFact {
  stem: string;
  ten_god: string;
  element: string;
  positions: PillarPosition[];
}

interface DayMasterFacts {
  day_master: string;
  element: string;
  season_state: {
    month_branch: string;
    state: string;
    basis: string;
  };
  roots: Array<{
    branch_position: PillarPosition;
    branch: string;
    stem: string;
    ten_god: string;
    element: string;
    root_types: string[];
    qi_level: QiLevel;
    affected_by_relations: string[];
  }>;
  supporting_facts: {
    resource_stems: TenGodLocationFact[];
    peer_stems: TenGodLocationFact[];
    resource_hidden_stems: TenGodLocationFact[];
    peer_hidden_stems: TenGodLocationFact[];
  };
  pressure_facts: {
    wealth: TenGodLocationFact[];
    officer_killing: TenGodLocationFact[];
    output: TenGodLocationFact[];
  };
  special_pattern_materials: Array<{
    type: string;
    basis: string[];
  }>;
  evidence: string[];
}

interface TenGodLocationFact {
  ten_god: string;
  stem: string;
  element: string;
  position: PillarPosition;
  source: 'stem' | 'hidden_stem';
  branch?: string;
  qi_level?: QiLevel;
  affected_by_relations: string[];
}

interface PatternCandidatesFactLayer {
  method_version: 'pattern_candidates_v1_fact_layer';
  regular: PatternCandidateFact[];
  mixed_qi: PatternCandidateFact[];
  auxiliary: PatternCandidateFact[];
  usable_god_materials_for_lu_ren: LuRenUsableGodFact[];
  notes: string[];
}

interface PatternCandidateFact {
  id: string;
  name: string;
  family: string;
  status: string;
  confidence: string;
  entry: string;
  ten_god: string;
  stem?: string;
  element?: string;
  month_branch: string;
  evidence: string[];
  penetrations: Array<{
    position: PillarPosition;
    stem: string;
    ten_god: string;
  }>;
  roots: Array<{
    position: PillarPosition;
    branch: string;
    stem: string;
    qi: string;
  }>;
  supporting_materials: string[];
  conflict_materials: string[];
  notes: string[];
}

interface LuRenUsableGodFact {
  id: string;
  ten_god: string;
  stem?: string;
  element?: string;
  source: string;
  position?: PillarPosition;
  branches?: string[];
  label?: string;
  evidence: string[];
  notes: string[];
}

interface YongshenBasisFacts {
  method_version: 'yongshen_basis_facts_v1';
  tiaohou: {
    climate_problems: Array<{
      type: 'cold' | 'heat' | 'dryness' | 'dampness';
      sources: string[];
    }>;
    rule_suggested_elements: Array<{
      element: string;
      need: string;
      basis: string[];
    }>;
    available_elements_in_chart: ElementLocationFact[];
    affected_by_relations: string[];
  };
  pattern: {
    candidate_patterns: Array<{
      id: string;
      name: string;
      ten_god: string;
      family: string;
    }>;
    rule_suggested_ten_gods: Array<{
      ten_god: string;
      source_pattern: string;
      basis: string;
    }>;
    available_ten_gods_in_chart: TenGodLocationFact[];
    pattern_conflicts: Array<{
      ten_god: string;
      source_pattern: string;
      basis: string;
      available_facts: TenGodLocationFact[];
    }>;
  };
  fuyi: {
    supporting_facts: TenGodLocationFact[];
    pressure_facts: TenGodLocationFact[];
    rule_suggested_directions: Array<{
      direction: string;
      basis: string[];
    }>;
  };
  bingyao: {
    illness_facts: Array<{
      type: string;
      basis: string[];
    }>;
    remedy_materials_by_rule: Array<{
      source_illness: string;
      suggested_ten_gods?: string[];
      suggested_elements?: string[];
      available_ten_gods: TenGodLocationFact[];
      available_elements: ElementLocationFact[];
    }>;
  };
  tongguan: {
    conflict_facts: Array<{
      elements: string[];
      source_relations: string[];
      mediating_element_by_rule: string;
    }>;
    mediating_elements_by_rule: Array<{
      element: string;
      basis: string;
    }>;
    available_mediating_elements: ElementLocationFact[];
  };
  summary_materials: {
    supporting_materials: Array<{
      kind: 'element' | 'ten_god';
      value: string;
      sources: string[];
    }>;
    opposing_materials: Array<{
      kind: 'element' | 'ten_god';
      value: string;
      sources: string[];
    }>;
    conflicting_materials: Array<{
      kind: 'element' | 'ten_god';
      value: string;
      supporting_sources: string[];
      opposing_sources: string[];
    }>;
  };
  notes: string[];
}

interface ElementLocationFact {
  element: string;
  stem: string;
  ten_god: string;
  position: PillarPosition;
  source: 'stem' | 'hidden_stem';
  branch?: string;
  qi_level?: QiLevel;
  affected_by_relations: string[];
}

const POSITIONS: PillarPosition[] = ['year', 'month', 'day', 'time'];
const VISIBLE_PENETRATION_POSITIONS: PillarPosition[] = ['year', 'month', 'time'];
const QI_LEVELS: QiLevel[] = ['main_qi', 'middle_qi', 'residual_qi'];
const MIXED_QI_MONTH_BRANCHES = new Set(['辰', '戌', '丑', '未']);
const RESOURCE_TEN_GODS = new Set(['正印', '偏印']);
const PEER_TEN_GODS = new Set(['比肩', '劫财']);
const WEALTH_TEN_GODS = new Set(['正财', '偏财']);
const OFFICER_KILLING_TEN_GODS = new Set(['正官', '七杀']);
const OUTPUT_TEN_GODS = new Set(['食神', '伤官']);

const POSITION_LABELS: Record<PillarPosition, string> = {
  year: '年柱',
  month: '月柱',
  day: '日柱',
  time: '时柱',
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

const ZHI_WUXING: Record<string, string> = {
  子: '水',
  亥: '水',
  寅: '木',
  卯: '木',
  巳: '火',
  午: '火',
  申: '金',
  酉: '金',
  丑: '土',
  辰: '土',
  未: '土',
  戌: '土',
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

const BRANCH_SELF_PUNISHMENTS = ['辰', '午', '酉', '亥'];

const STORAGE_BRANCHES: Record<string, string> = {
  辰: '水',
  戌: '火',
  丑: '金',
  未: '木',
};

const MONTH_CLIMATE_RULES: Record<string, {
  climate: Partial<Record<'cold' | 'heat' | 'dryness' | 'dampness', string[]>>;
  needs: Array<{ need: string; suggested: string[]; basis: string[] }>;
}> = {
  寅: { climate: { cold: ['寅月寒未尽'], dampness: ['寅月木起带湿'] }, needs: [{ need: '火暖', suggested: ['火'], basis: ['寅月寒未尽'] }] },
  卯: { climate: { dampness: ['卯月湿寒余气'] }, needs: [{ need: '火泄秀', suggested: ['火'], basis: ['卯月木旺'] }] },
  辰: { climate: { dampness: ['辰为湿土', '辰为水库'] }, needs: [{ need: '火暖燥', suggested: ['火'], basis: ['辰月湿土'] }, { need: '木疏土', suggested: ['木'], basis: ['辰月土湿'] }] },
  巳: { climate: { heat: ['巳月火起'], dryness: ['巳月燥热渐成'] }, needs: [{ need: '水润', suggested: ['水', '金'], basis: ['巳月燥热'] }] },
  午: { climate: { heat: ['午月火旺'], dryness: ['午月热极易燥'] }, needs: [{ need: '水调候', suggested: ['水', '金'], basis: ['午月火旺'] }] },
  未: { climate: { heat: ['未月火余'], dryness: ['未为燥土'] }, needs: [{ need: '水润', suggested: ['水'], basis: ['未月燥土'] }, { need: '木疏土', suggested: ['木'], basis: ['未月土重'] }] },
  申: { climate: { dryness: ['申月金起带燥'] }, needs: [{ need: '水润金', suggested: ['水'], basis: ['申月燥金'] }, { need: '火炼金', suggested: ['火'], basis: ['申月金起'] }] },
  酉: { climate: { dryness: ['酉月金旺燥肃'] }, needs: [{ need: '火炼', suggested: ['火'], basis: ['酉月金旺'] }, { need: '水润', suggested: ['水'], basis: ['酉月燥肃'] }] },
  戌: { climate: { heat: ['戌为火库'], dryness: ['戌为燥土'] }, needs: [{ need: '水润燥', suggested: ['水', '金'], basis: ['戌月燥土'] }, { need: '木疏土', suggested: ['木'], basis: ['戌月土燥'] }] },
  亥: { climate: { cold: ['亥月水起'], dampness: ['亥月寒湿'] }, needs: [{ need: '火暖', suggested: ['火'], basis: ['亥月寒湿'] }, { need: '土制水', suggested: ['土'], basis: ['亥月水起'] }] },
  子: { climate: { cold: ['子月水旺寒极'], dampness: ['子月寒水'] }, needs: [{ need: '火暖', suggested: ['火'], basis: ['子月寒极'] }, { need: '土辅', suggested: ['土'], basis: ['子月水旺'] }] },
  丑: { climate: { cold: ['丑月寒土'], dampness: ['丑为寒湿土'] }, needs: [{ need: '火暖土燥', suggested: ['火'], basis: ['丑月寒湿'] }, { need: '木疏土', suggested: ['木'], basis: ['丑月湿土'] }] },
};

const SEASON_STATE_BY_MONTH_BRANCH: Record<string, Record<string, string>> = {
  寅: { 木: '旺', 火: '相', 水: '休', 金: '囚', 土: '死' },
  卯: { 木: '旺', 火: '相', 水: '休', 金: '囚', 土: '死' },
  巳: { 火: '旺', 土: '相', 木: '休', 水: '囚', 金: '死' },
  午: { 火: '旺', 土: '相', 木: '休', 水: '囚', 金: '死' },
  申: { 金: '旺', 水: '相', 土: '休', 火: '囚', 木: '死' },
  酉: { 金: '旺', 水: '相', 土: '休', 火: '囚', 木: '死' },
  亥: { 水: '旺', 木: '相', 金: '休', 土: '囚', 火: '死' },
  子: { 水: '旺', 木: '相', 金: '休', 土: '囚', 火: '死' },
  辰: { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' },
  戌: { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' },
  丑: { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' },
  未: { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' },
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

const PATTERN_RULES_BY_TEN_GOD: Record<string, { suggested: string[]; conflicts: string[]; basis: string }> = {
  正官: { suggested: ['正财', '偏财', '正印', '偏印'], conflicts: ['食神', '伤官', '七杀'], basis: '正官格候选常看财生官、印护官，同时记录食伤克官与官杀混杂材料' },
  七杀: { suggested: ['食神', '正印', '偏印', '比肩', '劫财'], conflicts: ['正财', '偏财', '正官'], basis: '七杀格候选常看食神制杀、印化杀和身能任杀材料' },
  正财: { suggested: ['食神', '伤官', '正官'], conflicts: ['比肩', '劫财', '七杀'], basis: '财格候选常看食伤生财、官护财，同时记录比劫争财和财生杀材料' },
  偏财: { suggested: ['食神', '伤官', '正官'], conflicts: ['比肩', '劫财', '七杀'], basis: '财格候选常看食伤生财、官护财，同时记录比劫争财和财生杀材料' },
  正印: { suggested: ['正官', '七杀'], conflicts: ['正财', '偏财'], basis: '印格候选常看官杀生印，同时记录财破印材料' },
  偏印: { suggested: ['正官', '七杀'], conflicts: ['正财', '偏财', '食神'], basis: '偏印格候选常看官杀生印，同时记录财破印和枭印夺食材料' },
  食神: { suggested: ['正财', '偏财', '七杀'], conflicts: ['偏印', '伤官'], basis: '食神格候选常看食神生财、食神制杀，同时记录枭印夺食和食伤混杂材料' },
  伤官: { suggested: ['正财', '偏财', '正印', '偏印'], conflicts: ['正官'], basis: '伤官格候选常看伤官生财、伤官配印，同时记录伤官见官材料' },
  比肩: { suggested: ['正财', '偏财', '正官', '七杀', '食神', '伤官'], conflicts: ['比肩', '劫财'], basis: '建禄候选不以比肩为用，另看财官杀食伤材料' },
  劫财: { suggested: ['正财', '偏财', '正官', '七杀', '食神', '伤官'], conflicts: ['比肩', '劫财'], basis: '月劫候选不以劫财为用，另看财官杀食伤材料' },
};

const TONGGUAN_BY_CONFLICT: Record<string, string> = {
  金木: '水',
  木金: '水',
  木土: '火',
  土木: '火',
  土水: '金',
  水土: '金',
  水火: '木',
  火水: '木',
  火金: '土',
  金火: '土',
};

export function buildZipingStructureFacts(input: ZipingStructureInput): ZipingStructureFactsResult {
  const hourPrecision = input.time ? 'known' : 'unknown';
  const ganZhiEffects = buildGanZhiEffects(input);
  const monthCommand = buildMonthCommandFacts(input, ganZhiEffects);
  const dayMasterFacts = buildDayMasterFacts(input, ganZhiEffects);
  const patternCandidates = buildPatternCandidateFacts(input.patternCandidates);
  const yongshenBasisFacts = buildYongshenBasisFacts(input, ganZhiEffects, monthCommand, dayMasterFacts, patternCandidates);

  return {
    method_version: 'ziping_structure_v2_fact_layer',
    hour_precision: hourPrecision,
    observed_pillars: pillarItems(input).map((item) => item.position),
    gan_zhi_effects: ganZhiEffects,
    month_command: monthCommand,
    day_master_facts: dayMasterFacts,
    pattern_candidates: patternCandidates,
    yongshen_basis_facts: yongshenBasisFacts,
    notes: [
      '子平结构引擎 V2 当前只输出事实材料，不输出最终喜用忌、分数、权重或裁决。',
      '格局候选沿用 pattern_candidates_v1；本事实层会输出去裁决化的候选材料副本。',
      ...(hourPrecision === 'unknown'
        ? ['出生时辰未知；所有空数组只表示已知三柱范围内未见，不表示完整命盘不存在。']
        : []),
    ],
  };
}

export function buildZipingAiBrief(
  facts: ZipingStructureFactsResult,
  ganZhiEffectsOverride?: ZipingAiBriefResult['gan_zhi_effects'],
): ZipingAiBriefResult {
  const month = facts.month_command;
  const dayMaster = facts.day_master_facts;
  const patterns = facts.pattern_candidates;
  const usage = facts.yongshen_basis_facts;
  const hiddenText = summarizeList(
    month.hidden_stems.map(item => `${qiText(item.qi_level)}${item.stem}${item.ten_god}`),
    4,
  );
  const penetrationText = summarizeList(
    month.penetrations.map(item => `${item.stem}${item.ten_god}透${item.positions.map(positionText).join('、')}`),
    3,
  ) || '月令藏干未透';
  const patternItems = [
    ...patterns.regular,
    ...patterns.mixed_qi,
    ...patterns.auxiliary,
  ];
  const patternPayload = patternItems.map(item => ({
    name: item.name,
    confidence: item.confidence,
  }));
  const rootsText = summarizeList(
    dayMaster.roots.map(item => `${positionText(item.branch_position)}${item.branch}藏${item.stem}${item.ten_god}`),
    4,
  ) || '未见明确根气材料';
  const visibleStemText = summarizeVisibleStemFacts(dayMaster);
  const climateSummary = summarizeClimateForAi(month, usage);
  const ganZhiEffectsPayload = ganZhiEffectsOverride || summarizeGanZhiEffectsForAi(facts.gan_zhi_effects);
  const patternCoreText = summarizeList([
    ...patterns.regular.map(item => `${item.ten_god}${item.family === 'auxiliary' ? '辅助' : ''}`),
    ...patterns.mixed_qi.map(item => `杂气${item.ten_god}`),
    ...patterns.auxiliary.map(item => `${item.ten_god}辅助`),
  ], 5) || '无格局候选';
  const arbitrationSourceText = summarizeList([
    climateSummary ? `气候${climateSummary}` : '',
    patternCoreText ? `格局见${patternCoreText}` : '',
    rootsText ? `根气见${rootsText}` : '',
    visibleStemText ? `显干见${visibleStemText}` : '',
  ], 5);

  return {
    method_version: 'ziping_ai_brief_v1',
    month_command: `${dayMaster.day_master}${dayMaster.element}日主；${month.month_branch}月${month.is_mixed_qi_month ? '杂气月' : '普通月'}；月令${month.command_stem}${month.command_ten_god}；藏干${hiddenText}；${penetrationText}；气候：${climateSummary}。`,
    day_master_capacity: `${dayMaster.season_state.basis}；根气：${rootsText}；显干：${visibleStemText || '无非日主显干十神'}。`,
    pattern_candidates: patternPayload,
    gan_zhi_effects: ganZhiEffectsPayload,
    yongshen_arbitration_facts: arbitrationSourceText,
  };
}

function buildGanZhiEffects(input: ZipingStructureInput): GanZhiEffectsFacts {
  const relations: GanZhiRelationFact[] = [];
  const stemItems = pillarItems(input).filter(item => item.pillar?.stem);
  const branchItems = pillarItems(input).filter(item => item.pillar?.branch);
  const branches = branchItems.map(item => item.pillar.branch);
  const stems = stemItems.map(item => item.pillar.stem);

  STEM_COMBINATIONS.forEach((rule) => {
    if (!rule.stems.every(stem => stems.includes(stem))) return;
    relations.push(makeRelation(input, {
      type: 'stem_combination',
      relationLabel: rule.label,
      stems: rule.stems,
      resultElement: rule.element,
      evidence: [`${rule.label}事实成立`],
    }));
  });

  for (let index = 0; index < stemItems.length - 1; index += 1) {
    const left = stemItems[index];
    const right = stemItems[index + 1];
    addStemControlRelation(input, relations, left.pillar.stem, right.pillar.stem);
    addStemControlRelation(input, relations, right.pillar.stem, left.pillar.stem);
  }

	  THREE_MEETINGS.forEach((rule) => {
	    const matched = rule.branches.filter(branch => branches.includes(branch));
	    if (matched.length === 3) {
	      relations.push(makeRelation(input, {
	        type: 'branch_three_meeting',
	        relationLabel: rule.label,
	        branches: rule.branches,
	        resultElement: rule.element,
	        evidence: [`${rule.label}事实成立`],
	      }));
    }
  });

  THREE_HARMONIES.forEach((rule) => {
    const matched = rule.branches.filter(branch => branches.includes(branch));
    if (matched.length === 3) {
      relations.push(makeRelation(input, {
        type: 'branch_three_harmony',
        relationLabel: rule.label,
        branches: rule.branches,
        resultElement: rule.element,
        evidence: [`${rule.label}事实成立`],
      }));
    }
  });

  buildCanonicalDerivedBranchRules().forEach((rule) => {
    if (!rule.branches.every(branch => branches.includes(branch))) return;
    if (rule.groupBranches.every(branch => branches.includes(branch))) return;
    relations.push(makeRelation(input, {
      type: rule.relation,
      relationLabel: canonicalDerivedBranchLabel(rule),
      branches: rule.branches,
      resultElement: rule.element,
      missingBranch: rule.missingBranch,
      evidence: [`${rule.branches.join('')}构成${rule.aliases[0]}${rule.element}材料`],
    }));
  });

  BRANCH_SIX_COMBINATIONS.forEach((rule) => {
    if (!rule.branches.every(branch => branches.includes(branch))) return;
    relations.push(makeRelation(input, {
      type: 'branch_six_combination',
      relationLabel: rule.label,
      branches: rule.branches,
      resultElement: rule.element,
      evidence: [`${rule.label}事实成立`],
    }));
  });

  addBranchPairRelations(input, relations, BRANCH_CLASHES, 'branch_clash', '冲');
  addBranchPairRelations(input, relations, BRANCH_HARMS, 'branch_harm', '害');
  addBranchPairRelations(input, relations, BRANCH_BREAKS, 'branch_break', '破');
  addBranchPairRelations(input, relations, BRANCH_PUNISHMENTS, 'branch_punishment', '刑');

  BRANCH_SELF_PUNISHMENTS.forEach((branch) => {
    const matches = branchItems.filter(item => item.pillar.branch === branch);
    if (matches.length < 2) return;
    relations.push(makeRelation(input, {
      type: 'branch_self_punishment',
      relationLabel: `${branch}${branch}自刑`,
      branches: [branch],
      evidence: [`${branch}重复出现，形成自刑材料`],
    }));
  });

  const activatedElements = relations
    .filter(relation => Boolean(relation.result_element))
    .map(relation => ({
      element: relation.result_element || '',
      source: relation.relation_label,
      branches: relation.branches,
      stems: relation.stems,
    }));

  const damagedTargets = relations
    .filter(relation => ['branch_clash', 'branch_harm', 'branch_break', 'branch_punishment', 'branch_self_punishment'].includes(relation.type))
    .map(relation => ({
      target_type: relation.involves_month_branch || relation.involves_day_branch ? 'core_branch' : 'branch',
      target: relation.branches?.join('、') || '',
      relation: relation.relation_label,
      branches: relation.branches || [],
      affected_hidden_stems: relation.affected_hidden_stems,
    }));

  const storageEvents = branchItems
    .filter(item => STORAGE_BRANCHES[item.pillar.branch])
    .map(item => {
      const clashed = relations.some(relation =>
        relation.type === 'branch_clash' && (relation.branches || []).includes(item.pillar.branch)
      );
      return {
        branch: item.pillar.branch,
        position: item.position,
        storage_element: STORAGE_BRANCHES[item.pillar.branch],
        event: clashed ? 'storage_clashed' as const : 'storage_present' as const,
        evidence: [`${POSITION_LABELS[item.position]}${item.pillar.branch}为${STORAGE_BRANCHES[item.pillar.branch]}库${clashed ? '，且见冲' : ''}`],
      };
    });

  return {
    relations,
    activated_elements: uniqueObjects(activatedElements, item => `${item.element}:${item.source}`),
    damaged_targets: damagedTargets,
    storage_events: storageEvents,
  };
}

function buildMonthCommandFacts(input: ZipingStructureInput, ganZhiEffects: GanZhiEffectsFacts): MonthCommandFacts {
  const hiddenStems = hiddenStemFacts(input.month, 'month');
  const command = hiddenStems[0];
  const monthBranch = input.month?.branch || '';
  const isMixedQiMonth = MIXED_QI_MONTH_BRANCHES.has(monthBranch);
  const penetrations = collectMonthPenetrations(input, hiddenStems);
  const climateFacts = buildClimateFacts(input);
  const tiaohouNeeds = (MONTH_CLIMATE_RULES[monthBranch]?.needs || []).map(need => ({
    need: need.need,
    suggested_elements_by_rule: need.suggested,
    basis: need.basis,
  }));
  const activatedByRelations = ganZhiEffects.relations.filter(relation =>
    (relation.branches || []).includes(monthBranch)
    || hiddenStems.some(hidden => hidden.element && relation.result_element === hidden.element)
  );

  return {
    month_branch: monthBranch,
    is_mixed_qi_month: isMixedQiMonth,
    command_stem: command?.stem || '',
    command_ten_god: command?.ten_god || '',
    command_basis: 'month_branch_main_qi_v1',
    hidden_stems: hiddenStems,
    penetrations,
    activated_by_relations: activatedByRelations,
    climate_facts: climateFacts,
    tiaohou_needs: tiaohouNeeds,
    pattern_entry_hint: patternEntryHint(command?.ten_god || '', monthBranch),
    evidence: [
      monthBranch ? `月支为${monthBranch}` : '',
      command ? `月令主气${command.stem}为${command.ten_god}` : '',
      isMixedQiMonth ? `${monthBranch}为辰戌丑未杂气月，进入 mixed_qi 入口` : '',
    ].filter(Boolean),
  };
}

function buildDayMasterFacts(input: ZipingStructureInput, ganZhiEffects: GanZhiEffectsFacts): DayMasterFacts {
  const dayElement = input.dayMasterElement || GAN_WUXING[input.dayMaster] || '';
  const roots = buildRootFacts(input, ganZhiEffects);
  const support = buildSupportingFacts(input, ganZhiEffects);
  const pressure = buildPressureFacts(input, ganZhiEffects);
  const supportFacts = [
    ...support.resource_stems,
    ...support.peer_stems,
    ...support.resource_hidden_stems,
    ...support.peer_hidden_stems,
  ];
  const pressureFacts = [...pressure.wealth, ...pressure.officer_killing, ...pressure.output];
  const specialPatternMaterials = buildSpecialPatternMaterials(input, roots, supportFacts, pressureFacts);

  return {
    day_master: input.dayMaster,
    element: dayElement,
    season_state: {
      month_branch: input.month?.branch || '',
      state: SEASON_STATE_BY_MONTH_BRANCH[input.month?.branch || '']?.[dayElement] || '',
      basis: `${input.month?.branch || ''}月中${dayElement || '日主五行'}处于${SEASON_STATE_BY_MONTH_BRANCH[input.month?.branch || '']?.[dayElement] || '未知'}地`,
    },
    roots,
    supporting_facts: support,
    pressure_facts: pressure,
    special_pattern_materials: specialPatternMaterials,
    evidence: [
      `日主为${input.dayMaster}${dayElement}`,
      `月支为${input.month?.branch || ''}`,
    ].filter(Boolean),
  };
}

function buildPatternCandidateFacts(patternCandidates?: PatternCandidatesResult): PatternCandidatesFactLayer {
  return {
    method_version: 'pattern_candidates_v1_fact_layer',
    regular: sortPatternCandidatesForAi(patternCandidates?.regular || []).map(mapPatternCandidateFact),
    mixed_qi: sortPatternCandidatesForAi(patternCandidates?.mixedQi || []).map(mapPatternCandidateFact),
    auxiliary: sortPatternCandidatesForAi(patternCandidates?.auxiliary || []).map(mapPatternCandidateFact),
    usable_god_materials_for_lu_ren: (patternCandidates?.usableGods || []).map(mapLuRenUsableGodFact),
    notes: [
      ...(patternCandidates?.notes || []),
      '此处是事实层副本：保留候选依据，不在本层输出新增评分或最终裁决。',
    ],
  };
}

function buildYongshenBasisFacts(
  input: ZipingStructureInput,
  ganZhiEffects: GanZhiEffectsFacts,
  monthCommand: MonthCommandFacts,
  dayMasterFacts: DayMasterFacts,
  patternCandidates: PatternCandidatesFactLayer,
): YongshenBasisFacts {
  const climateProblems = buildClimateProblems(monthCommand);
  const tiaohouSuggestedElements = monthCommand.tiaohou_needs.flatMap(need =>
    need.suggested_elements_by_rule.map(element => ({
      element,
      need: need.need,
      basis: need.basis,
    }))
  );
  const availableTiaohouElements = availableElementFacts(input, tiaohouSuggestedElements.map(item => item.element), ganZhiEffects);

  const allPatternCandidates = [
    ...patternCandidates.regular,
    ...patternCandidates.mixed_qi,
    ...patternCandidates.auxiliary,
  ];
  const patternSuggestedTenGods = allPatternCandidates.flatMap(candidate =>
    (PATTERN_RULES_BY_TEN_GOD[candidate.ten_god]?.suggested || []).map(tenGod => ({
      ten_god: tenGod,
      source_pattern: candidate.name,
      basis: PATTERN_RULES_BY_TEN_GOD[candidate.ten_god]?.basis || '',
    }))
  );
  const patternConflictTenGods = allPatternCandidates.flatMap(candidate =>
    (PATTERN_RULES_BY_TEN_GOD[candidate.ten_god]?.conflicts || []).map(tenGod => ({
      ten_god: tenGod,
      source_pattern: candidate.name,
      basis: PATTERN_RULES_BY_TEN_GOD[candidate.ten_god]?.basis || '',
      available_facts: collectTenGodFacts(input, [tenGod], ganZhiEffects),
    }))
  );
  const availablePatternTenGods = collectTenGodFacts(input, patternSuggestedTenGods.map(item => item.ten_god), ganZhiEffects);
  const supportingFacts = [
    ...dayMasterFacts.supporting_facts.resource_stems,
    ...dayMasterFacts.supporting_facts.peer_stems,
    ...dayMasterFacts.supporting_facts.resource_hidden_stems,
    ...dayMasterFacts.supporting_facts.peer_hidden_stems,
  ];
  const pressureFacts = [
    ...dayMasterFacts.pressure_facts.wealth,
    ...dayMasterFacts.pressure_facts.officer_killing,
    ...dayMasterFacts.pressure_facts.output,
  ];
  const allowAbsenceInferences = Boolean(input.time);
  const fuyiDirections = buildFuyiDirections(
    dayMasterFacts,
    supportingFacts,
    pressureFacts,
    allowAbsenceInferences,
  );
  const illnessFacts = buildIllnessFacts(
    dayMasterFacts,
    climateProblems,
    supportingFacts,
    pressureFacts,
    allowAbsenceInferences,
  );
  const remedyMaterials = illnessFacts.map(illness => buildRemedyMaterial(input, ganZhiEffects, illness));
  const tongguanConflicts = buildTongguanConflicts(input, ganZhiEffects);
  const mediatingElements = tongguanConflicts.map(conflict => ({
    element: conflict.mediating_element_by_rule,
    basis: `${conflict.elements.join('')}交战取${conflict.mediating_element_by_rule}通关`,
  }));
  const availableMediatingElements = availableElementFacts(input, mediatingElements.map(item => item.element), ganZhiEffects);
  const summaryMaterials = buildSummaryMaterials(tiaohouSuggestedElements, patternSuggestedTenGods, patternConflictTenGods, remedyMaterials, mediatingElements);

  return {
    method_version: 'yongshen_basis_facts_v1',
    tiaohou: {
      climate_problems: climateProblems,
      rule_suggested_elements: uniqueObjects(tiaohouSuggestedElements, item => `${item.element}:${item.need}`),
      available_elements_in_chart: availableTiaohouElements,
      affected_by_relations: relationLabelsAffectingElements(ganZhiEffects, tiaohouSuggestedElements.map(item => item.element)),
    },
    pattern: {
      candidate_patterns: allPatternCandidates.map(candidate => ({
        id: candidate.id,
        name: candidate.name,
        ten_god: candidate.ten_god,
        family: candidate.family,
      })),
      rule_suggested_ten_gods: uniqueObjects(patternSuggestedTenGods, item => `${item.ten_god}:${item.source_pattern}`),
      available_ten_gods_in_chart: availablePatternTenGods,
      pattern_conflicts: patternConflictTenGods.filter(item => item.available_facts.length > 0),
    },
    fuyi: {
      supporting_facts: supportingFacts,
      pressure_facts: pressureFacts,
      rule_suggested_directions: fuyiDirections,
    },
    bingyao: {
      illness_facts: illnessFacts,
      remedy_materials_by_rule: remedyMaterials,
    },
    tongguan: {
      conflict_facts: tongguanConflicts,
      mediating_elements_by_rule: uniqueObjects(mediatingElements, item => `${item.element}:${item.basis}`),
      available_mediating_elements: availableMediatingElements,
    },
    summary_materials: summaryMaterials,
    notes: ['本层只输出取用事实材料，不输出最终喜用忌。'],
  };
}

function addStemControlRelation(
  input: ZipingStructureInput,
  relations: GanZhiRelationFact[],
  controllerStem: string,
  controlledStem: string,
): void {
  const controllerElement = GAN_WUXING[controllerStem];
  const controlledElement = GAN_WUXING[controlledStem];
  if (!controllerElement || !controlledElement || WUXING_CONTROLS[controllerElement] !== controlledElement) return;
  relations.push(makeRelation(input, {
    type: 'stem_control_clash',
    relationLabel: `${controllerStem}${controllerElement}克${controlledStem}${controlledElement}`,
    stems: [controllerStem, controlledStem],
    evidence: [`天干相邻见${controllerStem}克${controlledStem}`],
  }));
}

function addBranchPairRelations(
  input: ZipingStructureInput,
  relations: GanZhiRelationFact[],
  pairs: string[][],
  type: string,
  relationName: string,
): void {
  const branches = pillarItems(input).map(item => item.pillar?.branch).filter(Boolean);
  pairs.forEach((pair) => {
    const [left, right] = pair;
    if (!branches.includes(left) || !branches.includes(right)) return;
    relations.push(makeRelation(input, {
      type,
      relationLabel: `${left}${right}${relationName}`,
      branches: pair,
      evidence: [`地支见${left}${right}${relationName}`],
    }));
  });
}

function makeRelation(
  input: ZipingStructureInput,
  options: {
    type: string;
    relationLabel: string;
    stems?: string[];
    branches?: string[];
    resultElement?: string;
    missingBranch?: string;
    evidence: string[];
  },
): GanZhiRelationFact {
  const branches = options.branches || [];
  const affectedHiddenStems = branches.flatMap(branch => hiddenStemFactsByBranch(input, branch));
  const affectedPatternCandidates = affectedPatternCandidateNames(input.patternCandidates, branches, options.resultElement);

  return {
    type: options.type,
    relation_label: options.relationLabel,
    stems: options.stems,
    branches: options.branches,
    result_element: options.resultElement,
    missing_branch: options.missingBranch,
    involves_month_branch: branches.includes(input.month?.branch || ''),
    involves_day_branch: branches.includes(input.day?.branch || ''),
    affected_hidden_stems: affectedHiddenStems,
    affected_pattern_candidates: affectedPatternCandidates,
    evidence: options.evidence,
  };
}

function hiddenStemFactsByBranch(input: ZipingStructureInput, branch: string): HiddenStemFact[] {
  return pillarItems(input)
    .filter(item => item.pillar?.branch === branch)
    .flatMap(item => hiddenStemFacts(item.pillar, item.position));
}

function affectedPatternCandidateNames(
  patternCandidates: PatternCandidatesResult | undefined,
  branches: string[],
  resultElement?: string,
): string[] {
  const allCandidates = [
    ...(patternCandidates?.regular || []),
    ...(patternCandidates?.mixedQi || []),
    ...(patternCandidates?.auxiliary || []),
  ];
  return allCandidates
    .filter(candidate =>
      branches.includes(candidate.monthBranch)
      || Boolean(resultElement && candidate.element === resultElement)
      || candidate.roots.some(root => branches.includes(root.branch))
    )
    .map(candidate => candidate.name);
}

function pillarItems(input: ZipingStructureInput): Array<{ position: PillarPosition; pillar: PillarData }> {
  return POSITIONS
    .map(position => ({ position, pillar: input[position] }))
    .filter((item): item is { position: PillarPosition; pillar: PillarData } => Boolean(item.pillar));
}

function hiddenStemFacts(pillar: PillarData, position: PillarPosition): HiddenStemFact[] {
  return (pillar?.hiddenStems || []).map((hidden, index) => ({
    position,
    branch: pillar.branch,
    stem: hidden.stem,
    ten_god: hidden.tenGod,
    element: hidden.element || GAN_WUXING[hidden.stem] || '',
    qi_level: QI_LEVELS[index] || 'residual_qi',
  }));
}

function collectMonthPenetrations(input: ZipingStructureInput, monthHiddenStems: HiddenStemFact[]): PenetrationFact[] {
  return monthHiddenStems
    .map((hidden) => {
      const positions = VISIBLE_PENETRATION_POSITIONS.filter(position => input[position]?.stem === hidden.stem);
      return {
        stem: hidden.stem,
        ten_god: hidden.ten_god,
        element: hidden.element,
        positions,
      };
    })
    .filter(item => item.positions.length > 0);
}

function patternEntryHint(tenGod: string, monthBranch: string): MonthCommandFacts['pattern_entry_hint'] {
  if (!tenGod) return 'unknown';
  if (MIXED_QI_MONTH_BRANCHES.has(monthBranch)) return 'mixed_qi';
  if (tenGod === '比肩' || tenGod === '劫财') return 'lu_ren';
  return 'regular';
}

function buildClimateFacts(input: ZipingStructureInput): MonthCommandFacts['climate_facts'] {
  const monthBranch = input.month?.branch || '';
  const base = MONTH_CLIMATE_RULES[monthBranch]?.climate || {};
  const climateFacts = {
    cold_sources: [...(base.cold || [])],
    heat_sources: [...(base.heat || [])],
    dryness_sources: [...(base.dryness || [])],
    dampness_sources: [...(base.dampness || [])],
  };

  pillarItems(input).forEach(({ position, pillar }) => {
    const label = `${POSITION_LABELS[position]}${pillar.ganZhi || `${pillar.stem}${pillar.branch}`}`;
    if (['亥', '子', '丑'].includes(pillar.branch)) climateFacts.cold_sources.push(`${label}见${pillar.branch}，补充寒湿材料`);
    if (['巳', '午', '未'].includes(pillar.branch)) climateFacts.heat_sources.push(`${label}见${pillar.branch}，补充火热材料`);
    if (['申', '酉', '戌', '未'].includes(pillar.branch)) climateFacts.dryness_sources.push(`${label}见${pillar.branch}，补充燥气材料`);
    if (['亥', '子', '丑', '辰'].includes(pillar.branch)) climateFacts.dampness_sources.push(`${label}见${pillar.branch}，补充湿气材料`);
    if (pillar.stemElement === '火') climateFacts.heat_sources.push(`${label}天干火透`);
    if (pillar.stemElement === '水') climateFacts.cold_sources.push(`${label}天干水透`);
  });

  return {
    cold_sources: uniqueStrings(climateFacts.cold_sources),
    heat_sources: uniqueStrings(climateFacts.heat_sources),
    dryness_sources: uniqueStrings(climateFacts.dryness_sources),
    dampness_sources: uniqueStrings(climateFacts.dampness_sources),
  };
}

function buildRootFacts(
  input: ZipingStructureInput,
  ganZhiEffects: GanZhiEffectsFacts,
): DayMasterFacts['roots'] {
  const dayElement = input.dayMasterElement || GAN_WUXING[input.dayMaster] || '';
  return pillarItems(input).flatMap(({ position, pillar }) =>
    (pillar.hiddenStems || []).flatMap((hidden, index) => {
      const hiddenElement = hidden.element || GAN_WUXING[hidden.stem] || '';
      const rootTypes: string[] = [];
      if (hidden.stem === input.dayMaster) rootTypes.push('same_stem_root');
      if (hiddenElement === dayElement) rootTypes.push('same_element_root');
      if (RESOURCE_TEN_GODS.has(hidden.tenGod)) rootTypes.push('resource_root');
      if (JIAN_LU_MONTH_BRANCH[input.dayMaster] === pillar.branch || YANG_REN_MONTH_BRANCH[input.dayMaster] === pillar.branch) {
        rootTypes.push('lu_wang_root');
      }
      if (rootTypes.length === 0) return [];
      return [{
        branch_position: position,
        branch: pillar.branch,
        stem: hidden.stem,
        ten_god: hidden.tenGod,
        element: hiddenElement,
        root_types: uniqueStrings(rootTypes),
        qi_level: QI_LEVELS[index] || 'residual_qi',
        affected_by_relations: relationLabelsByBranch(ganZhiEffects, pillar.branch),
      }];
    })
  );
}

function buildSupportingFacts(
  input: ZipingStructureInput,
  ganZhiEffects: GanZhiEffectsFacts,
): DayMasterFacts['supporting_facts'] {
  const visibleFacts = VISIBLE_PENETRATION_POSITIONS
    .map(position => visibleTenGodFact(input, position, ganZhiEffects))
    .filter((item): item is TenGodLocationFact => Boolean(item));
  const hiddenFacts = POSITIONS.flatMap(position => hiddenTenGodFacts(input, position, ganZhiEffects));

  return {
    resource_stems: visibleFacts.filter(item => RESOURCE_TEN_GODS.has(item.ten_god)),
    peer_stems: visibleFacts.filter(item => PEER_TEN_GODS.has(item.ten_god)),
    resource_hidden_stems: hiddenFacts.filter(item => RESOURCE_TEN_GODS.has(item.ten_god)),
    peer_hidden_stems: hiddenFacts.filter(item => PEER_TEN_GODS.has(item.ten_god)),
  };
}

function buildPressureFacts(
  input: ZipingStructureInput,
  ganZhiEffects: GanZhiEffectsFacts,
): DayMasterFacts['pressure_facts'] {
  const facts = [
    ...VISIBLE_PENETRATION_POSITIONS
      .map(position => visibleTenGodFact(input, position, ganZhiEffects))
      .filter((item): item is TenGodLocationFact => Boolean(item)),
    ...POSITIONS.flatMap(position => hiddenTenGodFacts(input, position, ganZhiEffects)),
  ];

  return {
    wealth: facts.filter(item => WEALTH_TEN_GODS.has(item.ten_god)),
    officer_killing: facts.filter(item => OFFICER_KILLING_TEN_GODS.has(item.ten_god)),
    output: facts.filter(item => OUTPUT_TEN_GODS.has(item.ten_god)),
  };
}

function visibleTenGodFact(
  input: ZipingStructureInput,
  position: PillarPosition,
  ganZhiEffects: GanZhiEffectsFacts,
): TenGodLocationFact | null {
  const pillar = input[position];
  if (!pillar?.stem || !pillar.tenGod || pillar.tenGod === '日主') return null;
  return {
    ten_god: pillar.tenGod,
    stem: pillar.stem,
    element: pillar.stemElement || GAN_WUXING[pillar.stem] || '',
    position,
    source: 'stem',
    affected_by_relations: relationLabelsByStem(ganZhiEffects, pillar.stem),
  };
}

function hiddenTenGodFacts(
  input: ZipingStructureInput,
  position: PillarPosition,
  ganZhiEffects: GanZhiEffectsFacts,
): TenGodLocationFact[] {
  const pillar = input[position];
  if (!pillar) return [];
  return (pillar?.hiddenStems || [])
    .filter(hidden => Boolean(hidden.tenGod))
    .map((hidden, index) => ({
      ten_god: hidden.tenGod,
      stem: hidden.stem,
      element: hidden.element || GAN_WUXING[hidden.stem] || '',
      position,
      source: 'hidden_stem' as const,
      branch: pillar.branch,
      qi_level: QI_LEVELS[index] || 'residual_qi',
      affected_by_relations: relationLabelsByBranch(ganZhiEffects, pillar.branch),
    }));
}

function buildSpecialPatternMaterials(
  input: ZipingStructureInput,
  roots: DayMasterFacts['roots'],
  supportFacts: TenGodLocationFact[],
  pressureFacts: TenGodLocationFact[],
): DayMasterFacts['special_pattern_materials'] {
  const materials: DayMasterFacts['special_pattern_materials'] = [];
  const elements = elementCountsInChart(input);
  const dominantElements = Object.entries(elements)
    .filter(([, count]) => count >= 4)
    .map(([element]) => element);

  if (input.time && roots.length === 0 && supportFacts.length === 0 && pressureFacts.length > 0) {
    materials.push({
      type: 'follow_weak_material',
      basis: ['日主无根气事实', '印比帮身事实未出现', '财官食伤压力事实出现'],
    });
  }
  if (input.time && roots.length >= 3 && supportFacts.length >= 3 && pressureFacts.length === 0) {
    materials.push({
      type: 'follow_strong_material',
      basis: ['日主根气多见', '印比帮身事实多见', '财官食伤压力事实未出现'],
    });
  }
  dominantElements.forEach((element) => {
    materials.push({
      type: 'dominant_element_material',
      basis: [`${element}在天干、地支、藏干中多处出现`],
    });
  });

  STEM_COMBINATIONS.forEach((rule) => {
    const stems = pillarItems(input).map(item => item.pillar?.stem).filter(Boolean);
    if (rule.stems.every(stem => stems.includes(stem))) {
      materials.push({
        type: 'transform_material',
        basis: [`${rule.label}存在，是否化气需后续判断`],
      });
    }
  });

  return materials;
}

function mapPatternCandidateFact(candidate: PatternCandidate): PatternCandidateFact {
  return {
    id: candidate.id,
    name: candidate.name,
    family: candidate.family,
    status: candidate.status,
    confidence: candidate.confidence,
    entry: candidate.entry,
    ten_god: candidate.tenGod,
    stem: candidate.stem,
    element: candidate.element,
    month_branch: candidate.monthBranch,
    evidence: candidate.evidence || [],
    penetrations: (candidate.penetration || []).map(item => ({
      position: item.position,
      stem: item.stem,
      ten_god: item.tenGod,
    })),
    roots: (candidate.roots || []).map(item => ({
      position: item.position,
      branch: item.branch,
      stem: item.stem,
      qi: item.qi,
    })),
    supporting_materials: candidate.supportSignals || [],
    conflict_materials: candidate.downgradeSignals || [],
    notes: candidate.notes || [],
  };
}

function sortPatternCandidatesForAi(candidates: PatternCandidate[]): PatternCandidate[] {
  const confidenceRank = { high: 0, medium: 1, low: 2 };
  const entryRank: Record<string, number> = {
    mixed_qi: 0,
    month_command: 1,
    jian_lu: 2,
    yue_jie: 2,
    yang_ren: 2,
    visible_stem_auxiliary: 3,
  };

  return [...candidates].sort((left, right) => {
    const confidenceDiff = (confidenceRank[left.confidence] ?? 9) - (confidenceRank[right.confidence] ?? 9);
    if (confidenceDiff !== 0) return confidenceDiff;
    return (entryRank[left.entry] ?? 9) - (entryRank[right.entry] ?? 9);
  });
}

function mapLuRenUsableGodFact(candidate: LuRenUsableGodCandidate): LuRenUsableGodFact {
  return {
    id: candidate.id,
    ten_god: candidate.tenGod,
    stem: candidate.stem,
    element: candidate.element,
    source: candidate.source,
    position: candidate.position,
    branches: candidate.branches,
    label: candidate.label,
    evidence: candidate.evidence || [],
    notes: candidate.notes || [],
  };
}

function buildClimateProblems(monthCommand: MonthCommandFacts): YongshenBasisFacts['tiaohou']['climate_problems'] {
  const entries: YongshenBasisFacts['tiaohou']['climate_problems'] = [];
  if (monthCommand.climate_facts.cold_sources.length > 0) entries.push({ type: 'cold', sources: monthCommand.climate_facts.cold_sources });
  if (monthCommand.climate_facts.heat_sources.length > 0) entries.push({ type: 'heat', sources: monthCommand.climate_facts.heat_sources });
  if (monthCommand.climate_facts.dryness_sources.length > 0) entries.push({ type: 'dryness', sources: monthCommand.climate_facts.dryness_sources });
  if (monthCommand.climate_facts.dampness_sources.length > 0) entries.push({ type: 'dampness', sources: monthCommand.climate_facts.dampness_sources });
  return entries;
}

function availableElementFacts(
  input: ZipingStructureInput,
  elements: string[],
  ganZhiEffects: GanZhiEffectsFacts,
): ElementLocationFact[] {
  const wanted = new Set(elements.filter(Boolean));
  if (wanted.size === 0) return [];
  const facts: ElementLocationFact[] = [];

  POSITIONS.forEach((position) => {
    const pillar = input[position];
    if (!pillar) return;
    const stemElement = pillar.stemElement || GAN_WUXING[pillar.stem] || '';
    if (wanted.has(stemElement) && pillar.tenGod !== '日主') {
      facts.push({
        element: stemElement,
        stem: pillar.stem,
        ten_god: pillar.tenGod,
        position,
        source: 'stem',
        affected_by_relations: relationLabelsByStem(ganZhiEffects, pillar.stem),
      });
    }
    (pillar.hiddenStems || []).forEach((hidden, index) => {
      const hiddenElement = hidden.element || GAN_WUXING[hidden.stem] || '';
      if (!wanted.has(hiddenElement)) return;
      facts.push({
        element: hiddenElement,
        stem: hidden.stem,
        ten_god: hidden.tenGod,
        position,
        source: 'hidden_stem',
        branch: pillar.branch,
        qi_level: QI_LEVELS[index] || 'residual_qi',
        affected_by_relations: relationLabelsByBranch(ganZhiEffects, pillar.branch),
      });
    });
  });

  return uniqueObjects(facts, item => `${item.element}:${item.stem}:${item.position}:${item.source}:${item.branch || ''}`);
}

function collectTenGodFacts(
  input: ZipingStructureInput,
  tenGods: string[],
  ganZhiEffects: GanZhiEffectsFacts,
): TenGodLocationFact[] {
  const wanted = new Set(tenGods.filter(Boolean));
  if (wanted.size === 0) return [];
  const facts = [
    ...VISIBLE_PENETRATION_POSITIONS
      .map(position => visibleTenGodFact(input, position, ganZhiEffects))
      .filter((item): item is TenGodLocationFact => Boolean(item)),
    ...POSITIONS.flatMap(position => hiddenTenGodFacts(input, position, ganZhiEffects)),
  ];

  return uniqueObjects(
    facts.filter(item => wanted.has(item.ten_god)),
    item => `${item.ten_god}:${item.stem}:${item.position}:${item.source}:${item.branch || ''}`,
  );
}

function relationLabelsAffectingElements(ganZhiEffects: GanZhiEffectsFacts, elements: string[]): string[] {
  const wanted = new Set(elements.filter(Boolean));
  return uniqueStrings(ganZhiEffects.relations
    .filter(relation =>
      (relation.result_element && wanted.has(relation.result_element))
      || relation.affected_hidden_stems.some(hidden => wanted.has(hidden.element))
    )
    .map(relation => relation.relation_label));
}

function buildFuyiDirections(
  dayMasterFacts: DayMasterFacts,
  supportingFacts: TenGodLocationFact[],
  pressureFacts: TenGodLocationFact[],
  allowAbsenceInferences: boolean,
): YongshenBasisFacts['fuyi']['rule_suggested_directions'] {
  const directions: YongshenBasisFacts['fuyi']['rule_suggested_directions'] = [];
  if (allowAbsenceInferences && (dayMasterFacts.roots.length === 0 || supportingFacts.length === 0)) {
    directions.push({
      direction: '印比扶身材料',
      basis: ['日主根气或印比帮身事实不足时，传统扶抑会记录印比材料'],
    });
  }
  if (pressureFacts.length > 0) {
    directions.push({
      direction: '财官食伤压力材料',
      basis: ['财官食伤克泄耗事实出现，需要交给解释层结合根气和印比判断能否承载'],
    });
  }
  if (dayMasterFacts.roots.length > 0 && supportingFacts.length > 0) {
    directions.push({
      direction: '泄耗制材料',
      basis: ['日主有根且有帮身事实时，传统扶抑会记录财官食伤能否成用的材料'],
    });
  }
  return directions;
}

function buildIllnessFacts(
  dayMasterFacts: DayMasterFacts,
  climateProblems: YongshenBasisFacts['tiaohou']['climate_problems'],
  supportingFacts: TenGodLocationFact[],
  pressureFacts: TenGodLocationFact[],
  allowAbsenceInferences: boolean,
): YongshenBasisFacts['bingyao']['illness_facts'] {
  const facts: YongshenBasisFacts['bingyao']['illness_facts'] = [];
  const hasLimitedSupport = allowAbsenceInferences
    && (dayMasterFacts.roots.length === 0 || supportingFacts.length === 0);

  if (dayMasterFacts.pressure_facts.wealth.length > 0 && hasLimitedSupport) {
    facts.push({ type: 'wealth_pressure_with_limited_support', basis: ['财星事实出现', '根气或印比材料不足'] });
  }
  if (dayMasterFacts.pressure_facts.officer_killing.length > 0 && hasLimitedSupport) {
    facts.push({ type: 'officer_killing_pressure_with_limited_support', basis: ['官杀事实出现', '根气或印比材料不足'] });
  }
  if (dayMasterFacts.pressure_facts.output.length > 0 && hasLimitedSupport) {
    facts.push({ type: 'output_pressure_with_limited_support', basis: ['食伤事实出现', '根气或印比材料不足'] });
  }
  if (allowAbsenceInferences && supportingFacts.filter(item => RESOURCE_TEN_GODS.has(item.ten_god)).length >= 3 && dayMasterFacts.pressure_facts.wealth.length === 0) {
    facts.push({ type: 'resource_many_without_wealth_material', basis: ['印星材料多见', '财星材料未见'] });
  }
  if (allowAbsenceInferences && supportingFacts.filter(item => PEER_TEN_GODS.has(item.ten_god)).length >= 3 && dayMasterFacts.pressure_facts.wealth.length === 0) {
    facts.push({ type: 'peer_many_without_wealth_material', basis: ['比劫材料多见', '财星材料未见'] });
  }
  if (climateProblems.some(item => item.type === 'cold' || item.type === 'dampness')) {
    facts.push({ type: 'cold_damp_material', basis: climateProblems.filter(item => item.type === 'cold' || item.type === 'dampness').flatMap(item => item.sources) });
  }
  if (climateProblems.some(item => item.type === 'heat' || item.type === 'dryness')) {
    facts.push({ type: 'heat_dry_material', basis: climateProblems.filter(item => item.type === 'heat' || item.type === 'dryness').flatMap(item => item.sources) });
  }
  if (pressureFacts.length === 0 && facts.length === 0) {
    return facts;
  }
  return facts;
}

function buildRemedyMaterial(
  input: ZipingStructureInput,
  ganZhiEffects: GanZhiEffectsFacts,
  illness: YongshenBasisFacts['bingyao']['illness_facts'][number],
): YongshenBasisFacts['bingyao']['remedy_materials_by_rule'][number] {
  const mapping: Record<string, { tenGods?: string[]; elements?: string[] }> = {
    wealth_pressure_with_limited_support: { tenGods: ['正印', '偏印', '比肩', '劫财'] },
    officer_killing_pressure_with_limited_support: { tenGods: ['正印', '偏印', '比肩', '劫财', '食神'] },
    output_pressure_with_limited_support: { tenGods: ['正印', '偏印', '比肩', '劫财'] },
    resource_many_without_wealth_material: { tenGods: ['正财', '偏财', '食神', '伤官'] },
    peer_many_without_wealth_material: { tenGods: ['正官', '七杀', '食神', '伤官', '正财', '偏财'] },
    cold_damp_material: { elements: ['火', '土'] },
    heat_dry_material: { elements: ['水', '金'] },
  };
  const rule = mapping[illness.type] || {};
  return {
    source_illness: illness.type,
    suggested_ten_gods: rule.tenGods,
    suggested_elements: rule.elements,
    available_ten_gods: collectTenGodFacts(input, rule.tenGods || [], ganZhiEffects),
    available_elements: availableElementFacts(input, rule.elements || [], ganZhiEffects),
  };
}

function buildTongguanConflicts(
  input: ZipingStructureInput,
  ganZhiEffects: GanZhiEffectsFacts,
): YongshenBasisFacts['tongguan']['conflict_facts'] {
  const conflictFacts: YongshenBasisFacts['tongguan']['conflict_facts'] = [];

  ganZhiEffects.relations
    .filter(relation => relation.type === 'stem_control_clash')
    .forEach((relation) => {
      const elements = (relation.stems || []).map(stem => GAN_WUXING[stem]).filter(Boolean);
      const key = elements.join('');
      const mediating = TONGGUAN_BY_CONFLICT[key];
      if (!mediating) return;
      conflictFacts.push({
        elements,
        source_relations: [relation.relation_label],
        mediating_element_by_rule: mediating,
      });
    });

  return uniqueObjects(conflictFacts, item => `${item.elements.join('')}:${item.mediating_element_by_rule}:${item.source_relations.join('|')}`);
}

function buildSummaryMaterials(
  tiaohouElements: Array<{ element: string; need: string }>,
  patternSuggestedTenGods: Array<{ ten_god: string; source_pattern: string }>,
  patternConflictTenGods: Array<{ ten_god: string; source_pattern: string }>,
  remedyMaterials: YongshenBasisFacts['bingyao']['remedy_materials_by_rule'],
  mediatingElements: Array<{ element: string; basis: string }>,
): YongshenBasisFacts['summary_materials'] {
  const supporting = new Map<string, { kind: 'element' | 'ten_god'; value: string; sources: Set<string> }>();
  const opposing = new Map<string, { kind: 'element' | 'ten_god'; value: string; sources: Set<string> }>();

  const addSupport = (kind: 'element' | 'ten_god', value: string, source: string) => {
    if (!value) return;
    const key = `${kind}:${value}`;
    if (!supporting.has(key)) supporting.set(key, { kind, value, sources: new Set() });
    supporting.get(key)?.sources.add(source);
  };
  const addOpposing = (kind: 'element' | 'ten_god', value: string, source: string) => {
    if (!value) return;
    const key = `${kind}:${value}`;
    if (!opposing.has(key)) opposing.set(key, { kind, value, sources: new Set() });
    opposing.get(key)?.sources.add(source);
  };

  tiaohouElements.forEach(item => addSupport('element', item.element, `调候:${item.need}`));
  patternSuggestedTenGods.forEach(item => addSupport('ten_god', item.ten_god, `格局:${item.source_pattern}`));
  patternConflictTenGods.forEach(item => addOpposing('ten_god', item.ten_god, `格局冲突:${item.source_pattern}`));
  remedyMaterials.forEach((item) => {
    (item.suggested_ten_gods || []).forEach(tenGod => addSupport('ten_god', tenGod, `病药:${item.source_illness}`));
    (item.suggested_elements || []).forEach(element => addSupport('element', element, `病药:${item.source_illness}`));
  });
  mediatingElements.forEach(item => addSupport('element', item.element, `通关:${item.basis}`));

  const supportingMaterials = Array.from(supporting.values()).map(item => ({
    kind: item.kind,
    value: item.value,
    sources: Array.from(item.sources),
  }));
  const opposingMaterials = Array.from(opposing.values()).map(item => ({
    kind: item.kind,
    value: item.value,
    sources: Array.from(item.sources),
  }));
  const conflictingMaterials = supportingMaterials.flatMap((support) => {
    const opposingItem = opposing.get(`${support.kind}:${support.value}`);
    if (!opposingItem) return [];
    return [{
      kind: support.kind,
      value: support.value,
      supporting_sources: support.sources,
      opposing_sources: Array.from(opposingItem.sources),
    }];
  });

  return {
    supporting_materials: supportingMaterials,
    opposing_materials: opposingMaterials,
    conflicting_materials: conflictingMaterials,
  };
}

function relationLabelsByBranch(ganZhiEffects: GanZhiEffectsFacts, branch: string): string[] {
  return uniqueStrings(ganZhiEffects.relations
    .filter(relation => (relation.branches || []).includes(branch))
    .map(relation => relation.relation_label));
}

function relationLabelsByStem(ganZhiEffects: GanZhiEffectsFacts, stem: string): string[] {
  return uniqueStrings(ganZhiEffects.relations
    .filter(relation => (relation.stems || []).includes(stem))
    .map(relation => relation.relation_label));
}

function elementCountsInChart(input: ZipingStructureInput): Record<string, number> {
  const counts: Record<string, number> = {};
  pillarItems(input).forEach(({ pillar }) => {
    const stemElement = pillar.stemElement || GAN_WUXING[pillar.stem] || '';
    if (stemElement) counts[stemElement] = (counts[stemElement] || 0) + 1;
    const branchElement = pillar.branchElement || ZHI_WUXING[pillar.branch] || '';
    if (branchElement) counts[branchElement] = (counts[branchElement] || 0) + 1;
    (pillar.hiddenStems || []).forEach((hidden) => {
      const hiddenElement = hidden.element || GAN_WUXING[hidden.stem] || '';
      if (hiddenElement) counts[hiddenElement] = (counts[hiddenElement] || 0) + 1;
    });
  });
  return counts;
}

function summarizePrimaryAndSecondaryPatterns(patterns: PatternCandidateFact[]): string {
  if (patterns.length === 0) return '未生成格局候选';
  const [primary, ...secondary] = patterns;
  const secondaryText = summarizeList(secondary.map(item => item.name), 4);
  if (!secondaryText) return `优先候选：${primary.name}`;
  return `优先候选：${primary.name}；其他候选：${secondaryText}`;
}

function summarizeVisibleStemFacts(dayMaster: DayMasterFacts): string {
  const positionOrder: Record<PillarPosition, number> = {
    year: 0,
    month: 1,
    day: 2,
    time: 3,
  };
  const visibleFacts = [
    ...dayMaster.supporting_facts.resource_stems,
    ...dayMaster.supporting_facts.peer_stems,
    ...dayMaster.pressure_facts.wealth,
    ...dayMaster.pressure_facts.officer_killing,
    ...dayMaster.pressure_facts.output,
  ]
    .filter(item => item.source === 'stem')
    .sort((left, right) => positionOrder[left.position] - positionOrder[right.position])
    .map(item => `${positionText(item.position)}${item.stem}${item.ten_god}`);

  return summarizeList(visibleFacts, 4);
}

function summarizeGanZhiEffectsForAi(ganZhiEffects: GanZhiEffectsFacts): ZipingAiBriefResult['gan_zhi_effects'] {
  const heavenlyStems = ganZhiEffects.relations
    .filter(item => (item.stems || []).length > 0)
    .map(item => item.relation_label);
  const earthlyBranches = ganZhiEffects.relations
    .filter(item => (item.branches || []).length > 0)
    .map(item => item.relation_label);

  return {
    heavenly_stems: uniqueStrings(heavenlyStems),
    earthly_branches: uniqueStrings(earthlyBranches),
  };
}

function summarizeList(values: string[], limit: number): string {
  const unique = uniqueStrings(values);
  if (unique.length === 0) return '';
  const shown = unique.slice(0, limit);
  const suffix = unique.length > limit ? `等${unique.length}项` : '';
  return `${shown.join('、')}${suffix}`;
}

function positionText(position: PillarPosition): string {
  return POSITION_LABELS[position] || position;
}

function qiText(qiLevel: QiLevel): string {
  if (qiLevel === 'main_qi') return '主气';
  if (qiLevel === 'middle_qi') return '中气';
  return '余气';
}

function summarizeClimateForAi(month: MonthCommandFacts, usage: YongshenBasisFacts): string {
  const baseTypes = climateTypesFromMonthBase(month);
  const allTypes = usage.tiaohou.climate_problems.map(item => item.type);
  const extraTypes = allTypes.filter(type => !baseTypes.includes(type));
  const baseText = climateGroupText(baseTypes);
  const extraText = climateGroupText(extraTypes);

  if (baseText && extraText) return `月令${baseText}，原局另见${extraText}`;
  if (baseText) return `月令${baseText}`;
  if (extraText) return `原局见${extraText}`;
  return '无明显气候材料';
}

function climateTypesFromMonthBase(month: MonthCommandFacts): Array<'cold' | 'heat' | 'dryness' | 'dampness'> {
  const result: Array<'cold' | 'heat' | 'dryness' | 'dampness'> = [];
  const isBaseSource = (source: string) => !source.includes('补充') && !source.includes('天干');

  if (month.climate_facts.cold_sources.some(isBaseSource)) result.push('cold');
  if (month.climate_facts.heat_sources.some(isBaseSource)) result.push('heat');
  if (month.climate_facts.dryness_sources.some(isBaseSource)) result.push('dryness');
  if (month.climate_facts.dampness_sources.some(isBaseSource)) result.push('dampness');

  return result;
}

function climateGroupText(types: Array<'cold' | 'heat' | 'dryness' | 'dampness'>): string {
  const set = new Set(types);
  if (set.size === 0) return '';
  const parts: string[] = [];

  if (set.has('cold') && set.has('dampness')) {
    parts.push('寒湿');
  } else {
    if (set.has('cold')) parts.push('寒');
    if (set.has('dampness')) parts.push('湿');
  }

  if (set.has('heat') && set.has('dryness')) {
    parts.push('火燥');
  } else {
    if (set.has('heat')) parts.push('热');
    if (set.has('dryness')) parts.push('燥');
  }

  return parts.join('、');
}

function climateTextByType(type: YongshenBasisFacts['tiaohou']['climate_problems'][number]['type']): string {
  const map = {
    cold: '寒',
    heat: '热',
    dryness: '燥',
    dampness: '湿',
  };
  return map[type];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueObjects<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  items.forEach((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}
