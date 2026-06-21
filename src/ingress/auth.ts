import type { Context } from 'hono';
import type { Env } from '../types';

export async function verifyPagerDutyHmac(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const signature = c.req.header('X-PagerDuty-Signature');
  if (!signature) return false;

  const body = await c.req.text();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(c.env.PAGERDUTY_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expectedHex = Array.from(new Uint8Array(expected))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Signature format: "v1=<hex>"
  const parts = signature.split(',');
  for (const part of parts) {
    const [version, hash] = part.split('=');
    if (version === 'v1' && hash === expectedHex) return true;
  }
  return false;
}

export async function verifyDatadogWebhook(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return false;
  // Datadog uses Basic Auth or a shared secret depending on configuration
  const expected = `Bearer ${c.env.DATADOG_API_KEY}`;
  return authHeader === expected;
}

export async function verifySlackRequest(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const timestamp = c.req.header('X-Slack-Request-Timestamp');
  const slackSignature = c.req.header('X-Slack-Signature');
  if (!timestamp || !slackSignature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false; // Replay attack guard: reject if older than 5 min

  const body = await c.req.text();
  const baseString = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(c.env.SLACK_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString));
  const computed =
    'v0=' +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  return computed === slackSignature;
}
