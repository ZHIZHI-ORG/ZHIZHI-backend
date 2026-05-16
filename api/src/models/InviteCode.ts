/**
 * 邀请码数据模型
 * 对应数据库表：invite_codes / invite_usages
 *
 * 邀请码在本系统中承担两个角色：
 *   1. 内测门禁：用户必须输入有效码才能进入注册/登录页（STRICT 模式）。
 *   2. 好友邀请：注册用户可生成自己的邀请码分享给朋友（未来扩展）。
 */

/**
 * 邀请码实体（对应 invite_codes 表的完整字段）
 */
export interface InviteCode {
  id: string;              // UUID 主键
  code: string;            // 邀请码字符串，如 "ZHIZHI2026"
  created_by: string | null; // 创建者 user.id；null = 系统生成
  used_count: number;      // 已使用次数
  max_uses: number;        // 最大使用次数，-1 = 无限
  is_active: boolean;      // 是否有效
  expires_at: string | null; // 过期时间，null = 永不过期
  period_start: string | null; // 用户邀请码所属周期开始时间（系统码为 null）
  period_end: string | null;   // 用户邀请码所属周期结束时间（系统码为 null）
  note: string | null;     // 备注
  created_at: string;      // 创建时间
}

/**
 * 邀请使用记录实体（对应 invite_usages 表）
 */
export interface InviteUsage {
  id: string;
  invite_code_id: string;    // 关联的邀请码
  used_by_user_id: string;   // 使用者的 user.id
  used_at: string;           // 使用时间
}

/**
 * 邀请码校验结果
 * 用于 checkInviteCode 接口的返回值
 */
export interface InviteCodeCheckResult {
  valid: boolean;    // 是否有效
  message: string;   // 给前端展示的提示信息
}

/**
 * 邀请码使用场景枚举
 * 区分"仅用于门禁验证"还是"用于注册关联"
 */
export enum InviteCodeScene {
  /** 门禁验证：仅校验有效性，不消耗使用次数 */
  GATEKEEPER = 'GATEKEEPER',
  /** 注册关联：校验有效性并记录使用，消耗使用次数 */
  REGISTER = 'REGISTER',
}
