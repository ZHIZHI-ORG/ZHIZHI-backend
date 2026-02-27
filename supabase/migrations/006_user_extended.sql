-- ============================================================
-- 迁移：006_user_extended.sql
-- 用途：扩展 users 表，添加用户资料模块所需的扩展字段
-- 说明：
--   simple.md §7.2 定义的用户资料字段中，部分字段
--   (career, school, mbti, bio, location 等) 原 users 表未包含。
--   本迁移补充这些字段，供 PUT /api/user/profile/extended 接口使用。
-- ============================================================


-- ============================================================
-- 1. 扩展 users 表：添加用户资料扩展字段
-- ============================================================

-- 个人简介
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio TEXT;

COMMENT ON COLUMN users.bio IS '个人简介';

-- 所在地（城市/地区，如"北京"）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN users.location IS '所在地（城市/地区）';

-- 职业
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS career TEXT;

COMMENT ON COLUMN users.career IS '职业';

-- 学校
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS school TEXT;

COMMENT ON COLUMN users.school IS '学校';

-- MBTI 人格类型（如 INTJ / ENFP）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mbti TEXT;

COMMENT ON COLUMN users.mbti IS 'MBTI人格类型（如 INTJ）';

-- 备注/生活事件（用户可以写当前生活状态）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN users.notes IS '备注/生活事件（用户自填）';


-- ============================================================
-- 2. 为 invite_codes 表添加 "用户邀请码" 相关索引优化
-- ============================================================
-- 说明：invite_codes 表已在 003_invite_codes.sql 中建立。
--   GET /api/user/invite-code 接口需要按 created_by 查询用户邀请码。
--   003 中已有 idx_invite_codes_created_by 索引，无需重复创建。
-- （本节保留注释，说明无需额外索引）


-- ============================================================
-- 3. RLS 策略：允许用户读写自己的扩展字段
-- ============================================================
-- 说明：users 表已有 "用户只能更新自己的信息" 策略（schema.sql），
--   该策略对整行生效，新增列自动受保护，无需新增策略。
-- （本节保留注释，说明无需额外策略）
