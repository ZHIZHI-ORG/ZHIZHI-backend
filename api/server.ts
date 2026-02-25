/**
 * 本地开发服务器
 *
 * 用途：在本地模拟 Vercel Serverless 环境运行 API，无需部署即可测试。
 * 启动：npm run dev:node
 *
 * 注意：此文件仅用于本地开发，Vercel 部署时不使用此文件，
 *       Vercel 会直接读取 api/ 目录下的每个文件作为独立 Serverless Function。
 */

// 环境变量必须最先加载，确保后续所有模块都能读到
import 'dotenv/config';

import http from 'http';
import { parse } from 'url';

// ─────────────────────────────────────────────────────────────
// 导入所有 API Handler
// ─────────────────────────────────────────────────────────────

// 基础
import healthHandler from './api/health';

// 认证模块（对应 simple.md §3 用户认证模块）
import checkInviteCodeHandler from './api/auth/check-invite-code';
import sendCodeHandler        from './api/auth/send-code';
import registerHandler        from './api/auth/register';
import loginHandler           from './api/auth/login';
import socialLoginHandler     from './api/auth/social-login';
import refreshTokenHandler    from './api/auth/refresh-token';
import logoutHandler          from './api/auth/logout';
import resetPasswordHandler   from './api/auth/reset-password';
import deleteAccountHandler   from './api/auth/delete-account';

// 用户模块（对应 simple.md §7 用户资料模块）
import profileHandler from './api/user/profile';

// 八字模块（对应 simple.md §4 八字档案模块）
import baziCreateHandler from './api/bazi/create';
import baziListHandler   from './api/bazi/list';
import baziByIdHandler   from './api/bazi/[id]';


// ─────────────────────────────────────────────────────────────
// 路由表（精确路径匹配）
// 动态路由（如 /api/bazi/:id）在下方服务器逻辑中单独处理
// ─────────────────────────────────────────────────────────────
const routes: Record<string, any> = {
  // 基础
  '/api/health': healthHandler,

  // 认证模块
  '/api/auth/check-invite-code': checkInviteCodeHandler,
  '/api/auth/send-code':         sendCodeHandler,
  '/api/auth/register':          registerHandler,
  '/api/auth/login':             loginHandler,
  '/api/auth/social-login':      socialLoginHandler,
  '/api/auth/refresh-token':     refreshTokenHandler,
  '/api/auth/logout':            logoutHandler,
  '/api/auth/reset-password':    resetPasswordHandler,
  '/api/auth/delete-account':    deleteAccountHandler,

  // 用户模块
  '/api/user/profile': profileHandler,

  // 八字模块（精确路径，动态 /api/bazi/:id 在下方处理）
  '/api/bazi/create': baziCreateHandler,
  '/api/bazi/list':   baziListHandler,
};


// ─────────────────────────────────────────────────────────────
// HTTP 服务器
// ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsedUrl = parse(req.url || '', true);
  const pathname = parsedUrl.pathname || '';

  // CORS 头（允许本地前端/工具跨域请求）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 处理浏览器 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Step 1: 精确路由匹配
  let handler = routes[pathname];
  let params: Record<string, string> = {};

  // Step 2: 动态路由匹配（/api/bazi/:id，排除已精确匹配的 create/list）
  if (!handler && pathname.startsWith('/api/bazi/')) {
    const id = pathname.replace('/api/bazi/', '');
    if (id && id !== 'list' && id !== 'create') {
      handler = baziByIdHandler;
      params = { id };
    }
  }

  // 404：路由不存在
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: { message: `Not Found: ${pathname}` } }));
    return;
  }

  try {
    // 读取请求体
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });

    req.on('end', async () => {
      // 构造模拟 Vercel VercelRequest 对象
      const mockReq: any = {
        method:  req.method,
        url:     req.url,
        headers: req.headers,
        query:   parsedUrl.query,
        params,
        // 安全解析 JSON body（空 body 或非 JSON 时不报错）
        body: body
          ? (() => { try { return JSON.parse(body); } catch { return {}; } })()
          : {},
      };

      // 构造模拟 Vercel VercelResponse 对象
      const mockRes: any = {
        statusCode: 200,
        _headers: {} as Record<string, string>,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        setHeader(key: string, value: string) {
          this._headers[key] = value;
          return this;
        },
        getHeader(key: string) {
          return this._headers[key];
        },
        json(data: any) {
          res.writeHead(this.statusCode, { 'Content-Type': 'application/json', ...this._headers });
          res.end(JSON.stringify(data));
        },
        send(data: any) {
          res.writeHead(this.statusCode, this._headers);
          res.end(data);
        },
      };

      await handler(mockReq, mockRes);
    });
  } catch (error: any) {
    console.error('[Server] 未捕获异常:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: { message: '服务器内部错误' } }));
  }
});


// ─────────────────────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 知之 API 本地服务器已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   健康检查: http://localhost:${PORT}/api/health`);
  console.log(`\n📋 认证接口（simple.md §3）:`);
  console.log(`   POST /api/auth/check-invite-code`);
  console.log(`   POST /api/auth/send-code`);
  console.log(`   POST /api/auth/register`);
  console.log(`   POST /api/auth/login`);
  console.log(`   POST /api/auth/social-login`);
  console.log(`   POST /api/auth/refresh-token`);
  console.log(`   POST /api/auth/logout`);
  console.log(`   POST /api/auth/reset-password`);
  console.log(`   POST /api/auth/delete-account`);
  console.log(`\n按 Ctrl+C 停止\n`);
});
