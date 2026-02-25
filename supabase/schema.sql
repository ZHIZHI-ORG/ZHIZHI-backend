-- ============================================
-- 知之ZHIZHI - 八字命理应用数据库设计
-- 数据库：PostgreSQL (Supabase)
-- 版本：v1.0
-- ============================================

-- ============================================
-- 表 1: 用户基本信息表
-- ============================================
-- 说明：
-- 1. Supabase 内置 auth.users 表处理认证（邮箱/密码）
-- 2. 此表存储用户的额外业务信息
-- 3. id 直接关联 auth.users(id)，一对一关系

CREATE TABLE IF NOT EXISTS users (
  -- 主键：关联 Supabase Auth 用户
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,

  -- 用户基本信息
  email TEXT UNIQUE NOT NULL,                    -- 登录邮箱（与 auth.users.email 保持同步）
  display_name TEXT,                             -- 显示名称（昵称）
  avatar_url TEXT,                               -- 头像 URL

  -- 账号状态
  is_active BOOLEAN DEFAULT true,                -- 账号是否激活
  is_email_verified BOOLEAN DEFAULT false,       -- 邮箱是否验证

  -- 统计字段（冗余，提升查询性能）
  bazi_profile_count INTEGER DEFAULT 0,          -- 用户创建的八字档案数量

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,

  -- 软删除（避免物理删除导致数据丢失）
  deleted_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE users IS '用户基本信息表：存储已注册的主用户信息';
COMMENT ON COLUMN users.id IS '用户UUID，关联 Supabase auth.users';
COMMENT ON COLUMN users.bazi_profile_count IS '冗余字段：用户创建的八字档案总数，定期校准';
COMMENT ON COLUMN users.deleted_at IS '软删除时间戳，NULL表示未删除';


-- ============================================
-- 表 2: 八字档案信息表
-- ============================================
-- 说明：
-- 1. 存储所有八字信息（包括主用户本人和亲友）
-- 2. 通过 is_owner 区分是主用户本人还是亲友
-- 3. 通过 owner_user_id 标识档案的创建者

CREATE TABLE IF NOT EXISTS bazi_profiles (
  -- 主键
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 关联关系
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,  -- 档案所有者（创建此档案的用户）

  -- 档案类型标识
  is_owner BOOLEAN DEFAULT false,                -- true: 主用户本人, false: 亲友

  -- 个人基本信息
  name TEXT NOT NULL,                            -- 姓名（主用户或亲友的名字）
  relation_to_owner TEXT,                        -- 与主用户的关系（"本人"、"父亲"、"母亲"、"配偶"、"子女"等）
  gender TEXT CHECK (gender IN ('male', 'female', 'unknown')),  -- 性别

  -- 生辰信息（核心数据）
  birth_year INTEGER NOT NULL CHECK (birth_year >= 1900 AND birth_year <= 2100),
  birth_month INTEGER NOT NULL CHECK (birth_month >= 1 AND birth_month <= 12),
  birth_day INTEGER NOT NULL CHECK (birth_day >= 1 AND birth_day <= 31),
  birth_hour INTEGER CHECK (birth_hour >= 0 AND birth_hour <= 23),  -- 可选，时辰
  birth_minute INTEGER CHECK (birth_minute >= 0 AND birth_minute <= 59),  -- 可选

  -- 农历/公历标识
  is_lunar BOOLEAN DEFAULT false,                -- true: 农历, false: 公历

  -- 时区信息（重要！避免时间计算错误）
  birth_timezone TEXT DEFAULT 'Asia/Shanghai',   -- IANA 时区标识符

  -- 八字计算结果（由后端算法生成）
  bazi_year_stem TEXT,                           -- 年柱天干（甲、乙、丙...）
  bazi_year_branch TEXT,                         -- 年柱地支（子、丑、寅...）
  bazi_month_stem TEXT,                          -- 月柱天干
  bazi_month_branch TEXT,                        --月柱地支
  bazi_day_stem TEXT,                            -- 日柱天干
  bazi_day_branch TEXT,                          -- 日柱地支
  bazi_hour_stem TEXT,                           -- 时柱天干
  bazi_hour_branch TEXT,                         -- 时柱地支

  -- 五行属性（计算结果）
  wuxing_analysis JSONB,                         -- 五行分析结果（金木水火土的数量、强弱等）

  -- 备注信息
  notes TEXT,                                    -- 用户自定义备注

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- 软删除
  deleted_at TIMESTAMP WITH TIME ZONE,

  -- 唯一性约束：同一用户不能为同一个人创建重复的八字档案
  -- （基于姓名+生日+是否本人）
  CONSTRAINT unique_bazi_profile UNIQUE (owner_user_id, name, birth_year, birth_month, birth_day, is_owner)
);

COMMENT ON TABLE bazi_profiles IS '八字档案表：存储主用户本人及其添加的亲友的八字信息';
COMMENT ON COLUMN bazi_profiles.owner_user_id IS '档案创建者（主用户）';
COMMENT ON COLUMN bazi_profiles.is_owner IS '标识此档案是否为主用户本人';
COMMENT ON COLUMN bazi_profiles.is_lunar IS '出生日期是否为农历';
COMMENT ON COLUMN bazi_profiles.birth_timezone IS '出生时的时区，用于准确计算时辰';
COMMENT ON COLUMN bazi_profiles.wuxing_analysis IS 'JSON格式存储五行分析：{"金":2,"木":1,"水":3,"火":1,"土":1}';


-- ============================================
-- 索引优化
-- ============================================

-- 用户表索引
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- 八字档案表索引
CREATE INDEX IF NOT EXISTS idx_bazi_owner_user_id ON bazi_profiles(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bazi_is_owner ON bazi_profiles(owner_user_id, is_owner) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bazi_created_at ON bazi_profiles(created_at DESC);

-- 支持按关系查询（例如：查询所有"配偶"的档案）
CREATE INDEX IF NOT EXISTS idx_bazi_relation ON bazi_profiles(owner_user_id, relation_to_owner) WHERE deleted_at IS NULL;


-- ============================================
-- RLS (Row Level Security) 权限策略
-- ============================================

-- 启用 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bazi_profiles ENABLE ROW LEVEL SECURITY;

-- Users 表权限策略
-- 策略1：用户只能查看自己的信息
CREATE POLICY "用户只能查看自己的信息" ON users
  FOR SELECT USING (auth.uid() = id AND deleted_at IS NULL);

-- 策略2：用户只能更新自己的信息
CREATE POLICY "用户只能更新自己的信息" ON users
  FOR UPDATE USING (auth.uid() = id AND deleted_at IS NULL);

-- 策略3：允许创建用户记录（注册时）
CREATE POLICY "允许创建用户记录" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Bazi Profiles 表权限策略
-- 策略1：用户只能查看自己创建的八字档案
CREATE POLICY "用户只能查看自己的八字档案" ON bazi_profiles
  FOR SELECT USING (auth.uid() = owner_user_id AND deleted_at IS NULL);

-- 策略2：用户只能创建属于自己的八字档案
CREATE POLICY "用户只能创建自己的八字档案" ON bazi_profiles
  FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

-- 策略3：用户只能更新自己创建的八字档案
CREATE POLICY "用户只能更新自己的八字档案" ON bazi_profiles
  FOR UPDATE USING (auth.uid() = owner_user_id AND deleted_at IS NULL);

-- 策略4：用户只能删除自己创建的八字档案（软删除）
CREATE POLICY "用户只能删除自己的八字档案" ON bazi_profiles
  FOR DELETE USING (auth.uid() = owner_user_id);


-- ============================================
-- 触发器（自动更新时间戳和计数器）
-- ============================================

-- 通用的更新时间戳函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为 users 表添加触发器
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 为 bazi_profiles 表添加触发器
CREATE TRIGGER update_bazi_profiles_updated_at
  BEFORE UPDATE ON bazi_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 八字档案计数器更新函数
CREATE OR REPLACE FUNCTION update_bazi_profile_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.deleted_at IS NULL THEN
    -- 新增档案时，计数+1
    UPDATE users
    SET bazi_profile_count = bazi_profile_count + 1
    WHERE id = NEW.owner_user_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- 软删除时，计数-1
    UPDATE users
    SET bazi_profile_count = GREATEST(bazi_profile_count - 1, 0)
    WHERE id = NEW.owner_user_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    -- 恢复删除时，计数+1
    UPDATE users
    SET bazi_profile_count = bazi_profile_count + 1
    WHERE id = NEW.owner_user_id;
  ELSIF TG_OP = 'DELETE' THEN
    -- 物理删除时，计数-1
    UPDATE users
    SET bazi_profile_count = GREATEST(bazi_profile_count - 1, 0)
    WHERE id = OLD.owner_user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为 bazi_profiles 表添加计数器触发器
CREATE TRIGGER update_user_bazi_count
  AFTER INSERT OR UPDATE OR DELETE ON bazi_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_bazi_profile_count();


-- ============================================
-- 数据库函数（业务逻辑辅助）
-- ============================================

-- 函数：获取用户的所有八字档案（包括本人和亲友）
CREATE OR REPLACE FUNCTION get_user_bazi_profiles(user_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  is_owner BOOLEAN,
  relation_to_owner TEXT,
  birth_date TEXT,
  bazi_summary TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    bp.id,
    bp.name,
    bp.is_owner,
    bp.relation_to_owner,
    CONCAT(bp.birth_year, '-', LPAD(bp.birth_month::TEXT, 2, '0'), '-', LPAD(bp.birth_day::TEXT, 2, '0')) AS birth_date,
    CONCAT(bp.bazi_year_stem, bp.bazi_year_branch, ' ',
           bp.bazi_month_stem, bp.bazi_month_branch, ' ',
           bp.bazi_day_stem, bp.bazi_day_branch, ' ',
           bp.bazi_hour_stem, bp.bazi_hour_branch) AS bazi_summary
  FROM bazi_profiles bp
  WHERE bp.owner_user_id = user_id AND bp.deleted_at IS NULL
  ORDER BY bp.is_owner DESC, bp.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_user_bazi_profiles IS '获取用户的所有八字档案，按"本人优先"排序';


-- ============================================
-- 数据完整性校验函数
-- ============================================

-- 校验：每个用户最多只能有一个"本人"档案
CREATE OR REPLACE FUNCTION check_single_owner_profile()
RETURNS TRIGGER AS $$
DECLARE
  existing_count INTEGER;
BEGIN
  IF NEW.is_owner = true THEN
    SELECT COUNT(*) INTO existing_count
    FROM bazi_profiles
    WHERE owner_user_id = NEW.owner_user_id
      AND is_owner = true
      AND deleted_at IS NULL
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID);

    IF existing_count > 0 THEN
      RAISE EXCEPTION '每个用户只能创建一个本人档案';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_single_owner_profile
  BEFORE INSERT OR UPDATE ON bazi_profiles
  FOR EACH ROW
  EXECUTE FUNCTION check_single_owner_profile();


-- ============================================
-- 初始化数据（可选）
-- ============================================

-- 天干地支枚举数据（用于前端选择器）
CREATE TABLE IF NOT EXISTS tiangan_dizhi_lookup (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('tiangan', 'dizhi', 'wuxing')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  order_num INTEGER NOT NULL,
  description TEXT,
  UNIQUE(type, code)
);

COMMENT ON TABLE tiangan_dizhi_lookup IS '天干地支查找表：用于前端展示和验证';

INSERT INTO tiangan_dizhi_lookup (type, code, name, order_num, description) VALUES
  -- 十天干
  ('tiangan', 'jia', '甲', 1, '阳木'),
  ('tiangan', 'yi', '乙', 2, '阴木'),
  ('tiangan', 'bing', '丙', 3, '阳火'),
  ('tiangan', 'ding', '丁', 4, '阴火'),
  ('tiangan', 'wu', '戊', 5, '阳土'),
  ('tiangan', 'ji', '己', 6, '阴土'),
  ('tiangan', 'geng', '庚', 7, '阳金'),
  ('tiangan', 'xin', '辛', 8, '阴金'),
  ('tiangan', 'ren', '壬', 9, '阳水'),
  ('tiangan', 'gui', '癸', 10, '阴水'),

  -- 十二地支
  ('dizhi', 'zi', '子', 1, '鼠'),
  ('dizhi', 'chou', '丑', 2, '牛'),
  ('dizhi', 'yin', '寅', 3, '虎'),
  ('dizhi', 'mao', '卯', 4, '兔'),
  ('dizhi', 'chen', '辰', 5, '龙'),
  ('dizhi', 'si', '巳', 6, '蛇'),
  ('dizhi', 'wu', '午', 7, '马'),
  ('dizhi', 'wei', '未', 8, '羊'),
  ('dizhi', 'shen', '申', 9, '猴'),
  ('dizhi', 'you', '酉', 10, '鸡'),
  ('dizhi', 'xu', '戌', 11, '狗'),
  ('dizhi', 'hai', '亥', 12, '猪'),

  -- 五行
  ('wuxing', 'metal', '金', 1, NULL),
  ('wuxing', 'wood', '木', 2, NULL),
  ('wuxing', 'water', '水', 3, NULL),
  ('wuxing', 'fire', '火', 4, NULL),
  ('wuxing', 'earth', '土', 5, NULL)
ON CONFLICT (type, code) DO NOTHING;
