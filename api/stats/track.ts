import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

// Beijing timezone offset (UTC+8)
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function getBeijingDateStr(): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function getBeijingHour(): number {
  return new Date(Date.now() + BEIJING_OFFSET_MS).getUTCHours();
}

const VALID_APPS = new Set(['it-tools', 'excel-tools']);

// Simple shared token for client-side tracking beacons
const TRACK_TOKEN = process.env.TRACK_TOKEN || 'xingwhy-track-2026';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate tracking token
  const token = req.headers['x-track-token'] as string | undefined;
  if (token !== TRACK_TOKEN) {
    return res.status(403).json({ error: '无效的追踪令牌' });
  }

  const { app } = req.body || {};

  if (!app || !VALID_APPS.has(app)) {
    return res.status(400).json({ error: '无效的应用标识' });
  }

  try {
    const now = Date.now();
    const today = getBeijingDateStr();
    const currentHour = getBeijingHour();

    // Generate visitor hash from IP + User-Agent
    const ip = req.headers['x-forwarded-for']
      || req.headers['x-real-ip']
      || req.connection?.remoteAddress
      || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    const visitorId = `${ip}:${ua}`;

    // Hash visitor ID (same algorithm as middleware: SHA-256)
    const crypto = await import('crypto');
    const visitorHash = crypto.createHash('sha256').update(visitorId).digest('hex');

    // Record active visitor
    await kv.zadd(`active_visitors:${app}`, {
      score: now,
      member: visitorHash,
    });

    // Increment daily PV
    await kv.incr(`pv:${app}:${today}`);

    // Increment hourly PV
    await kv.incr(`pv_hourly:${app}:${today}:${currentHour}`);

    // Track daily UV
    await kv.sadd(`uv:${app}:${today}`, visitorHash);

    // Track hourly UV
    await kv.sadd(`uv_hourly:${app}:${today}:${currentHour}`, visitorHash);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Track error:', err);
    return res.status(500).json({ error: '追踪失败' });
  }
}
