import { supabase } from '../supabase';
import {
  CreateHistoryRecordInput,
  HistoryRecord,
  HistoryRecordListQuery,
} from '../../models/HistoryRecord';

export class HistoryRepository {
  private tableName = 'history_records';

  async listByUser(
    userId: string,
    query: HistoryRecordListQuery,
  ): Promise<{ items: HistoryRecord[]; total: number }> {
    let builder = supabase
      .from(this.tableName)
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .is('deleted_at', null);

    if (query.type) {
      builder = builder.eq('type', query.type);
    }

    if (query.favorited !== undefined) {
      builder = builder.eq('is_favorited', query.favorited);
    }

    if (query.date_from) {
      builder = builder.gte('source_date', query.date_from);
    }

    if (query.date_to) {
      builder = builder.lte('source_date', query.date_to);
    }

    const page = query.page || 1;
    const pageSize = query.page_size || 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await builder
      .order('occurred_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`查询历史记录失败: ${error.message}`);
    }

    return {
      items: (data || []) as HistoryRecord[],
      total: count || 0,
    };
  }

  async findById(userId: string, id: string): Promise<HistoryRecord | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      return null;
    }

    return data as HistoryRecord;
  }

  async findByDedupeKey(userId: string, dedupeKey: string): Promise<HistoryRecord | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .eq('dedupe_key', dedupeKey)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      return null;
    }

    return data as HistoryRecord;
  }

  async create(userId: string, input: CreateHistoryRecordInput): Promise<HistoryRecord> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        user_id: userId,
        bazi_profile_id: input.bazi_profile_id || null,
        type: input.type,
        category: input.category || null,
        title: input.title,
        subtitle: input.subtitle || null,
        summary: input.summary || null,
        source_date: input.source_date || null,
        payload: input.payload,
        thumbnail_key: input.thumbnail_key || null,
        occurred_at: input.occurred_at || new Date().toISOString(),
        dedupe_key: input.dedupe_key || null,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`创建历史记录失败: ${error.message}`);
    }

    return data as HistoryRecord;
  }

  async setFavorite(userId: string, id: string, isFavorited: boolean): Promise<HistoryRecord> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({
        is_favorited: isFavorited,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      throw new Error(`更新收藏状态失败: ${error.message}`);
    }

    return data as HistoryRecord;
  }

  async softDelete(userId: string, id: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', id)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`删除历史记录失败: ${error.message}`);
    }
  }
}

export const historyRepository = new HistoryRepository();
