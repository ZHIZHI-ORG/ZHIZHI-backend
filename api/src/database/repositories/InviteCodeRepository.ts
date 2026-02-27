/**
 * 邀请码数据访问层（Repository）
 * 对应数据库表：invite_codes / invite_usages
 *
 * 职责：
 *   只负责与数据库的交互（CRUD），不包含业务逻辑。
 *   业务逻辑（如"是否有效"的判断）统一放在 inviteCodeService 中。
 */
import { supabase } from '../supabase';
import { InviteCode, InviteUsage } from '../../models/InviteCode';

export class InviteCodeRepository {
  private codesTable = 'invite_codes';
  private usagesTable = 'invite_usages';

  // ─────────────────────────────────────────────
  // invite_codes 表操作
  // ─────────────────────────────────────────────

  /**
   * 根据码字符串查找邀请码
   * 注意：此处不做有效性过滤，由 Service 层判断（分离关注点）
   *
   * @param code - 邀请码字符串，如 "ZHIZHI2026"
   * @returns InviteCode | null
   */
  async findByCode(code: string): Promise<InviteCode | null> {
    const { data, error } = await supabase
      .from(this.codesTable)
      .select('*')
      .eq('code', code.toUpperCase()) // 统一转大写，避免大小写导致查不到
      .single();

    if (error || !data) {
      return null;
    }

    return data as InviteCode;
  }

  /**
   * 根据创建者用户 ID 查询该用户生成的所有邀请码
   * 用于"我的邀请码"页面展示
   *
   * @param userId - 创建者的 user.id
   * @returns InviteCode[]
   */
  async findByCreator(userId: string): Promise<InviteCode[]> {
    const { data, error } = await supabase
      .from(this.codesTable)
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data as InviteCode[];
  }

  /**
   * 将邀请码的已使用次数 +1
   * 在用户成功注册并关联邀请码后调用
   *
   * @param codeId - invite_codes.id
   */
  async incrementUsedCount(codeId: string): Promise<void> {
    const { error } = await supabase.rpc('increment_invite_code_used_count', {
      code_id: codeId,
    });

    // 降级方案：如果 RPC 函数不存在，改用普通更新
    // （RPC 可以做原子性自增，避免并发问题）
    if (error) {
      console.warn('RPC 自增失败，降级为普通更新:', error.message);
      await supabase
        .from(this.codesTable)
        .update({ used_count: supabase.rpc('used_count + 1') as any })
        .eq('id', codeId);
    }
  }

  // ─────────────────────────────────────────────
  // invite_usages 表操作
  // ─────────────────────────────────────────────

  /**
   * 创建邀请使用记录
   * 在用户注册成功后调用，记录"谁用了哪张码"
   *
   * @param codeId  - invite_codes.id
   * @param userId  - 注册成功的 user.id
   * @returns InviteUsage
   */
  async createUsage(codeId: string, userId: string): Promise<InviteUsage> {
    const { data, error } = await supabase
      .from(this.usagesTable)
      .insert({
        invite_code_id: codeId,
        used_by_user_id: userId,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`记录邀请使用关系失败: ${error.message}`);
    }

    return data as InviteUsage;
  }

  /**
   * 查询某用户是否已有邀请记录（防止重复关联）
   *
   * @param userId - user.id
   * @returns boolean
   */
  async hasUsageByUser(userId: string): Promise<boolean> {
    const { data } = await supabase
      .from(this.usagesTable)
      .select('id')
      .eq('used_by_user_id', userId)
      .single();

    return !!data;
  }

  /**
   * 查询某邀请码的所有使用记录
   * 用于"我邀请的好友列表"功能
   *
   * @param codeId - invite_codes.id
   * @returns InviteUsage[]
   */
  async findUsagesByCode(codeId: string): Promise<InviteUsage[]> {
    const { data, error } = await supabase
      .from(this.usagesTable)
      .select('*')
      .eq('invite_code_id', codeId)
      .order('used_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data as InviteUsage[];
  }

  /**
   * 为用户创建专属邀请码
   * 码格式：ZZ + 随机6位大写字母+数字，如 "ZZAB12CD"
   *
   * @param userId - 码的创建者 user.id
   * @returns InviteCode
   */
  async createForUser(userId: string): Promise<InviteCode> {
    // 生成唯一邀请码（带重试机制）
    let code = '';
    let attempts = 0;
    while (attempts < 5) {
      code = 'ZZ' + Math.random().toString(36).substring(2, 8).toUpperCase();
      const existing = await this.findByCode(code);
      if (!existing) break;
      attempts++;
    }

    const { data, error } = await supabase
      .from(this.codesTable)
      .insert({
        code,
        created_by: userId,
        max_uses: -1, // 用户邀请码无使用次数限制
        is_active: true,
        note: '用户生成的好友邀请码',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`创建用户邀请码失败: ${error.message}`);
    }

    return data as InviteCode;
  }
}

// 导出单例，整个应用共用一个实例
export const inviteCodeRepository = new InviteCodeRepository();
