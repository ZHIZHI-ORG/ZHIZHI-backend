/**
 * 八字档案数据模型
 * 对应数据库表：bazi_profiles
 */
import type { DailyFortuneProfileContext } from './DailyFortuneContext';

/**
 * 性别枚举
 */
export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  UNKNOWN = 'unknown',
}

/**
 * 五行分析结果（字段名与 baziCalculator.ts WuxingAnalysis 保持一致）
 */
export interface WuxingAnalysis {
  金: number;
  木: number;
  水: number;
  火: number;
  土: number;
  dominant: string;   // 最强五行
  lacking: string[];  // 缺失五行列表
}

/**
 * 八字档案实体（完整信息）
 */
export interface BaziProfile {
  id: string; // UUID
  owner_user_id: string; // 档案所有者（创建者）
  is_owner: boolean; // 是否为主用户本人

  // 基本信息
  name: string;
  relation_to_owner?: string; // 与主用户的关系
  gender?: Gender;

  // 生辰信息
  birth_year: number;
  birth_month: number;
  birth_day: number;
  birth_hour?: number | null;
  birth_minute?: number | null;
  is_lunar: boolean; // 是否农历
  birth_timezone: string; // 时区

  // 八字计算结果（基础四柱，冗余列方便直接查询）
  bazi_year_stem?: string;   // 年柱天干
  bazi_year_branch?: string; // 年柱地支
  bazi_month_stem?: string;
  bazi_month_branch?: string;
  bazi_day_stem?: string;
  bazi_day_branch?: string;
  bazi_hour_stem?: string | null;
  bazi_hour_branch?: string | null;

  // 五行分析
  wuxing_analysis?: WuxingAnalysis;

  // 完整命盘（JSONB，baziCalculator.ts FullChartResult，含十神/藏干/纳音/空亡/神煞/大运等）
  full_chart?: any;

  // 日主冗余字段（方便快速查询，避免每次解析 full_chart）
  day_master?: string;         // 日主天干（如"庚"）
  day_master_element?: string; // 日主五行（如"金"）

  // 可选扩展字段（simple.md §4.3）
  birth_country?: string;  // 出生国家
  birth_region?: string;   // 出生地区（省/市/区）
  birth_latitude?: number;  // 出生地纬度
  birth_longitude?: number; // 出生地经度
  time_basis?: 'standard_time' | 'true_solar_time'; // 排盘时间基准
  true_solar_time?: string | null; // 后端校准后的真太阳时
  true_solar_correction_minutes?: number | null; // 真太阳时总校正分钟数
  calculation_metadata?: any; // 排盘校准元信息
  mbti?: string;           // MBTI 类型

  // 首页日运的结构化现实上下文和知之理解快照
  daily_fortune_context?: DailyFortuneProfileContext;

  // 备注
  notes?: string;

  // 时间戳
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

/**
 * 创建八字档案输入（前端提交的数据）
 */
export interface CreateBaziProfileInput {
  is_owner: boolean; // 是否为本人
  name: string;
  relation_to_owner?: string;
  gender?: Gender;

  // 生辰信息
  birth_year: number;
  birth_month: number;
  birth_day: number;
  birth_hour?: number | null;
  birth_minute?: number | null;
  is_lunar?: boolean;        // 默认 false（公历）
  birth_timezone?: string;   // 默认 'Asia/Shanghai'

  // 可选扩展字段（simple.md §4.3）
  birth_country?: string;
  birth_region?: string;
  birth_latitude?: number;
  birth_longitude?: number;
  mbti?: string;

  daily_fortune_context?: DailyFortuneProfileContext;

  notes?: string;
}

/**
 * 更新八字档案输入
 */
export interface UpdateBaziProfileInput {
  is_owner?: boolean;
  name?: string;
  relation_to_owner?: string;
  gender?: Gender;
  birth_year?: number;
  birth_month?: number;
  birth_day?: number;
  birth_hour?: number | null;
  birth_minute?: number | null;
  is_lunar?: boolean;
  birth_timezone?: string;
  birth_country?: string;
  birth_region?: string;
  birth_latitude?: number;
  birth_longitude?: number;
  time_basis?: 'standard_time' | 'true_solar_time';
  true_solar_time?: string | null;
  true_solar_correction_minutes?: number | null;
  calculation_metadata?: any;
  mbti?: string;
  daily_fortune_context?: DailyFortuneProfileContext;
  bazi_year_stem?: string;
  bazi_year_branch?: string;
  bazi_month_stem?: string;
  bazi_month_branch?: string;
  bazi_day_stem?: string;
  bazi_day_branch?: string;
  bazi_hour_stem?: string | null;
  bazi_hour_branch?: string | null;
  wuxing_analysis?: WuxingAnalysis;
  full_chart?: any;
  day_master?: string;
  day_master_element?: string;
  notes?: string;
}

/**
 * 八字档案列表查询参数
 */
export interface BaziProfileListQuery {
  is_owner?: boolean; // 筛选本人或亲友
  relation?: string; // 按关系筛选
  page?: number;
  page_size?: number;
}

/**
 * 八字档案列表响应
 */
export interface BaziProfileListResponse {
  items: BaziProfile[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * 八字档案简要信息（用于列表展示）
 */
export interface BaziProfileSummary {
  id: string;
  name: string;
  is_owner: boolean;
  relation_to_owner?: string;
  birth_date: string; // 格式：YYYY-MM-DD
  bazi_summary: string; // 八字四柱简写，如"甲子 乙丑 丙寅 丁卯"
  created_at: string;
}

/**
 * 八字计算请求（用于测试/预览）
 */
export interface CalculateBaziInput {
  birth_year: number;
  birth_month: number;
  birth_day: number;
  birth_hour?: number;
  birth_minute?: number;
  is_lunar?: boolean;
  birth_timezone?: string;
}

/**
 * 八字计算响应
 */
export interface CalculateBaziResponse {
  bazi: {
    year_stem: string;
    year_branch: string;
    month_stem: string;
    month_branch: string;
    day_stem: string;
    day_branch: string;
    hour_stem: string;
    hour_branch: string;
  };
  wuxing_analysis: WuxingAnalysis;
  summary: string; // 八字四柱文本
}
