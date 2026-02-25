/**
 * 诊断 Supabase 认证配置
 * 运行：node test-supabase-auth.js
 */

require('dotenv/config');
const { createClient } = require('@supabase/supabase-js');

async function testAuth() {
  console.log('🔍 诊断 Supabase 认证配置\n');

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  console.log(`📡 Supabase URL: ${url}`);
  console.log(`🔑 Anon Key: ${anonKey.substring(0, 30)}...\n`);

  const supabase = createClient(url, anonKey);

  // 测试1：尝试注册
  const testEmail = `test${Date.now()}@gmail.com`;
  const testPassword = 'Test123456!';

  console.log(`📍 测试注册用户: ${testEmail}`);

  try {
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: testPassword,
    });

    if (error) {
      console.error('❌ 注册失败:');
      console.error('   错误码:', error.status);
      console.error('   错误信息:', error.message);
      console.error('   详细信息:', JSON.stringify(error, null, 2));

      console.log('\n💡 可能的解决方案:');
      console.log('1. 检查 Supabase Dashboard → Authentication → Settings');
      console.log('2. 确保 "Enable email signups" 是 ON');
      console.log('3. 开发环境建议关闭 "Enable email confirmations"');
      console.log('4. 检查 Site URL 是否设置为 http://localhost:3000');

      process.exit(1);
    }

    console.log('✅ 注册成功！');
    console.log('   用户ID:', data.user?.id);
    console.log('   邮箱:', data.user?.email);
    console.log('   Session:', data.session ? '已创建' : '未创建（需要邮箱确认）');

    if (data.session) {
      console.log('   Access Token:', data.session.access_token.substring(0, 30) + '...');
    }

    // 测试2：尝试登录
    console.log('\n📍 测试登录用户: ' + testEmail);

    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

    if (loginError) {
      console.error('❌ 登录失败:', loginError.message);
    } else {
      console.log('✅ 登录成功！');
      console.log('   Session:', loginData.session ? '已创建' : '未创建');
    }

    console.log('\n🎉 Supabase 认证配置正常！');
    console.log('\n下一步: 运行 ./test-api.sh 测试完整 API');

  } catch (error) {
    console.error('❌ 测试过程发生异常:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testAuth();
