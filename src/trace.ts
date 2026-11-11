import { randomBytes } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import newrelic from 'newrelic';

// W3C Trace Context: 00-<trace-id>-<parent-id>-<flags>
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Sets `traceresponse` (W3C Trace Context Level 2) on every response and keeps the trace ID in
 * `res.locals.traceId` for error bodies. The ID comes from the New Relic agent; when the agent is
 * disabled, from the incoming `traceparent`; otherwise a new one is made.
 */
export const traceResponse: RequestHandler = (req, res, next) => {
  const { traceId, spanId } = newrelic.getTraceMetadata();
  const incoming = TRACEPARENT.exec(req.get('traceparent') ?? '');
  const id = traceId || incoming?.[1] || hex(16);
  res.locals.traceId = id;
  res.set('traceresponse', `00-${id}-${spanId || hex(8)}-01`);
  next();
};

export function traceIdOf(res: Response): string | undefined {
  const id: unknown = res.locals.traceId;
  return typeof id === 'string' ? id : undefined;
}
