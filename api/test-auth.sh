#!/bin/bash
# ============================================================
# 认证模块接口测试脚本
# 依据：simple.md §3 用户认证模块
#
# 使用方法：
#   1. 保持 npm run dev:node 在另一个终端运行
#   2. 在新终端执行：bash test-auth.sh
# ============================================================

BASE_URL="http://localhost:3000"
PASS=0
FAIL=0

# 彩色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── 关键修复：绕过系统代理 ────────────────────────────────────
# macOS 上 Clash/VPN 等工具会设置 http_proxy 环境变量，
# 导致 curl 把 localhost 请求也转发给代理，返回 502。
# 通过清空代理环境变量，强制 curl 直连本地，不经过任何代理。
unset http_proxy
unset https_proxy
unset HTTP_PROXY
unset HTTPS_PROXY
unset ALL_PROXY
unset all_proxy
NO_PROXY_OPT="--noproxy 'localhost,127.0.0.1'"

# ── 工具函数 ─────────────────────────────────────────────────

assert() {
  local name="$1"
  local expected_code="$2"
  local actual_code="$3"
  local body="$4"

  if [ "$actual_code" = "$expected_code" ]; then
    echo -e "${GREEN}✅ PASS${NC} [$name] HTTP $actual_code"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}❌ FAIL${NC} [$name] 期望 HTTP $expected_code，实际 HTTP $actual_code"
    echo -e "   响应：$body"
    FAIL=$((FAIL + 1))
  fi
}

# POST 请求（无鉴权）
post() {
  local path="$1"
  local data="$2"
  curl -s $NO_PROXY_OPT -o /tmp/zhizhi_resp.txt -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$data" \
    --max-time 10 \
    "$BASE_URL$path"
}

# POST 请求（带 Authorization header）
post_auth() {
  local path="$1"
  local data="$2"
  local token="$3"
  curl -s $NO_PROXY_OPT -o /tmp/zhizhi_resp.txt -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "$data" \
    --max-time 10 \
    "$BASE_URL$path"
}

# GET 请求
get() {
  local path="$1"
  curl -s $NO_PROXY_OPT -o /tmp/zhizhi_resp.txt -w "%{http_code}" \
    --max-time 10 \
    "$BASE_URL$path"
}

get_body() {
  cat /tmp/zhizhi_resp.txt 2>/dev/null
}

# ── 开始测试 ─────────────────────────────────────────────────
echo ""
echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}  知之 API 认证模块测试                        ${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""

# ── 基础 ─────────────────────────────────────────────────────
echo -e "${YELLOW}── 基础 ──────────────────────────────────────${NC}"

CODE=$(get "/api/health")
assert "T01 健康检查" "200" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# ── 邀请码验证 ───────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── 邀请码验证 ────────────────────────────────${NC}"

CODE=$(post "/api/auth/check-invite-code" '{"invitationCode":"ZHIZHI2026"}')
assert "T02 有效邀请码 ZHIZHI2026" "200" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

CODE=$(post "/api/auth/check-invite-code" '{"invitationCode":"INVALID_XYZ"}')
assert "T03 无效邀请码" "400" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

CODE=$(post "/api/auth/check-invite-code" '{}')
assert "T04 邀请码缺少字段" "400" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# ── 发送验证码 ───────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── 发送验证码 ────────────────────────────────${NC}"

# 邮箱格式错误（本地校验，无需连 Supabase）
CODE=$(post "/api/auth/send-code" '{"email":"not-an-email"}')
assert "T05 验证码-邮箱格式错误" "400" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# 正常邮箱（会真实调用 Supabase OTP，仅记录结果）
CODE=$(post "/api/auth/send-code" '{"email":"test-zhizhi@example.com"}')
echo -e "   T06 发送验证码（观察）HTTP $CODE — $(get_body)"

# ── 注册 ─────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── 注册 ──────────────────────────────────────${NC}"

# 缺少 verificationCode 和 invitationCode
CODE=$(post "/api/auth/register" '{"email":"test@example.com","password":"Test1234"}')
assert "T07 注册缺少字段" "400" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# 无效邀请码（本地校验邀请码，需要迁移 SQL 已执行）
CODE=$(post "/api/auth/register" '{
  "email":"test@example.com",
  "password":"Test1234",
  "verificationCode":"123456",
  "invitationCode":"BADCODE"
}')
assert "T08 注册-无效邀请码" "400" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# ── 登录 ─────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── 登录 ──────────────────────────────────────${NC}"

# 邮箱格式错误（本地校验）
CODE=$(post "/api/auth/login" '{"email":"bad-email","password":"Test1234"}')
assert "T09 登录-邮箱格式错误" "400" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# 缺少 password 和 verificationCode（本地校验）
CODE=$(post "/api/auth/login" '{"email":"test@example.com"}')
assert "T10 登录-缺少凭证字段" "400" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# 密码登录-账号不存在（会调用 Supabase，仅记录）
CODE=$(post "/api/auth/login" '{"email":"nonexistent@example.com","password":"Test1234"}')
assert "T11 密码登录-账号不存在" "401" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# ── Token / 登出 ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── Token / 登出 ──────────────────────────────${NC}"

# 无效 refresh_token（会调用 Supabase）
CODE=$(post "/api/auth/refresh-token" '{"refreshToken":"invalid.token.here"}')
assert "T12 无效 RefreshToken" "401" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# 登出未带 Authorization header（本地校验）
CODE=$(post "/api/auth/logout" '{}')
assert "T13 登出-未携带 Token" "401" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# 注销账号未带 Authorization header（本地校验）
CODE=$(post "/api/auth/delete-account" '{}')
assert "T14 注销账号-未携带 Token" "401" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# ── 密码重置 ─────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── 密码重置 ──────────────────────────────────${NC}"

# 缺少字段（本地校验）
CODE=$(post "/api/auth/reset-password" '{"email":"test@example.com"}')
assert "T15 重置密码-缺少字段" "400" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# ── 路由边界 ─────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── 路由边界 ──────────────────────────────────${NC}"

# 不存在的路由
CODE=$(get "/api/nonexistent")
assert "T16 不存在的路由" "404" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# GET 访问只允许 POST 的接口
CODE=$(curl -s $NO_PROXY_OPT -o /tmp/zhizhi_resp.txt -w "%{http_code}" \
  -X GET --max-time 5 "$BASE_URL/api/auth/login")
assert "T17 GET /auth/login 应返回 405" "405" "$CODE" "$(get_body)"
echo "   响应：$(get_body)"

# ── 汇总 ─────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}================================================${NC}"
echo -e "  测试完成：${GREEN}$PASS 通过${NC}  ${RED}$FAIL 失败${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""

if [ $FAIL -gt 0 ]; then
  echo -e "${YELLOW}⚠️  排查提示：${NC}"
  echo "  - T01/000: 服务器未启动，先执行 npm run dev:node"
  echo "  - T02/400: 需要先在 Supabase SQL Editor 执行 003_invite_codes.sql"
  echo "  - T08/500: Supabase 连接失败，检查 .env 中 SUPABASE_URL 和 SUPABASE_SERVICE_KEY"
  echo "  - 其他 5xx: 查看服务器终端的具体报错日志"
fi
