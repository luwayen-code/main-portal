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

function requireAuth(req: VercelRequest, res: VercelResponse): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未授权' });
    return false;
  }

  const token = authHeader.slice(7);
  if (!verifyToken(token, TOKEN_SECRET)) {
    res.status(401).json({ error: '令牌无效或已过期' });
    return false;
  }

  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireAuth(req, res)) return;

  const { confirm } = req.body || {};
  if (confirm !== true) {
    return res.status(400).json({ error: '缺少二次确认参数' });
  }

  try {
    const patterns = [
      'pv:*',
      'pv_hourly:*',
      'uv:*',
      'uv_hourly:*',
      'active_visitors:*',
    ];

    let deletedKeys = 0;
    for (const pattern of patterns) {
      const keys: string[] = [];
      let cursor = 0;
      do {
        const [nextCursor, foundKeys] = await kv.scan(cursor, { match: pattern, count: 100 });
        cursor = Number(nextCursor);
        keys.push(...foundKeys);
      } while (cursor !== 0);

      if (keys.length > 0) {
        await kv.del(...keys);
        deletedKeys += keys.length;
      }
    }

    return res.status(200).json({ success: true, deletedKeys });
  } catch (err) {
    console.error('Failed to clear stats:', err);
    return res.status(500).json({ error: '清除统计数据失败' });
  }
}
