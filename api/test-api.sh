#!/bin/bash
# API 测试脚本
# 运行前确保：npm run dev:node 已启动

BASE_URL="http://localhost:3000"

echo "🧪 开始测试知之ZHIZHI后端API"
echo "================================"

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 测试1: 健康检查
echo -e "\n📍 测试 1: 健康检查"
curl -s "$BASE_URL/api/health" | jq '.'

# 测试2: 用户注册
echo -e "\n📍 测试 2: 用户注册"
# 使用时间戳生成唯一邮箱，避免重复注册错误
TIMESTAMP=$(date +%s)
TEST_EMAIL="testuser${TIMESTAMP}@gmail.com"
echo "使用测试邮箱: $TEST_EMAIL"

REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$TEST_EMAIL\",
    \"password\": \"Test123456!\",
    \"display_name\": \"测试用户\"
  }")

echo "$REGISTER_RESPONSE" | jq '.'

# 提取 access_token
ACCESS_TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.data.access_token')

if [ "$ACCESS_TOKEN" != "null" ] && [ -n "$ACCESS_TOKEN" ]; then
  echo -e "${GREEN}✅ 注册成功，已获取 Token${NC}"
else
  echo -e "${RED}❌ 注册失败或 Token 为空${NC}"
  exit 1
fi

# 测试3: 获取用户资料
echo -e "\n📍 测试 3: 获取用户资料"
curl -s "$BASE_URL/api/user/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.'

# 测试4: 创建八字档案（本人）
echo -e "\n📍 测试 4: 创建八字档案（本人）"
CREATE_BAZI_RESPONSE=$(curl -s -X POST "$BASE_URL/api/bazi/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "is_owner": true,
    "name": "测试用户",
    "relation_to_owner": "本人",
    "gender": "male",
    "birth_year": 1990,
    "birth_month": 3,
    "birth_day": 15,
    "birth_hour": 10,
    "birth_minute": 30,
    "is_lunar": false,
    "notes": "这是我的八字档案"
  }')

echo "$CREATE_BAZI_RESPONSE" | jq '.'

# 提取档案ID
BAZI_ID=$(echo "$CREATE_BAZI_RESPONSE" | jq -r '.data.id')

if [ "$BAZI_ID" != "null" ] && [ -n "$BAZI_ID" ]; then
  echo -e "${GREEN}✅ 八字档案创建成功${NC}"
else
  echo -e "${RED}❌ 八字档案创建失败${NC}"
  exit 1
fi

# 测试5: 获取八字档案列表
echo -e "\n📍 测试 5: 获取八字档案列表"
curl -s "$BASE_URL/api/bazi/list" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.'

# 测试6: 获取单个八字档案详情
echo -e "\n📍 测试 6: 获取八字档案详情"
curl -s "$BASE_URL/api/bazi/$BAZI_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.'

# 测试7: 创建亲友档案
echo -e "\n📍 测试 7: 创建亲友档案"
curl -s -X POST "$BASE_URL/api/bazi/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "is_owner": false,
    "name": "张三",
    "relation_to_owner": "父亲",
    "gender": "male",
    "birth_year": 1965,
    "birth_month": 8,
    "birth_day": 20,
    "birth_hour": 14,
    "is_lunar": true,
    "notes": "父亲的八字"
  }' | jq '.'

echo -e "\n${GREEN}🎉 所有测试完成！${NC}"
echo "================================"
echo "💡 提示：如果看到错误，检查："
echo "  1. npm run dev:node 是否在运行"
echo "  2. .env 文件是否配置正确"
echo "  3. Supabase 数据库是否可访问"
