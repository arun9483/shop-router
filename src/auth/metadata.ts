import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import * as client from 'openid-client';
import type { OidcSettings } from './config.js';
import { IdpUnavailableError } from './idp/adapter.js';

export interface Idp {
  settings: OidcSettings;
  /** `openid-client`'s configuration for this server's own client, when it has one. */
  config?: client.Configuration;
  /** The IdP's public keys, fetched inside the network and cached by `jose`. */
  keys: JWTVerifyGetKey;
}

/**
 * Reads the IdP's metadata where this server reaches it (inside Docker, `OIDC_INTERNAL_URL`), and
 * checks that its issuer is the public one tokens carry. `openid-client`'s own `discovery()` refuses
 * a URL that differs from the issuer, so its configuration is built from the checked metadata.
 * Back-channel endpoints (token, keys, admin) then point inside the network; front-channel ones
 * (login, logout) stay public.
 */
async function discover(settings: OidcSettings, timeoutMs: number): Promise<Idp> {
  const url = `${settings.internalUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
  let metadata: client.ServerMetadata;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    metadata = (await res.json()) as client.ServerMetadata;
  } catch (error) {
    throw new IdpUnavailableError(`IdP metadata from ${url}: ${(error as Error).message}`);
  }
  if (metadata.issuer !== settings.issuer) {
    throw new Error(`IdP issuer is ${metadata.issuer}, expected ${settings.issuer}`);
  }
  if (!metadata.jwks_uri) throw new Error('IdP metadata has no jwks_uri');

  const keys = createRemoteJWKSet(new URL(metadata.jwks_uri), { timeoutDuration: timeoutMs });
  if (!settings.clientId) return { settings, keys };
  const config = new client.Configuration(metadata, settings.clientId, settings.clientSecret);
  if (new URL(settings.internalUrl).protocol === 'http:') client.allowInsecureRequests(config);
  return { settings, config, keys };
}

/**
 * The IdP, discovered on first use and then kept. A failed discovery is not kept, so a server that
 * starts before the IdP recovers once the IdP is up.
 */
export function lazyIdp(settings: OidcSettings, timeoutMs = 3000): () => Promise<Idp> {
  let pending: Promise<Idp> | undefined;
  return () => {
    pending ??= discover(settings, timeoutMs).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

/** This server's own client, for calls that need it: login, refresh, service access tokens. */
export function ownClient(idp: Idp): { config: client.Configuration; clientId: string } {
  if (!idp.config || !idp.settings.clientId) {
    throw new Error('This server has no client at the IdP (OIDC_CLIENT_ID, OIDC_CLIENT_SECRET)');
  }
  return { config: idp.config, clientId: idp.settings.clientId };
}
