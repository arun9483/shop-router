/** How a server reaches the shop's identity provider (IdP). See MVP-2 in arun-mfe-platform. */
export interface OidcSettings {
  /** The issuer every token carries, e.g. `https://shop.test:8443/realms/shop`. */
  issuer: string;
  /** Where this server reaches the IdP, e.g. `http://keycloak:8080/realms/shop` inside Docker. */
  internalUrl: string;
  /**
   * This server's own client at the IdP: the Shell FES (login) and every backend have one. An MFE's
   * FES has none: it only checks tokens and asks its backend.
   */
  clientId?: string;
  clientSecret?: string;
}

/** An environment variable that must be set when login is on. */
export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set when AUTH_ENABLED=true`);
  return value;
}

/**
 * The IdP settings when `AUTH_ENABLED=true`, otherwise undefined: login is off by default, and the
 * server then behaves as in MVP-1. With `withClient` (the default), the server's own client is
 * required. A missing setting stops the server at start.
 */
export function oidcSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  { withClient = true }: { withClient?: boolean } = {},
): OidcSettings | undefined {
  if (env.AUTH_ENABLED !== 'true') return undefined;
  const issuer = requiredEnv('OIDC_ISSUER_URL', env);
  const settings: OidcSettings = { issuer, internalUrl: env.OIDC_INTERNAL_URL ?? issuer };
  if (withClient) {
    settings.clientId = requiredEnv('OIDC_CLIENT_ID', env);
    settings.clientSecret = requiredEnv('OIDC_CLIENT_SECRET', env);
  }
  return settings;
}
