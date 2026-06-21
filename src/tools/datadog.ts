import { maskPIIInObject } from '../middleware/pii-mask';
import { wrapExternalDataForPrompt } from '../security/prompt-guard';
import type { Env, ToolResult } from '../types';

interface LogSearchInput {
  query: string;
  timeRange: { from: string; to: string };
  service?: string;
}

export async function searchDatadogLogs(env: Env, input: LogSearchInput): Promise<ToolResult> {
  const start = Date.now();

  const payload = {
    filter: {
      query: input.service ? `service:${input.service} ${input.query}` : input.query,
      from: input.timeRange.from,
      to: input.timeRange.to,
    },
    sort: 'timestamp',
    page: { limit: 50 },
  };

  const response = await fetch(
    `https://api.${env.DATADOG_SITE}/api/v2/logs/events/search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': env.DATADOG_API_KEY,
        'DD-APPLICATION-KEY': env.DATADOG_APP_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!response.ok) {
    return {
      success: false,
      error: `Datadog API error: ${response.status}`,
      latencyMs: Date.now() - start,
    };
  }

  const raw = await response.json();
  const masked = maskPIIInObject(raw);

  return {
    success: true,
    data: masked,
    latencyMs: Date.now() - start,
  };
}

// Wraps Datadog results for safe prompt insertion
export function formatLogsForPrompt(logs: unknown): string {
  return wrapExternalDataForPrompt(JSON.stringify(logs).slice(0, 6000), 'datadog_logs');
}
