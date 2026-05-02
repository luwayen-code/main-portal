import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, contact } = req.query as { token?: string; contact?: string };

    let ids: string[] = [];

    if (token) {
      const tokenIds = await kv.get<string[]>(`feedback:token:${token}`) || [];
      ids.push(...tokenIds);
    }

    if (contact) {
      const contactIds = await kv.get<string[]>(`feedback:contact:${contact.toLowerCase()}`) || [];
      ids.push(...contactIds);
    }

    ids = [...new Set(ids)];

    const feedbacks = await Promise.all(
      ids.map(async (id) => {
        const data = await kv.get<string>(`feedback:${id}`);
        return data ? JSON.parse(data) : null;
      })
    );

    const valid = feedbacks
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.status(200).json({ feedbacks: valid });
  } catch (err: any) {
    console.error('Feedback my-list error:', err);
    return res.status(500).json({ error: '查询失败', detail: err?.message || String(err) });
  }
}
