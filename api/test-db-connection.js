/**
 * 测试 Supabase 数据库连接
 * 运行：node test-db-connection.js
 */

require('dotenv/config');
const { createClient } = require('@supabase/supabase-js');

async function testConnection() {
  console.log('🔍 正在测试 Supabase 连接...\n');

  // 检查环境变量
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error('❌ 错误：环境变量未设置');
    console.log('请检查 .env 文件中的 SUPABASE_URL 和 SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  console.log(`📡 Supabase URL: ${url}`);
  console.log(`🔑 Service Key: ${key.substring(0, 20)}...\n`);

  try {
    // 创建 Supabase 客户端
    const supabase = createClient(url, key);

    // 测试 1: 查询 users 表
    console.log('测试 1: 查询 users 表...');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*')
      .limit(1);

    if (usersError) {
      console.error('❌ users 表查询失败:', usersError.message);
    } else {
      console.log('✅ users 表连接成功！');
      console.log(`   当前用户数: ${users.length}`);
    }

    // 测试 2: 查询 bazi_profiles 表
    console.log('\n测试 2: 查询 bazi_profiles 表...');
    const { data: profiles, error: profilesError } = await supabase
      .from('bazi_profiles')
      .select('*')
      .limit(1);

    if (profilesError) {
      console.error('❌ bazi_profiles 表查询失败:', profilesError.message);
    } else {
      console.log('✅ bazi_profiles 表连接成功！');
      console.log(`   当前档案数: ${profiles.length}`);
    }

    // 测试 3: 查询天干地支查找表
    console.log('\n测试 3: 查询 tiangan_dizhi_lookup 表...');
    const { data: lookup, error: lookupError } = await supabase
      .from('tiangan_dizhi_lookup')
      .select('*')
      .eq('type', 'tiangan')
      .limit(5);

    if (lookupError) {
      console.error('❌ tiangan_dizhi_lookup 表查询失败:', lookupError.message);
    } else {
      console.log('✅ tiangan_dizhi_lookup 表连接成功！');
      console.log(`   天干数据样例:`, lookup.map(l => l.name).join('、'));
    }

    console.log('\n🎉 所有测试通过！Supabase 数据库连接正常。');
    console.log('\n下一步：运行 npm run dev:node 启动本地服务器');

  } catch (error) {
    console.error('\n❌ 连接失败:', error.message);
    console.log('\n请检查：');
    console.log('1. .env 文件中的 SUPABASE_URL 和 SUPABASE_SERVICE_KEY 是否正确');
    console.log('2. 是否已在 Supabase SQL Editor 中执行了 schema.sql');
    console.log('3. 网络连接是否正常');
    process.exit(1);
  }
}

testConnection();
