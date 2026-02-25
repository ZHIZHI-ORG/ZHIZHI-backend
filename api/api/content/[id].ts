/**
 * 内容详情端点（支持获取、更新、删除）
 * GET /api/content/[id] - 获取内容详情
 * PUT /api/content/[id] - 更新内容
 * DELETE /api/content/[id] - 删除内容
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser, getOptionalUser } from '../../src/utils/auth';
import { getContentById, updateContent, deleteContent } from '../../src/services/contentService';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 从 URL 中提取 ID
    const id = req.query.id as string;

    if (!id) {
      return res.status(400).json({ error: 'Missing content ID' });
    }

    if (req.method === 'GET') {
      // 获取内容详情（公开访问）
      const content = await getContentById(id);
      const response = Response.ok(content);
      return res.status(response.statusCode).json(response.body);
    } else if (req.method === 'PUT') {
      // 更新内容（需要登录且是作者）
      const currentUser = await getCurrentUser(req);
      const updatedContent = await updateContent(id, currentUser.id, req.body);
      const response = Response.ok(updatedContent, '更新成功');
      return res.status(response.statusCode).json(response.body);
    } else if (req.method === 'DELETE') {
      // 删除内容（需要登录且是作者）
      const currentUser = await getCurrentUser(req);
      await deleteContent(id, currentUser.id);
      const response = Response.noContent();
      return res.status(response.statusCode).send('');
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
