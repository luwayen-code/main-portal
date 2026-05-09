import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { createHmac } from 'crypto';

const redis = Redis.fromEnv();

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

    function parseDayFields(fields: Record<string, string> | null, _date: string, maxHour: number) {
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

    const apps = await Promise.all(
      APPS.map(async (app) => {
        // Fetch all 7 days via HGETALL (1 KV op per day)
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
        const statsMap = new Map(dailyStats.map(d => [d.date, d.fields]));

        // Today
        const todayParsed = parseDayFields(statsMap.get(today) || null, today, currentHour);

        // Weekly
        const weeklyPV: { date: string; count: number }[] = [];
        const weeklyUV: { date: string; count: number }[] = [];
        const weeklyHourlyPV: { date: string; hours: { hour: number; count: number }[] }[] = [];
        const weeklyHourlyUV: { date: string; hours: { hour: number; count: number }[] }[] = [];
        let weeklyNewVisitors = 0;
        for (const date of last7Days) {
          const dayFields = statsMap.get(date) || null;
          const maxHour = date === today ? currentHour : 23;
          const parsed = parseDayFields(dayFields, date, maxHour);
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
