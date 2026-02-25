/**
 * 八字服务层（Service）
 *
 * 职责：
 *   - 创建八字档案（调用计算器、写入数据库）
 *   - 查询档案列表 / 详情
 *   - 更新档案（仅允许改非核心字段）
 *   - 删除档案（软删除）
 *
 * 计算器：baziCalculator.ts（基于 lunar-javascript + 自研神煞查表）
 */

import { baziProfileRepository } from '../database/repositories/BaziProfileRepository';
import {
  BaziProfile,
  CreateBaziProfileInput,
  UpdateBaziProfileInput,
  BaziProfileListQuery,
  BaziProfileListResponse,
} from '../models/BaziProfile';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors';
import { calculateFullChart } from '../utils/baziCalculator';

// ============================================================
// 创建档案
// ============================================================

/**
 * 创建八字档案
 *
 * 流程：
 *   1. 验证输入字段
 *   2. 检查本人档案是否已存在（is_owner=true 只能有一个）
 *   3. 调用计算器生成完整命盘
 *   4. 写入数据库（基础字段 + full_chart）
 *
 * @param userId - 当前登录用户 ID
 * @param input  - 前端提交的档案信息
 */
export async function createBaziProfile(
  userId: string,
  input: CreateBaziProfileInput,
): Promise<BaziProfile> {

  // 1. 验证输入
  validateBaziInput(input);

  // 2. 本人档案唯一性检查
  if (input.is_owner) {
    const hasOwner = await baziProfileRepository.hasOwnerProfile(userId);
    if (hasOwner) {
      throw new ValidationError('您已经创建过本人档案，无法重复创建');
    }
  }

  // 3. 计算完整命盘
  const chart = await calculateFullChart(
    input.birth_year,
    input.birth_month,
    input.birth_day,
    input.birth_hour ?? 12,    // 不知时辰默认午时
    input.birth_minute ?? 0,
    input.is_lunar ?? false,
    1,   // gender 暂时统一用1（后续可从 input.gender 映射）
    1,   // sect 默认流派1
  );

  // 4. 写入数据库
  const profile = await baziProfileRepository.create(userId, {
    // 前端提交的基础字段
    is_owner: input.is_owner,
    name: input.name,
    relation_to_owner: input.relation_to_owner,
    gender: input.gender,
    birth_year: input.birth_year,
    birth_month: input.birth_month,
    birth_day: input.birth_day,
    birth_hour: input.birth_hour,
    birth_minute: input.birth_minute,
    is_lunar: input.is_lunar,
    birth_timezone: input.birth_timezone,
    // 可选扩展字段（simple.md §4.3）
    birth_country: input.birth_country,
    birth_region: input.birth_region,
    mbti: input.mbti,
    notes: input.notes,
    // 基础四柱冗余列
    bazi_year_stem: chart.year.stem,
    bazi_year_branch: chart.year.branch,
    bazi_month_stem: chart.month.stem,
    bazi_month_branch: chart.month.branch,
    bazi_day_stem: chart.day.stem,
    bazi_day_branch: chart.day.branch,
    bazi_hour_stem: chart.time.stem,
    bazi_hour_branch: chart.time.branch,
    // 五行分析
    wuxing_analysis: chart.wuxing,
    // 完整命盘 JSONB
    full_chart: chart,
    // 日主冗余字段
    day_master: chart.dayMaster,
    day_master_element: chart.dayMasterElement,
  });

  return profile;
}

// ============================================================
// 查询档案列表
// ============================================================

/**
 * 获取用户的八字档案列表
 *
 * @param userId - 用户 ID
 * @param query  - 分页/筛选参数
 */
export async function getBaziProfileList(
  userId: string,
  query?: BaziProfileListQuery,
): Promise<BaziProfileListResponse> {

  const { items, total } = await baziProfileRepository.findByOwner(userId, query);

  const page = query?.page || 1;
  const pageSize = query?.page_size || 20;

  return {
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  };
}

// ============================================================
// 查询档案详情
// ============================================================

/**
 * 获取单个八字档案详情（含完整命盘）
 *
 * @param userId    - 当前用户 ID（用于权限校验）
 * @param profileId - 档案 ID
 */
export async function getBaziProfileById(
  userId: string,
  profileId: string,
): Promise<BaziProfile> {

  const profile = await baziProfileRepository.findById(profileId);

  if (!profile) {
    throw new NotFoundError('八字档案不存在');
  }

  // 权限校验：只能访问自己的档案
  if (profile.owner_user_id !== userId) {
    throw new ForbiddenError('无权访问此档案');
  }

  return profile;
}

// ============================================================
// 更新档案
// ============================================================

/**
 * 更新八字档案
 *
 * 根据 simple.md §4.2：只允许修改姓名、关系、备注
 * 生辰信息不可更改（影响命盘计算结果的一致性）
 *
 * @param userId    - 当前用户 ID
 * @param profileId - 档案 ID
 * @param input     - 可更新字段
 */
export async function updateBaziProfile(
  userId: string,
  profileId: string,
  input: UpdateBaziProfileInput,
): Promise<BaziProfile> {

  // 权限校验（内部调用 findById）
  await getBaziProfileById(userId, profileId);

  return await baziProfileRepository.update(profileId, input);
}

// ============================================================
// 删除档案
// ============================================================

/**
 * 删除八字档案（软删除，设置 deleted_at）
 *
 * @param userId    - 当前用户 ID
 * @param profileId - 档案 ID
 */
export async function deleteBaziProfile(
  userId: string,
  profileId: string,
): Promise<boolean> {

  // 权限校验
  await getBaziProfileById(userId, profileId);

  return await baziProfileRepository.softDelete(profileId);
}

// ============================================================
// 输入验证
// ============================================================

/**
 * 验证创建档案的输入字段
 */
function validateBaziInput(input: CreateBaziProfileInput): void {

  // 姓名
  if (!input.name || input.name.trim().length === 0) {
    throw new ValidationError('姓名不能为空');
  }
  if (input.name.length > 50) {
    throw new ValidationError('姓名不能超过50个字符');
  }

  // 性别
  if (!input.gender || !['male', 'female'].includes(input.gender)) {
    throw new ValidationError('性别必须为 male 或 female');
  }

  // 亲友档案必须填写关系
  if (!input.is_owner && !input.relation_to_owner) {
    throw new ValidationError('亲友档案必须填写与您的关系');
  }

  // 出生年份
  const currentYear = new Date().getFullYear();
  if (input.birth_year < 1900 || input.birth_year > currentYear + 1) {
    throw new ValidationError(`出生年份须在 1900 到 ${currentYear + 1} 之间`);
  }

  // 出生月份
  if (input.birth_month < 1 || input.birth_month > 12) {
    throw new ValidationError('出生月份须在 1 到 12 之间');
  }

  // 出生日期
  if (input.birth_day < 1 || input.birth_day > 31) {
    throw new ValidationError('出生日期须在 1 到 31 之间');
  }

  // 时辰（可选）
  if (input.birth_hour !== undefined && (input.birth_hour < 0 || input.birth_hour > 23)) {
    throw new ValidationError('出生小时须在 0 到 23 之间');
  }

  // 分钟（可选）
  if (input.birth_minute !== undefined && (input.birth_minute < 0 || input.birth_minute > 59)) {
    throw new ValidationError('出生分钟须在 0 到 59 之间');
  }
}
