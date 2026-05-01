import { kv } from '@vercel/kv';

// Active visitor TTL: 5 minutes
const ACTIVE_VISITOR_TTL = 5 * 60 * 1000;

// Beijing timezone offset (UTC+8)
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function getBeijingDateStr(): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function getBeijingHour(): number {
  return new Date(Date.now() + BEIJING_OFFSET_MS).getUTCHours();
}

// Sub-app prefixes to track
const TRACKED_PREFIXES = ['/it-tools', '/excel-tools'];

// External deployment URLs for each sub-app
const EXTERNAL_URLS: Record<string, string> = {
  'it-tools': 'https://it-tools-six-gules.vercel.app',
  'excel-tools': 'https://excel-tools-gilt.vercel.app',
};

// Shared tracking token (must match api/stats/track.ts)
const TRACK_TOKEN = process.env.TRACK_TOKEN || 'xingwhy-track-2026';

// Asset extensions to skip (only track page visits)
const SKIP_EXTENSIONS = new Set([
  '.js', '.mjs', '.css', '.map', '.png', '.jpg', '.jpeg', '.gif',
  '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.webp',
  '.json', '.xml', '.txt', '.webmanifest', '.wasm',
]);

function getPathWithoutTrailingSlash(pathname: string): string {
  return pathname.endsWith('/') && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;
}

function getTrackedApp(pathname: string): string | null {
  for (const prefix of TRACKED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return prefix.slice(1); // "/it-tools" → "it-tools"
    }
  }
  return null;
}

function isPageVisit(pathname: string, accept: string | null): boolean {
  // Skip requests for static assets
  const lastSegment = pathname.split('/').pop() || '';
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex !== -1) {
    const ext = lastSegment.slice(dotIndex).toLowerCase();
    if (SKIP_EXTENSIONS.has(ext)) return false;
  }

  // Check if the request accepts HTML (browser navigation)
  if (accept && accept.includes('text/html')) return true;

  // Also count paths without extensions (SPA routes)
  if (dotIndex === -1) return true;

  return false;
}

async function trackVisit(app: string, visitorHash: string): Promise<void> {
  const now = Date.now();
  const today = getBeijingDateStr();
  const currentHour = getBeijingHour();

  // Record active visitor in sorted set (score = timestamp)
  await kv.zadd(`active_visitors:${app}`, {
    score: now,
    member: visitorHash,
  });

  // Increment daily page view counter
  await kv.incr(`pv:${app}:${today}`);

  // Increment hourly page view counter
  await kv.incr(`pv_hourly:${app}:${today}:${currentHour}`);

  // Track daily unique visitor (UV)
  await kv.sadd(`uv:${app}:${today}`, visitorHash);

  // Track hourly unique visitor (UV)
  await kv.sadd(`uv_hourly:${app}:${today}:${currentHour}`, visitorHash);
}

// Client-side tracking script injected into sub-app HTML
// Only tracks SPA navigation (pushState/replaceState/popstate)
// Initial page load is tracked server-side by this middleware
function getTrackingScript(appKey: string): string {
  return `<script data-track="1">(function(){`
    + `var APP='${appKey}';`
    + `var TK='${TRACK_TOKEN}';`
    + `function beacon(){`
    + `try{fetch('/api/stats/track',{`
    + `method:'POST',`
    + `headers:{'Content-Type':'application/json','x-track-token':TK},`
    + `body:JSON.stringify({app:APP}),`
    + `keepalive:true`
    + `}).catch(function(){})}catch(e){}}`
    // Intercept SPA navigation (pushState / replaceState)
    + `var ps=history.pushState,rs=history.replaceState;`
    + `history.pushState=function(){ps.apply(this,arguments);beacon()};`
    + `history.replaceState=function(){rs.apply(this,arguments);beacon()};`
    // Listen for popstate (back/forward navigation)
    + `window.addEventListener('popstate',beacon);`
    + `})()</script>`;
}

async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const pathname = getPathWithoutTrailingSlash(url.pathname);
  const app = getTrackedApp(pathname);

  if (!app) {
    // Not a tracked path - continue normally
    return new Response(null, {
      headers: { 'x-middleware-next': '1' },
    });
  }

  const acceptHeader = request.headers.get('accept');
  const isHtml = isPageVisit(pathname, acceptHeader);

  // --- Server-side tracking for all page visits ---
  if (isHtml) {
    const ip = request.headers.get('x-forwarded-for')
      || request.headers.get('x-real-ip')
      || 'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';
    const visitorHash = await hashString(`${ip}:${ua}`);

    try {
      await trackVisit(app, visitorHash);
    } catch (err) {
      console.error('Tracking error:', err);
    }
  }

  // --- For HTML pages: fetch external URL + inject tracking script ---
  if (isHtml && EXTERNAL_URLS[app]) {
    try {
      const externalUrl = `${EXTERNAL_URLS[app]}${pathname}`;

      const extRes = await fetch(externalUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': request.headers.get('user-agent') || '',
        },
        redirect: 'follow',
      });

      const contentType = extRes.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        let html = await extRes.text();
        // Inject tracking script before </body> (or at end of document)
        const scriptTag = getTrackingScript(app);
        if (html.includes('</body>')) {
          html = html.replace('</body>', scriptTag + '</body>');
        } else {
          html += scriptTag;
        }

        // Return modified HTML with appropriate headers
        const headers = new Headers();
        headers.set('Content-Type', 'text/html; charset=utf-8');
        headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');

        return new Response(html, {
          status: extRes.status,
          headers,
        });
      }

      // Not HTML after all - return as-is
      return new Response(extRes.body, {
        status: extRes.status,
        headers: extRes.headers,
      });
    } catch (err) {
      console.error('Proxy fetch error:', err);
      // Fall through to Vercel rewrite as fallback
    }
  }

  // --- For non-HTML requests (static assets): continue to Vercel rewrites ---
  return new Response(null, {
    headers: { 'x-middleware-next': '1' },
  });
}

export const config = {
  matcher: ['/it-tools/:path*', '/excel-tools/:path*'],
};
