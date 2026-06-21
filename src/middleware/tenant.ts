import type { Context } from 'hono';
import type { Env } from '../types';

export function getTenantId(c: Context<{ Bindings: Env }>): string {
  // In production: extract from CF Access JWT claim or custom header
  // The header must be set by Cloudflare Access, not by the client
  const tenantId =
    c.req.header('CF-Access-Tenant-ID') ??
    c.req.header('X-Tenant-ID') ??
    'default';

  // Sanitize: only allow alphanumeric, hyphen, underscore
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default';
}

export function buildDurableObjectId(tenantId: string, incidentId: string): string {
  return `${tenantId}::${incidentId}`;
}

export function buildD1TenantFilter(tenantId: string): string {
  // Safe parameterized filtering — callers must use this with D1 prepared statements
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
}
