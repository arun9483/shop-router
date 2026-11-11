import type { RequestHandler } from 'express';
import { HttpError } from '../problem.js';
import type { LoggedInUser } from './backend.js';

/** The user a standalone MFE acts as, without an IdP: development only. */
export interface DevUser {
  sub: string;
  /** This unit's roles. */
  roles: string[];
}

/**
 * The development-only login bypass for a standalone MFE (MVP-2): `AUTH_DEV_BYPASS=true` makes the
 * FES and backend act as `AUTH_DEV_USER_SUB` with `AUTH_DEV_USER_ROLES` (comma-separated), with no
 * IdP and no cookies. Refuses to start in production (`NODE_ENV=production`) or on Cloud Run
 * (`K_SERVICE` is set), and warns at start.
 */
export function devBypassFromEnv(env: NodeJS.ProcessEnv = process.env): DevUser | undefined {
  if (env.AUTH_DEV_BYPASS !== 'true') return undefined;
  if (env.NODE_ENV === 'production' || env.K_SERVICE) {
    throw new Error(
      'AUTH_DEV_BYPASS is for development only and refuses to run in production or on Cloud Run',
    );
  }
  const user: DevUser = {
    sub: env.AUTH_DEV_USER_SUB || 'dev-user',
    roles: (env.AUTH_DEV_USER_ROLES ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
  };
  console.warn(
    `AUTH_DEV_BYPASS is on: every request acts as ${user.sub} with roles [${user.roles.join(', ')}]. Development only.`,
  );
  return user;
}

/** Marks every response, so a bypass that is on by mistake is visible. */
export const devBypassHeader: RequestHandler = (_req, res, next) => {
  res.set('X-Auth-Dev-Bypass', 'true');
  next();
};

function devMe(user: DevUser) {
  return {
    sub: user.sub,
    preferred_username: user.sub,
    name: 'Development User',
    roles: user.roles,
  };
}

/** The backend's `requireUser`, bypassed: the development user, `403` without a role. */
export function devRequireUser(user: DevUser): RequestHandler {
  return (_req, res, next) => {
    if (user.roles.length === 0)
      throw new HttpError(403, 'No role in this unit (AUTH_DEV_USER_ROLES)');
    const loggedIn: LoggedInUser = {
      sub: user.sub,
      sid: 'dev',
      user: {
        sub: user.sub,
        preferred_username: user.sub,
        name: 'Development User',
        enabled: true,
      },
      roles: user.roles,
    };
    res.locals.user = loggedIn;
    next();
  };
}

/** The FES gate, bypassed: the development user as `/me`, `403` without a role. */
export function devFesGate(user: DevUser): { page: RequestHandler; api: RequestHandler } {
  const gate: RequestHandler = (_req, res, next) => {
    if (user.roles.length === 0)
      throw new HttpError(403, 'No role in this unit (AUTH_DEV_USER_ROLES)');
    res.locals.me = devMe(user);
    next();
  };
  return { page: gate, api: gate };
}
