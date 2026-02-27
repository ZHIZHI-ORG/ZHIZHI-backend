/**
 * 用户数据模型
 * 对应数据库表：users
 */

/**
 * 用户实体（完整信息）
 */
export interface User {
  id: string; // UUID
  email: string;
  display_name?: string; // 显示名称（昵称）
  avatar_url?: string;
  is_active: boolean;
  is_email_verified: boolean;
  bazi_profile_count: number; // 创建的八字档案数量
  created_at: string; // ISO 8601 时间戳
  updated_at: string;
  last_login_at?: string;
  deleted_at?: string; // 软删除时间戳
}

/**
 * 用户注册输入
 */
export interface RegisterInput {
  email: string;
  password: string;
  display_name?: string;
}

/**
 * 用户登录输入
 */
export interface LoginInput {
  email: string;
  password: string;
}

/**
 * 登录响应
 */
export interface LoginResponse {
  user: UserProfile;
  access_token: string;
  refresh_token: string;
}

/**
 * 用户资料（返回给前端的简化信息，不包含敏感字段）
 */
export interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  avatar_url?: string;
  is_email_verified: boolean;
  bazi_profile_count: number;
  created_at: string;
}

/**
 * 更新用户资料输入（基础）
 */
export interface UpdateUserInput {
  display_name?: string;
  avatar_url?: string;
}

/**
 * 更新用户扩展资料输入
 * 对应 PUT /api/user/profile/extended
 */
export interface UpdateUserExtendedInput {
  bio?: string;       // 个人简介
  location?: string;  // 所在地
  career?: string;    // 职业
  school?: string;    // 学校
  mbti?: string;      // MBTI（如 INTJ）
  notes?: string;     // 备注/生活事件
}

/**
 * 刷新 Token 输入
 */
export interface RefreshTokenInput {
  refresh_token: string;
}

/**
 * 刷新 Token 响应
 */
export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
}
