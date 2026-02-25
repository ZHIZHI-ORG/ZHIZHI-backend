/**
 * AI 问答系统 - 轻量化设计
 * 只存储用户偏好和配置，问题和答案都是临时生成
 */

-- ============================================
-- 1. 问题分类枚举
-- ============================================
CREATE TYPE question_category AS ENUM (
  'career',        -- 事业发展
  'wealth',        -- 财运投资
  'health',        -- 健康养生
  'relationship',  -- 感情婚姻
  'study',         -- 学习进修
  'daily_life',    -- 日常生活
  'food',          -- 饮食建议
  'travel',        -- 出行方位
  'social',        -- 人际社交
  'decision'       -- 决策建议
);

-- ============================================
-- 2. 用户兴趣偏好表（核心）
-- ============================================
CREATE TABLE user_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category question_category NOT NULL,

  -- 兴趣权重（0-1之间，影响该类问题出现的概率）
  interest_weight FLOAT DEFAULT 0.5 CHECK (interest_weight >= 0 AND interest_weight <= 1),

  -- 统计数据（用于调整权重）
  view_count INTEGER DEFAULT 0,          -- 查看次数
  answer_open_count INTEGER DEFAULT 0,   -- 打开答案次数
  follow_up_click_count INTEGER DEFAULT 0, -- 点击后续问题次数

  -- 最后更新时间
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 唯一约束：每个用户每个分类只有一条记录
  UNIQUE(user_id, category),

  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_user_interests_user ON user_interests(user_id);
CREATE INDEX idx_user_interests_weight ON user_interests(user_id, interest_weight DESC);

-- ============================================
-- 3. 八字类型偏好模板（预设配置）
-- ============================================
-- 这个表存储不同八字特征对应的问题偏好
-- 例如：五行缺金的人更关注健康、财运
CREATE TABLE bazi_category_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 八字特征描述
  template_name VARCHAR(100) NOT NULL UNIQUE, -- 如 "五行缺金", "木旺", "日主为庚"
  description TEXT,

  -- 匹配条件（JSONB格式，灵活配置）
  -- 示例: {"wuxing_lacking": ["金"], "day_stem": "庚"}
  match_conditions JSONB NOT NULL,

  -- 各类别的推荐权重
  category_weights JSONB NOT NULL,
  -- 示例: {"health": 0.8, "wealth": 0.7, "career": 0.5, ...}

  -- 是否启用
  is_active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bazi_templates_active ON bazi_category_templates(is_active);

-- ============================================
-- 4. 每日问题种子表（保证同一天看到相同问题）
-- ============================================
CREATE TABLE daily_question_seeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 日期（用于判断是否需要重新生成）
  seed_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- 随机种子（用于生成一致的问题序列）
  random_seed VARCHAR(64) NOT NULL,

  -- 当天生成的问题ID列表（只存ID，不存内容）
  -- 这样可以保证当天重复访问看到相同顺序的问题
  question_ids VARCHAR[] DEFAULT '{}',

  -- 过期时间（第二天自动清理）
  expires_at TIMESTAMPTZ DEFAULT (CURRENT_DATE + INTERVAL '1 day'),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- 唯一约束：每个用户每天一条记录
  UNIQUE(user_id, seed_date),

  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_daily_seeds_user_date ON daily_question_seeds(user_id, seed_date DESC);
CREATE INDEX idx_daily_seeds_expires ON daily_question_seeds(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================
-- 5. 用户交互行为表（轻量级，只记录关键行为）
-- ============================================
CREATE TABLE question_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 问题标识（临时ID，当天有效）
  question_id VARCHAR(100) NOT NULL,
  category question_category NOT NULL,

  -- 交互类型
  action VARCHAR(50) NOT NULL, -- 'view_question', 'open_answer', 'click_follow_up', 'dismiss'

  -- 交互时间
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_interactions_user ON question_interactions(user_id, created_at DESC);
CREATE INDEX idx_interactions_category ON question_interactions(category, action);

-- ============================================
-- 6. 自动更新时间戳触发器
-- ============================================
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_interests_timestamp
  BEFORE UPDATE ON user_interests
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trigger_update_bazi_templates_timestamp
  BEFORE UPDATE ON bazi_category_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp();

-- ============================================
-- 7. 自动调整兴趣权重的函数
-- ============================================
CREATE OR REPLACE FUNCTION adjust_interest_weight(
  p_user_id UUID,
  p_category question_category,
  p_action VARCHAR
)
RETURNS VOID AS $$
DECLARE
  weight_delta FLOAT;
BEGIN
  -- 根据不同行为调整权重
  CASE p_action
    WHEN 'open_answer' THEN weight_delta := 0.05;      -- 打开答案：增加5%
    WHEN 'click_follow_up' THEN weight_delta := 0.08;  -- 点击后续：增加8%
    WHEN 'dismiss' THEN weight_delta := -0.03;         -- 忽略：减少3%
    ELSE weight_delta := 0;
  END CASE;

  -- 更新权重（限制在0-1之间）
  UPDATE user_interests
  SET
    interest_weight = LEAST(1.0, GREATEST(0.0, interest_weight + weight_delta)),
    updated_at = NOW()
  WHERE user_id = p_user_id AND category = p_category;

END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 8. 初始化用户兴趣的函数
-- ============================================
CREATE OR REPLACE FUNCTION initialize_user_interests(p_user_id UUID, p_bazi_profile_id UUID)
RETURNS VOID AS $$
DECLARE
  bazi_record RECORD;
  template_record RECORD;
  base_weight FLOAT := 0.5;
BEGIN
  -- 获取用户的八字信息
  SELECT * INTO bazi_record
  FROM bazi_profiles
  WHERE id = p_bazi_profile_id;

  -- 为每个分类初始化权重
  INSERT INTO user_interests (user_id, category, interest_weight)
  SELECT
    p_user_id,
    unnest(enum_range(NULL::question_category)),
    base_weight
  ON CONFLICT (user_id, category) DO NOTHING;

  -- 根据八字特征调整权重
  -- 查找匹配的模板
  FOR template_record IN
    SELECT * FROM bazi_category_templates WHERE is_active = TRUE
  LOOP
    -- 这里可以添加复杂的匹配逻辑
    -- 例如检查五行缺失、日主等
    -- 暂时简化处理
  END LOOP;

END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. 清理过期数据的函数
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_seeds()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- 删除过期的每日种子
  DELETE FROM daily_question_seeds
  WHERE expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  -- 清理7天前的交互记录（可选）
  DELETE FROM question_interactions
  WHERE created_at < NOW() - INTERVAL '7 days';

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 10. Row Level Security (RLS) 策略
-- ============================================

ALTER TABLE user_interests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "用户只能查看自己的兴趣偏好"
  ON user_interests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "用户只能修改自己的兴趣偏好"
  ON user_interests FOR ALL
  USING (auth.uid() = user_id);

ALTER TABLE daily_question_seeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "用户只能查看自己的每日种子"
  ON daily_question_seeds FOR ALL
  USING (auth.uid() = user_id);

ALTER TABLE question_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "用户只能查看自己的交互记录"
  ON question_interactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "用户只能创建自己的交互记录"
  ON question_interactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 八字模板表：所有人可读，只有管理员可写
ALTER TABLE bazi_category_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "所有人可以查看八字模板"
  ON bazi_category_templates FOR SELECT
  TO authenticated
  USING (TRUE);

-- ============================================
-- 11. 初始化一些预设的八字模板
-- ============================================
INSERT INTO bazi_category_templates (template_name, description, match_conditions, category_weights) VALUES
('五行缺金', '缺少金元素，建议关注健康和财运',
 '{"wuxing_lacking": ["金"]}',
 '{"health": 0.8, "wealth": 0.7, "career": 0.6, "relationship": 0.5, "daily_life": 0.5, "food": 0.6, "travel": 0.4, "social": 0.5, "decision": 0.5, "study": 0.4}'::jsonb),

('五行缺木', '缺少木元素，建议关注事业和学习',
 '{"wuxing_lacking": ["木"]}',
 '{"health": 0.5, "wealth": 0.5, "career": 0.8, "relationship": 0.6, "daily_life": 0.5, "food": 0.6, "travel": 0.5, "social": 0.6, "decision": 0.6, "study": 0.8}'::jsonb),

('五行缺水', '缺少水元素，建议关注智慧和人际',
 '{"wuxing_lacking": ["水"]}',
 '{"health": 0.6, "wealth": 0.6, "career": 0.5, "relationship": 0.7, "daily_life": 0.5, "food": 0.5, "travel": 0.6, "social": 0.8, "decision": 0.7, "study": 0.7}'::jsonb),

('五行缺火', '缺少火元素，建议关注热情和社交',
 '{"wuxing_lacking": ["火"]}',
 '{"health": 0.6, "wealth": 0.5, "career": 0.6, "relationship": 0.8, "daily_life": 0.5, "food": 0.5, "travel": 0.7, "social": 0.8, "decision": 0.5, "study": 0.5}'::jsonb),

('五行缺土', '缺少土元素，建议关注稳定和健康',
 '{"wuxing_lacking": ["土"]}',
 '{"health": 0.7, "wealth": 0.6, "career": 0.6, "relationship": 0.6, "daily_life": 0.7, "food": 0.7, "travel": 0.5, "social": 0.5, "decision": 0.6, "study": 0.5}'::jsonb),

('木旺', '木元素旺盛，建议关注事业发展',
 '{"wuxing_dominant": "木"}',
 '{"health": 0.5, "wealth": 0.6, "career": 0.9, "relationship": 0.6, "daily_life": 0.5, "food": 0.5, "travel": 0.6, "social": 0.7, "decision": 0.7, "study": 0.8}'::jsonb);

-- ============================================
-- 12. 注释说明
-- ============================================
COMMENT ON TABLE user_interests IS '用户对各类问题的兴趣权重（持久化）';
COMMENT ON TABLE bazi_category_templates IS '不同八字特征对应的问题类别推荐权重模板';
COMMENT ON TABLE daily_question_seeds IS '每日问题生成的随机种子（确保当天一致性）';
COMMENT ON TABLE question_interactions IS '用户交互行为记录（用于调整兴趣权重）';

COMMENT ON COLUMN user_interests.interest_weight IS '兴趣权重0-1，越高该类问题出现概率越大';
COMMENT ON COLUMN daily_question_seeds.random_seed IS '随机种子，用于生成确定性的问题序列';
COMMENT ON COLUMN bazi_category_templates.match_conditions IS 'JSONB格式的匹配条件，如 {"wuxing_lacking": ["金"]}';
