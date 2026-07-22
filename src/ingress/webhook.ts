import { Hono } from 'hono';
import { z } from 'zod';
import { verifyPagerDutyHmac, verifyDatadogWebhook, verifySlackRequest } from './auth';
import { maskPII } from '../middleware/pii-mask';
import { getTenantId } from '../middleware/tenant';
import type { Env, IncidentEvent, Severity } from '../types';

export const webhookRouter = new Hono<{ Bindings: Env }>();

// PagerDuty v3 webhooks deliver a single outbound event per request:
// { "event": { "event_type": "incident.triggered", "data": { ...incident } } }
// https://developer.pagerduty.com/docs/webhooks/v3-overview/
const PagerDutyV3EnvelopeSchema = z.object({
  event: z.object({
    id: z.string(),
    event_type: z.string(),
  }),
});

export const PagerDutyV3IncidentSchema = z.object({
  event: z.object({
    id: z.string(),
    event_type: z.string(),
    resource_type: z.string(),
    occurred_at: z.string().optional(),
    data: z.object({
      id: z.string(),
      title: z.string(),
      html_url: z.string().optional(),
      status: z.string().optional(),
      urgency: z.enum(['high', 'low']),
      service: z.object({ summary: z.string() }),
      priority: z.object({ summary: z.string() }).nullable().optional(),
    }),
  }),
});

const PAGERDUTY_INCIDENT_EVENTS = new Set(['incident.triggered', 'incident.escalated']);

webhookRouter.post('/pagerduty', async (c) => {
  if (!(await verifyPagerDutyHmac(c))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const raw = await c.req.json();

  // Accept-and-ignore non-incident events (e.g. pagey.ping test events) so
  // PagerDuty's "Send Test Event" doesn't register as a delivery failure.
  const envelope = PagerDutyV3EnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return c.json({ error: 'Invalid payload' }, 400);
  }
  if (!PAGERDUTY_INCIDENT_EVENTS.has(envelope.data.event.event_type)) {
    return c.json({ received: 0, ids: [] });
  }

  const parsed = PagerDutyV3IncidentSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Invalid payload' }, 400);
  }

  const tenantId = getTenantId(c);
  const inc = parsed.data.event.data;

  // Prefer the explicit incident priority (P1–P4) when set; fall back to urgency.
  const prioritySummary = inc.priority?.summary;
  const severity: Severity =
    prioritySummary && /^P[1-4]$/.test(prioritySummary)
      ? (prioritySummary as Severity)
      : inc.urgency === 'high'
        ? 'P1'
        : 'P2';

  const event: IncidentEvent = {
    id: crypto.randomUUID(),
    tenantId,
    source: 'pagerduty',
    severity,
    service: inc.service.summary,
    // v3 incident data carries no free-text description; the title is the signal.
    title: maskPII(inc.title),
    description: maskPII(inc.title),
    ...(inc.html_url && { alertUrl: inc.html_url }),
    receivedAt: Date.now(),
    metadata: { pdIncidentId: inc.id, pdEventType: parsed.data.event.event_type },
  };

  await c.env.INCIDENT_QUEUE.send(event);
  return c.json({ received: 1, ids: [event.id] });
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
    ...(parsed.data.url && { alertUrl: parsed.data.url }),
    receivedAt: Date.now(),
    metadata: { ddAlertId: parsed.data.alert_id },
  };

  await c.env.INCIDENT_QUEUE.send(event);
  return c.json({ received: 1, ids: [event.id] });
});

// Slack slash command: /incident <description>
webhookRouter.post('/slack', async (c) => {
  const rawBody = await c.req.text();
  if (!(await verifySlackRequest(c, rawBody))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const formData = new URLSearchParams(rawBody);
  const text = formData.get('text') ?? '';
  const userId = formData.get('user_id') ?? 'unknown';
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
