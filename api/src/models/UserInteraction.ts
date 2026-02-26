/**
 * 用户行为记录模型
 * 对应数据库表：user_interactions
 */

export type InteractionCategory = 'career' | 'love' | 'health' | 'overall' | 'study';
export type InteractionAction = 'expand_bullet' | 'view_scene' | 'view_card';

export interface UserInteraction {
  id: string;
  user_id: string;
  category: InteractionCategory;
  action: InteractionAction;
  created_at: string;
}

export interface CreateUserInteractionInput {
  user_id: string;
  category: InteractionCategory;
  action: InteractionAction;
}

/** 某类别的权重统计结果 */
export interface CategoryWeight {
  category: InteractionCategory;
  count: number;
}
