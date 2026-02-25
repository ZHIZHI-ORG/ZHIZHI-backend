-- ============================================================
-- 迁移：004_bazi_extended.sql
-- 用途：扩展 bazi_profiles 表，存储完整命盘计算结果
-- 说明：
--   原 schema.sql 只存了基础四柱天干地支和五行分析。
--   本迁移新增 JSONB 字段存储十神、藏干、纳音、空亡、
--   神煞、长生十二宫、大运等完整命盘数据。
--   使用 JSONB 而非独立列，方便后续扩展字段而无需再迁移。
-- ============================================================


-- ============================================================
-- 1. 扩展 bazi_profiles 表：新增完整命盘字段
-- ============================================================

-- 完整命盘数据（JSONB，存储 baziCalculator.ts 的 FullChartResult）
-- 包含：四柱详情（十神/藏干/纳音/空亡/神煞/地势）、大运列表
ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS full_chart JSONB;

COMMENT ON COLUMN bazi_profiles.full_chart IS '完整命盘计算结果（JSON），包含十神、藏干、纳音、空亡、神煞、长生十二宫、大运等';

-- 出生地信息（simple.md §4.3 中的可选字段）
ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS birth_country TEXT;

COMMENT ON COLUMN bazi_profiles.birth_country IS '出生国家（可选）';

ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS birth_region TEXT;

COMMENT ON COLUMN bazi_profiles.birth_region IS '出生地区：省/市/区（可选）';

-- MBTI（simple.md §4.3 中的可选字段）
ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS mbti TEXT;

COMMENT ON COLUMN bazi_profiles.mbti IS 'MBTI人格类型（可选，如 INTJ）';

-- 日主天干（冗余字段，方便快速查询，避免每次解析 full_chart）
ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS day_master TEXT;

COMMENT ON COLUMN bazi_profiles.day_master IS '日主天干（冗余字段，如"庚"），从 full_chart 提取';

-- 日主五行（冗余字段）
ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS day_master_element TEXT;

COMMENT ON COLUMN bazi_profiles.day_master_element IS '日主五行（冗余字段，如"金"）';


-- ============================================================
-- 2. 索引优化
-- ============================================================

-- 按日主查询（例如查询所有庚金日主的档案）
CREATE INDEX IF NOT EXISTS idx_bazi_day_master
  ON bazi_profiles(day_master)
  WHERE deleted_at IS NULL;

-- full_chart JSONB 的 GIN 索引（支持 JSON 内部字段查询）
CREATE INDEX IF NOT EXISTS idx_bazi_full_chart_gin
  ON bazi_profiles USING GIN (full_chart)
  WHERE full_chart IS NOT NULL;
