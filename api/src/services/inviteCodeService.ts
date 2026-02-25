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
import { InviteCode, InviteCodeCheckResult, InviteCodeScene } from '../models/InviteCode';
import { ValidationError } from '../utils/errors';

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

  // 超出使用次数（max_uses = -1 表示无限制，跳过此检查）
  if (inviteCode.max_uses !== -1 && inviteCode.used_count >= inviteCode.max_uses) {
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
