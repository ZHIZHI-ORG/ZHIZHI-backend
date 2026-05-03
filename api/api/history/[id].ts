import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../src/utils/auth';
import {
  deleteHistoryRecord,
  getHistoryRecord,
} from '../../src/services/historyService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id as string;

  if (!id) {
    return res.status(400).json({ success: false, error: { message: '缺少历史记录 ID' } });
  }

  try {
    const user = await getCurrentUser(req);

    if (req.method === 'GET') {
      const data = await getHistoryRecord(user.id, id);
      const response = Response.ok(data);
      return res.status(response.statusCode).json(response.body);
    }

    if (req.method === 'DELETE') {
      const data = await deleteHistoryRecord(user.id, id);
      const response = Response.ok(data, '历史记录已删除');
      return res.status(response.statusCode).json(response.body);
    }

    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
