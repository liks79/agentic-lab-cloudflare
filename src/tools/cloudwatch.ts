import type { Env, ToolResult } from '../types';

interface MetricsInput {
  namespace: string;
  metricName: string;
  startTime: string;
  endTime: string;
  dimensions?: Array<{ Name: string; Value: string }>;
  period?: number;
}

export async function queryCloudWatchMetrics(env: Env, input: MetricsInput): Promise<ToolResult> {
  const start = Date.now();

  // AWS Signature V4 signing is complex; in production use aws4fetch or a Lambda proxy
  // This implementation uses a simplified approach for portfolio demonstration
  const region = env.AWS_REGION;
  const endpoint = `https://monitoring.${region}.amazonaws.com/`;

  const params = new URLSearchParams({
    Action: 'GetMetricStatistics',
    Version: '2010-08-01',
    Namespace: input.namespace,
    MetricName: input.metricName,
    StartTime: input.startTime,
    EndTime: input.endTime,
    Period: String(input.period ?? 60),
    Statistics: 'Average,Maximum,SampleCount',
  });

  input.dimensions?.forEach((dim, i) => {
    params.set(`Dimensions.member.${i + 1}.Name`, dim.Name);
    params.set(`Dimensions.member.${i + 1}.Value`, dim.Value);
  });

  // Note: real implementation requires AWS Signature V4 (see docs/runbook.md)
  const response = await fetch(`${endpoint}?${params.toString()}`, {
    method: 'GET',
    headers: {
      'X-Amz-Date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z',
      // Authorization header would contain Signature V4 in production
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    return {
      success: false,
      error: `CloudWatch API error: ${response.status}`,
      latencyMs: Date.now() - start,
    };
  }

  const text = await response.text();
  return { success: true, data: { xml: text.slice(0, 4000) }, latencyMs: Date.now() - start };
}
