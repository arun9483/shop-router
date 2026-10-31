import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, mfeRoutes } from './app.js';

const servers: Server[] = [];

/** A fake upstream that answers every request with its own name and the headers it got. */
async function upstream(name: string): Promise<string> {
  const app = express();
  app.use((req, res) => {
    res.json({ name, path: req.originalUrl, traceparent: req.get('traceparent') ?? null });
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

let router: express.Express;

beforeAll(async () => {
  router = createApp(await upstream('shell'), [
    { name: 'catalog', url: await upstream('catalog') },
  ]);
});

afterAll(() => {
  for (const server of servers) server.close();
});

describe('mfeRoutes', () => {
  it('reads MFE_<NAME>_URL variables', () => {
    expect(
      mfeRoutes({ MFE_CATALOG_URL: 'http://a', MFE_CART_URL: 'http://b', SHELL_URL: 'http://c' }),
    ).toEqual([
      { name: 'catalog', url: 'http://a' },
      { name: 'cart', url: 'http://b' },
    ]);
  });
});

describe('router', () => {
  it.each([
    ['/mfe/catalog/entry.js', 'catalog'],
    ['/api/catalog/products', 'catalog'],
    ['/api/catalog', 'catalog'],
    ['/api/catalog?page=2', 'catalog'],
    ['/api/catalogue', 'shell'],
    ['/catalog/42', 'shell'],
    ['/api/shell/greeting', 'shell'],
    ['/mfe/catalogue/entry.js', 'shell'],
    ['/', 'shell'],
  ])('routes %s to %s', async (path, name) => {
    const res = await request(router).get(path);
    expect(res.body).toMatchObject({ name, path });
  });

  it('passes trace headers through unchanged', async () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const res = await request(router).get('/api/catalog/products').set('traceparent', traceparent);
    expect((res.body as { traceparent: string }).traceparent).toBe(traceparent);
  });

  it('does not expose health or version', async () => {
    expect((await request(router).get('/health/live')).status).toBe(404);
    expect((await request(router).get('/version')).status).toBe(404);
  });
});
