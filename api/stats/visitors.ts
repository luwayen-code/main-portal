import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { createHmac } from 'crypto';

const redis = Redis.fromEnv();

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-this-secret-in-production';
const ACTIVE_VISITOR_TTL = 5 * 60 * 1000; // 5 minutes

// Beijing timezone offset (UTC+8)
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function getBeijingDateStr(): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function getBeijingHour(): number {
  return new Date(Date.now() + BEIJING_OFFSET_MS).getUTCHours();
}

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

interface AppInfo {
  key: string;
  name: string;
  icon: string;
}

const APPS: AppInfo[] = [
  { key: 'it-tools', name: 'IT Tools', icon: '🛠️' },
  { key: 'excel-tools', name: 'EasyExcel', icon: '📊' },
];

function getTodayStr(): string {
  return getBeijingDateStr();
}

function getLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() + BEIJING_OFFSET_MS);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify auth token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const token = authHeader.slice(7);
  const isValid = verifyToken(token, TOKEN_SECRET);
  if (!isValid) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }

  try {
    const now = Date.now();
    const minScore = now - ACTIVE_VISITOR_TTL;
    const today = getTodayStr();
    const last7Days = getLast7Days();
    const currentHour = getBeijingHour();

    const apps = await Promise.all(
      APPS.map(async (app) => {
        // Get active visitor count from sorted set
        let activeVisitors = 0;
        let lastActiveTime = 0;
        try {
          await redis.zremrangebyscore(`active_visitors:${app.key}`, 0, minScore);
          activeVisitors = await redis.zcount(`active_visitors:${app.key}`, minScore, now);
          // Get the latest active visitor timestamp
          // ZRANGE with WITHSCORES returns flat array: [member1, score1, member2, score2, ...]
          const latestFlat = await redis.zrange(
            `active_visitors:${app.key}`,
            0,
            0,
            { rev: true, withScores: true },
          ) as string[];
          if (latestFlat.length >= 2) {
            lastActiveTime = parseInt(latestFlat[1], 10) || 0;
          }
        } catch {
          activeVisitors = 0;
          lastActiveTime = 0;
        }

        // Helper: parse hash fields into hourly arrays
        function parseDayStats(fields: Record<string, string> | null, date: string, maxHour: number) {
          const pvHourly: { hour: number; count: number }[] = [];
          const uvHourly: { hour: number; count: number }[] = [];
          let pvTotal = 0;
          let uvTotal = 0;
          let newVisitors = 0;
          if (fields) {
            pvTotal = parseInt(fields.pv || '0', 10) || 0;
            uvTotal = parseInt(fields.uv || '0', 10) || 0;
            newVisitors = parseInt(fields.new_visitors || '0', 10) || 0;
            for (let h = 0; h <= maxHour; h++) {
              pvHourly.push({ hour: h, count: parseInt(fields[`h${h}_pv`] || '0', 10) || 0 });
              uvHourly.push({ hour: h, count: parseInt(fields[`h${h}_uv`] || '0', 10) || 0 });
            }
          } else {
            for (let h = 0; h <= maxHour; h++) {
              pvHourly.push({ hour: h, count: 0 });
              uvHourly.push({ hour: h, count: 0 });
            }
          }
          return { pvTotal, uvTotal, pvHourly, uvHourly, newVisitors };
        }

        // Fetch all 7 days of stats via HGETALL (1 KV op per day, instead of ~48 per day)
        const allDays = [today, ...last7Days.filter(d => d !== today)];
        const uniqueDays = [...new Set(allDays)];
        const dailyStats = await Promise.all(
          uniqueDays.map(async (date) => {
            try {
              const fields = await redis.hgetall(`dailystats:${app.key}:${date}`);
              return { date, fields: fields as Record<string, string> | null };
            } catch {
              return { date, fields: null };
            }
          }),
        );

        // Build a lookup map
        const statsMap = new Map(dailyStats.map(d => [d.date, d.fields]));

        // Today's stats
        const todayFields = statsMap.get(today) || null;
        const todayParsed = parseDayStats(todayFields, today, currentHour);

        // Weekly daily totals
        const weeklyPV: { date: string; count: number }[] = [];
        const weeklyUV: { date: string; count: number }[] = [];
        const weeklyHourlyPV: { date: string; hours: { hour: number; count: number }[] }[] = [];
        const weeklyHourlyUV: { date: string; hours: { hour: number; count: number }[] }[] = [];
        let weeklyNewVisitors = 0;

        for (const date of last7Days) {
          const dayFields = statsMap.get(date) || null;
          const maxHour = date === today ? currentHour : 23;
          const parsed = parseDayStats(dayFields, date, maxHour);
          weeklyPV.push({ date, count: parsed.pvTotal });
          weeklyUV.push({ date, count: parsed.uvTotal });
          weeklyHourlyPV.push({ date, hours: parsed.pvHourly });
          weeklyHourlyUV.push({ date, hours: parsed.uvHourly });
          weeklyNewVisitors += parsed.newVisitors;
        }

        // Total new visitors (cumulative, all time)
        let totalNewVisitors = 0;
        try {
          totalNewVisitors = (await redis.get<number>(`stats:new_visitors:${app.key}`)) || 0;
        } catch {
          totalNewVisitors = 0;
        }

        return {
          name: app.name,
          icon: app.icon,
          activeVisitors,
          lastActiveTime,
          todayPV: todayParsed.pvTotal,
          todayUV: todayParsed.uvTotal,
          todayNewVisitors: todayParsed.newVisitors,
          todayHourlyPV: todayParsed.pvHourly,
          todayHourlyUV: todayParsed.uvHourly,
          weeklyPV,
          weeklyUV,
          weeklyNewVisitors,
          weeklyHourlyPV,
          weeklyHourlyUV,
          totalNewVisitors,
        };
      }),
    );

    let paused = false;
    try {
      paused = (await redis.get<boolean>('stats:paused')) || false;
    } catch {
      paused = false;
    }

    return res.status(200).json({ apps, paused });
  } catch (err: any) {
    console.error('Failed to fetch stats:', err?.message || String(err));
    return res.status(500).json({ error: '获取统计数据失败', detail: err?.message || String(err) });
  }
}
