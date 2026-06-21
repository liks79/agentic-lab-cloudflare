import { Hono } from 'hono';
import { webhookRouter } from './ingress/webhook';
import { IncidentSession } from './agents/incident-session';
import type { Env } from './types';

export { IncidentSession };

const app = new Hono<{ Bindings: Env }>();

app.route('/webhook', webhookRouter);

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const { processIncidentQueue } = await import('./agents/queue-consumer');
    await processIncidentQueue(batch, env);
  },
};
