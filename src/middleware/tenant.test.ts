import { describe, expect, it } from 'vitest';
import { buildD1TenantFilter, buildDurableObjectId, getTenantId } from './tenant';

function contextWithHeaders(headers: Record<string, string | undefined>): Parameters<typeof getTenantId>[0] {
  return {
    req: {
      header: (name: string) => headers[name],
    },
  } as Parameters<typeof getTenantId>[0];
}

describe('getTenantId', () => {
  it('prefers the Cloudflare Access tenant header', () => {
    const context = contextWithHeaders({
      'CF-Access-Tenant-ID': 'access-tenant',
      'X-Tenant-ID': 'client-tenant',
    });

    expect(getTenantId(context)).toBe('access-tenant');
  });

  it('removes unsupported characters', () => {
    const context = contextWithHeaders({
      'X-Tenant-ID': 'tenant!@#-A_B.<>',
    });

    expect(getTenantId(context)).toBe('tenant-A_B');
  });

  it('limits tenant IDs to 64 characters', () => {
    const context = contextWithHeaders({
      'X-Tenant-ID': 'a'.repeat(80),
    });

    expect(getTenantId(context)).toHaveLength(64);
  });

  it('falls back to default when sanitized tenant is empty', () => {
    const context = contextWithHeaders({
      'X-Tenant-ID': '!@#$',
    });

    expect(getTenantId(context)).toBe('default');
  });
});

describe('tenant helpers', () => {
  it('builds durable object IDs from tenant and incident IDs', () => {
    expect(buildDurableObjectId('tenant', 'incident')).toBe('tenant::incident');
  });

  it('sanitizes D1 tenant filters', () => {
    expect(buildD1TenantFilter('tenant!@#-A_B')).toBe('tenant-A_B');
  });
});
