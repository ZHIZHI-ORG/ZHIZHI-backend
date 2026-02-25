-- ============================================================
-- 迁移：003_invite_codes.sql
-- 用途：邀请码系统（内测门禁 + 好友邀请）
-- 说明：
--   知之 App 内测阶段采用邀请制，未验证邀请码的设备无法进入。
--   本迁移新增两张表：
--     - invite_codes   : 邀请码主表（码本身的元数据）
--     - invite_usages  : 邀请关系表（谁用了哪张码）
-- ============================================================


-- ============================================================
-- 表 1: invite_codes — 邀请码主表
-- ============================================================
-- 设计说明：
--   1. 系统生成的码（created_by IS NULL）用于内测门禁验证。
--   2. 用户生成的码（created_by = user.id）用于"邀请好友"功能。
--   3. max_uses = -1 表示无使用次数限制（如管理员批量码）。
--   4. expires_at IS NULL 表示永不过期。

CREATE TABLE IF NOT EXISTS invite_codes (
  -- 主键
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 邀请码字符串，全局唯一，大写字母+数字，如 "ZHIZHI2026"
  code TEXT UNIQUE NOT NULL,

  -- 码的创建者：NULL = 系统生成，非 NULL = 某用户生成的邀请码
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- 已使用次数（每次有效使用后 +1）
  used_count INTEGER DEFAULT 0 NOT NULL,

  -- 最大允许使用次数：-1 表示无限次
  max_uses INTEGER DEFAULT 1 NOT NULL,

  -- 是否有效（可手动禁用某张码）
  is_active BOOLEAN DEFAULT true NOT NULL,

  -- 过期时间：NULL 表示永不过期
  expires_at TIMESTAMP WITH TIME ZONE,

  -- 备注（如"2026年春节批次"），仅管理员可见
  note TEXT,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE invite_codes IS '邀请码表：记录所有邀请码的元数据，支持门禁验证和好友邀请两种场景';
COMMENT ON COLUMN invite_codes.created_by IS 'NULL=系统生成码；有值=用户生成的好友邀请码';
COMMENT ON COLUMN invite_codes.max_uses IS '-1 表示无使用次数限制';
COMMENT ON COLUMN invite_codes.expires_at IS 'NULL 表示永不过期';


-- ============================================================
-- 表 2: invite_usages — 邀请关系表
-- ============================================================
-- 设计说明：
--   记录"谁用了哪张码"，用于：
--     1. 查询某码的使用历史。
--     2. 查询某用户的邀请树（谁被我邀请进来的）。
--     3. 未来扩展：邀请奖励发放依据。
--   每个用户只能有一条使用记录（一人只能被一张码邀请一次）。

CREATE TABLE IF NOT EXISTS invite_usages (
  -- 主键
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 关联的邀请码
  invite_code_id UUID NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,

  -- 使用该码的用户（注册完成后写入）
  used_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 使用时间
  used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  -- 约束：每个用户只能有一条邀请记录
  CONSTRAINT unique_user_invite UNIQUE (used_by_user_id)
);

COMMENT ON TABLE invite_usages IS '邀请使用记录表：记录每个用户是通过哪张邀请码注册的';
COMMENT ON COLUMN invite_usages.used_by_user_id IS '每个用户只能被邀请一次（UNIQUE 约束）';


-- ============================================================
-- 索引优化
-- ============================================================

-- 按码字符串查询（门禁验证的高频操作）
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code) WHERE is_active = true;

-- 按创建者查询（用户查自己生成的邀请码）
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON invite_codes(created_by) WHERE is_active = true;

-- 按邀请码 ID 查询使用记录
CREATE INDEX IF NOT EXISTS idx_invite_usages_code_id ON invite_usages(invite_code_id);

-- 按被邀请用户查询
CREATE INDEX IF NOT EXISTS idx_invite_usages_user_id ON invite_usages(used_by_user_id);


-- ============================================================
-- RLS（行级安全）策略
-- ============================================================

-- 启用 RLS
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_usages ENABLE ROW LEVEL SECURITY;

-- invite_codes：所有登录用户可读有效的码（用于验证门禁）
-- 写操作通过 Service Role Key（后端）完成，前端无写权限
CREATE POLICY "所有人可查询有效邀请码" ON invite_codes
  FOR SELECT USING (is_active = true);

-- invite_usages：用户只能查看自己的邀请记录
CREATE POLICY "用户只能查看自己的邀请记录" ON invite_usages
  FOR SELECT USING (auth.uid() = used_by_user_id);


-- ============================================================
-- 初始数据：内测种子邀请码
-- ============================================================
-- 说明：这些是系统级别的内测门禁码，max_uses=-1 表示无限次使用。
-- 上线前请在 Supabase Dashboard 中管理，或通过管理员接口生成。

INSERT INTO invite_codes (code, created_by, max_uses, note) VALUES
  ('ZHIZHI2026', NULL, -1, '内测总码，无使用次数限制'),
  ('BETA2026',   NULL, -1, '内测备用码')
ON CONFLICT (code) DO NOTHING;
