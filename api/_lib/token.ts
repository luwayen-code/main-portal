/**
 * Shared HMAC-based token utilities.
 * Works in both Node.js (serverless functions) and Edge Runtime (middleware).
 */

const encoder = new TextEncoder();

async function getHMACKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function computeHMAC(message: string, secret: string): Promise<string> {
  const key = await getHMACKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a token: `{expirationTimestamp}.{hmac}`
 */
export async function createToken(
  expiresInMs: number,
  secret: string,
): Promise<string> {
  const exp = Date.now() + expiresInMs;
  const hmac = await computeHMAC(String(exp), secret);
  return `${exp}.${hmac}`;
}

/**
 * Verify a token. Returns true if valid and not expired.
 */
export async function verifyToken(
  token: string,
  secret: string,
): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const expStr = token.substring(0, dotIndex);
  const providedHmac = token.substring(dotIndex + 1);

  const exp = parseInt(expStr, 10);
  if (isNaN(exp) || exp < Date.now()) return false;

  const expectedHmac = await computeHMAC(expStr, secret);
  return providedHmac === expectedHmac;
}
