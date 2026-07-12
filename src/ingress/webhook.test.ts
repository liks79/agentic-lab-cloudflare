import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PagerDutyV3IncidentSchema } from './webhook';

describe('PagerDutyV3IncidentSchema', () => {
  it('parses the v3 fixture payload', () => {
    const fixture = JSON.parse(
      readFileSync('fixtures/incidents/pagerduty-p1.json', 'utf-8'),
    );
    const result = PagerDutyV3IncidentSchema.safeParse(fixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.event.event_type).toBe('incident.triggered');
      expect(result.data.event.data.service.summary).toBe('payment-service-prod');
      expect(result.data.event.data.priority?.summary).toBe('P1');
      expect(result.data.event.data.urgency).toBe('high');
    }
  });

  it('parses a minimal v3 payload without optional fields', () => {
    const result = PagerDutyV3IncidentSchema.safeParse({
      event: {
        id: '01ABC',
        event_type: 'incident.escalated',
        resource_type: 'incident',
        data: {
          id: 'PINC1',
          title: 'DB connection pool exhausted',
          urgency: 'low',
          service: { summary: 'orders-api' },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects the legacy v2-style messages[] payload', () => {
    const result = PagerDutyV3IncidentSchema.safeParse({
      messages: [
        {
          event: 'incident.trigger',
          incident: {
            id: 'PD-OLD-001',
            title: 'legacy shape',
            urgency: 'high',
            service: { name: 'payment-service-prod' },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
