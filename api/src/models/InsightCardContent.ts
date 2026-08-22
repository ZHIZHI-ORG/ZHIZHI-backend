export const INSIGHT_CARD_CONTENT_CONTRACT_VERSION = 'insight_card_content_v2' as const;
export const INSIGHT_CARD_LARGE_DETAIL_PROMPT_VERSION = 'insight_large_detail_prompt_v4' as const;
export const INSIGHT_CARD_MEDIUM_DETAIL_PROMPT_VERSION = 'insight_medium_detail_prompt_v4' as const;
export const INSIGHT_CARD_FOLLOW_UP_PROMPT_VERSION = 'insight_card_follow_up_prompt_v4' as const;
export const INSIGHT_CARD_DETAIL_SCHEMA_VERSION = 'insight_card_detail_output_v2' as const;
export const INSIGHT_CARD_FOLLOW_UP_SCHEMA_VERSION = 'insight_card_follow_up_output_v1' as const;

export const INSIGHT_SOURCE_TYPES = ['medium', 'large'] as const;
export type InsightSourceType = typeof INSIGHT_SOURCE_TYPES[number];
export type InsightContentStatus = 'generating' | 'retry_wait' | 'ready' | 'failed';

export interface InsightCardSourceMaterial {
  source_type: InsightSourceType;
  source_batch_id: string;
  source_item_id: string;
  profile_id: string;
  source_item_snapshot: Record<string, unknown>;
  /** Server-selected hard facts: the fixed structure foundation plus the
   * source-card refs; Large also carries its frozen time-window refs. */
  selected_fact_snapshot: unknown;
  grounding_context_snapshot: unknown;
  fact_refs: string[];
}

export interface InsightDetailContent {
  detail_id: string;
  source_type: InsightSourceType;
  source_batch_id: string;
  source_item_id: string;
  title: string;
  preview: string;
  /** One continuous reading. Natural paragraph breaks are represented by \n\n. */
  body: string;
  /** Flattened hard-fact references used by the generated paragraphs. */
  fact_refs: string[];
  suggested_follow_ups: string[];
  follow_ups: InsightDetailFollowUpHistoryItem[];
}

export interface InsightDetailFollowUpHistoryItem {
  follow_up_id: string;
  parent_follow_up_id: string | null;
  question: string;
  answer: string;
  fact_refs: string[];
  created_at: string;
}

export interface InsightFollowUpContent {
  follow_up_id: string;
  detail_id: string;
  parent_follow_up_id: string | null;
  question: string;
  answer: string;
  fact_refs: string[];
}

export interface InsightContentGenerationMetrics {
  provider_calls: number;
  input_bytes: number;
  duration_ms: number;
  prompt_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  billed_output_tokens: number | null;
  total_tokens: number | null;
  provider_response_bytes: number;
}

export interface ResolveInsightDetailRequest {
  source_type: InsightSourceType;
  source_batch_id: string;
  source_item_id: string;
}

export interface ResolveInsightFollowUpRequest {
  detail_id: string;
  client_request_id: string;
  question: string;
  parent_follow_up_id?: string;
}

export type InsightDetailServiceResult =
  | { status: 'ready'; generation_id: string; detail: InsightDetailContent }
  | {
      status: 'generating' | 'retry_wait';
      generation_id: string;
      next_action: 'poll' | 'resume_post';
      retry_after_ms: number;
    }
  | { status: 'unavailable'; cause: string; retryable: boolean; generation_id?: string };

export type InsightFollowUpServiceResult =
  | { status: 'ready'; generation_id: string; follow_up: InsightFollowUpContent }
  | {
      status: 'generating' | 'retry_wait';
      generation_id: string;
      next_action: 'poll' | 'resume_post';
      retry_after_ms: number;
    }
  | { status: 'unavailable'; cause: string; retryable: boolean; generation_id?: string };

export interface InsightConversationTurn {
  follow_up_id: string;
  parent_follow_up_id: string | null;
  question: string;
  answer: string;
  fact_refs: string[];
  created_at: string;
}
