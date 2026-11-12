import { describe, expect, it } from 'vitest';
import { lazyIdp } from '../metadata.js';
import { IdpUnavailableError, type IdpAdapter, type IdpUser } from './adapter.js';
import {
  checkAdapterContract,
  checkUnavailableContract,
  type ContractFixtures,
} from './contract.js';
import { keycloakAdapter } from './keycloak.js';

// A fake IdP held in memory: the contract must hold for it too, so the contract itself is checked.
// The Keycloak adapter runs the same contract against a real Keycloak in shop-mfe-platform's sso-check.sh.
const people: Record<string, IdpUser> = {
  alice: { sub: 'alice', preferred_username: 'alice', enabled: true },
  bob: { sub: 'bob', preferred_username: 'bob', enabled: true },
};
const roles: Record<string, Record<string, string[]>> = { alice: { shell: ['shell-user'] } };
const sessions: Record<string, string[]> = { alice: ['s1'] };

const fake: IdpAdapter = {
  getUser: (sub) => Promise.resolve(people[sub]),
  getUnitRoles: (sub, unit) => Promise.resolve(roles[sub]?.[unit] ?? []),
  isSessionActive: (sub, sid) => Promise.resolve(sessions[sub]?.includes(sid) ?? false),
  isAccessToken: (_header, claims) => claims.kind === 'access',
  serviceRoles: (claims, client) => (claims.roles as Record<string, string[]>)[client] ?? [],
};

const fixtures: ContractFixtures = {
  user: { sub: 'alice', sid: 's1', username: 'alice', unit: 'shell', roles: ['shell-user'] },
  userWithoutRole: { sub: 'bob' },
  endedSession: { sub: 'alice', sid: 's0' },
  unknownSub: 'nobody',
  tokens: {
    access: { header: {}, claims: { kind: 'access' } },
    id: { header: {}, claims: { kind: 'id' } },
    refresh: { header: {}, claims: { kind: 'refresh' } },
  },
  service: { claims: { roles: { 'shop-router': ['ops'] } }, client: 'shop-router', role: 'ops' },
};

describe('IdP adapter contract (ADR 0004)', () => {
  it('holds for a fake IdP', async () => {
    expect(await checkAdapterContract(fake, fixtures)).toHaveLength(5);
  });

  it('catches an adapter that breaks it', async () => {
    const broken: IdpAdapter = { ...fake, isAccessToken: () => true };
    await expect(checkAdapterContract(broken, fixtures)).rejects.toThrow('isAccessToken: ID token');
  });

  it('fails closed: a fake IdP that is down throws IdpUnavailableError', async () => {
    const down = () => Promise.reject(new IdpUnavailableError('down'));
    const unavailable: IdpAdapter = {
      ...fake,
      getUser: down,
      getUnitRoles: down,
      isSessionActive: down,
    };
    await expect(checkUnavailableContract(unavailable, 'alice', 's1')).resolves.toContain(
      'IdpUnavailableError',
    );
  });

  it('fails closed: the Keycloak adapter with Keycloak unreachable throws IdpUnavailableError', async () => {
    const unreachable = lazyIdp(
      {
        issuer: 'https://idp.test/realms/shop',
        internalUrl: 'http://127.0.0.1:9/realms/shop',
        clientId: 'shell-backend',
        clientSecret: 'x',
      },
      500,
    );
    await expect(
      checkUnavailableContract(keycloakAdapter(unreachable, 500), 'alice', 's1'),
    ).resolves.toContain('IdpUnavailableError');
  });
});
