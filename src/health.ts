import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type Response, type Router as ExpressRouter } from 'express';
import type { Route } from './app.js';

export interface VersionInfo {
  name: string;
  version: string;
  commit: string;
  buildTime: string;
}

export interface HealthOptions {
  version: VersionInfo;
  /** How long one FES may take to answer. */
  unitTimeoutMs?: number;
  /** How long a unit's answer is reused, so public callers cannot multiply calls to every FES. */
  cacheMs?: number;
}

/** Reads the `version.json` that `scripts/write-version.mjs` puts next to the compiled output. */
export function readVersion(dir: string): VersionInfo {
  try {
    return JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')) as VersionInfo;
  } catch {
    return { name: 'unknown', version: '0.0.0', commit: 'unknown', buildTime: 'unknown' };
  }
}

/** Reuses `load`'s result for `ms`; callers during a load share it. */
function cached<T>(ms: number, load: () => Promise<T>): () => Promise<T> {
  let last: { at: number; value: Promise<T> } | undefined;
  return () => {
    if (!last || Date.now() - last.at >= ms) last = { at: Date.now(), value: load() };
    return last.value;
  };
}

/** The health fields of every server in the shop. */
function healthFields(status: string, version: VersionInfo) {
  return { status, version: version.version, releaseId: version.commit, serviceId: version.name };
}

function sendHealth(res: Response, code: number, body: object): void {
  res.status(code).type('application/health+json').json(body);
}

/**
 * The router's own `/health/live`, `/health/ready` and `/version`, which never depend on a unit, so
 * one failing MFE cannot take the router out of service. `/health/units` and `/version/units` add
 * every unit, and `/health/units/<name>` and `/version/units/<name>` one of them. They carry only
 * names, statuses and versions: this is public. Health responses follow the IETF health check
 * draft (draft-inadarei-api-health-check-06), `application/health+json`: `status` with the HTTP code
 * it requires, and each unit as a `<name>:ready` entry in `checks`.
 */
export function healthRouter(
  shellUrl: string,
  mfes: Route[],
  { version, unitTimeoutMs = 1000, cacheMs = 3000 }: HealthOptions,
): ExpressRouter {
  const call = (url: string) => fetch(url, { signal: AbortSignal.timeout(unitTimeoutMs) });

  const units = new Map(
    [{ name: 'shell', url: shellUrl }, ...mfes].map(({ name, url }) => [
      name,
      {
        ready: cached(cacheMs, () =>
          call(`${url}/health/ready`)
            .then(async (res) => ({ ok: res.ok, body: (await res.json()) as object }))
            .catch(() => ({ ok: false, body: { status: 'fail' } }))
            .then((result) => ({ ...result, time: new Date().toISOString() })),
        ),
        version: cached(cacheMs, () =>
          call(`${url}/version`)
            .then((res) => (res.ok ? (res.json() as Promise<VersionInfo>) : undefined))
            .catch(() => undefined),
        ),
      },
    ]),
  );
  const all = [...units];

  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get(['/health/live', '/health/ready'], (_req, res) => {
    sendHealth(res, 200, healthFields('pass', version));
  });
  router.get('/version', (_req, res) => {
    res.json(version);
  });

  router.get('/health/units', async (_req, res) => {
    const ready = await Promise.all(all.map(([, unit]) => unit.ready()));
    const shellReady = ready[0]?.ok;
    // The shop can still serve pages without an MFE, but not without the Shell.
    const status = !shellReady ? 'fail' : ready.every(({ ok }) => ok) ? 'pass' : 'warn';
    sendHealth(res, shellReady ? 200 : 503, {
      ...healthFields(status, version),
      description: 'The shop router and the readiness of every unit',
      // No `output`: a failure's raw error is not for a public response.
      checks: Object.fromEntries(
        all.map(([name], index) => [
          `${name}:ready`,
          [
            {
              componentId: name,
              componentType: 'component',
              status: ready[index]?.ok ? 'pass' : 'fail',
              time: ready[index]?.time,
            },
          ],
        ]),
      ),
    });
  });
  router.get('/health/units/:name', async (req, res) => {
    const unit = units.get(req.params.name);
    if (!unit) {
      res.sendStatus(404);
      return;
    }
    // The unit's own answer, so it reads the same here as on the unit's port.
    const { ok, body } = await unit.ready();
    sendHealth(res, ok ? 200 : 503, body);
  });

  router.get('/version/units', async (_req, res) => {
    const versions = await Promise.all(all.map(([, unit]) => unit.version()));
    const failed = { status: 'fail' };
    res.json({
      units: {
        router: version,
        ...Object.fromEntries(all.map(([name], index) => [name, versions[index] ?? failed])),
      },
    });
  });
  router.get('/version/units/:name', async (req, res) => {
    const unit = units.get(req.params.name);
    if (!unit) {
      res.sendStatus(404);
      return;
    }
    const info = await unit.version();
    res.status(info ? 200 : 503).json(info ?? { status: 'fail' });
  });

  return router;
}
