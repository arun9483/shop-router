import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drain } from './shutdown.js';

vi.mock('newrelic', () => ({ default: { shutdown: vi.fn() } }));

let server: Server;

async function listen(handler: RequestListener): Promise<string> {
  server = createServer(handler).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

afterEach(() => {
  server.closeAllConnections();
});

describe('drain', () => {
  it('lets a request in flight finish, then refuses new ones', async () => {
    const url = await listen((_req, res) => {
      setTimeout(() => res.end('done'), 100);
    });
    const inFlight = fetch(url);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await drain(server, 2000);
    expect(await (await inFlight).text()).toBe('done');
    await expect(fetch(url)).rejects.toThrow();
  });

  it('gives up on a request that never finishes', async () => {
    const url = await listen(() => {
      // Never answers.
    });
    void fetch(url).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const started = Date.now();
    await drain(server, 50);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
