import type { RequestHandler } from 'express';
import { decodeProtectedHeader, errors, jwtVerify } from 'jose';
import newrelic from 'newrelic';
import * as client from 'openid-client';
import { HttpError } from '../problem.js';
import { IdpUnavailableError, type IdpAdapter } from './idp/adapter.js';
import { ownClient, type Idp } from './metadata.js';
import { bearerToken } from './token.js';

/** The user a backend-to-backend call is for, recorded by the provider for tracing only (ADR 0005). */
export const USER_SUB_HEADER = 'X-Shop-User-Sub';

// A service access token is reused until this long before it expires.
const RENEW_BEFORE_MS = 30_000;

/**
 * For a backend calling another backend (ADR 0005): this backend's own service access token
 * (client credentials, no admin scope), reused until shortly before it expires. Never the user's token.
 */
export function serviceCaller(idp: () => Promise<Idp>): () => Promise<Record<string, string>> {
  let token: { value: string; until: number } | undefined;
  return async () => {
    if (!token || token.until <= Date.now()) {
      const { config } = ownClient(await idp());
      try {
        const grant = await client.clientCredentialsGrant(config);
        const lifetimeMs = (grant.expires_in ?? 60) * 1000;
        token = { value: grant.access_token, until: Date.now() + lifetimeMs - RENEW_BEFORE_MS };
      } catch (error) {
        throw new IdpUnavailableError(`Service access token: ${(error as Error).message}`);
      }
    }
    return { Authorization: `Bearer ${token.value}` };
  };
}

export interface ServiceCaller {
  /** The calling client, e.g. `cart-backend`. */
  clientId: string;
  /** The user the call is for, if the caller said. */
  userSub?: string;
}

export interface ServiceOptions {
  idp: () => Promise<Idp>;
  adapter: IdpAdapter;
  /** This server's client, e.g. `catalog-backend`: it must be in `aud`, and holds the role. */
  audience: string;
  /** The API role the caller must hold, e.g. `catalog-api:read-products`. */
  role: string;
}

/**
 * For routes only other services call (ADR 0005): the bearer must be a service access token (no
 * `sid`, so never a user's token) with this server in `aud` and the API role this route needs. The
 * caller is trusted for the user it names in `X-Shop-User-Sub`, which is recorded for tracing only.
 * `401` for no valid token, `403` without the role, `503` when the IdP's keys cannot be read.
 */
export function requireService({ idp, adapter, audience, role }: ServiceOptions): RequestHandler {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const token = bearerToken(req.get('authorization'));
    if (!token) throw new HttpError(401, 'A service access token is required');
    const { settings, keys } = await idp().catch((error: unknown) => {
      throw error instanceof IdpUnavailableError
        ? new HttpError(503, 'The identity provider is unavailable')
        : error;
    });
    let claims: Record<string, unknown>;
    try {
      ({ payload: claims } = await jwtVerify(token, keys, { issuer: settings.issuer, audience }));
    } catch (error) {
      if (error instanceof errors.JWKSTimeout)
        throw new HttpError(503, 'The identity provider is unavailable');
      throw new HttpError(401, 'The service access token is not valid');
    }
    if (!adapter.isAccessToken(decodeProtectedHeader(token), claims) || 'sid' in claims) {
      throw new HttpError(401, 'Not a service access token');
    }
    if (!adapter.serviceRoles(claims, audience).includes(role)) {
      throw new HttpError(403, `The caller lacks ${role}`);
    }
    const userSub = req.get(USER_SUB_HEADER);
    if (userSub) newrelic.setUserID(userSub);
    const caller: ServiceCaller = {
      clientId: typeof claims.azp === 'string' ? claims.azp : 'unknown',
      ...(userSub ? { userSub } : {}),
    };
    res.locals.caller = caller;
    next();
  };
}
