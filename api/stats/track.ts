import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

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

const PAUSED_KEY = 'stats:paused';

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

  const { app, activity } = req.body || {};
  const isActivityHeartbeat = activity === true;

  if (!app || !VALID_APPS.has(app)) {
    return res.status(400).json({ error: '无效的应用标识' });
  }

  // Check if tracking is paused
  try {
    const paused = await redis.get<boolean>(PAUSED_KEY);
    if (paused) {
      return res.status(200).json({ ok: true, paused: true });
    }
  } catch {
    // ignore
  }

  try {
    const now = Date.now();

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

    // Record active visitor (always, even for activity heartbeats)
    await redis.zadd(`active_visitors:${app}`, {
      score: now,
      member: visitorHash,
    });

    // --- Activity heartbeat: only update online status, skip PV/UV ---
    if (isActivityHeartbeat) {
      return res.status(200).json({ ok: true, heartbeat: true });
    }

    // --- Full tracking: record PV/UV counts ---
    const today = getBeijingDateStr();
    const currentHour = getBeijingHour();

    // --- Aggregated daily stats (Hash) — dramatically reduces reads ---
    const statsKey = `dailystats:${app}:${today}`;
    // Daily PV
    await redis.hincrby(statsKey, 'pv', 1);
    // Hourly PV
    await redis.hincrby(statsKey, `h${currentHour}_pv`, 1);

    // Hourly UV (only increment if visitor is new to this hour)
    const hourlyUVKey = `uv_hourly:${app}:${today}:${currentHour}`;
    const isNewHourlyUV = await redis.sadd(hourlyUVKey, visitorHash);
    if (isNewHourlyUV > 0) {
      await redis.hincrby(statsKey, `h${currentHour}_uv`, 1);
    }

    // Daily UV (only increment if visitor is new today)
    const dailyUVKey = `uv:${app}:${today}`;
    const isNewDailyUV = await redis.sadd(dailyUVKey, visitorHash);
    if (isNewDailyUV > 0) {
      await redis.hincrby(statsKey, 'uv', 1);
    }

    // New visitor tracking (first time ever globally)
    const allVisitorsKey = `all_visitors:${app}`;
    const isNewGlobalVisitor = await redis.sadd(allVisitorsKey, visitorHash);
    if (isNewGlobalVisitor > 0) {
      await redis.hincrby(statsKey, 'new_visitors', 1);
      await redis.incr(`stats:new_visitors:${app}`);
    }

    // --- Legacy keys (keep for backward compatibility) ---
    await redis.incr(`pv:${app}:${today}`);
    await redis.incr(`pv_hourly:${app}:${today}:${currentHour}`);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Track error:', err);
    return res.status(500).json({ error: '追踪失败' });
  }
}
