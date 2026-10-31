import express, { type Express } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

export interface Route {
  name: string;
  url: string;
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
 * included, pass through unchanged.
 */
export function createApp(shellUrl: string, mfes: Route[]): Express {
  const app = express();
  app.disable('x-powered-by');

  // Health and version checks go to each server's own port, never through the router.
  app.use(['/health', '/version'], (_req, res) => {
    res.sendStatus(404);
  });

  for (const { name, url } of mfes) {
    app.use(
      createProxyMiddleware({
        target: url,
        xfwd: true,
        pathFilter: (path) =>
          [`/mfe/${name}`, `/api/${name}`].some(
            (prefix) =>
              path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
          ),
      }),
    );
  }
  app.use(createProxyMiddleware({ target: shellUrl, xfwd: true }));
  return app;
}
