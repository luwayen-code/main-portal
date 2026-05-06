import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { createHmac } from 'crypto';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-this-secret-in-production';

function computeHMAC(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function verifyToken(token: string, secret: string): boolean {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;
  const expStr = token.substring(0, dotIndex);
  const providedHmac = token.substring(dotIndex + 1);
  const exp = parseInt(expStr, 10);
  if (isNaN(exp) || exp < Date.now()) return false;
  const expectedHmac = computeHMAC(expStr, secret);
  return providedHmac === expectedHmac;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }
  const token = authHeader.slice(7);
  if (!verifyToken(token, TOKEN_SECRET)) {
    return res.status(401).json({ error: '令牌无效' });
  }

  try {
    const { id, reply } = req.body as { id: string; reply: string };
    if (!id || !reply?.trim()) {
      return res.status(400).json({ error: '参数不完整' });
    }

    const feedback: any = await redis.get(`feedback:${id}`);
    if (!feedback) {
      return res.status(404).json({ error: '反馈不存在' });
    }

    feedback.status = 'replied';
    feedback.reply = {
      content: reply.trim(),
      repliedAt: new Date().toISOString(),
    };

    await redis.set(`feedback:${id}`, feedback);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Feedback reply error:', err);
    return res.status(500).json({ error: '回复失败' });
  }
}
