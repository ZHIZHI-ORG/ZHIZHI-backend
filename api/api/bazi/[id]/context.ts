import type { VercelRequest, VercelResponse } from '@vercel/node';
import { updateBaziProfileContext } from '../../../src/services/baziService';
import { getCurrentUser } from '../../../src/utils/auth';
import { formatError } from '../../../src/utils/errors';
import { Response } from '../../../src/utils/response';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const profileId = req.query.id as string;
    if (!profileId) {
      return res.status(400).json({ success: false, error: { message: '缺少档案 ID' } });
    }
    const user = await getCurrentUser(req);
    const profile = await updateBaziProfileContext(
      user.id,
      profileId,
      req.body?.daily_fortune_context,
    );
    const response = Response.ok(profile, '现实语境更新成功');
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const response = formatError(error);
    return res.status(response.statusCode).json(response.body);
  }
}
