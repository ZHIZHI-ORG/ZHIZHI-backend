#!/bin/bash
# 专门测试八字档案创建的脚本
# 运行前确保：npm run dev:node 已启动

BASE_URL="http://localhost:3000"

echo "🧪 测试八字档案创建流程"
echo "================================"

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 步骤1: 注册新用户
echo -e "\n${YELLOW}步骤 1: 注册新用户${NC}"
TIMESTAMP=$(date +%s)
TEST_EMAIL="bazitest${TIMESTAMP}@gmail.com"
TEST_PASSWORD="Test123456!"

echo "邮箱: $TEST_EMAIL"
echo "密码: $TEST_PASSWORD"

REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$TEST_EMAIL\",
    \"password\": \"$TEST_PASSWORD\",
    \"display_name\": \"八字测试用户\"
  }")

echo "注册响应:"
echo "$REGISTER_RESPONSE" | jq '.'

# 提取 Token
ACCESS_TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.data.access_token')

if [ "$ACCESS_TOKEN" = "null" ] || [ -z "$ACCESS_TOKEN" ]; then
  echo -e "${RED}❌ 注册失败，无法获取 Token${NC}"
  exit 1
fi

echo -e "${GREEN}✅ 注册成功${NC}"
echo "Access Token: ${ACCESS_TOKEN:0:50}..."

# 步骤2: 验证 Token（获取用户信息）
echo -e "\n${YELLOW}步骤 2: 验证 Token（获取用户信息）${NC}"
PROFILE_RESPONSE=$(curl -s "$BASE_URL/api/user/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "用户信息:"
echo "$PROFILE_RESPONSE" | jq '.'

USER_ID=$(echo "$PROFILE_RESPONSE" | jq -r '.data.id')

if [ "$USER_ID" = "null" ] || [ -z "$USER_ID" ]; then
  echo -e "${RED}❌ 无法获取用户ID，Token可能无效${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Token有效，用户ID: $USER_ID${NC}"

# 步骤3: 创建八字档案
echo -e "\n${YELLOW}步骤 3: 创建八字档案（本人）${NC}"

CREATE_REQUEST='{
  "is_owner": true,
  "name": "八字测试用户",
  "relation_to_owner": "本人",
  "gender": "male",
  "birth_year": 1990,
  "birth_month": 3,
  "birth_day": 15,
  "birth_hour": 10,
  "birth_minute": 30,
  "is_lunar": false,
  "birth_timezone": "Asia/Shanghai",
  "notes": "这是测试档案"
}'

echo "请求体:"
echo "$CREATE_REQUEST" | jq '.'

echo -e "\n发送创建请求..."
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/bazi/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "$CREATE_REQUEST")

echo -e "\n创建响应:"
echo "$CREATE_RESPONSE" | jq '.'

# 检查是否成功
SUCCESS=$(echo "$CREATE_RESPONSE" | jq -r '.success')
BAZI_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.id')

if [ "$SUCCESS" = "true" ] && [ "$BAZI_ID" != "null" ] && [ -n "$BAZI_ID" ]; then
  echo -e "\n${GREEN}✅ 八字档案创建成功！${NC}"
  echo "档案ID: $BAZI_ID"

  # 步骤4: 查看创建的档案
  echo -e "\n${YELLOW}步骤 4: 查看创建的档案${NC}"
  DETAIL_RESPONSE=$(curl -s "$BASE_URL/api/bazi/$BAZI_ID" \
    -H "Authorization: Bearer $ACCESS_TOKEN")

  echo "$DETAIL_RESPONSE" | jq '.'

  # 步骤5: 查看档案列表
  echo -e "\n${YELLOW}步骤 5: 查看档案列表${NC}"
  LIST_RESPONSE=$(curl -s "$BASE_URL/api/bazi/list" \
    -H "Authorization: Bearer $ACCESS_TOKEN")

  echo "$LIST_RESPONSE" | jq '.'

  echo -e "\n${GREEN}🎉 所有测试通过！${NC}"
else
  echo -e "\n${RED}❌ 八字档案创建失败${NC}"
  ERROR_MSG=$(echo "$CREATE_RESPONSE" | jq -r '.error.message')
  echo "错误信息: $ERROR_MSG"
  exit 1
fi
