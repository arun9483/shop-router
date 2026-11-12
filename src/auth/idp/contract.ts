import { strict as assert } from 'node:assert';
import { IdpUnavailableError, type IdpAdapter } from './adapter.js';

/** What a real or fake IdP holds, for the contract to check an adapter against (ADR 0004). */
export interface ContractFixtures {
  /** A user with roles in `unit`, and a live login session. */
  user: { sub: string; sid: string; username: string; unit: string; roles: string[] };
  /** A user with no role in `user.unit`. */
  userWithoutRole: { sub: string };
  /** A login session that has ended (the user logged out). */
  endedSession: { sub: string; sid: string };
  /** A sub the IdP does not know. */
  unknownSub: string;
  /** The decoded header and claims of the user's tokens. */
  tokens: {
    access: { header: Record<string, unknown>; claims: Record<string, unknown> };
    id: { header: Record<string, unknown>; claims: Record<string, unknown> };
    refresh: { header: Record<string, unknown>; claims: Record<string, unknown> };
  };
  /** A service access token's claims and a role it holds on `client`. */
  service: { claims: Record<string, unknown>; client: string; role: string };
}

/**
 * The IdP adapter contract: every adapter, for any IdP, must pass it. Returns what it checked; throws
 * an `AssertionError` on the first broken promise. Framework-free, so unit tests run it against a fake
 * and `shop-mfe-platform`'s `sso-check.sh` against the running Keycloak.
 */
export async function checkAdapterContract(
  adapter: IdpAdapter,
  f: ContractFixtures,
): Promise<string[]> {
  const checked: string[] = [];

  const user = await adapter.getUser(f.user.sub);
  assert.ok(user, 'getUser finds a known user');
  assert.equal(user.sub, f.user.sub, 'getUser: sub');
  assert.equal(user.preferred_username, f.user.username, 'getUser: preferred_username');
  assert.equal(user.enabled, true, 'getUser: enabled');
  assert.equal(await adapter.getUser(f.unknownSub), undefined, 'getUser: unknown sub is undefined');
  checked.push('getUser: a known user with OIDC fields; an unknown sub is undefined');

  assert.deepEqual(
    [...(await adapter.getUnitRoles(f.user.sub, f.user.unit))].sort(),
    [...f.user.roles].sort(),
    'getUnitRoles: the user’s roles in the unit',
  );
  assert.deepEqual(
    await adapter.getUnitRoles(f.userWithoutRole.sub, f.user.unit),
    [],
    'getUnitRoles: none for a user without a role there',
  );
  checked.push(`getUnitRoles: ${f.user.roles.join(', ')} in ${f.user.unit}; none without a role`);

  assert.equal(
    await adapter.isSessionActive(f.user.sub, f.user.sid),
    true,
    'isSessionActive: live',
  );
  assert.equal(
    await adapter.isSessionActive(f.endedSession.sub, f.endedSession.sid),
    false,
    'isSessionActive: ended',
  );
  checked.push('isSessionActive: true for a live session, false after logout');

  const { access, id, refresh } = f.tokens;
  assert.equal(
    adapter.isAccessToken(access.header, access.claims),
    true,
    'isAccessToken: access token',
  );
  assert.equal(adapter.isAccessToken(id.header, id.claims), false, 'isAccessToken: ID token');
  assert.equal(
    adapter.isAccessToken(refresh.header, refresh.claims),
    false,
    'isAccessToken: refresh token',
  );
  checked.push('isAccessToken: only the access token');

  assert.ok(
    adapter.serviceRoles(f.service.claims, f.service.client).includes(f.service.role),
    'serviceRoles: the service holds its role',
  );
  assert.deepEqual(
    adapter.serviceRoles(f.service.claims, 'no-such-client'),
    [],
    'serviceRoles: none elsewhere',
  );
  checked.push(`serviceRoles: ${f.service.role} on ${f.service.client}`);

  return checked;
}

/** The second half of the contract: an adapter whose IdP cannot be reached fails closed. */
export async function checkUnavailableContract(
  adapter: IdpAdapter,
  sub: string,
  sid: string,
): Promise<string> {
  const calls: [string, () => Promise<unknown>][] = [
    ['getUser', () => adapter.getUser(sub)],
    ['getUnitRoles', () => adapter.getUnitRoles(sub, 'shell')],
    ['isSessionActive', () => adapter.isSessionActive(sub, sid)],
  ];
  for (const [name, call] of calls) {
    await assert.rejects(
      call,
      IdpUnavailableError,
      `${name} throws IdpUnavailableError when the IdP is down`,
    );
  }
  return 'getUser, getUnitRoles, isSessionActive throw IdpUnavailableError when the IdP cannot be reached';
}
