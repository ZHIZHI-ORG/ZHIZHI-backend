/**
 * 健康检查端点
 * GET /api/health
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { checkDatabaseHealth } from '../src/database/supabase';
import { Response } from '../src/utils/response';
import { formatError } from '../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const dbHealth = await checkDatabaseHealth();

    const healthStatus = {
      status: dbHealth ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      database: dbHealth ? 'connected' : 'disconnected',
    };

    const response = Response.ok(healthStatus);
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
