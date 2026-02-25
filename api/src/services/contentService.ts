/**
 * 内容服务层
 */
import { ContentRepository } from '../database/repositories/ContentRepository';
import {
  Content,
  CreateContentInput,
  UpdateContentInput,
  ContentListQuery,
  ContentListResponse,
} from '../models/Content';

const contentRepository = new ContentRepository();

/**
 * 创建内容
 */
export async function createContent(userId: string, input: CreateContentInput): Promise<Content> {
  // 可以在这里添加业务逻辑，如：
  // - 内容审核
  // - 敏感词过滤
  // - 标签规范化

  return await contentRepository.create(userId, input);
}

/**
 * 根据 ID 获取内容
 */
export async function getContentById(id: string, incrementView: boolean = true): Promise<Content> {
  const content = await contentRepository.findById(id);
  if (!content) {
    throw new Error('内容不存在');
  }

  // 增加浏览次数
  if (incrementView) {
    await contentRepository.incrementViewCount(id);
  }

  return content;
}

/**
 * 更新内容
 */
export async function updateContent(id: string, userId: string, input: UpdateContentInput): Promise<Content> {
  // 验证内容所有权
  const existingContent = await contentRepository.findById(id);
  if (!existingContent) {
    throw new Error('内容不存在');
  }

  if (existingContent.user_id !== userId) {
    throw new Error('无权限修改此内容');
  }

  return await contentRepository.update(id, input);
}

/**
 * 删除内容
 */
export async function deleteContent(id: string, userId: string): Promise<void> {
  // 验证内容所有权
  const existingContent = await contentRepository.findById(id);
  if (!existingContent) {
    throw new Error('内容不存在');
  }

  if (existingContent.user_id !== userId) {
    throw new Error('无权限删除此内容');
  }

  const success = await contentRepository.delete(id);
  if (!success) {
    throw new Error('删除内容失败');
  }
}

/**
 * 获取内容列表
 */
export async function getContentList(query: ContentListQuery): Promise<ContentListResponse> {
  return await contentRepository.findList(query);
}

/**
 * 点赞内容
 */
export async function likeContent(id: string): Promise<void> {
  // TODO: 可以添加防重复点赞逻辑（需要创建 likes 表）
  await contentRepository.incrementLikeCount(id);
}
