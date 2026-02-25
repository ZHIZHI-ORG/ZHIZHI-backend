/**
 * 八字档案数据访问层（Repository）
 * 对应数据库表：bazi_profiles
 */
import { supabase } from '../supabase';
import {
  BaziProfile,
  UpdateBaziProfileInput,
  BaziProfileListQuery,
} from '../../models/BaziProfile';

export class BaziProfileRepository {
  private tableName = 'bazi_profiles';

  /**
   * 根据 ID 查询八字档案
   * @param id - 档案 UUID
   * @returns BaziProfile | null
   */
  async findById(id: string): Promise<BaziProfile | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) {
      console.error('查询八字档案失败:', error);
      return null;
    }

    return data as BaziProfile;
  }

  /**
   * 查询用户的所有八字档案
   * @param ownerUserId - 用户 ID
   * @param query - 查询参数
   * @returns BaziProfile[]
   */
  async findByOwner(
    ownerUserId: string,
    query?: BaziProfileListQuery
  ): Promise<{ items: BaziProfile[]; total: number }> {
    let queryBuilder = supabase
      .from(this.tableName)
      .select('*', { count: 'exact' })
      .eq('owner_user_id', ownerUserId)
      .is('deleted_at', null);

    // 筛选条件
    if (query?.is_owner !== undefined) {
      queryBuilder = queryBuilder.eq('is_owner', query.is_owner);
    }

    if (query?.relation) {
      queryBuilder = queryBuilder.eq('relation_to_owner', query.relation);
    }

    // 排序：本人优先，然后按创建时间
    queryBuilder = queryBuilder.order('is_owner', { ascending: false });
    queryBuilder = queryBuilder.order('created_at', { ascending: true });

    // 分页
    const page = query?.page || 1;
    const pageSize = query?.page_size || 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    queryBuilder = queryBuilder.range(from, to);

    const { data, error, count } = await queryBuilder;

    if (error) {
      throw new Error(`查询八字档案列表失败: ${error.message}`);
    }

    return {
      items: (data || []) as BaziProfile[],
      total: count || 0,
    };
  }

  /**
   * 创建八字档案
   * @param ownerUserId - 创建者 ID
   * @param input - 档案数据
   * @returns BaziProfile
   */
  async create(ownerUserId: string, input: any): Promise<BaziProfile> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        // 基础信息
        owner_user_id: ownerUserId,
        is_owner: input.is_owner,
        name: input.name,
        relation_to_owner: input.relation_to_owner || null,
        gender: input.gender || null,

        // 生辰信息
        birth_year: input.birth_year,
        birth_month: input.birth_month,
        birth_day: input.birth_day,
        birth_hour: input.birth_hour ?? null,
        birth_minute: input.birth_minute ?? null,
        is_lunar: input.is_lunar ?? false,
        birth_timezone: input.birth_timezone || 'Asia/Shanghai',

        // 扩展字段（simple.md §4.3）
        birth_country: input.birth_country || null,
        birth_region: input.birth_region || null,
        mbti: input.mbti || null,

        // 备注
        notes: input.notes || null,

        // 基础四柱（冗余列，由 baziService 传入）
        bazi_year_stem: input.bazi_year_stem || null,
        bazi_year_branch: input.bazi_year_branch || null,
        bazi_month_stem: input.bazi_month_stem || null,
        bazi_month_branch: input.bazi_month_branch || null,
        bazi_day_stem: input.bazi_day_stem || null,
        bazi_day_branch: input.bazi_day_branch || null,
        bazi_hour_stem: input.bazi_hour_stem || null,
        bazi_hour_branch: input.bazi_hour_branch || null,

        // 五行分析
        wuxing_analysis: input.wuxing_analysis || null,

        // 完整命盘 JSONB
        full_chart: input.full_chart || null,

        // 日主冗余字段
        day_master: input.day_master || null,
        day_master_element: input.day_master_element || null,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`创建八字档案失败: ${error.message}`);
    }

    return data as BaziProfile;
  }

  /**
   * 更新八字档案
   * @param id - 档案 ID
   * @param input - 更新数据
   * @returns BaziProfile
   */
  async update(id: string, input: UpdateBaziProfileInput): Promise<BaziProfile> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update(input)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      throw new Error(`更新八字档案失败: ${error.message}`);
    }

    return data as BaziProfile;
  }

  /**
   * 更新八字计算结果
   * @param id - 档案 ID
   * @param baziData - 八字计算结果
   */
  async updateBaziCalculation(
    id: string,
    baziData: {
      bazi_year_stem: string;
      bazi_year_branch: string;
      bazi_month_stem: string;
      bazi_month_branch: string;
      bazi_day_stem: string;
      bazi_day_branch: string;
      bazi_hour_stem: string;
      bazi_hour_branch: string;
      wuxing_analysis: any;
    }
  ): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update(baziData)
      .eq('id', id);

    if (error) {
      throw new Error(`更新八字计算结果失败: ${error.message}`);
    }
  }

  /**
   * 软删除八字档案
   * @param id - 档案 ID
   * @returns boolean
   */
  async softDelete(id: string): Promise<boolean> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('软删除八字档案失败:', error);
      return false;
    }

    return true;
  }

  /**
   * 检查用户是否已创建本人档案
   * @param ownerUserId - 用户 ID
   * @returns boolean
   */
  async hasOwnerProfile(ownerUserId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('id')
      .eq('owner_user_id', ownerUserId)
      .eq('is_owner', true)
      .is('deleted_at', null)
      .single();

    return data !== null && !error;
  }

  /**
   * 获取用户创建的档案总数（包括本人和亲友）
   * @param ownerUserId - 用户 ID
   * @returns number
   */
  async countByOwner(ownerUserId: string): Promise<number> {
    const { count, error } = await supabase
      .from(this.tableName)
      .select('*', { count: 'exact', head: true })
      .eq('owner_user_id', ownerUserId)
      .is('deleted_at', null);

    if (error) {
      console.error('统计档案数量失败:', error);
      return 0;
    }

    return count || 0;
  }
}

// 导出单例
export const baziProfileRepository = new BaziProfileRepository();
