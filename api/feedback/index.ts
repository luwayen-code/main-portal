import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

interface FeedbackBody {
  type: string;
  content: string;
  contact: string;
  token: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, content, contact, token } = req.body as FeedbackBody;

    if (!content?.trim() || !contact?.trim()) {
      return res.status(400).json({ error: '反馈内容和联系方式不能为空' });
    }

    const id = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const feedback = {
      id,
      app: 'excel-tools',
      type: type || 'suggestion',
      content: content.trim(),
      contact: contact.trim(),
      token: token || '',
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    await kv.set(`feedback:${id}`, feedback);

    if (token) {
      const tokenKey = `feedback:token:${token}`;
      const existing = await kv.get<string[]>(tokenKey) || [];
      existing.push(id);
      await kv.set(tokenKey, existing);
    }

    const contactKey = `feedback:contact:${contact.trim().toLowerCase()}`;
    const existingContact = await kv.get<string[]>(contactKey) || [];
    existingContact.push(id);
    await kv.set(contactKey, existingContact);

    return res.status(200).json({ success: true, id });
  } catch (err: any) {
    console.error('Feedback submit error:', err);
    return res.status(500).json({ error: '提交失败', detail: err?.message || String(err) });
  }
}
