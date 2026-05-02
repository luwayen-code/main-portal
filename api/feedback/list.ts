import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { createHmac } from 'crypto';

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
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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
    let cursor = 0;
    const feedbacks: any[] = [];
    do {
      const [nextCursor, keys] = await kv.scan(cursor, { match: 'feedback:fb_*', count: 100 });
      cursor = Number(nextCursor);
      for (const key of keys) {
        const data = await kv.get(key);
        if (data) feedbacks.push(data);
      }
    } while (cursor !== 0);

    feedbacks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.status(200).json({ feedbacks });
  } catch (err) {
    console.error('Admin feedback list error:', err);
    return res.status(500).json({ error: '获取失败' });
  }
}
