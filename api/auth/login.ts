import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-this-secret-in-production';
const TOKEN_EXPIRATION = 24 * 60 * 60 * 1000;

function computeHMAC(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function createToken(expiresInMs: number, secret: string): string {
  const exp = Date.now() + expiresInMs;
  const hmac = computeHMAC(String(exp), secret);
  return `${exp}.${hmac}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password } = req.body || {};

    if (!password) {
      return res.status(400).json({ error: '请输入密码' });
    }

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: '密码错误' });
    }

    const token = createToken(TOKEN_EXPIRATION, TOKEN_SECRET);

    return res.status(200).json({
      token,
      expiresIn: TOKEN_EXPIRATION,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: '服务器内部错误', detail: String(err) });
  }
}
