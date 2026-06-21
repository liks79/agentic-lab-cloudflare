import { Hono } from 'hono';
import { z } from 'zod';
import { verifyPagerDutyHmac, verifyDatadogWebhook, verifySlackRequest } from './auth';
import { maskPII } from '../middleware/pii-mask';
import { getTenantId } from '../middleware/tenant';
import type { Env, IncidentEvent, Severity } from '../types';

export const webhookRouter = new Hono<{ Bindings: Env }>();

const PagerDutyPayloadSchema = z.object({
  messages: z.array(
    z.object({
      event: z.string(),
      incident: z.object({
        id: z.string(),
        title: z.string(),
        html_url: z.string().optional(),
        urgency: z.enum(['high', 'low']),
        service: z.object({ name: z.string() }),
        description: z.string().optional(),
        custom_fields: z.record(z.unknown()).optional(),
      }),
    }),
  ),
});

webhookRouter.post('/pagerduty', async (c) => {
  if (!(await verifyPagerDutyHmac(c))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const raw = await c.req.json();
  const parsed = PagerDutyPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Invalid payload' }, 400);
  }

  const tenantId = getTenantId(c);
  const published: string[] = [];

  for (const msg of parsed.data.messages) {
    if (msg.event !== 'incident.trigger' && msg.event !== 'incident.escalate') continue;

    const inc = msg.incident;
    const severity: Severity = inc.urgency === 'high' ? 'P1' : 'P2';
    const event: IncidentEvent = {
      id: crypto.randomUUID(),
      tenantId,
      source: 'pagerduty',
      severity,
      service: inc.service.name,
      title: maskPII(inc.title),
      description: maskPII(inc.description ?? ''),
      alertUrl: inc.html_url,
      receivedAt: Date.now(),
      metadata: { pdIncidentId: inc.id },
    };

    await c.env.INCIDENT_QUEUE.send(event);
    published.push(event.id);
  }

  return c.json({ received: published.length, ids: published });
});

const DatadogPayloadSchema = z.object({
  alert_id: z.string(),
  alert_title: z.string(),
  alert_status: z.string(),
  alert_priority: z.string().optional(),
  service: z.string().optional(),
  body: z.string().optional(),
  url: z.string().optional(),
});

webhookRouter.post('/datadog', async (c) => {
  if (!(await verifyDatadogWebhook(c))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const raw = await c.req.json();
  const parsed = DatadogPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Invalid payload' }, 400);
  }

  const tenantId = getTenantId(c);
  const severityMap: Record<string, Severity> = {
    P1: 'P1',
    P2: 'P2',
    P3: 'P3',
    P4: 'P4',
    critical: 'P1',
    high: 'P2',
    medium: 'P3',
    low: 'P4',
  };
  const severity: Severity = severityMap[parsed.data.alert_priority ?? 'P3'] ?? 'P3';

  const event: IncidentEvent = {
    id: crypto.randomUUID(),
    tenantId,
    source: 'datadog',
    severity,
    service: parsed.data.service ?? 'unknown',
    title: maskPII(parsed.data.alert_title),
    description: maskPII(parsed.data.body ?? ''),
    alertUrl: parsed.data.url,
    receivedAt: Date.now(),
    metadata: { ddAlertId: parsed.data.alert_id },
  };

  await c.env.INCIDENT_QUEUE.send(event);
  return c.json({ received: 1, ids: [event.id] });
});

// Slack slash command: /incident <description>
webhookRouter.post('/slack', async (c) => {
  if (!(await verifySlackRequest(c))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const formData = await c.req.formData();
  const text = formData.get('text')?.toString() ?? '';
  const userId = formData.get('user_id')?.toString() ?? 'unknown';
  const tenantId = getTenantId(c);

  const event: IncidentEvent = {
    id: crypto.randomUUID(),
    tenantId,
    source: 'slack',
    severity: 'P3',
    service: 'manual',
    title: maskPII(text.slice(0, 200)),
    description: maskPII(text),
    receivedAt: Date.now(),
    metadata: { slackUserId: userId },
  };

  await c.env.INCIDENT_QUEUE.send(event);
  return c.json({
    response_type: 'ephemeral',
    text: `Incident created: \`${event.id}\`. The SRE Agent is investigating...`,
  });
});
