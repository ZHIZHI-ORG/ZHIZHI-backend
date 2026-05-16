-- ============================================================
-- 迁移：010_invite_weekly_ownership.sql
-- 用途：用户邀请码按香港自然周刷新，并确保邀请关系可追溯
-- ============================================================

ALTER TABLE invite_codes
  ADD COLUMN IF NOT EXISTS period_start TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS period_end TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN invite_codes.period_start IS '用户邀请码所属周期开始时间；系统门禁码为 NULL';
COMMENT ON COLUMN invite_codes.period_end IS '用户邀请码所属周期结束时间；系统门禁码为 NULL';

-- 将已有用户邀请码归入当前香港自然周，避免上线迁移后老用户立即丢失邀请码。
UPDATE invite_codes
SET
  period_start = date_trunc('week', now() AT TIME ZONE 'Asia/Hong_Kong') AT TIME ZONE 'Asia/Hong_Kong',
  period_end = (date_trunc('week', now() AT TIME ZONE 'Asia/Hong_Kong') + INTERVAL '7 days') AT TIME ZONE 'Asia/Hong_Kong',
  expires_at = COALESCE(
    expires_at,
    (date_trunc('week', now() AT TIME ZONE 'Asia/Hong_Kong') + INTERVAL '7 days') AT TIME ZONE 'Asia/Hong_Kong'
  )
WHERE created_by IS NOT NULL
  AND period_start IS NULL;

-- 如果历史上同一用户已有多张当前周期码，只保留最新一张有效码。
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY created_by, period_start
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM invite_codes
  WHERE created_by IS NOT NULL
    AND is_active = true
)
UPDATE invite_codes
SET is_active = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_creator_period_active
  ON invite_codes(created_by, period_start)
  WHERE created_by IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_invite_codes_period_end
  ON invite_codes(period_end)
  WHERE created_by IS NOT NULL AND is_active = true;

-- 原子自增邀请码使用次数。服务端注册成功写入 invite_usages 后调用。
CREATE OR REPLACE FUNCTION increment_invite_code_used_count(code_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE invite_codes
  SET used_count = used_count + 1
  WHERE id = code_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
