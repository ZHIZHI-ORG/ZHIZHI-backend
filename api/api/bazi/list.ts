/**
 * 获取八字档案列表端点
 * GET /api/bazi/list
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getBaziProfileList } from '../../src/services/baziService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';
import { getCurrentUser } from '../../src/utils/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  try {
    // 1. 验证用户身份
    const user = await getCurrentUser(req);

    // 2. 解析查询参数
    const query = {
      is_owner: req.query.is_owner === 'true' ? true : req.query.is_owner === 'false' ? false : undefined,
      relation: req.query.relation as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      page_size: req.query.page_size ? parseInt(req.query.page_size as string) : 20,
    };

    // 3. 调用服务层查询列表
    const result = await getBaziProfileList(user.id, query);

    // 4. 返回成功响应
    const response = Response.ok(result);
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
