/**
 * 用户数据访问层（Repository）
 * 类似于 Java 中的 DAO 或 JPA Repository
 * 对应数据库表：users
 */
import { supabase } from '../supabase';
import { User, UpdateUserInput, UserProfile } from '../../models/User';

export class UserRepository {
  private tableName = 'users';

  /**
   * 根据 ID 查询用户（包含软删除检查）
   * @param id - 用户 UUID
   * @returns User | null
   */
  async findById(id: string): Promise<User | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .is('deleted_at', null) // 只查询未删除的用户
      .single();

    if (error) {
      console.error('查询用户失败:', error);
      return null;
    }

    return data as User;
  }

  /**
   * 根据邮箱查询用户
   * @param email - 用户邮箱
   * @returns User | null
   */
  async findByEmail(email: string): Promise<User | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('email', email)
      .is('deleted_at', null)
      .single();

    if (error) {
      return null;
    }

    return data as User;
  }

  /**
   * 创建新用户（注册后由 Supabase Auth 触发）
   * @param input - 用户数据
   * @returns User
   */
  async create(input: { id: string; email: string; display_name?: string }): Promise<User> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        id: input.id,
        email: input.email,
        display_name: input.display_name || null,
        is_active: true,
        is_email_verified: false,
        bazi_profile_count: 0,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`创建用户记录失败: ${error.message}`);
    }

    return data as User;
  }

  /**
   * 更新用户信息
   * @param id - 用户 ID
   * @param input - 更新数据
   * @returns User
   */
  async update(id: string, input: UpdateUserInput): Promise<User> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update(input)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      throw new Error(`更新用户信息失败: ${error.message}`);
    }

    return data as User;
  }

  /**
   * 软删除用户
   * @param id - 用户 ID
   * @returns boolean
   */
  async softDelete(id: string): Promise<boolean> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('软删除用户失败:', error);
      return false;
    }

    return true;
  }

  /**
   * 更新最后登录时间
   * @param id - 用户 ID
   */
  async updateLastLogin(id: string): Promise<void> {
    await supabase
      .from(this.tableName)
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', id);
  }

  /**
   * 检查邮箱是否已注册
   * @param email - 邮箱
   * @returns boolean
   */
  async existsByEmail(email: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    return user !== null;
  }

  /**
   * 转换为用户资料（隐藏敏感信息）
   * @param user - 用户实体
   * @returns UserProfile
   */
  toProfile(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      is_email_verified: user.is_email_verified,
      bazi_profile_count: user.bazi_profile_count,
      created_at: user.created_at,
    };
  }
}

// 导出单例
export const userRepository = new UserRepository();
