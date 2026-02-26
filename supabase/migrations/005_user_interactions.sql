-- ============================================================
-- 005_user_interactions.sql
-- 用户行为记录表，用于后期推荐算法权重统计
-- ============================================================

CREATE TABLE IF NOT EXISTS user_interactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,   -- career / love / health / overall / study
  action       TEXT NOT NULL,   -- expand_bullet / view_scene / view_card
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 查询某用户的行为记录时按 user_id + created_at 索引
CREATE INDEX idx_user_interactions_user_id
  ON user_interactions(user_id, created_at DESC);

-- 统计权重时按 user_id + category 索引
CREATE INDEX idx_user_interactions_category
  ON user_interactions(user_id, category);

-- RLS：用户只能读写自己的行为记录
ALTER TABLE user_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户只能插入自己的行为记录"
  ON user_interactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户只能查看自己的行为记录"
  ON user_interactions FOR SELECT
  USING (auth.uid() = user_id);
