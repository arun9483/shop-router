import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { readVersion } from './health.js';

vi.mock('newrelic', () => ({ default: { setTransactionName: vi.fn() } }));

const version = { name: 'shop-router', version: '1.0.0', commit: 'abc', buildTime: 'now' };
const servers: Server[] = [];

interface Fes {
  url: string;
  calls: () => number;
}

/** A fake FES: `ready` decides its readiness; `hang` means it never answers. */
async function fes(name: string, { ready = true, hang = false } = {}): Promise<Fes> {
  let calls = 0;
  const app = express();
  app.get('/health/ready', (_req, res) => {
    calls += 1;
    if (hang) return;
    res.status(ready ? 200 : 503).json({ status: ready ? 'pass' : 'fail', serviceId: name });
  });
  app.get('/version', (_req, res) => {
    if (hang) return;
    res.json({ name, version: '2.0.0', commit: 'def', buildTime: 'then' });
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { url, calls: () => calls };
}

/** A URL nothing listens on. */
const down = 'http://localhost:1';

function router(shellUrl: string, mfeUrl: string, cacheMs = 0) {
  return createApp(shellUrl, [{ name: 'catalog', url: mfeUrl }], { version, cacheMs });
}

afterAll(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

describe("the router's own health and version", () => {
  it('stays healthy with every unit down', async () => {
    const app = router(down, down);
    for (const path of ['/health/live', '/health/ready']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/health\+json/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(res.text)).toEqual({
        status: 'pass',
        version: '1.0.0',
        releaseId: 'abc',
        serviceId: 'shop-router',
      });
    }
    expect((await request(app).get('/version')).body).toEqual(version);
  });

  it('is turned off by leaving health out, as are the unit endpoints', async () => {
    const app = createApp(down, []);
    for (const path of ['/health/live', '/version', '/health/units', '/version/units/shell']) {
      expect((await request(app).get(path)).status, path).toBe(404);
    }
  });
});

describe('/health/units', () => {
  it('passes with every unit ready', async () => {
    const app = router((await fes('shell')).url, (await fes('catalog')).url);
    const res = await request(app).get('/health/units');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/health\+json/);
    expect(res.headers['cache-control']).toBe('no-store');
    const time = expect.any(String) as string;
    expect(JSON.parse(res.text)).toEqual({
      status: 'pass',
      version: '1.0.0',
      releaseId: 'abc',
      serviceId: 'shop-router',
      description: 'The shop router and the readiness of every unit',
      checks: {
        'shell:ready': [{ componentId: 'shell', componentType: 'component', status: 'pass', time }],
        'catalog:ready': [
          { componentId: 'catalog', componentType: 'component', status: 'pass', time },
        ],
      },
    });
  });

  it('warns when an MFE is down: the shop still serves pages', async () => {
    const res = await request(router((await fes('shell')).url, down)).get('/health/units');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toMatchObject({
      status: 'warn',
      checks: {
        'shell:ready': [{ status: 'pass' }],
        'catalog:ready': [{ status: 'fail' }],
      },
    });
  });

  it('fails when the Shell is down', async () => {
    const res = await request(router(down, (await fes('catalog')).url)).get('/health/units');
    expect(res.status).toBe(503);
    expect(JSON.parse(res.text)).toMatchObject({
      status: 'fail',
      checks: { 'shell:ready': [{ status: 'fail' }], 'catalog:ready': [{ status: 'pass' }] },
    });
  });

  it('counts an FES that is not ready as failing', async () => {
    const notReady = await fes('catalog', { ready: false });
    const res = await request(router((await fes('shell')).url, notReady.url)).get('/health/units');
    expect(JSON.parse(res.text)).toMatchObject({
      status: 'warn',
      checks: { 'catalog:ready': [{ status: 'fail' }] },
    });
  });

  it('gives up on a unit that never answers, without waiting for it', async () => {
    const shell = await fes('shell');
    const hung = await fes('catalog', { hang: true });
    const app = createApp(shell.url, [{ name: 'catalog', url: hung.url }], {
      version,
      unitTimeoutMs: 50,
      cacheMs: 0,
    });
    const res = await request(app).get('/health/units');
    expect(JSON.parse(res.text)).toMatchObject({
      status: 'warn',
      checks: { 'catalog:ready': [{ status: 'fail' }] },
    });
  });

  it('shows no error detail when a unit fails: this is public', async () => {
    const res = await request(router((await fes('shell')).url, down)).get('/health/units');
    expect(res.text).not.toContain('localhost');
    expect(res.text).not.toContain('output');
  });

  it('reuses answers, so public calls do not multiply calls to each FES', async () => {
    const shell = await fes('shell');
    const app = router(shell.url, (await fes('catalog')).url, 60_000);
    for (let i = 0; i < 5; i++) await request(app).get('/health/units');
    expect(shell.calls()).toBe(1);
  });
});

describe('/health/units/<name>', () => {
  it('answers for one unit', async () => {
    const app = router((await fes('shell')).url, down);
    const shell = await request(app).get('/health/units/shell');
    expect(shell.status).toBe(200);
    expect(shell.headers['content-type']).toMatch(/^application\/health\+json/);
    expect(JSON.parse(shell.text)).toEqual({ status: 'pass', serviceId: 'shell' });
    const catalog = await request(app).get('/health/units/catalog');
    expect(catalog.status).toBe(503);
    expect(JSON.parse(catalog.text)).toEqual({ status: 'fail' });
  });

  it('is a 404 for an unknown unit', async () => {
    expect((await request(router(down, down)).get('/health/units/nope')).status).toBe(404);
  });
});

describe('/version/units', () => {
  it('lists the router and every unit, with a failure for one that cannot answer', async () => {
    const app = router((await fes('@shop-shell/fes')).url, down);
    const res = await request(app).get('/version/units');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      units: {
        router: version,
        shell: { name: '@shop-shell/fes', version: '2.0.0', commit: 'def', buildTime: 'then' },
        catalog: { status: 'fail' },
      },
    });
  });
});

describe('/version/units/<name>', () => {
  it('answers for one unit', async () => {
    const app = router((await fes('@shop-shell/fes')).url, down);
    const shell = await request(app).get('/version/units/shell');
    expect(shell.status).toBe(200);
    expect(shell.body).toMatchObject({ name: '@shop-shell/fes', commit: 'def' });
    const catalog = await request(app).get('/version/units/catalog');
    expect(catalog.status).toBe(503);
    expect(catalog.body).toEqual({ status: 'fail' });
  });

  it('is a 404 for an unknown unit', async () => {
    expect((await request(router(down, down)).get('/version/units/nope')).status).toBe(404);
  });
});

describe('readVersion', () => {
  it('falls back when there is no version.json', () => {
    expect(readVersion('/no/such/folder').name).toBe('unknown');
  });
});
