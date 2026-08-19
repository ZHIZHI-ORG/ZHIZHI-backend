import { VercelRequest, VercelResponse } from '@vercel/node';
import { processAppStoreNotification } from '../../../src/services/commerceService';
import { Response } from '../../../src/utils/response';
import { formatError } from '../../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    const data = await processAppStoreNotification(req.body || {}, 'Production');
    const response = Response.ok(data);
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
