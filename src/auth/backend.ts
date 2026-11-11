import type { RequestHandler, Response } from 'express';
import newrelic from 'newrelic';
import { HttpError } from '../problem.js';
import { TtlCache } from './cache.js';
import { IdpUnavailableError, type IdpAdapter, type IdpUser } from './idp/adapter.js';
import type { Idp } from './metadata.js';
import { bearerToken, checkAccessToken } from './token.js';

export interface LoggedInUser {
  sub: string;
  sid: string;
  user: IdpUser;
  /** This unit's roles only. */
  roles: string[];
}

export interface BackendUserOptions {
  idp: () => Promise<Idp>;
  adapter: IdpAdapter;
  /** This unit's name: `shell`, `catalog` or `cart`. Its backend's client is `<unit>-backend`. */
  unit: string;
  /** How long the IdP's answer for one session is reused. */
  cacheMs?: number;
}

/** Problems from the auth checks are never cached by anyone. */
function refuse(res: Response, error: unknown): never {
  res.set('Cache-Control', 'no-store');
  if (error instanceof IdpUnavailableError)
    throw new HttpError(503, 'The identity provider is unavailable');
  throw error;
}

/**
 * For a unit's backend: the request must carry the user's lightweight access token as its bearer.
 * Checks it locally, then asks the IdP, with this backend's own service access token, whether the
 * session is still live, the user is enabled, and which of this unit's roles they hold. The answer
 * is reused per session for `cacheMs`. `401` for no valid token, an ended session or a disabled
 * user; `403` for no role in this unit; `503` when the IdP cannot answer. The token is never sent on.
 */
export function requireUser({
  idp,
  adapter,
  unit,
  cacheMs = 15_000,
}: BackendUserOptions): RequestHandler {
  const answers = new TtlCache<{ active: boolean; user: IdpUser | undefined; roles: string[] }>(
    cacheMs,
  );

  return async (req, res, next) => {
    try {
      const token = bearerToken(req.get('authorization'));
      if (!token) throw new HttpError(401, 'Login required');
      const { settings, keys } = await idp();
      const { sub, sid } = await checkAccessToken(token, {
        keys,
        issuer: settings.issuer,
        audience: `${unit}-backend`,
        isAccessToken: adapter.isAccessToken,
      });
      const { active, user, roles } = await answers.get(`${sub} ${sid}`, async () => {
        const [active, user, roles] = await Promise.all([
          adapter.isSessionActive(sub, sid),
          adapter.getUser(sub),
          adapter.getUnitRoles(sub, unit),
        ]);
        return { active, user, roles };
      });
      if (!active || !user?.enabled) throw new HttpError(401, 'The session has ended');
      newrelic.setUserID(sub);
      if (roles.length === 0) throw new HttpError(403, `No role in ${unit}`);
      const loggedIn: LoggedInUser = { sub, sid, user, roles };
      res.locals.user = loggedIn;
      next();
    } catch (error) {
      refuse(res, error);
    }
  };
}

export function loggedInUser(res: Response): LoggedInUser {
  const user = res.locals.user as LoggedInUser | undefined;
  if (!user) throw new HttpError(401, 'Login required');
  return user;
}

/**
 * `GET /me`: the user with OpenID Connect field names and this unit's roles. Never a token, `sid`,
 * another unit's roles or raw IdP attributes. It is also the FES's gate.
 */
export const meHandler: RequestHandler = (_req, res) => {
  const { user, roles } = loggedInUser(res);
  const fields = Object.fromEntries(Object.entries(user).filter(([name]) => name !== 'enabled'));
  res
    .set('Cache-Control', 'no-store')
    .set('Vary', 'Authorization')
    .json({ ...fields, roles });
};
