-- ============================================
-- 测试数据（开发环境使用）
-- ============================================

-- 注意：实际用户需要通过 Supabase Auth API 创建
-- 这里仅插入 profiles 表的测试数据（假设已通过 Auth 创建用户）

-- 示例：插入测试用户资料
-- INSERT INTO profiles (id, username, email, bio)
-- VALUES
--   ('00000000-0000-0000-0000-000000000001', 'test_user1', 'test1@example.com', '这是测试用户1'),
--   ('00000000-0000-0000-0000-000000000002', 'test_user2', 'test2@example.com', '这是测试用户2');

-- 示例：插入测试内容
-- INSERT INTO contents (user_id, title, body, content_type, status, tags)
-- VALUES
--   (
--     '00000000-0000-0000-0000-000000000001',
--     '第一篇测试文章',
--     '这是文章的正文内容...',
--     'article',
--     'published',
--     ARRAY['测试', '示例']
--   ),
--   (
--     '00000000-0000-0000-0000-000000000002',
--     '第二篇测试文章',
--     '这是另一篇文章的正文内容...',
--     'article',
--     'published',
--     ARRAY['测试']
--   );

-- 提示：
-- 1. 在 Supabase Dashboard 的 SQL Editor 中执行 schema.sql
-- 2. 通过 API 或 Supabase Auth UI 创建测试用户
-- 3. 使用 API 接口插入测试数据
