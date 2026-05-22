import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../../src/utils/auth';
import { setHistoryFavorite } from '../../../src/services/historyService';
import { Response } from '../../../src/utils/response';
import { formatError, ValidationError } from '../../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  const id = req.query.id as string;
  if (!id) {
    return res.status(400).json({ success: false, error: { message: '缺少历史记录 ID' } });
  }

  try {
    const user = await getCurrentUser(req);
    if (typeof req.body?.is_favorited !== 'boolean') {
      throw new ValidationError('is_favorited 必须是布尔值');
    }

    const data = await setHistoryFavorite(user.id, id, req.body.is_favorited);
    const response = Response.ok(data, '收藏状态已更新');
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
