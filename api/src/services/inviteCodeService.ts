/**
 * 邀请码服务层（Service）
 *
 * 职责：
 *   封装所有与邀请码相关的业务逻辑，包括：
 *     - 验证邀请码是否有效（门禁校验）
 *     - 注册时关联邀请码（消耗次数 + 写入使用记录）
 *
 * 调用关系：
 *   Handler → inviteCodeService → InviteCodeRepository → Supabase DB
 *
 * 为什么要独立一个 Service？
 *   邀请码逻辑在多个场景被复用（check-invite-code 接口 / register 流程 / social-login 流程），
 *   抽成独立 Service 避免重复代码，也便于单独测试和未来修改门禁策略。
 */
import { inviteCodeRepository } from '../database/repositories/InviteCodeRepository';
import { userRepository } from '../database/repositories/UserRepository';
import { InviteCode, InviteCodeCheckResult, InviteCodeScene } from '../models/InviteCode';
import { ValidationError } from '../utils/errors';

const FRIEND_INVITE_WEEKLY_LIMIT = 5;
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface InviteQuotaContract {
  code: string;
  used_count: number;
  max_uses: number;
  remaining_count: number | null;
  reset_policy: 'weekly' | 'none' | 'lifetime';
  reset_at: string | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}

function getHongKongWeekWindow(now = new Date()): { start: Date; nextReset: Date } {
  const hkDate = new Date(now.getTime() + HONG_KONG_OFFSET_MS);
  const day = hkDate.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const startHkMs = Date.UTC(
    hkDate.getUTCFullYear(),
    hkDate.getUTCMonth(),
    hkDate.getUTCDate() - daysSinceMonday,
    0,
    0,
    0,
    0,
  );
  const start = new Date(startHkMs - HONG_KONG_OFFSET_MS);
  const nextReset = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start, nextReset };
}

function formatHongKongIso(date: Date): string {
  const hkDate = new Date(date.getTime() + HONG_KONG_OFFSET_MS);
  const y = hkDate.getUTCFullYear();
  const m = String(hkDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(hkDate.getUTCDate()).padStart(2, '0');
  const hh = String(hkDate.getUTCHours()).padStart(2, '0');
  const mm = String(hkDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(hkDate.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+08:00`;
}

function toDatabaseIso(date: Date): string {
  return date.toISOString();
}

function getEffectiveMaxUses(inviteCode: InviteCode): number {
  if (inviteCode.created_by) {
    return inviteCode.max_uses === -1 ? FRIEND_INVITE_WEEKLY_LIMIT : inviteCode.max_uses;
  }
  return inviteCode.max_uses;
}

async function getEffectiveUsedCount(inviteCode: InviteCode): Promise<number> {
  if (!inviteCode.created_by) {
    return inviteCode.used_count;
  }

  const { start } = getHongKongWeekWindow();
  return inviteCodeRepository.countUsagesByCodeSince(inviteCode.id, start.toISOString());
}

export async function buildInviteQuotaContract(inviteCode: InviteCode): Promise<InviteQuotaContract> {
  const maxUses = getEffectiveMaxUses(inviteCode);
  const usedCount = await getEffectiveUsedCount(inviteCode);
  const isUnlimited = maxUses === -1;
  const { nextReset } = getHongKongWeekWindow();

  return {
    code: inviteCode.code,
    used_count: usedCount,
    max_uses: maxUses,
    remaining_count: isUnlimited ? null : Math.max(0, maxUses - usedCount),
    reset_policy: inviteCode.created_by ? 'weekly' : isUnlimited ? 'none' : 'lifetime',
    reset_at: inviteCode.created_by ? formatHongKongIso(nextReset) : null,
    period_start: inviteCode.period_start,
    period_end: inviteCode.period_end,
    created_at: inviteCode.created_at,
  };
}

/**
 * 校验邀请码是否有效
 *
 * 有效性判断规则（全部满足才算有效）：
 *   1. 码存在于数据库中
 *   2. is_active = true（未被手动禁用）
 *   3. 未过期（expires_at IS NULL 或 > 当前时间）
 *   4. 未超出最大使用次数（max_uses = -1 则无限制）
 *
 * 注意：此函数只做"只读校验"，不消耗使用次数。
 *       消耗次数的逻辑在 consumeInviteCode() 中。
 *
 * @param code - 用户输入的邀请码字符串
 * @returns InviteCodeCheckResult - { valid, message }
 */
export async function checkInviteCode(code: string): Promise<InviteCodeCheckResult> {
  // 基础格式校验：空码直接拒绝，不查数据库
  if (!code || code.trim().length === 0) {
    return { valid: false, message: '邀请码不能为空' };
  }

  // 查询数据库
  const inviteCode = await inviteCodeRepository.findByCode(code.trim());

  // 码不存在
  if (!inviteCode) {
    return { valid: false, message: '邀请码无效或已失效' };
  }

  // 已被手动禁用
  if (!inviteCode.is_active) {
    return { valid: false, message: '邀请码已失效' };
  }

  // 已过期（expires_at 不为 null 且已过当前时间）
  if (inviteCode.expires_at && new Date(inviteCode.expires_at) < new Date()) {
    return { valid: false, message: '邀请码已过期' };
  }

  const maxUses = getEffectiveMaxUses(inviteCode);
  const usedCount = await getEffectiveUsedCount(inviteCode);

  // 超出使用次数（max_uses = -1 表示无限制，跳过此检查）
  if (maxUses !== -1 && usedCount >= maxUses) {
    return { valid: false, message: '邀请码已被使用完毕' };
  }

  // 所有检查通过
  return { valid: true, message: '欢迎加入知之' };
}

/**
 * 获取邀请码实体（用于注册流程中的关联）
 * 如果码无效则抛出 ValidationError，直接被 formatError 捕获并返回 400
 *
 * @param code - 邀请码字符串
 * @returns InviteCode - 有效的邀请码实体
 * @throws ValidationError - 如果码无效
 */
export async function getValidInviteCode(code: string): Promise<InviteCode> {
  const result = await checkInviteCode(code);
  if (!result.valid) {
    throw new ValidationError(result.message);
  }

  // 此时一定能查到（checkInviteCode 内部已验证）
  const inviteCode = await inviteCodeRepository.findByCode(code.trim());
  return inviteCode!;
}

/**
 * 消耗邀请码：写入使用记录 + 自增使用次数
 *
 * 调用时机：用户注册成功后立即调用（在同一个事务语义内）。
 * 注意：Supabase JS 客户端不支持真正的数据库事务，
 *       因此先写使用记录，再自增次数；如果自增失败，记录依然有效（可接受的最终一致性）。
 *
 * @param inviteCode  - 通过 getValidInviteCode 获取的有效码实体
 * @param newUserId   - 刚注册成功的用户 ID
 */
export async function consumeInviteCode(inviteCode: InviteCode, newUserId: string): Promise<void> {
  // Step 1：写入邀请使用记录（记录"谁用了哪张码"）
  await inviteCodeRepository.createUsage(inviteCode.id, newUserId);

  // Step 2：自增使用次数（max_uses=-1 时也执行，便于统计，但不影响有效性判断）
  await inviteCodeRepository.incrementUsedCount(inviteCode.id);
}

/**
 * 获取用户专属邀请码
 * 如果用户已有邀请码则直接返回，没有则自动生成一个。
 *
 * @param userId - 用户 ID
 * @returns InviteCode
 */
export async function getUserInviteCode(userId: string): Promise<InviteCode> {
  const { start, nextReset } = getHongKongWeekWindow();
  const periodStart = toDatabaseIso(start);
  const periodEnd = toDatabaseIso(nextReset);

  // 每个用户每个自然周只保留一个当前有效邀请码。旧周期码通过 expires_at 自动失效。
  const existing = await inviteCodeRepository.findByCreatorAndPeriod(userId, periodStart);
  if (existing) {
    return existing;
  }

  try {
    return await inviteCodeRepository.createForUser(userId, periodStart, periodEnd);
  } catch (error) {
    // 并发打开邀请页时，数据库唯一索引会保证同一用户同一周期只有一个有效码。
    // 如果另一个请求已经创建成功，当前请求重读即可，避免前端看到偶发失败。
    const raced = await inviteCodeRepository.findByCreatorAndPeriod(userId, periodStart);
    if (raced) {
      return raced;
    }
    throw error;
  }
}

/**
 * 获取用户的邀请记录列表
 * 即通过用户邀请码注册进来的好友信息。
 *
 * @param userId - 用户 ID
 * @returns InvitationRecord[]
 */
export async function getUserInvitations(userId: string): Promise<InvitationRecord[]> {
  // 获取用户的所有邀请码
  const codes = await inviteCodeRepository.findByCreator(userId);
  if (codes.length === 0) {
    return [];
  }

  // 汇总所有码的使用记录
  const allUsages: InvitationRecord[] = [];
  const invitedUserIds = new Set<string>();
  for (const code of codes) {
    const usages = await inviteCodeRepository.findUsagesByCode(code.id);
    for (const usage of usages) {
      invitedUserIds.add(usage.used_by_user_id);
      allUsages.push({
        id: usage.id,
        invite_code: code.code,
        inviter_user_id: userId,
        invited_user_id: usage.used_by_user_id,
        invited_at: usage.used_at,
        created_at: usage.used_at,
        email: null,
        display_name: null,
      });
    }
  }

  const invitedUsers = await userRepository.findByIds(Array.from(invitedUserIds));
  const usersById = new Map(invitedUsers.map((user) => [user.id, user]));
  for (const record of allUsages) {
    const invitedUser = usersById.get(record.invited_user_id);
    if (invitedUser) {
      record.email = invitedUser.email;
      record.display_name = invitedUser.display_name ?? null;
    }
  }

  // 按邀请时间倒序排列
  allUsages.sort((a, b) => new Date(b.invited_at).getTime() - new Date(a.invited_at).getTime());
  return allUsages;
}

/**
 * 邀请记录（返回给前端的格式）
 */
export interface InvitationRecord {
  id: string;
  invite_code: string;    // 使用的邀请码
  inviter_user_id: string; // 邀请人用户 ID
  invited_user_id: string; // 被邀请用户的 ID
  invited_at: string;     // 邀请时间
  created_at: string;     // 前端列表兼容字段，同 invited_at
  email: string | null;
  display_name: string | null;
}
