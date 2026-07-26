import type { DailyFortuneUserContext } from './DailyFortuneContext';

export const DAILY_FORTUNE_CONTRACT_VERSION = 'daily_fortune_ai_first_v2' as const;
export const DAILY_FORTUNE_PROMPT_VERSION = 'daily_fortune_prompt_v6' as const;

export const DAILY_FORTUNE_SCENES = [
  'career',
  'love',
  'health',
  'study',
  'wealth',
] as const;

export const DAILY_FORTUNE_ITEM_KINDS = [
  'possible_event',
  'attention',
] as const;

export type DailyFortuneScene = typeof DAILY_FORTUNE_SCENES[number];
export type DailyFortuneItemKind = typeof DAILY_FORTUNE_ITEM_KINDS[number];
export type DailyFortunePillarPosition = 'year' | 'month' | 'day' | 'hour';

export type DailyFortuneJsonPrimitive = string | number | boolean | null;
export type DailyFortuneJsonValue =
  | DailyFortuneJsonPrimitive
  | DailyFortuneJsonValue[]
  | { [key: string]: DailyFortuneJsonValue };

export interface DailyFortuneHiddenStem {
  stem: string;
  ten_god: string;
  element: string;
}

export interface DailyFortunePillar {
  position: DailyFortunePillarPosition;
  gan_zhi: string;
  stem?: string;
  branch?: string;
  ten_god?: string;
  stem_element?: string;
  branch_element?: string;
  hidden_stems: DailyFortuneHiddenStem[];
  lifecycle?: string;
  self_sitting?: string;
  void_info?: string;
  na_yin?: string;
  shen_sha?: DailyFortuneJsonValue;
}

export interface DailyFortuneProfileFacts {
  gender?: string;
  birth_date: string;
  birth_place?: string;
  birth_timezone: string;
}

export interface DailyFortuneNatalFacts {
  pillars: DailyFortunePillar[];
  day_master: string;
  day_master_element?: string;
}

export interface DailyFortuneTimingPillar {
  gan_zhi: string;
  stem: string | null;
  branch: string | null;
  ten_god?: string;
  ten_god_top?: string;
  ten_god_bottom?: string;
  stem_element?: string;
  branch_element?: string;
  hidden_stems: DailyFortuneHiddenStem[];
  lifecycle?: string;
  self_sitting?: string;
  na_yin?: string;
  date?: string;
  year?: number;
  month?: number;
  solar_term?: string | null;
}

export interface DailyFortuneTimingFacts {
  dayun: DailyFortuneTimingPillar;
  liunian: DailyFortuneTimingPillar;
  liuyue: DailyFortuneTimingPillar;
  liuri: DailyFortuneTimingPillar;
}

export interface DailyFortuneInteractionParticipant {
  type: string;
  pillar: string | null;
  label: string;
  stem: string;
  branch: string;
  gan_zhi: string;
  ten_gods: string[];
}

export interface DailyFortuneMingliInteraction {
  id: string;
  scope: string;
  relation: string;
  relation_name: string;
  aliases: string[];
  participants: DailyFortuneInteractionParticipant[];
  source: DailyFortuneInteractionParticipant | null;
  targets: DailyFortuneInteractionParticipant[];
  transform_element: string | null;
  center_branch: string | null;
  activated_palaces: string[];
  intensity: number;
  time_horizon: string;
  adjacent: boolean;
  full_match: boolean;
  missing_branch: string | null;
  seen_stem: string | null;
  compared_against: string;
  rule_version: string;
}

export interface DailyFortuneMingliInteractions {
  rule_version: string;
  natal: DailyFortuneMingliInteraction[];
  timing: DailyFortuneMingliInteraction[];
}

export interface DailyFortuneFactPackage {
  contract_version: typeof DAILY_FORTUNE_CONTRACT_VERSION;
  effective_date: string;
  timezone: string;
  day_boundary: 'zi_chu_23_local';
  profile: DailyFortuneProfileFacts;
  natal: DailyFortuneNatalFacts;
  timing: DailyFortuneTimingFacts;
  mingli_interactions: DailyFortuneMingliInteractions;
  user_context: DailyFortuneUserContext;
}

export interface DailyFortuneOverall {
  headline: string;
  body: string;
}

export interface DailyFortuneItem {
  kind: DailyFortuneItemKind;
  title: string;
  body: string;
}

export interface DailyFortuneSelectedScene {
  scene: DailyFortuneScene;
  headline: string;
  items: [DailyFortuneItem, DailyFortuneItem];
}

export interface DailyFortuneAiContent {
  overall: DailyFortuneOverall;
  selected_scenes: [DailyFortuneSelectedScene, DailyFortuneSelectedScene];
}
