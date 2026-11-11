/** A user as the IdP knows them, with OpenID Connect Core §5.1 field names. */
export interface IdpUser {
  sub: string;
  preferred_username: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  locale?: string;
  enabled: boolean;
}

/**
 * The only IdP-specific code in a unit (ADR 0004). Everything else uses standard OIDC and OAuth.
 * Calls that reach the IdP throw `IdpUnavailableError` when it cannot answer; callers fail closed.
 */
export interface IdpAdapter {
  /** Backend: the user's profile by sub, using the backend's service access token. */
  getUser(sub: string): Promise<IdpUser | undefined>;
  /** Backend: the user's effective roles in one unit (`shell`, `catalog`, …), by sub. */
  getUnitRoles(sub: string, unit: string): Promise<string[]>;
  /** Backend: whether the login session named by the token's sid is still live. */
  isSessionActive(sub: string, sid: string): Promise<boolean>;
  /** FES and backend: true only for an access token, never an ID or refresh token. */
  isAccessToken: (header: Record<string, unknown>, claims: Record<string, unknown>) => boolean;
  /**
   * Provider backend and router: the roles a service access token holds on `client` (e.g.
   * `catalog-backend`), read from the token itself. Each IdP lays role claims out its own way.
   */
  serviceRoles: (claims: Record<string, unknown>, client: string) => string[];
}

/** The IdP could not answer: a check that needs it answers 503, never "allow". */
export class IdpUnavailableError extends Error {
  override name = 'IdpUnavailableError';
}
