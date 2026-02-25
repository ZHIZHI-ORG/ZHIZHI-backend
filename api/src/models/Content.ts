/**
 * 内容数据模型
 * 对应数据库中的 contents 表
 */

export interface Content {
  id: string;                  // UUID
  user_id: string;             // 创建者 ID
  title: string;               // 标题
  body: string;                // 内容正文
  content_type: ContentType;   // 内容类型
  status: ContentStatus;       // 发布状态
  tags?: string[];             // 标签数组
  view_count: number;          // 浏览次数
  like_count: number;          // 点赞次数
  created_at: string;          // 创建时间
  updated_at?: string;         // 更新时间
  published_at?: string;       // 发布时间
}

/**
 * 内容类型枚举
 */
export enum ContentType {
  ARTICLE = 'article',         // 文章
  VIDEO = 'video',             // 视频
  AUDIO = 'audio',             // 音频
  IMAGE = 'image',             // 图片
}

/**
 * 内容状态枚举
 */
export enum ContentStatus {
  DRAFT = 'draft',             // 草稿
  PUBLISHED = 'published',     // 已发布
  ARCHIVED = 'archived',       // 已归档
}

/**
 * 创建内容的请求参数
 */
export interface CreateContentInput {
  title: string;
  body: string;
  content_type: ContentType;
  tags?: string[];
  status?: ContentStatus;      // 默认为 draft
}

/**
 * 更新内容的请求参数
 */
export interface UpdateContentInput {
  title?: string;
  body?: string;
  tags?: string[];
  status?: ContentStatus;
}

/**
 * 内容列表查询参数
 */
export interface ContentListQuery {
  user_id?: string;            // 按作者筛选
  content_type?: ContentType;  // 按类型筛选
  status?: ContentStatus;      // 按状态筛选
  tag?: string;                // 按标签筛选
  page?: number;               // 页码（默认 1）
  page_size?: number;          // 每页数量（默认 20）
  sort_by?: 'created_at' | 'view_count' | 'like_count'; // 排序字段
  order?: 'asc' | 'desc';      // 排序方向（默认 desc）
}

/**
 * 内容列表响应
 */
export interface ContentListResponse {
  items: Content[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
