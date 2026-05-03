export type HistoryRecordType =
  | 'daily_fortune'
  | 'insight'
  | 'analysis'
  | 'drilldown'
  | 'bazi_chart';

export interface HistoryRecord {
  id: string;
  user_id: string;
  bazi_profile_id?: string | null;
  type: HistoryRecordType;
  category?: string | null;
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  source_date?: string | null;
  payload: Record<string, any>;
  thumbnail_key?: string | null;
  is_favorited: boolean;
  occurred_at: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  dedupe_key?: string | null;
}

export interface HistoryRecordListQuery {
  page?: number;
  page_size?: number;
  type?: HistoryRecordType;
  favorited?: boolean;
  date_from?: string;
  date_to?: string;
}

export interface CreateHistoryRecordInput {
  type: HistoryRecordType;
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  source_date?: string | null;
  bazi_profile_id?: string | null;
  category?: string | null;
  payload: Record<string, any>;
  thumbnail_key?: string | null;
  occurred_at?: string;
  dedupe_key?: string | null;
}

export interface HistoryRecordListItem {
  id: string;
  type: HistoryRecordType;
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  occurred_at: string;
  source_date?: string | null;
  category?: string | null;
  is_favorited: boolean;
  thumbnail_key?: string | null;
  detail_preview: Record<string, any>;
}

export interface HistoryRecordListResponse {
  items: HistoryRecordListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
