import { createApp, mfeRoutes } from './app.js';
import { readVersion } from './health.js';
import { closeOnSignal } from './shutdown.js';

const port = Number(process.env.PORT ?? 3000);
const shellUrl = process.env.SHELL_URL ?? 'http://localhost:3001';
const mfes = mfeRoutes(process.env);
const health =
  process.env.HEALTH_ENDPOINTS_ENABLED === 'false'
    ? undefined
    : {
        version: readVersion(import.meta.dirname),
        unitTimeoutMs: Number(process.env.HEALTH_UNIT_TIMEOUT_MS ?? 1000),
      };

const server = createApp(shellUrl, mfes, health).listen(port, () => {
  console.log(`router on http://localhost:${port}`);
  for (const { name, url } of mfes) console.log(`  /mfe/${name}, /api/${name} -> ${url}`);
  console.log(`  everything else -> ${shellUrl}`);
});
closeOnSignal(server);
