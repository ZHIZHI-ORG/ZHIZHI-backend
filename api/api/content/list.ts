/**
 * 获取内容列表端点
 * GET /api/content/list
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getContentList } from '../../src/services/contentService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';
import { ContentType, ContentStatus } from '../../src/models/Content';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 从查询参数中提取筛选条件
    const query = {
      user_id: req.query.user_id as string | undefined,
      content_type: req.query.content_type as ContentType | undefined,
      status: req.query.status as ContentStatus | undefined,
      tag: req.query.tag as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string) : undefined,
      page_size: req.query.page_size ? parseInt(req.query.page_size as string) : undefined,
      sort_by: req.query.sort_by as any,
      order: req.query.order as 'asc' | 'desc' | undefined,
    };

    const result = await getContentList(query);

    const response = Response.ok(result);
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
