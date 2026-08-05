import type {
  DailyFortuneFactPackage,
  DailyFortuneHiddenStem,
  DailyFortuneInteractionParticipant,
  DailyFortuneMingliInteraction,
  DailyFortunePillar,
  DailyFortuneTimingPillar,
} from './DailyFortune';

export const RECOMMENDATION_CONTRACT_VERSION = 'recommendation_ai_v7' as const;
export const RECOMMENDATION_PROMPT_VERSION = 'recommendation_prompt_v7' as const;
export const RECOMMENDATION_TAXONOMY_VERSION = 'recommendation_taxonomy_v1' as const;
export const RECOMMENDATION_CANDIDATE_POOL_VERSION = 'recommendation_pool_v2' as const;
export const RECOMMENDATION_CANDIDATE_POOL_SIZE = 30 as const;
export const RECOMMENDATION_DISPLAY_DECK_COUNT = 10 as const;
/** Kept in the wire shape only for legacy-batch compatibility. New batches are deck-only. */
export const RECOMMENDATION_DISPLAY_CENTER_COUNT = 0 as const;
export const RECOMMENDATION_ORCHESTRATOR_VERSION = 'recommendation_orchestrator_v2' as const;
export const RECOMMENDATION_EVIDENCE_WINDOW_LIMIT = 16 as const;
export const RECOMMENDATION_TIME_WINDOWS_BYTE_LIMIT = 96 * 1024;

export const RECOMMENDATION_DOMAINS = [
  'love',
  'career',
  'wealth',
  'health',
  'study',
] as const;

/**
 * MVP topic catalog. Love is intentionally deeper; the other four domains keep
 * a small general catalog until opens provide enough evidence to expand them.
 */
export const RECOMMENDATION_TOPIC_CATALOG = {
  love: [
    'love_overview',
    'emotional_pattern',
    'attraction_preference',
    'partner_fit',
    'new_connection',
    'relationship_progress',
    'conflict_and_repair',
    'commitment',
    'separation_risk',
    'external_interference',
  ],
  career: [
    'career_overview',
    'career_direction',
    'opportunity_and_change',
    'workplace_relationships',
    'decision_and_pressure',
  ],
  wealth: [
    'wealth_overview',
    'income_opportunity',
    'spending_and_risk',
    'resource_allocation',
    'money_decision',
  ],
  health: [
    'health_overview',
    'energy_and_rhythm',
    'sleep_and_stress',
    'habit_adjustment',
    'recovery_and_balance',
  ],
  study: [
    'study_overview',
    'learning_strengths',
    'focus_and_efficiency',
    'exam_and_performance',
    'skill_growth',
  ],
} as const;

export const RECOMMENDATION_TOPIC_KEYS = [
  ...RECOMMENDATION_TOPIC_CATALOG.love,
  ...RECOMMENDATION_TOPIC_CATALOG.career,
  ...RECOMMENDATION_TOPIC_CATALOG.wealth,
  ...RECOMMENDATION_TOPIC_CATALOG.health,
  ...RECOMMENDATION_TOPIC_CATALOG.study,
] as const;

export const RECOMMENDATION_QUESTION_JOBS = [
  'describe',
  'explain',
  'forecast',
  'compare',
  'act',
] as const;

export const RECOMMENDATION_CONTENT_HORIZONS = [
  'baseline',
  'phase',
  'year',
  'month',
] as const;

export const RECOMMENDATION_SELECTION_ROLES = [
  'p1_mingli_change',
  'p2_interest_match',
  'p2_baseline',
  'p3_diversity',
] as const;

export const RECOMMENDATION_SURFACES = ['deck', 'center'] as const;

export const RECOMMENDATION_EVENT_FAMILIES = [
  'baseline_pattern',
  'cycle_background',
  'direct_activation',
  'opportunity',
  'friction',
  'adjustment',
  'new_connection',
  'relationship_progress',
  'commitment',
  'separation_risk',
  'external_interference',
] as const;

export const RECOMMENDATION_CLAIM_MODES = [
  'description',
  'possibility',
  'conditional',
] as const;

export const RECOMMENDATION_BEHAVIOR_EVENT_TYPES = ['exposure', 'open'] as const;

export type RecommendationDomain = typeof RECOMMENDATION_DOMAINS[number];
export type RecommendationTopicKey = typeof RECOMMENDATION_TOPIC_KEYS[number];
export type RecommendationQuestionJob = typeof RECOMMENDATION_QUESTION_JOBS[number];
export type RecommendationContentHorizon = typeof RECOMMENDATION_CONTENT_HORIZONS[number];
export type RecommendationSelectionRole = typeof RECOMMENDATION_SELECTION_ROLES[number];
export type RecommendationSurface = typeof RECOMMENDATION_SURFACES[number];
export type RecommendationEventFamily = typeof RECOMMENDATION_EVENT_FAMILIES[number];
export type RecommendationClaimMode = typeof RECOMMENDATION_CLAIM_MODES[number];
export type RecommendationBehaviorEventType = typeof RECOMMENDATION_BEHAVIOR_EVENT_TYPES[number];

export interface RecommendationContentProfile {
  domain: RecommendationDomain;
  topic_key: RecommendationTopicKey;
  question_job: RecommendationQuestionJob;
  content_horizon: RecommendationContentHorizon;
}

export interface RecommendationEventHypothesis {
  event_family: RecommendationEventFamily;
  claim_mode: RecommendationClaimMode;
  summary: string;
  fact_refs: string[];
}

export interface RecommendationCardValidity {
  valid_from: string;
  valid_until: string | null;
}

/** Complete AI-generated card before it is assigned to a UI surface. */
export interface RecommendationCandidate {
  candidate_id: string;
  pool_position: number;
  semantic_key: string;
  /** AI-selected focus, validated against referenced_window_keys by the server. */
  primary_time_window_key: string | null;
  /** Mechanically derived from event_hypothesis.fact_refs; never supplied by the client. */
  referenced_window_keys: string[];
  content_profile: RecommendationContentProfile;
  selection_role: RecommendationSelectionRole;
  event_hypothesis: RecommendationEventHypothesis;
  validity: RecommendationCardValidity;
  question: string;
  preview: string;
  body: string;
}

/** A candidate projected into one immutable client-visible display batch. */
export interface CardCandidate extends RecommendationCandidate {
  position: number;
  surface: RecommendationSurface;
}

export interface RecommendationCandidatePool {
  pool_version: typeof RECOMMENDATION_CANDIDATE_POOL_VERSION;
  candidates: RecommendationCandidate[];
}

export interface RecommendationBatchCards {
  deck_cards: CardCandidate[];
  center_cards: CardCandidate[];
}

/** A server-issued reference the AI may cite. */
export interface RecommendationFactReference {
  ref: string;
  valid_from: string;
  valid_until: string | null;
}

/**
 * Recommendation facts omit redundant five-element lookup fields. Stems and
 * branches remain the canonical values; the model does not need 木/火/土/金/水
 * repeated beside every one of them.
 */
export type RecommendationHardFactHiddenStem = Pick<
  DailyFortuneHiddenStem,
  'stem' | 'ten_god'
>;

export type RecommendationHardFactPillar = Omit<
  DailyFortunePillar,
  'stem_element' | 'branch_element' | 'hidden_stems'
> & {
  hidden_stems: RecommendationHardFactHiddenStem[];
};

export type RecommendationHardFactTimingPillar = Omit<
  DailyFortuneTimingPillar,
  'stem_element' | 'branch_element' | 'hidden_stems'
> & {
  hidden_stems: RecommendationHardFactHiddenStem[];
};

export type RecommendationHardFactMember = Omit<
  DailyFortuneInteractionParticipant,
  'label'
>;

/** Deterministic relation fields that recommendation AI may interpret. */
export interface RecommendationHardFactInteraction {
  id: DailyFortuneMingliInteraction['id'];
  scope: DailyFortuneMingliInteraction['scope'];
  relation: DailyFortuneMingliInteraction['relation'];
  /** Unordered members of the relation; this carries no causal direction. */
  members: RecommendationHardFactMember[];
  center_branch: DailyFortuneMingliInteraction['center_branch'];
  time_horizon: DailyFortuneMingliInteraction['time_horizon'];
  adjacent: DailyFortuneMingliInteraction['adjacent'];
  full_match: DailyFortuneMingliInteraction['full_match'];
  missing_branch: DailyFortuneMingliInteraction['missing_branch'];
  seen_stem: DailyFortuneMingliInteraction['seen_stem'];
}

/**
 * Recommendation-only projection of the shared fact package. Domain hints,
 * heuristic strength, display labels, and user context are deliberately absent.
 */
export type RecommendationHardFactPackage = Pick<
  DailyFortuneFactPackage,
  | 'contract_version'
  | 'effective_date'
  | 'timezone'
  | 'day_boundary'
  | 'profile'
> & {
  natal: {
    pillars: RecommendationHardFactPillar[];
    day_master: string;
  };
  mingli_interactions: {
    rule_version: string;
    natal: RecommendationHardFactInteraction[];
  };
};

export const RECOMMENDATION_TIME_WINDOW_KINDS = [
  'dayun',
  'liunian',
  'liuyue',
] as const;

export const RECOMMENDATION_TIME_WINDOW_BUCKETS = [
  'dayun_index',
  'current_or_parent_dayun',
  'parent_liunian',
  'recent_12_liuyue',
  'future_exploration',
] as const;

export type RecommendationTimeWindowKind =
  typeof RECOMMENDATION_TIME_WINDOW_KINDS[number];
export type RecommendationTimeWindowBucket =
  typeof RECOMMENDATION_TIME_WINDOW_BUCKETS[number];
export type RecommendationTimeWindowDetailLevel = 'index' | 'evidence';

/**
 * One generic, deterministic timing window selected from the existing luck
 * timeline. The recommendation layer groups facts; it does not decide their
 * real-world meaning or add a second astrology rules engine.
 */
export interface RecommendationTimeWindow {
  window_key: string;
  kind: RecommendationTimeWindowKind;
  bucket: RecommendationTimeWindowBucket;
  detail_level: RecommendationTimeWindowDetailLevel;
  parent_window_keys: string[];
  is_current: boolean;
  target_window: RecommendationCardValidity;
  timing: RecommendationHardFactTimingPillar;
  interaction_rule_version: string;
  interactions: RecommendationHardFactInteraction[];
}

export type RecommendationPreferenceDimension =
  | 'domain'
  | 'topic_key'
  | 'question_job'
  | 'content_horizon';

export interface RecommendationInterestSignal {
  dimension: RecommendationPreferenceDimension;
  key: string;
  exposures: number;
  opens: number;
  /**
   * A mechanically derived, smoothed open ratio. It gives the model a weak
   * preference hint while avoiding the false certainty of a one-open sample.
   */
  smoothed_open_rate: number;
}

export interface RecommendationSessionOpen {
  candidate_id: string;
  content_profile: RecommendationContentProfile;
  primary_time_window_key: string | null;
  referenced_window_keys: string[];
  opened_at: string;
}

/** Bounded, factual memory used for time-window freshness and rotation. */
export interface RecommendationTimeWindowHistoryItem {
  window_key: string;
  primary_exposures: number;
  primary_opens: number;
  last_primary_exposed_at: string | null;
  last_primary_opened_at: string | null;
}

export interface RecommendationPreferenceContext {
  recent_14d: RecommendationInterestSignal[];
  long_term_90d: RecommendationInterestSignal[];
  current_session_opens: RecommendationSessionOpen[];
}

export interface RecommendationSelectionContext {
  orchestrator_version: typeof RECOMMENDATION_ORCHESTRATOR_VERSION;
  source: 'ai_generation' | 'pool_continuation';
  preference_context: RecommendationPreferenceContext;
}

export interface RecommendationContentHistoryItem {
  semantic_key: string;
  surface: RecommendationSurface;
  exposed: boolean;
  opened: boolean;
  last_seen_at: string;
}

export type RecommendationRelationshipStatus =
  | 'single'
  | 'dating'
  | 'married'
  | 'unknown';

export type JungianCognitiveFunction =
  | 'Ni' | 'Ne' | 'Si' | 'Se'
  | 'Ti' | 'Te' | 'Fi' | 'Fe';

/** Explicit user reality only; it is context for translation, never 命理 evidence. */
export interface RecommendationRealityContext {
  personality: {
    /** User-declared MBTI, used only as soft cognitive context. */
    mbti: string | null;
    /** Dominant through inferior, followed by the four shadow functions. */
    jungian_function_order: JungianCognitiveFunction[];
  };
  life_stage: {
    primary: string | null;
    tags: string[];
  };
  work_study: {
    mode: string | null;
    career_status: string | null;
    occupation: string | null;
    industry: string | null;
    study_status: string | null;
    school: string | null;
    current_goal: string | null;
  };
  relationship: {
    status: RecommendationRelationshipStatus;
    declared_status: string | null;
    current_focus: string | null;
  };
  saved_understanding: {
    snapshot_version: string | null;
    current_focus: string[];
    expression_preferences: string[];
    behavior_signals: string[];
    updated_at: string | null;
  };
}

export interface RecommendationAiInput {
  contract_version: typeof RECOMMENDATION_CONTRACT_VERSION;
  taxonomy_version: typeof RECOMMENDATION_TAXONOMY_VERSION;
  effective_date: string;
  timezone: string;
  fortune_facts: RecommendationHardFactPackage;
  time_windows: RecommendationTimeWindow[];
  available_fact_refs: RecommendationFactReference[];
  reality_context: RecommendationRealityContext;
  preference_context: RecommendationPreferenceContext;
  content_history: RecommendationContentHistoryItem[];
  /** Only entries for windows selected into this call are included. */
  time_window_history: RecommendationTimeWindowHistoryItem[];
}

export interface RecommendationAiGenerationMetrics {
  model_id: string;
  outcome: 'success';
  input_json_bytes: number;
  request_bytes: number;
  provider_response_bytes: number;
  output_text_bytes: number;
  prompt_token_count: number | null;
  cached_content_token_count: number | null;
  candidates_token_count: number | null;
  thoughts_token_count: number | null;
  total_token_count: number | null;
  latency_ms: number;
  finish_reason: string;
}

export interface RecommendationAiOutput {
  candidates: RecommendationCandidate[];
  generation_metrics: RecommendationAiGenerationMetrics;
}

export type RecommendationBatchStatus = 'generating' | 'retry_wait' | 'ready';

export interface RecommendationBatch {
  batch_id: string;
  status: RecommendationBatchStatus;
  bazi_profile_id: string;
  effective_date: string;
  timezone: string;
  after_batch_id: string | null;
  deck_cards: CardCandidate[];
  center_cards: CardCandidate[];
  prompt_version: string;
  taxonomy_version: string;
  model_id: string;
  created_at: string;
}

export interface RecommendationNextRequest {
  bazi_profile_id: string;
  timezone: string;
  /**
   * Groups a short browsing run so opens made before the next generation can
   * influence that next batch without being mistaken for a permanent profile
   * preference.
   */
  session_id: string;
  after_batch_id?: string | null;
}

export interface RecommendationNextResponse {
  status: RecommendationBatchStatus | 'unavailable';
  batch?: RecommendationBatch;
  generation_id?: string;
  retry_after_ms?: number;
  cause?: string;
}

export interface RecommendationBatchResponse {
  status: RecommendationBatchStatus | 'missing';
  batch?: RecommendationBatch;
  generation_id: string;
  retry_after_ms?: number;
}

export interface RecommendationEventRequest {
  event_id: string;
  batch_id: string;
  candidate_id: string;
  event_type: RecommendationBehaviorEventType;
  session_id: string;
}

export interface RecommendationEventResponse {
  accepted: boolean;
  duplicate: boolean;
}
