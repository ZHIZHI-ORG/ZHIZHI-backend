import type { DailyFortuneUserContext } from './DailyFortuneContext';

export const MEDIUM_INSIGHT_CONTRACT_VERSION = 'medium_insight_v2' as const;
export const MEDIUM_INSIGHT_PROMPT_VERSION = 'medium_insight_prompt_v7' as const;
export const MEDIUM_INSIGHT_FACT_VERSION = 'medium_fact_snapshot_v2' as const;
export const MEDIUM_INSIGHT_CONTEXT_VERSION = 'medium_context_snapshot_v2' as const;
export const MEDIUM_INSIGHT_OUTPUT_SCHEMA_VERSION = 'medium_insight_output_v1' as const;

export const MEDIUM_INSIGHT_DOMAINS = [
  'career',
  'wealth',
  'love',
  'health',
  'study',
] as const;

export const MEDIUM_INSIGHT_CONTENT_TYPES = [
  'pattern',
  'self_explanation',
  'strength',
  'tension',
  'fit',
] as const;

export const MEDIUM_INSIGHT_EVENT_TYPES = [
  'section_impression',
  'batch_ready_presented',
  'generation_error_presented',
  'exposure',
  'open',
] as const;

export type MediumInsightDomain = typeof MEDIUM_INSIGHT_DOMAINS[number];
export type MediumInsightContentType = typeof MEDIUM_INSIGHT_CONTENT_TYPES[number];
export type MediumInsightEventType = typeof MEDIUM_INSIGHT_EVENT_TYPES[number];
export type MediumInsightBatchStatus = 'generating' | 'retry_wait' | 'ready' | 'failed';

export interface MediumInsightFactReference {
  ref: string;
  source:
    | 'natal_pillar'
    | 'day_master'
    | 'dayun'
    | 'natal_interaction'
    | 'dayun_interaction'
    | 'month_command'
    | 'day_master_capacity'
    | 'pattern_candidates'
    | 'yongshen_basis';
  canonical_source: string;
  canonical_text: string;
  /** Canonical structured evidence for facts that cannot be losslessly flattened to one sentence. */
  fact_payload?: unknown;
  relation: string | null;
  participants: string[];
  scope: string;
  time_horizon: 'baseline' | 'ten_years';
  full_match: boolean | null;
  conditions: string[];
}

export interface MediumInsightFactSnapshot {
  version: typeof MEDIUM_INSIGHT_FACT_VERSION;
  effective_date: string;
  profile_id: string;
  profile_updated_at: string;
  facts: MediumInsightFactReference[];
}

export interface MediumInsightGroundingContextSnapshot {
  version: typeof MEDIUM_INSIGHT_CONTEXT_VERSION;
  /** Reality and product understanding only; never valid as a fact_refs target. */
  user_context: DailyFortuneUserContext;
}

export interface MediumInsightFactProjection {
  snapshot: MediumInsightFactSnapshot;
  groundingContext: MediumInsightGroundingContextSnapshot;
}

export interface MediumInsightRecentCard {
  domain: MediumInsightDomain;
  title: string;
  preview: string;
}

export interface MediumInsightAiCard {
  title: string;
  preview: string;
  content_type: MediumInsightContentType;
  fact_refs: string[];
}

export interface MediumInsightAiDomain {
  domain: MediumInsightDomain;
  cards: MediumInsightAiCard[];
}

export interface MediumInsightAiOutput {
  domains: MediumInsightAiDomain[];
}

export interface MediumInsightCard extends MediumInsightAiCard {
  content_id: string;
  position: number;
}

export interface MediumInsightDomainCards {
  domain: MediumInsightDomain;
  cards: MediumInsightCard[];
}

export interface MediumInsightBatch {
  batch_id: string;
  bazi_profile_id: string;
  effective_date: string;
  timezone: string;
  next_refresh_at: string;
  timezone_change_pending: boolean;
  contract_version: typeof MEDIUM_INSIGHT_CONTRACT_VERSION;
  domains: MediumInsightDomainCards[];
}

export interface MediumInsightGenerationMetrics {
  provider_calls: number;
  input_bytes: number;
  duration_ms: number;
  prompt_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  provider_response_bytes: number;
  repaired_cards: number;
}

export interface MediumInsightResolveRequest {
  bazi_profile_id: string;
  timezone: string;
}

export interface MediumInsightEventRequest {
  event_id: string;
  profile_id: string;
  batch_id?: string;
  content_id?: string;
  event_type: MediumInsightEventType;
  session_id: string;
  client_wait_ms?: number;
  occurred_at: string;
}
