import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { createHmac } from 'crypto';

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

    const apps = await Promise.all(
      APPS.map(async (app) => {
        // Get active visitor count from sorted set
        let activeVisitors = 0;
        try {
          await kv.zremrangebyscore(`active_visitors:${app.key}`, 0, minScore);
          activeVisitors = await kv.zcount(
            `active_visitors:${app.key}`,
            minScore,
            now,
          );
        } catch {
          activeVisitors = 0;
        }

        // Get today's page views
        let todayPV = 0;
        try {
          todayPV = (await kv.get<number>(`pv:${app.key}:${today}`)) || 0;
        } catch {
          todayPV = 0;
        }

        // Get today's unique visitors
        let todayUV = 0;
        try {
          todayUV = (await kv.scard(`uv:${app.key}:${today}`)) || 0;
        } catch {
          todayUV = 0;
        }

        // Get today's hourly page views
        const currentHour = getBeijingHour();
        const todayHourlyPV = await Promise.all(
          Array.from({ length: currentHour + 1 }, (_, h) => h).map(async (hour) => {
            let count = 0;
            try {
              count = (await kv.get<number>(`pv_hourly:${app.key}:${today}:${hour}`)) || 0;
            } catch {
              count = 0;
            }
            return { hour, count };
          }),
        );

        // Get today's hourly unique visitors
        const todayHourlyUV = await Promise.all(
          Array.from({ length: currentHour + 1 }, (_, h) => h).map(async (hour) => {
            let count = 0;
            try {
              count = (await kv.scard(`uv_hourly:${app.key}:${today}:${hour}`)) || 0;
            } catch {
              count = 0;
            }
            return { hour, count };
          }),
        );

        // Get weekly page views
        const weeklyPV = await Promise.all(
          last7Days.map(async (date) => {
            let count = 0;
            try {
              count = (await kv.get<number>(`pv:${app.key}:${date}`)) || 0;
            } catch {
              count = 0;
            }
            return { date, count };
          }),
        );

        // Get weekly unique visitors
        const weeklyUV = await Promise.all(
          last7Days.map(async (date) => {
            let count = 0;
            try {
              count = (await kv.scard(`uv:${app.key}:${date}`)) || 0;
            } catch {
              count = 0;
            }
            return { date, count };
          }),
        );

        // Get weekly hourly page views (each day with hourly breakdown)
        const weeklyHourlyPV = await Promise.all(
          last7Days.map(async (date) => {
            const maxHour = date === today ? currentHour : 23;
            const hours = await Promise.all(
              Array.from({ length: maxHour + 1 }, (_, h) => h).map(async (hour) => {
                let count = 0;
                try {
                  count = (await kv.get<number>(`pv_hourly:${app.key}:${date}:${hour}`)) || 0;
                } catch {
                  count = 0;
                }
                return { hour, count };
              }),
            );
            return { date, hours };
          }),
        );

        // Get weekly hourly unique visitors (each day with hourly breakdown)
        const weeklyHourlyUV = await Promise.all(
          last7Days.map(async (date) => {
            const maxHour = date === today ? currentHour : 23;
            const hours = await Promise.all(
              Array.from({ length: maxHour + 1 }, (_, h) => h).map(async (hour) => {
                let count = 0;
                try {
                  count = (await kv.scard(`uv_hourly:${app.key}:${date}:${hour}`)) || 0;
                } catch {
                  count = 0;
                }
                return { hour, count };
              }),
            );
            return { date, hours };
          }),
        );

        return {
          name: app.name,
          icon: app.icon,
          activeVisitors,
          todayPV,
          todayUV,
          todayHourlyPV,
          todayHourlyUV,
          weeklyPV,
          weeklyUV,
          weeklyHourlyPV,
          weeklyHourlyUV,
        };
      }),
    );

    return res.status(200).json({ apps });
  } catch (err) {
    console.error('Failed to fetch stats:', err);
    return res.status(500).json({ error: '获取统计数据失败' });
  }
}
