/**
 * 内容数据访问层（Repository）
 */
import { supabase } from '../supabase';
import {
  Content,
  CreateContentInput,
  UpdateContentInput,
  ContentListQuery,
  ContentListResponse,
  ContentStatus,
} from '../../models/Content';

export class ContentRepository {
  private tableName = 'contents';

  /**
   * 根据 ID 查询内容
   */
  async findById(id: string): Promise<Content | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('查询内容失败:', error);
      return null;
    }

    return data as Content;
  }

  /**
   * 创建新内容
   */
  async create(userId: string, input: CreateContentInput): Promise<Content> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        user_id: userId,
        title: input.title,
        body: input.body,
        content_type: input.content_type,
        status: input.status || ContentStatus.DRAFT,
        tags: input.tags || [],
        view_count: 0,
        like_count: 0,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`创建内容失败: ${error.message}`);
    }

    return data as Content;
  }

  /**
   * 更新内容
   */
  async update(id: string, input: UpdateContentInput): Promise<Content> {
    const updateData: any = {
      ...input,
      updated_at: new Date().toISOString(),
    };

    // 如果状态变更为已发布，记录发布时间
    if (input.status === ContentStatus.PUBLISHED) {
      updateData.published_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`更新内容失败: ${error.message}`);
    }

    return data as Content;
  }

  /**
   * 删除内容
   */
  async delete(id: string): Promise<boolean> {
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('删除内容失败:', error);
      return false;
    }

    return true;
  }

  /**
   * 查询内容列表（带分页和筛选）
   */
  async findList(query: ContentListQuery): Promise<ContentListResponse> {
    const page = query.page || 1;
    const pageSize = query.page_size || 20;
    const offset = (page - 1) * pageSize;

    // 构建查询
    let queryBuilder = supabase
      .from(this.tableName)
      .select('*', { count: 'exact' });

    // 应用筛选条件
    if (query.user_id) {
      queryBuilder = queryBuilder.eq('user_id', query.user_id);
    }
    if (query.content_type) {
      queryBuilder = queryBuilder.eq('content_type', query.content_type);
    }
    if (query.status) {
      queryBuilder = queryBuilder.eq('status', query.status);
    }
    if (query.tag) {
      queryBuilder = queryBuilder.contains('tags', [query.tag]);
    }

    // 排序
    const sortBy = query.sort_by || 'created_at';
    const order = query.order || 'desc';
    queryBuilder = queryBuilder.order(sortBy, { ascending: order === 'asc' });

    // 分页
    queryBuilder = queryBuilder.range(offset, offset + pageSize - 1);

    const { data, error, count } = await queryBuilder;

    if (error) {
      throw new Error(`查询内容列表失败: ${error.message}`);
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / pageSize);

    return {
      items: (data as Content[]) || [],
      total,
      page,
      page_size: pageSize,
      total_pages: totalPages,
    };
  }

  /**
   * 增加浏览次数
   */
  async incrementViewCount(id: string): Promise<void> {
    const { error } = await supabase.rpc('increment_view_count', { content_id: id });

    if (error) {
      console.error('增加浏览次数失败:', error);
    }
  }

  /**
   * 增加点赞次数
   */
  async incrementLikeCount(id: string): Promise<void> {
    const { error } = await supabase.rpc('increment_like_count', { content_id: id });

    if (error) {
      console.error('增加点赞次数失败:', error);
    }
  }
}
