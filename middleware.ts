import { kv } from '@vercel/kv';

// Active visitor TTL: 5 minutes
const ACTIVE_VISITOR_TTL = 5 * 60 * 1000;

// Sub-app prefixes to track
const TRACKED_PREFIXES = ['/it-tools', '/excel-tools'];

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
  const today = new Date().toISOString().slice(0, 10);

  // Record active visitor in sorted set (score = timestamp)
  await kv.zadd(`active_visitors:${app}`, {
    score: now,
    member: visitorHash,
  });

  // Increment daily page view counter
  await kv.incr(`pv:${app}:${today}`);
}

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const pathname = getPathWithoutTrailingSlash(url.pathname);
  const app = getTrackedApp(pathname);

  if (app && isPageVisit(pathname, request.headers.get('accept'))) {
    // Generate visitor hash from IP + User-Agent
    const ip = request.headers.get('x-forwarded-for')
      || request.headers.get('x-real-ip')
      || 'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';

    // Simple hash for visitor identification
    const visitorHash = await hashString(`${ip}:${ua}`);

    // Fire-and-forget tracking (don't block the response)
    try {
      await trackVisit(app, visitorHash);
    } catch (err) {
      // KV might not be configured - fail silently
      console.error('Tracking error:', err);
    }
  }

  // Continue to next middleware/rewrite
  return new Response(null, {
    headers: { 'x-middleware-next': '1' },
  });
}

async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const config = {
  matcher: ['/it-tools/:path*', '/excel-tools/:path*'],
};
