/**
 * Shared HMAC-based token utilities for Node.js Serverless Functions.
 * Uses Node.js native crypto module for reliability.
 */

import { createHmac } from 'node:crypto';

function computeHMAC(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Create a token: `{expirationTimestamp}.{hmac}`
 */
export function createToken(expiresInMs: number, secret: string): string {
  const exp = Date.now() + expiresInMs;
  const hmac = computeHMAC(String(exp), secret);
  return `${exp}.${hmac}`;
}

/**
 * Verify a token. Returns true if valid and not expired.
 */
export function verifyToken(token: string, secret: string): boolean {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const expStr = token.substring(0, dotIndex);
  const providedHmac = token.substring(dotIndex + 1);

  const exp = parseInt(expStr, 10);
  if (isNaN(exp) || exp < Date.now()) return false;

  const expectedHmac = computeHMAC(expStr, secret);
  return providedHmac === expectedHmac;
}
