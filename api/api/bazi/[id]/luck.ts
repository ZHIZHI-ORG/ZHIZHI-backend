import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../../src/utils/auth';
import { getBaziLuckTimeline } from '../../../src/services/baziService';
import { Response } from '../../../src/utils/response';
import { formatError } from '../../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  const profileId = req.query.id as string;
  if (!profileId) {
    return res.status(400).json({ success: false, error: { message: '缺少档案 ID' } });
  }

  try {
    const user = await getCurrentUser(req);
    const data = await getBaziLuckTimeline(user.id, profileId, {
      year: req.query.year ? Number(req.query.year) : undefined,
      month: req.query.month ? Number(req.query.month) : undefined,
      day: req.query.day as string | undefined,
    });
    const response = Response.ok(data);
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
