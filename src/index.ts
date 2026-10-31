import { createApp, mfeRoutes } from './app.js';
import { readVersion } from './health.js';

const port = Number(process.env.PORT ?? 3000);
const shellUrl = process.env.SHELL_URL ?? 'http://localhost:3001';
const mfes = mfeRoutes(process.env);
const health =
  process.env.HEALTH_ENDPOINTS_ENABLED === 'false'
    ? undefined
    : { version: readVersion(import.meta.dirname) };

createApp(shellUrl, mfes, health).listen(port, () => {
  console.log(`router on http://localhost:${port}`);
  for (const { name, url } of mfes) console.log(`  /mfe/${name}, /api/${name} -> ${url}`);
  console.log(`  everything else -> ${shellUrl}`);
});
