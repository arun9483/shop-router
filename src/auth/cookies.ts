import { CompactEncrypt, compactDecrypt } from 'jose';
import type { Request, Response } from 'express';

/** The shop's session cookies (ADR 0003). Only the Shell FES sets them; every FES reads `shop_at`. */
export const COOKIES = {
  /** The lightweight access token, not encrypted: any FES checks it. */
  accessToken: { name: 'shop_at', path: '/' },
  /** The refresh token, encrypted: only the Shell FES's `/auth/*` routes receive it. */
  refreshToken: { name: 'shop_rt', path: '/auth' },
  /** The ID token, encrypted: only `/auth/logout` receives it. */
  idToken: { name: 'shop_id', path: '/auth/logout' },
} as const;

/** The per-attempt login cookie's name; only `/auth/callback` receives it. */
export const loginAttemptCookie = (state: string) => ({
  name: `shop_tx_${state}`,
  path: '/auth/callback',
});

/** A cookie value from the request, if present. */
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name)
      return decodeURIComponent(part.slice(at + 1).trim());
  }
  return undefined;
}

/**
 * Sets an `HttpOnly; Secure; SameSite=Lax` cookie, always with its `Path`: a cookie set by an
 * `/auth/*` response would otherwise default to `Path=/auth`. Without `maxAgeMs` it lasts the
 * browser session.
 */
export function setCookie(
  res: Response,
  cookie: { name: string; path: string },
  value: string,
  maxAgeMs?: number,
): void {
  res.cookie(cookie.name, value, {
    path: cookie.path,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  });
}

/** Clears a cookie: only a response naming the same `Path` can. */
export function clearCookie(res: Response, cookie: { name: string; path: string }): void {
  res.clearCookie(cookie.name, {
    path: cookie.path,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}

/** Encrypts cookie values with `AUTH_COOKIE_KEY`: 32 bytes, as 64 hex characters or base64url. */
export interface CookieSealer {
  seal(value: string): Promise<string>;
  /** The value, or undefined when it was not sealed with this key or was changed. */
  open(sealed: string): Promise<string | undefined>;
}

export function cookieSealer(keyText: string): CookieSealer {
  const key = /^[0-9a-f]{64}$/i.test(keyText)
    ? Buffer.from(keyText, 'hex')
    : Buffer.from(keyText, 'base64url');
  if (key.length !== 32)
    throw new Error('AUTH_COOKIE_KEY must be 32 bytes: 64 hex characters or base64url');
  return {
    seal: (value) =>
      new CompactEncrypt(new TextEncoder().encode(value))
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .encrypt(key),
    async open(sealed) {
      try {
        const { plaintext } = await compactDecrypt(sealed, key);
        return new TextDecoder().decode(plaintext);
      } catch {
        return undefined;
      }
    },
  };
}
