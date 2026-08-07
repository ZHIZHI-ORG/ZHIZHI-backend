import type { DailyFortuneFactPackage, DailyFortuneHiddenStem } from '../src/models/DailyFortune';
import { buildDailyFortuneFactPackage } from '../src/services/dailyFortuneService';
import { ZHI_HIDDEN_STEMS } from '../src/utils/baziCalculator';
import {
  buildNatalMingliInteractions,
  buildTimingMingliInteractions,
  MingliInteraction,
} from '../src/utils/mingliInteractionEngine';

export interface DailyFortunePromptEvalCase {
  id: string;
  title: string;
  review_focus: string[];
  forbidden_terms: string[];
  required_relations: string[];
  forbidden_relations: string[];
  comparison_group: string | null;
  facts: DailyFortuneFactPackage;
}

type PillarPosition = 'year' | 'month' | 'day' | 'hour';
type PillarInput = [PillarPosition, string, string];
type TimingInput = [string, string];

interface EvalCaseInput {
  id: string;
  title: string;
  reviewFocus: string[];
  forbiddenTerms?: string[];
  requiredRelations: string[];
  forbiddenRelations?: string[];
  comparisonGroup?: string;
  pillars: PillarInput[];
  timing: {
    dayun: TimingInput;
    liunian: TimingInput;
    liuyue: TimingInput;
    liuri: TimingInput;
  };
  profileContext?: Record<string, unknown>;
  mbti?: string;
}

const STEM_ELEMENT: Record<string, string> = {
  甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土',
  庚: '金', 辛: '金', 壬: '水', 癸: '水',
};

// All cases use 己土 as day master; stem order comes from the production engine.
const TEN_GOD_BY_STEM: Record<string, string> = {
  甲: '正官', 乙: '七杀', 丙: '正印', 丁: '偏印', 戊: '劫财',
  己: '比肩', 庚: '伤官', 辛: '食神', 壬: '正财', 癸: '偏财',
};

function hidden(stem: string, tenGod: string): DailyFortuneHiddenStem {
  return { stem, ten_god: tenGod, element: STEM_ELEMENT[stem] };
}

function hiddenStems(branch: string): DailyFortuneHiddenStem[] {
  return (ZHI_HIDDEN_STEMS[branch] || []).map((stem) => hidden(stem, TEN_GOD_BY_STEM[stem]));
}

function enginePillar(input: PillarInput) {
  const [, ganZhi, tenGod] = input;
  const [stem, branch] = [...ganZhi];
  return {
    stem,
    branch,
    ganZhi,
    tenGod,
    hiddenStems: hiddenStems(branch).map((item) => ({
      stem: item.stem,
      tenGod: item.ten_god,
      element: item.element,
    })),
  };
}

function contractPillar(input: PillarInput) {
  const [position, ganZhi, tenGod] = input;
  const [stem, branch] = [...ganZhi];
  return {
    position,
    gan_zhi: ganZhi,
    stem,
    branch,
    ten_god: tenGod,
    stem_element: STEM_ELEMENT[stem],
    hidden_stems: hiddenStems(branch),
  };
}

function engineTiming(input: TimingInput) {
  const [ganZhi, tenGod] = input;
  const [stem, branch] = [...ganZhi];
  return { ganZhi, stem, branch, tenGod, tenGodTop: tenGod };
}

function contractTiming(input: TimingInput, extras: Record<string, unknown> = {}) {
  const [ganZhi, tenGod] = input;
  const [stem, branch] = [...ganZhi];
  return {
    gan_zhi: ganZhi,
    stem,
    branch,
    ten_god: tenGod,
    ten_god_top: tenGod,
    stem_element: STEM_ELEMENT[stem],
    hidden_stems: hiddenStems(branch),
    ...extras,
  };
}

function participantToContract(participant: MingliInteraction['participants'][number]) {
  return {
    type: participant.type,
    pillar: participant.pillar || null,
    label: participant.label,
    stem: participant.stem || '',
    branch: participant.branch || '',
    gan_zhi: participant.ganZhi || '',
    ten_gods: participant.tenGods || [],
  };
}

function interactionToContract(item: MingliInteraction) {
  return {
    id: item.id,
    scope: item.scope,
    relation: item.relation,
    relation_name: item.relationName,
    fact_label: item.factLabel,
    short_label: item.shortLabel,
    display_group: item.displayGroup,
    aliases: item.aliases,
    participants: item.participants.map(participantToContract),
    source: item.source ? participantToContract(item.source) : null,
    targets: item.targets.map(participantToContract),
    transform_element: item.transformElement || null,
    center_branch: item.centerBranch || null,
    activated_palaces: item.activatedPalaces,
    domain_candidates: item.domainCandidates,
    intensity: item.intensity,
    time_horizon: item.timeHorizon,
    evidence: item.evidence,
    adjacent: item.adjacent,
    full_match: item.fullMatch,
    missing_branch: item.missingBranch || null,
    seen_stem: item.seenStem || null,
    compared_against: item.comparedAgainst,
    rule_version: item.ruleVersion,
  };
}

function makeEvalCase(input: EvalCaseInput): DailyFortunePromptEvalCase {
  const chart = Object.fromEntries(input.pillars.map((pillar) => {
    const position = pillar[0] === 'hour' ? 'time' : pillar[0];
    return [position, enginePillar(pillar)];
  }));
  const timingContext = {
    dayun: engineTiming(input.timing.dayun),
    liunian: engineTiming(input.timing.liunian),
    liuyue: engineTiming(input.timing.liuyue),
    liuri: engineTiming(input.timing.liuri),
  };
  const natalInteractions = buildNatalMingliInteractions(chart as any);
  const timingInteractions = buildTimingMingliInteractions(chart as any, timingContext as any);
  const bundle = {
    profile: {
      id: `eval-${input.id}`,
      owner_user_id: 'eval-user',
      is_owner: true,
      name: input.title,
      gender: 'female',
      birth_year: 1992,
      birth_month: 6,
      birth_day: 8,
      birth_hour: input.pillars.some(([position]) => position === 'hour') ? 9 : null,
      birth_minute: input.pillars.some(([position]) => position === 'hour') ? 30 : null,
      is_lunar: false,
      birth_timezone: 'Asia/Shanghai',
      birth_region: '上海',
      mbti: input.mbti ?? null,
      daily_fortune_context: input.profileContext ?? {},
      updated_at: '2026-07-22T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    },
    chart: {
      day_master: '己',
      day_master_element: '土',
      pillars: input.pillars.map(contractPillar),
      mingli_facts: {
        rule_version: 'mingli_interactions_v1',
        natal_interactions: natalInteractions.map(interactionToContract),
      },
    },
    timeline: {
      active_luck_context: {
        dayun: contractTiming(input.timing.dayun, { start_year: 2024, end_year: 2033 }),
        liunian: contractTiming(input.timing.liunian, { year: 2026 }),
        liuyue: contractTiming(input.timing.liuyue, { month: 7 }),
        liuri: contractTiming(input.timing.liuri, { date: '2026-07-23' }),
      },
      timing_interactions: timingInteractions.map(interactionToContract),
    },
  };
  const facts = buildDailyFortuneFactPackage(
    bundle as any,
    '2026-07-23',
    'Asia/Hong_Kong',
  );

  return {
    id: input.id,
    title: input.title,
    review_focus: input.reviewFocus,
    forbidden_terms: input.forbiddenTerms ?? [],
    required_relations: input.requiredRelations,
    forbidden_relations: input.forbiddenRelations ?? [],
    comparison_group: input.comparisonGroup ?? null,
    facts,
  };
}

export const dailyFortunePromptEvalCases = [
  makeEvalCase({
    id: 'three-pillar-multiple-clashes',
    title: '三柱档案与多层冲动',
    pillars: [['year', '甲子', '正官'], ['month', '乙未', '七杀'], ['day', '己丑', '日主']],
    timing: { dayun: ['丁卯', '偏印'], liunian: ['丙午', '正印'], liuyue: ['乙未', '七杀'], liuri: ['己丑', '比肩'] },
    requiredRelations: ['branch_clash'],
    reviewFocus: ['不得出现时柱推断', 'Top 2 由命理事实决定', '不能把冲直接写成坏事'],
    forbiddenTerms: ['时柱', '出生时辰'],
  }),
  makeEvalCase({
    id: 'four-pillar-hour-included',
    title: '四柱档案包含真实时柱',
    pillars: [['year', '辛酉', '食神'], ['month', '丁巳', '偏印'], ['day', '己亥', '日主'], ['hour', '乙丑', '七杀']],
    timing: { dayun: ['戊子', '劫财'], liunian: ['丙午', '正印'], liuyue: ['甲申', '正官'], liuri: ['癸巳', '偏财'] },
    requiredRelations: ['branch_clash', 'branch_piercing'],
    reviewFocus: ['真实时柱可以参与判断', '不能只复述单一关系', '总述统摄两个场景'],
  }),
  makeEvalCase({
    id: 'conditional-context-control',
    title: '条件性合会的空背景对照',
    pillars: [['year', '庚子', '伤官'], ['month', '丁巳', '偏印'], ['day', '己卯', '日主']],
    timing: { dayun: ['辛酉', '食神'], liunian: ['丙午', '正印'], liuyue: ['壬寅', '正财'], liuri: ['癸亥', '偏财'] },
    requiredRelations: ['branch_clash', 'branch_half_harmony', 'branch_half_meeting'],
    forbiddenRelations: ['branch_three_harmony', 'branch_three_meeting'],
    comparisonGroup: 'study-context-neutrality',
    reviewFocus: ['半合半会不得升级成完整三合三会', '当天触发放入大运背景', '记录空背景下的 Top 2'],
  }),
  makeEvalCase({
    id: 'rich-study-context-does-not-rank',
    title: '丰富学习背景不能反向决定场景',
    pillars: [['year', '庚子', '伤官'], ['month', '丁巳', '偏印'], ['day', '己卯', '日主']],
    timing: { dayun: ['辛酉', '食神'], liunian: ['丙午', '正印'], liuyue: ['壬寅', '正财'], liuri: ['癸亥', '偏财'] },
    requiredRelations: ['branch_clash', 'branch_half_harmony', 'branch_half_meeting'],
    forbiddenRelations: ['branch_three_harmony', 'branch_three_meeting'],
    comparisonGroup: 'study-context-neutrality',
    reviewFocus: ['先由命理事实选择 Top 2', '学习资料只负责表达', '不暴露画像来源'],
    forbiddenTerms: ['MBTI', '知之', '画像', '系统认为'],
    mbti: 'INTJ',
    profileContext: {
      life_stage: { primary: '研究生阶段', tags: ['准备考试'] },
      work_study: { mode: 'study', study_status: '全日制研究生', current_goal: '完成论文并准备资格考试' },
      relationship: { status: '单身' },
      zhizhi_understanding: {
        snapshot_version: 'eval-v1',
        current_focus: ['论文进度', '考试准备'],
        expression_preferences: ['直接', '具体行动'],
        behavior_signals: ['近期持续查看学习内容'],
        updated_at: '2026-07-22T08:00:00.000Z',
      },
    },
  }),
];
