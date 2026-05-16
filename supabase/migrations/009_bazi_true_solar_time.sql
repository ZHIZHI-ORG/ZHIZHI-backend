-- ============================================================
-- 迁移：009_bazi_true_solar_time.sql
-- 用途：保存出生地经纬度和真太阳时校准结果
-- ============================================================

ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS birth_latitude NUMERIC(9,6);

COMMENT ON COLUMN bazi_profiles.birth_latitude IS '出生地纬度，由前端地点选择结果提交，用于地点事实存档和校验';

ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS birth_longitude NUMERIC(9,6);

COMMENT ON COLUMN bazi_profiles.birth_longitude IS '出生地经度，由前端地点选择结果提交，用于真太阳时校准';

ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS time_basis TEXT;

COMMENT ON COLUMN bazi_profiles.time_basis IS '排盘时间基准：standard_time 或 true_solar_time';

ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS true_solar_time TEXT;

COMMENT ON COLUMN bazi_profiles.true_solar_time IS '后端校准后的真太阳时时间，格式 YYYY-MM-DD HH:mm';

ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS true_solar_correction_minutes INTEGER;

COMMENT ON COLUMN bazi_profiles.true_solar_correction_minutes IS '真太阳时相对出生地钟表时间的总校正分钟数';

ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS calculation_metadata JSONB;

COMMENT ON COLUMN bazi_profiles.calculation_metadata IS '排盘校准元信息，例如真太阳时原始时间、校准时间、经度修正、均时差、是否跨日';

CREATE INDEX IF NOT EXISTS idx_bazi_birth_location
  ON bazi_profiles(birth_country, birth_region)
  WHERE deleted_at IS NULL;
