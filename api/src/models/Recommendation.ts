import type { DailyFortuneFactPackage } from './DailyFortune';

export const RECOMMENDATION_CONTRACT_VERSION = 'recommendation_ai_v1' as const;
export const RECOMMENDATION_PROMPT_VERSION = 'recommendation_prompt_v1' as const;
export const RECOMMENDATION_TAXONOMY_VERSION = 'recommendation_taxonomy_v1' as const;

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
  'day',
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

export interface CardCandidate {
  candidate_id: string;
  position: number;
  surface: RecommendationSurface;
  semantic_key: string;
  content_profile: RecommendationContentProfile;
  selection_role: RecommendationSelectionRole;
  event_hypothesis: RecommendationEventHypothesis;
  validity: RecommendationCardValidity;
  question: string;
  preview: string;
  body: string;
}

/** A server-issued reference the AI may cite. */
export interface RecommendationFactReference {
  ref: string;
  valid_from: string;
  valid_until: string | null;
}

/**
 * A future deterministic window that may be asked about today.  V1 supplies
 * the next liuyue; the shape deliberately permits later, fact-backed windows
 * without making the recommendation service decide their meaning.
 */
export interface RecommendationForecastWindow {
  window_key: 'next_liuyue';
  label: string;
  target_window: RecommendationCardValidity;
  /** Prefix that maps this window's facts into available_fact_refs. */
  fact_ref_prefix: string;
  fortune_facts: DailyFortuneFactPackage;
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
  opened_at: string;
}

export interface RecommendationPreferenceContext {
  recent_14d: RecommendationInterestSignal[];
  long_term_90d: RecommendationInterestSignal[];
  current_session_opens: RecommendationSessionOpen[];
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

export interface RecommendationAiInput {
  contract_version: typeof RECOMMENDATION_CONTRACT_VERSION;
  taxonomy_version: typeof RECOMMENDATION_TAXONOMY_VERSION;
  effective_date: string;
  timezone: string;
  fortune_facts: DailyFortuneFactPackage;
  forecast_windows: RecommendationForecastWindow[];
  available_fact_refs: RecommendationFactReference[];
  relationship_status: RecommendationRelationshipStatus;
  preference_context: RecommendationPreferenceContext;
  content_history: RecommendationContentHistoryItem[];
}

export interface RecommendationAiOutput {
  deck_cards: CardCandidate[];
  center_cards: CardCandidate[];
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
