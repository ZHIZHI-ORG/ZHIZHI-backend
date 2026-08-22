import { createHash } from 'node:crypto';
import { BaziProfile } from '../models/BaziProfile';
import { DailyFortuneFactPackage, DailyFortuneMingliInteraction } from '../models/DailyFortune';
import {
  MEDIUM_INSIGHT_CONTEXT_VERSION,
  MEDIUM_INSIGHT_FACT_VERSION,
  MediumInsightFactProjection,
  MediumInsightFactReference,
  MediumInsightFactSnapshot,
} from '../models/MediumInsight';
import type { ZipingStructureFactsResult } from '../utils/zipingStructureFacts';

export class MediumInsightFactError extends Error {
  constructor(message: string, public readonly code = 'FACTS_INCOMPLETE') {
    super(message);
    this.name = 'MediumInsightFactError';
  }
}

export function projectMediumInsightFacts(input: {
  profile: BaziProfile;
  facts: DailyFortuneFactPackage;
  zipingStructureFacts: ZipingStructureFactsResult | null;
}): MediumInsightFactProjection {
  if (!input.profile.is_owner) {
    throw new MediumInsightFactError('逐项理解只支持本人命盘');
  }
  if (!input.profile.updated_at) {
    throw new MediumInsightFactError('档案缺少并发版本');
  }
  if (input.facts.natal.pillars.length !== 3 && input.facts.natal.pillars.length !== 4) {
    throw new MediumInsightFactError('中卡事实必须包含实际保存的三柱或四柱');
  }
  if (!input.zipingStructureFacts
    || input.zipingStructureFacts.method_version !== 'ziping_structure_v2_fact_layer') {
    throw new MediumInsightFactError('中卡 V2 缺少可验证的子平结构事实');
  }
  const hourPrecision = input.zipingStructureFacts.hour_precision;

  const references: Omit<MediumInsightFactReference, 'ref'>[] = [];
  references.push({
    source: 'day_master',
    canonical_source: 'natal.day_master',
    canonical_text: `日主为${input.facts.natal.day_master}${input.facts.natal.day_master_element ? `，五行为${input.facts.natal.day_master_element}` : ''}`,
    relation: null,
    participants: [input.facts.natal.day_master],
    scope: 'natal',
    time_horizon: 'baseline',
    full_match: null,
    conditions: [],
  });

  for (const pillar of input.facts.natal.pillars) {
    const hidden = pillar.hidden_stems
      .map((item) => `${item.stem}${item.ten_god ? `(${item.ten_god})` : ''}`)
      .join('、');
    references.push({
      source: 'natal_pillar',
      canonical_source: `natal.pillars.${pillar.position}`,
      canonical_text: `${pillar.position}柱${pillar.gan_zhi}${pillar.ten_god ? `，天干十神${pillar.ten_god}` : ''}${hidden ? `，藏干${hidden}` : ''}`,
      relation: null,
      participants: [pillar.gan_zhi],
      scope: `natal_${pillar.position}`,
      time_horizon: 'baseline',
      full_match: null,
      conditions: [],
    });
  }

  const dayun = input.facts.timing.dayun;
  const dayunRange = hourPrecision === 'known' ? [
    dayun.start_date && dayun.end_date ? `${dayun.start_date}至${dayun.end_date}` : null,
    typeof dayun.start_year === 'number' && typeof dayun.end_year === 'number'
      ? `${dayun.start_year}至${dayun.end_year}年`
      : null,
    typeof dayun.age_start === 'number' && typeof dayun.age_end === 'number'
      ? `${dayun.age_start}至${dayun.age_end}岁`
      : null,
    dayun.label || null,
  ].filter((item): item is string => Boolean(item)) : [];
  const dayunPayload = {
    gan_zhi: dayun.gan_zhi,
    stem: dayun.stem,
    branch: dayun.branch,
    ten_god: dayun.ten_god,
    ten_god_top: dayun.ten_god_top,
    ten_god_bottom: dayun.ten_god_bottom,
    hidden_stems: dayun.hidden_stems,
    ...(hourPrecision === 'known' ? {
      start_date: dayun.start_date,
      end_date: dayun.end_date,
      start_year: dayun.start_year,
      end_year: dayun.end_year,
      age_start: dayun.age_start,
      age_end: dayun.age_end,
      label: dayun.label,
    } : {}),
  };
  references.push({
    source: 'dayun',
    canonical_source: 'timing.dayun',
    canonical_text: `当前大运${dayun.gan_zhi}${dayun.ten_god_top ? `，天干十神${dayun.ten_god_top}` : ''}${dayun.ten_god_bottom ? `，地支主气十神${dayun.ten_god_bottom}` : ''}${dayunRange.length ? `，范围${dayunRange.join('、')}` : ''}`,
    fact_payload: dayunPayload,
    relation: null,
    participants: [dayun.gan_zhi],
    scope: 'dayun',
    time_horizon: 'ten_years',
    full_match: null,
    conditions: hourPrecision === 'unknown' ? ['unknown_hour_dayun_boundary_approximate'] : [],
  });

  for (const interaction of input.facts.mingli_interactions.natal) {
    references.push(projectInteraction(interaction, 'natal_interaction', 'baseline'));
  }
  for (const interaction of input.facts.mingli_interactions.timing) {
    if (interaction.time_horizon !== 'ten_years') continue;
    references.push(projectInteraction(
      interaction,
      'dayun_interaction',
      'ten_years',
      hourPrecision === 'unknown' ? ['unknown_hour_dayun_boundary_approximate'] : [],
    ));
  }

  const structure = input.zipingStructureFacts;
  const structureMetadata = {
    hour_precision: structure.hour_precision,
    observed_pillars: structure.observed_pillars,
  };
  const structureConditions = structure.hour_precision === 'unknown'
    ? ['partial', 'unknown_hour']
    : [];
  const yongshenBasisForAi = projectYongshenBasisForAi(structure.yongshen_basis_facts);
  const structureBytes = Buffer.byteLength(JSON.stringify({
    month_command: structure.month_command,
    day_master_facts: structure.day_master_facts,
    pattern_candidates: structure.pattern_candidates,
    yongshen_basis_facts: yongshenBasisForAi,
  }), 'utf8');
  if (structureBytes > 96 * 1024) {
    throw new MediumInsightFactError('中卡子平结构事实超过安全上限', 'STRUCTURE_FACTS_TOO_LARGE');
  }
  const patternItems = [
    ...structure.pattern_candidates.regular,
    ...structure.pattern_candidates.mixed_qi,
    ...structure.pattern_candidates.auxiliary,
  ];
  references.push({
    source: 'month_command',
    canonical_source: 'ziping_structure_v2_fact_layer.month_command',
    canonical_text: `月令为${structure.month_command.month_branch}，司令${structure.month_command.command_stem}${structure.month_command.command_ten_god}`,
    fact_payload: { ...structureMetadata, value: structure.month_command },
    relation: null,
    participants: [structure.month_command.month_branch, structure.month_command.command_stem],
    scope: 'natal_structure',
    time_horizon: 'baseline',
    full_match: null,
    conditions: structureConditions,
  });
  references.push({
    source: 'day_master_capacity',
    canonical_source: 'ziping_structure_v2_fact_layer.day_master_facts',
    canonical_text: `日主${structure.day_master_facts.day_master}${structure.day_master_facts.element}，月令状态${structure.day_master_facts.season_state.state}`,
    fact_payload: { ...structureMetadata, value: structure.day_master_facts },
    relation: null,
    participants: [structure.day_master_facts.day_master, structure.day_master_facts.season_state.month_branch],
    scope: 'natal_structure',
    time_horizon: 'baseline',
    full_match: null,
    conditions: structureConditions,
  });
  references.push({
    source: 'pattern_candidates',
    canonical_source: 'ziping_structure_v2_fact_layer.pattern_candidates',
    canonical_text: patternItems.length > 0
      ? `格局候选材料：${patternItems.map((item) => `${item.name}(${item.status})`).join('、')}`
      : structure.hour_precision === 'unknown'
        ? '已知三柱范围内未形成格局候选材料'
        : '当前完整命盘事实层没有形成格局候选材料',
    fact_payload: { ...structureMetadata, value: structure.pattern_candidates },
    relation: null,
    participants: patternItems.map((item) => item.name),
    scope: 'natal_structure',
    time_horizon: 'baseline',
    full_match: null,
    conditions: structureConditions,
  });
  references.push({
    source: 'yongshen_basis',
    canonical_source: 'ziping_structure_v2_fact_layer.yongshen_basis_facts',
    canonical_text: '取用依据仅包含调候、格局、扶抑、病药与通关材料，不包含最终喜用忌裁决',
    fact_payload: { ...structureMetadata, value: yongshenBasisForAi },
    relation: null,
    participants: [],
    scope: 'natal_structure',
    time_horizon: 'baseline',
    full_match: null,
    conditions: [...structureConditions, 'evidence_only', 'no_final_yongshen_verdict'],
  });

  if (references.length < 5) {
    throw new MediumInsightFactError('中卡事实不足，不能生成泛化内容');
  }

  const snapshot: MediumInsightFactSnapshot = {
      version: MEDIUM_INSIGHT_FACT_VERSION,
      effective_date: input.facts.effective_date,
      profile_id: input.profile.id,
      profile_updated_at: input.profile.updated_at,
      facts: references.map((reference, index) => ({ ref: `F${index + 1}`, ...reference })),
  };
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 192 * 1024) {
    throw new MediumInsightFactError('中卡事实快照超过安全上限', 'FACT_SNAPSHOT_TOO_LARGE');
  }

  return {
    snapshot,
    groundingContext: {
      version: MEDIUM_INSIGHT_CONTEXT_VERSION,
      user_context: input.facts.user_context,
    },
  };
}

function projectYongshenBasisForAi(
  facts: ZipingStructureFactsResult['yongshen_basis_facts'],
) {
  const { summary_materials: _summaryMaterials, ...projected } = facts;
  return projected;
}

export function hashMediumInsightFactSnapshot(snapshot: MediumInsightFactSnapshot): string {
  // profile_updated_at is a concurrency fence, not a 命理 fact. Context-only
  // edits advance that timestamp but must not consume the one allowed hard-fact
  // replacement for the day.
  const hashInput = {
    version: snapshot.version,
    effective_date: snapshot.effective_date,
    profile_id: snapshot.profile_id,
    facts: snapshot.facts,
  };
  return createHash('sha256').update(canonicalJson(hashInput)).digest('hex');
}

function projectInteraction(
  interaction: DailyFortuneMingliInteraction,
  source: 'natal_interaction' | 'dayun_interaction',
  timeHorizon: 'baseline' | 'ten_years',
  extraConditions: string[] = [],
): Omit<MediumInsightFactReference, 'ref'> {
  const participants = interaction.participants.map((participant) => (
    `${participant.type}:${participant.pillar ?? 'none'}:${participant.gan_zhi}`
  ));
  const conditions = [
    interaction.missing_branch ? `missing_branch:${interaction.missing_branch}` : null,
    interaction.seen_stem ? `seen_stem:${interaction.seen_stem}` : null,
    interaction.adjacent ? 'adjacent' : null,
    ...interaction.activated_palaces.map((palace) => `activated_palace:${palace}`),
    ...extraConditions,
  ].filter((value): value is string => Boolean(value));
  return {
    source,
    canonical_source: `${source}.${interaction.id}`,
    canonical_text: `${interaction.scope}存在${interaction.relation}${interaction.full_match ? '完整关系' : '条件关系'}，参与者${participants.join('、')}`,
    relation: interaction.relation,
    participants,
    scope: interaction.scope,
    time_horizon: timeHorizon,
    full_match: interaction.full_match,
    conditions,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
