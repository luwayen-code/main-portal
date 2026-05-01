import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { createHmac } from 'crypto';

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-this-secret-in-production';
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

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

function requireAuth(req: VercelRequest, res: VercelResponse): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未授权' });
    return false;
  }

  const token = authHeader.slice(7);
  if (!verifyToken(token, TOKEN_SECRET)) {
    res.status(401).json({ error: '令牌无效或已过期' });
    return false;
  }

  return true;
}

function getBeijingDateStr(): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function getBeijingHour(): number {
  return new Date(Date.now() + BEIJING_OFFSET_MS).getUTCHours();
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

interface AppInfo {
  key: string;
  name: string;
  icon: string;
}

const APPS: AppInfo[] = [
  { key: 'it-tools', name: 'IT Tools', icon: '🛠️' },
  { key: 'excel-tools', name: 'EasyExcel', icon: '📊' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireAuth(req, res)) return;

  try {
    const today = getBeijingDateStr();
    const currentHour = getBeijingHour();
    const last7Days = getLast7Days();

    const apps = await Promise.all(
      APPS.map(async (app) => {
        const todayPV = (await kv.get<number>(`pv:${app.key}:${today}`)) || 0;
        const todayUV = (await kv.scard(`uv:${app.key}:${today}`)) || 0;

        const todayHourlyPV = await Promise.all(
          Array.from({ length: currentHour + 1 }, (_, h) => h).map(async (hour) => ({
            hour,
            count: (await kv.get<number>(`pv_hourly:${app.key}:${today}:${hour}`)) || 0,
          })),
        );

        const todayHourlyUV = await Promise.all(
          Array.from({ length: currentHour + 1 }, (_, h) => h).map(async (hour) => ({
            hour,
            count: (await kv.scard(`uv_hourly:${app.key}:${today}:${hour}`)) || 0,
          })),
        );

        const weeklyPV = await Promise.all(
          last7Days.map(async (date) => ({
            date,
            count: (await kv.get<number>(`pv:${app.key}:${date}`)) || 0,
          })),
        );

        const weeklyUV = await Promise.all(
          last7Days.map(async (date) => ({
            date,
            count: (await kv.scard(`uv:${app.key}:${date}`)) || 0,
          })),
        );

        const weeklyHourlyPV = await Promise.all(
          last7Days.map(async (date) => {
            const maxHour = date === today ? currentHour : 23;
            const hours = await Promise.all(
              Array.from({ length: maxHour + 1 }, (_, h) => h).map(async (hour) => ({
                hour,
                count: (await kv.get<number>(`pv_hourly:${app.key}:${date}:${hour}`)) || 0,
              })),
            );
            return { date, hours };
          }),
        );

        const weeklyHourlyUV = await Promise.all(
          last7Days.map(async (date) => {
            const maxHour = date === today ? currentHour : 23;
            const hours = await Promise.all(
              Array.from({ length: maxHour + 1 }, (_, h) => h).map(async (hour) => ({
                hour,
                count: (await kv.scard(`uv_hourly:${app.key}:${date}:${hour}`)) || 0,
              })),
            );
            return { date, hours };
          }),
        );

        return {
          name: app.name,
          icon: app.icon,
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

    const exportData = {
      exportTime: new Date().toISOString(),
      timezone: 'UTC+8 (Beijing)',
      today,
      apps,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="stats-export-${today}.json"`);
    return res.status(200).json(exportData);
  } catch (err) {
    console.error('Failed to export stats:', err);
    return res.status(500).json({ error: '导出统计数据失败' });
  }
}
