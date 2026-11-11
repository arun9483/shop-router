import * as client from 'openid-client';
import { ownClient, type Idp } from '../metadata.js';
import { IdpUnavailableError, type IdpAdapter, type IdpUser } from './adapter.js';

// Keycloak 26.8's admin API accepts only tokens with this scope. It is optional on each backend's
// client, so only admin API calls carry it.
const ADMIN_SCOPE = 'kc-admin-api';
// A service access token is reused until this long before it expires.
const RENEW_BEFORE_MS = 30_000;

interface KeycloakUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailVerified?: boolean;
  enabled: boolean;
  attributes?: Record<string, string[]>;
}

interface KeycloakGroup {
  clientRoles?: Record<string, string[]>;
}

interface KeycloakSession {
  id: string;
}

function toIdpUser(user: KeycloakUser): IdpUser {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  const locale = user.attributes?.locale?.[0];
  return {
    sub: user.id,
    preferred_username: user.username,
    ...(name ? { name } : {}),
    ...(user.firstName ? { given_name: user.firstName } : {}),
    ...(user.lastName ? { family_name: user.lastName } : {}),
    ...(user.email ? { email: user.email } : {}),
    ...(user.emailVerified === undefined ? {} : { email_verified: user.emailVerified }),
    ...(locale ? { locale } : {}),
    enabled: user.enabled,
  };
}

/**
 * The Keycloak adapter. Reads users through Keycloak's admin API with this backend's own service
 * access token, which needs only `realm-management` → `view-users`:
 *
 * - roles come from the user's groups, because `view-users` cannot look up a client's internal ID,
 *   which the role-mapping endpoints need; each unit grants its roles through its own groups;
 * - a session is live while its ID is among the user's sessions;
 * - an access token has the claim `typ: Bearer` (`ID` and `Refresh` for the others).
 */
export function keycloakAdapter(idp: () => Promise<Idp>, timeoutMs = 3000): IdpAdapter {
  let token: { value: string; until: number } | undefined;

  async function serviceToken(): Promise<string> {
    if (token && token.until > Date.now()) return token.value;
    const { config } = ownClient(await idp());
    try {
      const grant = await client.clientCredentialsGrant(config, { scope: ADMIN_SCOPE });
      const lifetimeMs = (grant.expires_in ?? 60) * 1000;
      token = { value: grant.access_token, until: Date.now() + lifetimeMs - RENEW_BEFORE_MS };
      return token.value;
    } catch (error) {
      throw new IdpUnavailableError(`Service access token: ${(error as Error).message}`);
    }
  }

  async function admin<T>(path: string, retried = false): Promise<T | undefined> {
    const { settings } = await idp();
    const realmUrl = new URL(settings.internalUrl);
    const realm = realmUrl.pathname.split('/').filter(Boolean).at(-1) ?? '';
    const url = `${realmUrl.origin}/admin/realms/${encodeURIComponent(realm)}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { authorization: `Bearer ${await serviceToken()}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof IdpUnavailableError) throw error;
      throw new IdpUnavailableError(`IdP admin API: ${(error as Error).message}`);
    }
    if (res.status === 401 && !retried) {
      token = undefined; // revoked or expired early: get a new one once
      return admin<T>(path, true);
    }
    if (res.status === 404) return undefined;
    if (!res.ok) throw new IdpUnavailableError(`IdP admin API ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  const user = (sub: string) => `/users/${encodeURIComponent(sub)}`;

  return {
    async getUser(sub) {
      const found = await admin<KeycloakUser>(user(sub));
      return found && toIdpUser(found);
    },
    async getUnitRoles(sub, unit) {
      const groups = await admin<KeycloakGroup[]>(`${user(sub)}/groups?briefRepresentation=false`);
      const roles = new Set(
        (groups ?? []).flatMap((g) => g.clientRoles?.[`${unit}-backend`] ?? []),
      );
      return [...roles].sort();
    },
    async isSessionActive(sub, sid) {
      const sessions = await admin<KeycloakSession[]>(`${user(sub)}/sessions`);
      return (sessions ?? []).some((session) => session.id === sid);
    },
    isAccessToken: (_header, claims) => claims.typ === 'Bearer',
    serviceRoles: (claims, client) => {
      const access = claims.resource_access as Record<string, { roles?: unknown }> | undefined;
      const roles = access?.[client]?.roles;
      return Array.isArray(roles)
        ? roles.filter((role): role is string => typeof role === 'string')
        : [];
    },
  };
}
