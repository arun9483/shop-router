import express, { type Express } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import newrelic from 'newrelic';
import { healthRouter, type HealthOptions } from './health.js';

export interface Route {
  name: string;
  url: string;
}

/** Whether `path`, which may carry a query, is `prefix` or anything under it. */
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

/** Reads every `MFE_<NAME>_URL` variable, e.g. `MFE_CATALOG_URL` gives the route `catalog`. */
export function mfeRoutes(env: NodeJS.ProcessEnv): Route[] {
  return Object.entries(env).flatMap(([key, url]) => {
    const match = /^MFE_([A-Z0-9]+)_URL$/.exec(key);
    return match?.[1] && url ? [{ name: match[1].toLowerCase(), url }] : [];
  });
}

/**
 * The one public origin, as a CDN would be in production: `/mfe/<name>[/*]` and `/api/<name>[/*]` go
 * to that MFE's FES and everything else to the Shell's FES. Requests and headers, trace headers
 * included, pass through unchanged. With `health`, it also answers health and version.
 */
export function createApp(shellUrl: string, mfes: Route[], health?: HealthOptions): Express {
  const app = express();
  app.disable('x-powered-by');

  if (health) app.use(healthRouter(shellUrl, mfes, health));
  // These paths never reach a unit: each FES answers its own on its own port.
  app.use(['/health', '/version'], (_req, res) => {
    res.sendStatus(404);
  });

  // A proxied request matches no Express route, so the agent would name every one `GET//`. Names
  // are per unit, never per URL, so public requests cannot create new ones.
  app.use('/api', (req, _res, next) => {
    const mfe = mfes.find(({ name }) => isUnder(req.originalUrl, `/api/${name}`));
    newrelic.setTransactionName(`api/${mfe?.name ?? 'shell'}`);
    next();
  });

  // A new connection per request. Reused connections would stay on the pod they first reached, so
  // one pod of a unit would take most of its traffic and a new pod would get none. The target's own
  // host, because hosts like Cloud Run find the service by it; X-Forwarded-Host keeps the public one.
  const proxy = { agent: false, changeOrigin: true, xfwd: true };

  for (const { name, url } of mfes) {
    app.use(
      createProxyMiddleware({
        ...proxy,
        target: url,
        pathFilter: (path) =>
          [`/mfe/${name}`, `/api/${name}`].some((prefix) => isUnder(path, prefix)),
      }),
    );
  }
  app.use(createProxyMiddleware({ ...proxy, target: shellUrl }));
  return app;
}
