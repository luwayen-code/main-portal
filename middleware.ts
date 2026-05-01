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

// Client-side tracking script injected into sub-app HTML.
// Handles BOTH initial page load AND SPA navigation.
// Rationale: PWA Service Workers in sub-apps may serve cached HTML
// without hitting the server, so server-side tracking is unreliable.
// The client-side beacon runs on every page load, regardless of cache.
function getTrackingScript(appKey: string): string {
  return `<script data-track="1">(function(){`
    + `var APP='${appKey}';`
    + `var TK='${TRACK_TOKEN}';`
    + `function beacon(){`
    + `try{fetch('/api/stats/track',{`
    + `method:'POST',`
    + `headers:{'Content-Type':'application/json','x-track-token':TK},`
    + `body:JSON.stringify({app:APP}),`
    + `keepalive:true,`
    + `cache:'no-store'`
    + `}).catch(function(){})}catch(e){}}`
    // Track on every page load (even when served from SW cache)
    + `beacon();`
    // Intercept SPA navigation (pushState / replaceState)
    + `var ps=history.pushState,rs=history.replaceState;`
    + `history.pushState=function(){ps.apply(this,arguments);beacon()};`
    + `history.replaceState=function(){rs.apply(this,arguments);beacon()};`
    // Listen for popstate (back/forward navigation)
    + `window.addEventListener('popstate',beacon);`
    + `})()</script>`;
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

  // --- For HTML pages: fetch external URL + inject tracking script ---
  // All tracking is done client-side via the injected script.
  // Server-side tracking is intentionally NOT used here because
  // PWA Service Workers may serve cached HTML without any server request.
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
