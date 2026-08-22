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
import profileHandler          from './api/user/profile';
import inviteCodeHandler       from './api/user/invite-code';
import invitationsHandler      from './api/user/invitations';
import profileExtendedHandler  from './api/user/profile/extended';

// 八字模块（对应 simple.md §4 八字档案模块）
import baziCreateHandler from './api/bazi/create';
import baziListHandler   from './api/bazi/list';
import baziByIdHandler   from './api/bazi/[id]';
import baziContextHandler from './api/bazi/[id]/context';
import baziChartHandler  from './api/bazi/[id]/chart';
import baziLuckHandler   from './api/bazi/[id]/luck';
import baziLuckAnalysisHandler from './api/bazi/[id]/luck-analysis';
import baziLuckBundleHandler from './api/bazi/[id]/luck-bundle';

// 运势模块（对应 simple.md §5 首页模块）
import fortuneDailyHandler from './api/fortune/daily';
import fortuneDrilldownHandler from './api/fortune/drilldown';
import fortuneDailyV2Handler from './api/v2/fortune/daily';
import recommendationNextHandler from './api/v2/recommendations/next';
import recommendationEventsHandler from './api/v2/recommendations/events';
import recommendationBatchHandler from './api/v2/recommendations/[batchId]';
import mediumInsightDailyHandler from './api/v2/insights/medium/daily';
import mediumInsightEventsHandler from './api/v2/insights/medium/events';
import insightDetailsV2Handler from './api/v2/insights/details';
import insightFollowUpsV2Handler from './api/v2/insights/follow-ups';

// 洞察模块（对应 simple.md §6 洞察分析模块）
import insightCardsHandler    from './api/insights/cards';
import insightAnalysisHandler from './api/insights/analysis';
import insightDetailHandler   from './api/insights/detail/[category]';

// 历史档案模块
import historyHandler from './api/history/index';
import historyByIdHandler from './api/history/[id]';
import historyFavoriteHandler from './api/history/[id]/favorite';

// 商业化模块
import commerceStatusHandler from './api/commerce/status';
import commerceTransactionSyncHandler from './api/commerce/transactions/sync';
import commercePointsLedgerHandler from './api/commerce/points/ledger';
import commercePointsConsumeHandler from './api/commerce/points/consume';
import commerceAppleNotificationHandler from './api/commerce/notifications/apple';
import commerceAppleSandboxNotificationHandler from './api/commerce/notifications/apple-sandbox';
import privacyPolicyHandler from './api/legal/privacy';

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
  '/api/user/profile':          profileHandler,
  '/api/user/invite-code':      inviteCodeHandler,
  '/api/user/invitations':      invitationsHandler,
  '/api/user/profile/extended': profileExtendedHandler,

  // 八字模块（精确路径，动态 /api/bazi/:id 在下方处理）
  '/api/bazi/create': baziCreateHandler,
  '/api/bazi/list':   baziListHandler,

  // 运势模块
  '/api/fortune/daily': fortuneDailyHandler,
  '/api/fortune/drilldown': fortuneDrilldownHandler,
  '/api/v2/fortune/daily': fortuneDailyV2Handler,
  '/api/v2/recommendations/next': recommendationNextHandler,
  '/api/v2/recommendations/events': recommendationEventsHandler,
  '/api/v2/insights/medium/daily': mediumInsightDailyHandler,
  '/api/v2/insights/medium/events': mediumInsightEventsHandler,
  '/api/v2/insights/details': insightDetailsV2Handler,
  '/api/v2/insights/follow-ups': insightFollowUpsV2Handler,

  // 洞察模块（精确路径，动态 /api/insights/detail/:category 在下方处理）
  '/api/insights/cards':    insightCardsHandler,
  '/api/insights/analysis': insightAnalysisHandler,

  // 历史档案模块
  '/api/history': historyHandler,

  // 商业化模块
  '/api/commerce/status': commerceStatusHandler,
  '/api/commerce/transactions/sync': commerceTransactionSyncHandler,
  '/api/commerce/points/ledger': commercePointsLedgerHandler,
  '/api/commerce/points/consume': commercePointsConsumeHandler,
  '/api/commerce/notifications/apple': commerceAppleNotificationHandler,
  '/api/commerce/notifications/apple-sandbox': commerceAppleSandboxNotificationHandler,
  '/api/legal/privacy': privacyPolicyHandler,
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
  if (
    req.method === 'OPTIONS'
    && pathname !== '/api/v2/fortune/daily'
    && pathname !== '/api/v2/recommendations/next'
    && pathname !== '/api/v2/recommendations/events'
    && pathname !== '/api/v2/insights/medium/daily'
    && pathname !== '/api/v2/insights/medium/events'
    && pathname !== '/api/v2/insights/details'
    && pathname !== '/api/v2/insights/follow-ups'
    && !/^\/api\/v2\/recommendations\/[^/]+$/.test(pathname)
  ) {
    res.writeHead(200);
    res.end();
    return;
  }

  // Step 1: 精确路由匹配
  let handler = routes[pathname];
  let params: Record<string, string> = {};

  // Step 2: 动态路由匹配（/api/bazi/:id/...，排除已精确匹配的 create/list）
  if (!handler && pathname.startsWith('/api/bazi/')) {
    const parts = pathname.replace('/api/bazi/', '').split('/').filter(Boolean);
    const id = parts[0];
    const child = parts[1];
    if (id && id !== 'list' && id !== 'create') {
      if (child === 'chart') {
        handler = baziChartHandler;
      } else if (child === 'context') {
        handler = baziContextHandler;
      } else if (child === 'luck') {
        handler = baziLuckHandler;
      } else if (child === 'luck-analysis') {
        handler = baziLuckAnalysisHandler;
      } else if (child === 'luck-bundle') {
        handler = baziLuckBundleHandler;
      } else if (!child) {
        handler = baziByIdHandler;
      }
      params = { id };
    }
  }

  // Step 3: 动态路由匹配（/api/history/:id/...）
  if (!handler && pathname.startsWith('/api/history/')) {
    const parts = pathname.replace('/api/history/', '').split('/').filter(Boolean);
    const id = parts[0];
    const child = parts[1];
    if (id) {
      handler = child === 'favorite' ? historyFavoriteHandler : historyByIdHandler;
      params = { id };
    }
  }

  // Step 4: 动态路由匹配（/api/insights/detail/:category）
  if (!handler && pathname.startsWith('/api/insights/detail/')) {
    const category = pathname.replace('/api/insights/detail/', '');
    if (category) {
      handler = insightDetailHandler;
      params = { category };
    }
  }

  // Step 5: dynamic recommendation batch polling.
  if (!handler && pathname.startsWith('/api/v2/recommendations/')) {
    const batchId = pathname.replace('/api/v2/recommendations/', '').split('/').filter(Boolean)[0];
    if (batchId && batchId !== 'next' && batchId !== 'events') {
      handler = recommendationBatchHandler;
      params = { batchId };
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
        query:   { ...parsedUrl.query, ...params },
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
  console.log(`\n👤 用户模块接口（simple.md §7）:`);
  console.log(`   GET  /api/user/profile`);
  console.log(`   PUT  /api/user/profile`);
  console.log(`   GET  /api/user/invite-code`);
  console.log(`   GET  /api/user/invitations`);
  console.log(`   PUT  /api/user/profile/extended`);
  console.log(`\n按 Ctrl+C 停止\n`);
});
