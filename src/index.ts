import { connectIdp, oidcSettingsFromEnv, requireService } from '@arun-dev/server/auth';
import { keycloakAdapter } from '@arun-dev/server/auth/keycloak';
import { closeOnSignal, readVersion } from '@arun-dev/server/http';
import { createApp, mfeRoutes } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const shellUrl = process.env.SHELL_URL ?? 'http://localhost:3001';
const mfes = mfeRoutes(process.env);

// MVP-2: with HEALTH_UNITS_AUTH=true, /health/units* and /version/units* need a service access token
// with HEALTH_UNITS_AUDIENCE (default shop-router) in aud and the HEALTH_UNITS_ROLE role (default ops,
// which shop-ops holds). Off by default, as in MVP-1.
function unitsGuard() {
  if (process.env.HEALTH_UNITS_AUTH !== 'true') return undefined;
  const settings = oidcSettingsFromEnv(
    { ...process.env, AUTH_ENABLED: 'true' },
    { withClient: false },
  );
  if (!settings) return undefined;
  return requireService({
    ...connectIdp(settings, { keycloak: keycloakAdapter }),
    audience: process.env.HEALTH_UNITS_AUDIENCE ?? 'shop-router',
    role: process.env.HEALTH_UNITS_ROLE ?? 'ops',
  });
}

const guard = unitsGuard();
const health =
  process.env.HEALTH_ENDPOINTS_ENABLED === 'false'
    ? undefined
    : {
        version: readVersion(import.meta.dirname),
        unitTimeoutMs: Number(process.env.HEALTH_UNIT_TIMEOUT_MS ?? 1000),
        ...(guard ? { unitsGuard: guard } : {}),
      };

const server = createApp(shellUrl, mfes, health).listen(port, () => {
  console.log(
    `router on http://localhost:${port}${guard ? ' (operator token on unit health)' : ''}`,
  );
  for (const { name, url } of mfes) console.log(`  /mfe/${name}, /api/${name} -> ${url}`);
  console.log(`  everything else -> ${shellUrl}`);
});
closeOnSignal(server);
