import { decodeProtectedHeader, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { HttpError } from '../problem.js';
import { IdpUnavailableError } from './idp/adapter.js';

export interface AccessTokenChecks {
  keys: JWTVerifyGetKey;
  issuer: string;
  /** True only for an access token (from the IdP adapter). */
  isAccessToken: (header: Record<string, unknown>, claims: Record<string, unknown>) => boolean;
  /** A backend: its own name must be in `aud`. */
  audience?: string;
  /** An FES: the client that signed the user in must be `azp`. */
  authorizedParty?: string;
}

export interface CheckedToken {
  sub: string;
  sid: string;
  /** The APIs the token is for: a unit's backend is here only when the user holds one of its roles. */
  audience: string[];
}

/**
 * Checks a lightweight access token locally: signature against the IdP's keys, `iss`, `exp`, then
 * `aud` or `azp`, and that it is an access token, so an ID token can never call an API. Any failure
 * is a 401; the IdP's keys being unreachable is a 503.
 */
export async function checkAccessToken(
  token: string,
  checks: AccessTokenChecks,
): Promise<CheckedToken> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, checks.keys, {
      issuer: checks.issuer,
      ...(checks.audience ? { audience: checks.audience } : {}),
    }));
  } catch (error) {
    if (
      error instanceof errors.JWKSTimeout ||
      (error instanceof TypeError && /fetch/i.test(error.message))
    ) {
      throw new IdpUnavailableError(`IdP keys: ${error.message}`);
    }
    throw new HttpError(401, 'The access token is not valid');
  }
  if (!checks.isAccessToken(decodeProtectedHeader(token), payload)) {
    throw new HttpError(401, 'Not an access token');
  }
  if (checks.authorizedParty && payload.azp !== checks.authorizedParty) {
    throw new HttpError(401, 'The access token was issued to another client');
  }
  const { sub, sid } = payload;
  if (typeof sub !== 'string' || typeof sid !== 'string') {
    throw new HttpError(401, 'The access token has no user or session');
  }
  const { aud } = payload;
  const audience =
    typeof aud === 'string'
      ? [aud]
      : Array.isArray(aud)
        ? aud.filter((a) => typeof a === 'string')
        : [];
  return { sub, sid, audience };
}

/** The bearer token of a request, if any. */
export function bearerToken(authorization: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return match?.[1];
}
