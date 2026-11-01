import type { Server } from 'node:http';
import newrelic from 'newrelic';

/** Stops new connections and lets requests in flight finish, giving up on them after `timeoutMs`. */
export function drain(server: Server, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
    }, timeoutMs);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
}

/**
 * On SIGTERM or SIGINT, drains `server`, sends New Relic what it holds, then exits, so taking a pod
 * away fails no request. `timeoutMs` stays under the 10 s a container gets before it is killed.
 */
export function closeOnSignal(server: Server, timeoutMs = 8000): void {
  const stop = () => {
    void drain(server, timeoutMs).then(() => {
      newrelic.shutdown({ collectPendingData: true, timeout: 1000 }, () => {
        process.exit(0);
      });
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
