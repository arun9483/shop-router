import { createApp, mfeRoutes } from './app.js';
import { connectIdp, oidcSettingsFromEnv, requireService } from './auth/index.js';
import { readVersion } from './health.js';
import { closeOnSignal } from './shutdown.js';

const port = Number(process.env.PORT ?? 3000);
const shellUrl = process.env.SHELL_URL ?? 'http://localhost:3001';
const mfes = mfeRoutes(process.env);

// MVP-2: with HEALTH_UNITS_AUTH=true, /health/units* and /version/units* need a service access token
// with shop-router in aud and the ops role (shop-ops has it). Off by default, as in MVP-1.
function unitsGuard() {
  if (process.env.HEALTH_UNITS_AUTH !== 'true') return undefined;
  const settings = oidcSettingsFromEnv(
    { ...process.env, AUTH_ENABLED: 'true' },
    { withClient: false },
  );
  if (!settings) return undefined;
  return requireService({ ...connectIdp(settings), audience: 'shop-router', role: 'ops' });
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
