-- ============================================================
-- 012_daily_fortune_user_context.sql
-- 首页日运：按八字档案保存的现实上下文与知之理解快照
-- ============================================================

ALTER TABLE bazi_profiles
  ADD COLUMN IF NOT EXISTS daily_fortune_context JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN bazi_profiles.daily_fortune_context IS
  '首页日运的结构化现实上下文与知之理解快照；仅用于将命理事实映射到具体场景，不参与排盘或命理关系计算';
