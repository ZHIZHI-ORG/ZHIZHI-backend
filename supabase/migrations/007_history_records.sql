-- ============================================================
-- 007_history_records.sql
-- 用户历史档案：保存可回看的每日运势、洞察、分析、下钻和命盘记录
-- ============================================================

CREATE TABLE IF NOT EXISTS history_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bazi_profile_id UUID REFERENCES bazi_profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('daily_fortune', 'insight', 'analysis', 'drilldown', 'bazi_chart')),
  category TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  summary TEXT,
  source_date DATE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_key TEXT,
  is_favorited BOOLEAN NOT NULL DEFAULT false,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE history_records IS '用户历史档案：保存用户可回看的生成内容和交互结果';
COMMENT ON COLUMN history_records.payload IS '完整回放内容；AI 生成内容必须包含 schema_version';
COMMENT ON COLUMN history_records.dedupe_key IS '服务端生成内容的幂等键，避免同一天同上下文重复落历史';

CREATE INDEX IF NOT EXISTS idx_history_records_user_occurred
  ON history_records(user_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_history_records_user_source_date
  ON history_records(user_id, source_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_history_records_user_favorite
  ON history_records(user_id, is_favorited, occurred_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_history_records_user_type
  ON history_records(user_id, type, occurred_at DESC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_history_records_user_dedupe
  ON history_records(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER update_history_records_updated_at
  BEFORE UPDATE ON history_records
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE history_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户只能查看自己的历史记录"
  ON history_records FOR SELECT
  USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "用户只能创建自己的历史记录"
  ON history_records FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户只能更新自己的历史记录"
  ON history_records FOR UPDATE
  USING (auth.uid() = user_id AND deleted_at IS NULL);
