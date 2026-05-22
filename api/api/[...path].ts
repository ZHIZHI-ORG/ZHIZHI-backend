import { VercelRequest, VercelResponse } from '@vercel/node';

import healthHandler from './health';

import checkInviteCodeHandler from './auth/check-invite-code';
import sendCodeHandler from './auth/send-code';
import registerHandler from './auth/register';
import loginHandler from './auth/login';
import socialLoginHandler from './auth/social-login';
import refreshTokenHandler from './auth/refresh-token';
import logoutHandler from './auth/logout';
import resetPasswordHandler from './auth/reset-password';
import deleteAccountHandler from './auth/delete-account';

import profileHandler from './user/profile';
import inviteCodeHandler from './user/invite-code';
import invitationsHandler from './user/invitations';
import profileExtendedHandler from './user/profile/extended';

import baziCreateHandler from './bazi/create';
import baziListHandler from './bazi/list';
import baziByIdHandler from './bazi/[id]';
import baziChartHandler from './bazi/[id]/chart';
import baziLuckHandler from './bazi/[id]/luck';
import baziLuckAnalysisHandler from './bazi/[id]/luck-analysis';

import fortuneDailyHandler from './fortune/daily';
import fortuneDrilldownHandler from './fortune/drilldown';

import insightCardsHandler from './insights/cards';
import insightAnalysisHandler from './insights/analysis';
import insightDetailHandler from './insights/detail/[category]';

import historyHandler from './history/index';
import historyByIdHandler from './history/[id]';
import historyFavoriteHandler from './history/[id]/favorite';

import commerceStatusHandler from './commerce/status';
import commerceTransactionSyncHandler from './commerce/transactions/sync';
import commercePointsLedgerHandler from './commerce/points/ledger';
import commercePointsConsumeHandler from './commerce/points/consume';

import contentListHandler from './content/list';
import contentCreateHandler from './content/create';
import contentByIdHandler from './content/[id]';

type Handler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>;

const routes: Record<string, Handler> = {
  '/api/health': healthHandler,

  '/api/auth/check-invite-code': checkInviteCodeHandler,
  '/api/auth/send-code': sendCodeHandler,
  '/api/auth/register': registerHandler,
  '/api/auth/login': loginHandler,
  '/api/auth/social-login': socialLoginHandler,
  '/api/auth/refresh-token': refreshTokenHandler,
  '/api/auth/logout': logoutHandler,
  '/api/auth/reset-password': resetPasswordHandler,
  '/api/auth/delete-account': deleteAccountHandler,

  '/api/user/profile': profileHandler,
  '/api/user/invite-code': inviteCodeHandler,
  '/api/user/invitations': invitationsHandler,
  '/api/user/profile/extended': profileExtendedHandler,

  '/api/bazi/create': baziCreateHandler,
  '/api/bazi/list': baziListHandler,

  '/api/fortune/daily': fortuneDailyHandler,
  '/api/fortune/drilldown': fortuneDrilldownHandler,

  '/api/insights/cards': insightCardsHandler,
  '/api/insights/analysis': insightAnalysisHandler,

  '/api/history': historyHandler,

  '/api/commerce/status': commerceStatusHandler,
  '/api/commerce/transactions/sync': commerceTransactionSyncHandler,
  '/api/commerce/points/ledger': commercePointsLedgerHandler,
  '/api/commerce/points/consume': commercePointsConsumeHandler,

  '/api/content/list': contentListHandler,
  '/api/content/create': contentCreateHandler,
};

function resolveRoute(pathname: string): { handler?: Handler; params: Record<string, string> } {
  const exact = routes[pathname];
  if (exact) {
    return { handler: exact, params: {} };
  }

  if (pathname.startsWith('/api/bazi/')) {
    const parts = pathname.replace('/api/bazi/', '').split('/').filter(Boolean);
    const id = parts[0];
    const child = parts[1];

    if (id && id !== 'list' && id !== 'create') {
      if (child === 'chart') {
        return { handler: baziChartHandler, params: { id } };
      }
      if (child === 'luck') {
        return { handler: baziLuckHandler, params: { id } };
      }
      if (child === 'luck-analysis') {
        return { handler: baziLuckAnalysisHandler, params: { id } };
      }
      if (!child) {
        return { handler: baziByIdHandler, params: { id } };
      }
    }
  }

  if (pathname.startsWith('/api/history/')) {
    const parts = pathname.replace('/api/history/', '').split('/').filter(Boolean);
    const id = parts[0];
    const child = parts[1];

    if (id) {
      return {
        handler: child === 'favorite' ? historyFavoriteHandler : historyByIdHandler,
        params: { id },
      };
    }
  }

  if (pathname.startsWith('/api/insights/detail/')) {
    const category = pathname.replace('/api/insights/detail/', '');
    if (category) {
      return { handler: insightDetailHandler, params: { category } };
    }
  }

  if (pathname.startsWith('/api/content/')) {
    const id = pathname.replace('/api/content/', '').split('/').filter(Boolean)[0];
    if (id && id !== 'list' && id !== 'create') {
      return { handler: contentByIdHandler, params: { id } };
    }
  }

  return { params: {} };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).send('');
  }

  const url = new URL(req.url || '/', `https://${req.headers.host || 'zhizhi-api.vercel.app'}`);
  const { handler: routeHandler, params } = resolveRoute(url.pathname);

  if (!routeHandler) {
    return res.status(404).json({
      success: false,
      error: { message: `Not Found: ${url.pathname}` },
    });
  }

  const routedReq = req as VercelRequest & {
    query: Record<string, any>;
    params?: Record<string, string>;
  };
  routedReq.query = { ...req.query, ...params };
  routedReq.params = params;

  return routeHandler(routedReq, res);
}
