import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../src/utils/auth';
import {
  createHistoryRecord,
  listHistoryRecords,
} from '../../src/services/historyService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await getCurrentUser(req);

    if (req.method === 'GET') {
      const data = await listHistoryRecords(user.id, req.query as Record<string, any>);
      const response = Response.ok(data);
      return res.status(response.statusCode).json(response.body);
    }

    if (req.method === 'POST') {
      const data = await createHistoryRecord(user.id, req.body);
      const response = Response.created(data, '历史记录创建成功');
      return res.status(response.statusCode).json(response.body);
    }

    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
