import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createToken } from '../_lib/token';

// Admin password - set via environment variable ADMIN_PASSWORD
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
// Token secret - set via environment variable TOKEN_SECRET
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-this-secret-in-production';
// Token expiration: 24 hours
const TOKEN_EXPIRATION = 24 * 60 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: '请输入密码' });
  }

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }

  const token = await createToken(TOKEN_EXPIRATION, TOKEN_SECRET);

  return res.status(200).json({
    token,
    expiresIn: TOKEN_EXPIRATION,
  });
}
