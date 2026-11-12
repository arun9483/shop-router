import type { Request, RequestHandler, Response } from 'express';
import newrelic from 'newrelic';
import { HttpError } from '../problem.js';
import { TtlCache } from './cache.js';
import { COOKIES, readCookie } from './cookies.js';
import { IdpUnavailableError, type IdpAdapter } from './idp/adapter.js';
import type { Idp } from './metadata.js';
import { checkAccessToken } from './token.js';

export interface FesGateOptions {
  idp: () => Promise<Idp>;
  adapter: IdpAdapter;
  /** The client that signs users in for the whole shop: only its tokens are accepted. */
  loginClientId: string;
  /** This unit's backend; its `/me` is the gate. */
  backendUrl: string;
  /**
   * This unit's backend's client, e.g. `catalog-backend`. The IdP puts it in a token's `aud` only when
   * the user holds one of the unit's roles, so a valid token without it is a `403` at once, not a
   * `401` that the client would take for an expired login.
   */
  backendAudience: string;
  backendTimeoutMs: number;
  /** How long the backend's answer for one session is reused. */
  cacheMs?: number;
}

type GateAnswer = { status: 200; me: unknown } | { status: 401 | 403 };

/** Where a page goes to log in, coming back to the same address. */
export function loginUrl(req: Request): string {
  return `/auth/login?returnTo=${encodeURIComponent(req.originalUrl)}`;
}

/** The lightweight access token for this request's backend calls; set by the gate. */
export function userBearer(res: Response): Record<string, string> {
  const token = res.locals.accessToken as string | undefined;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * For an FES: `shop_at` must hold a lightweight access token issued to the login client. Checked
 * locally, then the gate asks this unit's backend's `/me` with it, reused per session for
 * `cacheMs`: `200` lets the request through, `401` and `403` are passed back, and a backend or IdP
 * that cannot answer is `503`. Pages without a valid token are sent to log in; API calls get `401`
 * problem+json, so the client can refresh.
 */
export function fesGate({
  idp,
  adapter,
  loginClientId,
  backendUrl,
  backendAudience,
  backendTimeoutMs,
  cacheMs = 15_000,
}: FesGateOptions): { page: RequestHandler; api: RequestHandler } {
  const answers = new TtlCache<GateAnswer>(cacheMs);

  async function ask(token: string): Promise<GateAnswer> {
    let res: globalThis.Response;
    try {
      res = await fetch(`${backendUrl}/me`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(backendTimeoutMs),
      });
    } catch (error) {
      throw new IdpUnavailableError(`Backend /me: ${(error as Error).message}`);
    }
    if (res.status === 200) return { status: 200, me: await res.json() };
    if (res.status === 401 || res.status === 403) return { status: res.status };
    throw new IdpUnavailableError(`Backend /me: HTTP ${res.status}`);
  }

  async function check(req: Request, res: Response): Promise<GateAnswer> {
    const token = readCookie(req, COOKIES.accessToken.name);
    if (!token) return { status: 401 };
    const { settings, keys } = await idp();
    let sub: string;
    let sid: string;
    let audience: string[];
    try {
      ({ sub, sid, audience } = await checkAccessToken(token, {
        keys,
        issuer: settings.issuer,
        authorizedParty: loginClientId,
        isAccessToken: adapter.isAccessToken,
      }));
    } catch (error) {
      if (error instanceof HttpError) return { status: 401 };
      throw error;
    }
    const answer: GateAnswer = audience.includes(backendAudience)
      ? await answers.get(`${sub} ${sid}`, () => ask(token))
      : { status: 403 };
    if (answer.status !== 401) {
      newrelic.setUserID(sub);
      res.locals.accessToken = token;
    }
    if (answer.status === 200) res.locals.me = answer.me;
    return answer;
  }

  function guard(
    onRefused: (req: Request, res: Response, status: 401 | 403 | 503) => void,
  ): RequestHandler {
    return async (req, res, next) => {
      let answer: GateAnswer;
      try {
        answer = await check(req, res);
      } catch (error) {
        res.set('Cache-Control', 'no-store');
        if (!(error instanceof IdpUnavailableError)) throw error;
        // Fail closed: the IdP or the backend cannot answer, so the request is not let through.
        onRefused(req, res, 503);
        return;
      }
      if (answer.status === 200) {
        next();
        return;
      }
      res.set('Cache-Control', 'no-store');
      onRefused(req, res, answer.status);
    };
  }

  return {
    page: guard((req, res, status) => {
      if (status === 401) {
        res.redirect(302, loginUrl(req));
        return;
      }
      if (status === 503) {
        res
          .status(503)
          .type('html')
          .send(
            '<!doctype html><title>Try again shortly</title>' +
              '<p>Login cannot be checked right now. Try again shortly.</p>',
          );
        return;
      }
      res
        .status(403)
        .type('html')
        .send('<!doctype html><title>No access</title><p>You do not have access to the shop.</p>');
    }),
    api: guard((_req, _res, status) => {
      const detail = {
        401: 'Login required',
        403: 'No access to this unit',
        503: 'Login cannot be checked now',
      };
      throw new HttpError(status, detail[status]);
    }),
  };
}
