import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { verifyToken } from '../_lib/token';

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-this-secret-in-production';
const ACTIVE_VISITOR_TTL = 5 * 60 * 1000; // 5 minutes

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
  return new Date().toISOString().slice(0, 10);
}

function getLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
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
          // Clean up expired entries first
          await kv.zremrangebyscore(`active_visitors:${app.key}`, 0, minScore);
          // Count active visitors
          activeVisitors = await kv.zcount(
            `active_visitors:${app.key}`,
            minScore,
            now,
          );
        } catch {
          // KV might not be configured
          activeVisitors = 0;
        }

        // Get today's page views
        let todayPV = 0;
        try {
          todayPV = (await kv.get<number>(`pv:${app.key}:${today}`)) || 0;
        } catch {
          todayPV = 0;
        }

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

        return {
          name: app.name,
          icon: app.icon,
          activeVisitors,
          todayPV,
          weeklyPV,
        };
      }),
    );

    return res.status(200).json({ apps });
  } catch (err) {
    console.error('Failed to fetch stats:', err);
    return res.status(500).json({ error: '获取统计数据失败' });
  }
}
