/**
 * 用户行为记录数据访问层
 * 对应数据库表：user_interactions
 */
import { supabase } from '../supabase';
import {
  UserInteraction,
  CreateUserInteractionInput,
  CategoryWeight,
  InteractionCategory,
} from '../../models/UserInteraction';

export class UserInteractionRepository {
  private tableName = 'user_interactions';

  /**
   * 记录一次用户行为
   */
  async create(input: CreateUserInteractionInput): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .insert(input);

    if (error) {
      // 行为记录失败不影响主流程，仅打日志
      console.error('记录用户行为失败:', error.message);
    }
  }

  /**
   * 统计用户各类别权重（按点击次数降序）
   * 用于 AI prompt 中的个性化权重提示
   */
  async getCategoryWeights(userId: string): Promise<CategoryWeight[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('category')
      .eq('user_id', userId);

    if (error || !data) {
      return [];
    }

    // 在应用层统计各类别次数
    const counts: Record<string, number> = {};
    for (const row of data) {
      counts[row.category] = (counts[row.category] || 0) + 1;
    }

    return Object.entries(counts)
      .map(([category, count]) => ({
        category: category as InteractionCategory,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }
}

export const userInteractionRepository = new UserInteractionRepository();
