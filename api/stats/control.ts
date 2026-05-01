import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { createHmac } from 'crypto';

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-this-secret-in-production';
const PAUSED_KEY = 'stats:paused';

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

function requireAuth(req: VercelRequest, res: VercelResponse): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未授权' });
    return null;
  }

  const token = authHeader.slice(7);
  if (!verifyToken(token, TOKEN_SECRET)) {
    res.status(401).json({ error: '令牌无效或已过期' });
    return null;
  }

  return token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    if (!requireAuth(req, res)) return;

    try {
      const paused = await kv.get<boolean>(PAUSED_KEY) || false;
      return res.status(200).json({ paused });
    } catch (err) {
      console.error('Failed to get control state:', err);
      return res.status(500).json({ error: '获取状态失败' });
    }
  }

  if (req.method === 'POST') {
    if (!requireAuth(req, res)) return;

    const { paused } = req.body || {};
    if (typeof paused !== 'boolean') {
      return res.status(400).json({ error: '参数无效，paused 必须为布尔值' });
    }

    try {
      if (paused) {
        await kv.set(PAUSED_KEY, true);
      } else {
        await kv.del(PAUSED_KEY);
      }
      return res.status(200).json({ paused });
    } catch (err) {
      console.error('Failed to set control state:', err);
      return res.status(500).json({ error: '设置状态失败' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
