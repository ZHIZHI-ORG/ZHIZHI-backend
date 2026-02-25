/**
 * 创建内容端点
 * POST /api/content/create
 */
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getCurrentUser } from '../../src/utils/auth';
import { createContent } from '../../src/services/contentService';
import { validateCreateContentInput } from '../../src/utils/validation';
import { Response } from '../../src/utils/response';
import { formatError } from '../../src/utils/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. 验证用户身份（需要登录）
    const currentUser = await getCurrentUser(req);

    // 2. 验证请求参数
    validateCreateContentInput(req.body);

    // 3. 创建内容
    const content = await createContent(currentUser.id, {
      title: req.body.title,
      body: req.body.body,
      content_type: req.body.content_type,
      tags: req.body.tags,
      status: req.body.status,
    });

    // 4. 返回成功响应
    const response = Response.created(content, '创建成功');
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    const errorResponse = formatError(error);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
}
