import type { Env, ToolResult } from '../types';
import { searchDatadogLogs } from './datadog';
import { queryCloudWatchMetrics } from './cloudwatch';
import { searchIncidentHistory } from './vectorize-search';
import { createGitHubPR } from './github';
import { triggerArgoRollback } from './argocd';
import { notifySlack, sendSlackApprovalRequest } from './slack';
import { createJiraTicket } from './jira';

export interface ToolDefinition {
  name: string;
  description: string;
  handler: (input: Record<string, unknown>, tenantId: string) => Promise<ToolResult>;
}

export interface ToolRegistry {
  descriptions: Array<{ name: string; description: string }>;
  call: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
}

export function buildToolRegistry(env: Env, tenantId: string): ToolRegistry {
  const tools: ToolDefinition[] = [
    {
      name: 'log_search',
      description: 'Search Datadog logs. Input: { query: string, timeRange: { from: string, to: string }, service?: string }',
      handler: (input) => searchDatadogLogs(env, input as { query: string; timeRange: { from: string; to: string }; service?: string }),
    },
    {
      name: 'metrics_query',
      description: 'Query AWS CloudWatch metrics. Input: { namespace: string, metricName: string, startTime: string, endTime: string }',
      handler: (input) => queryCloudWatchMetrics(env, input as { namespace: string; metricName: string; startTime: string; endTime: string }),
    },
    {
      name: 'incident_history',
      description: 'Semantic search for similar past incidents. Input: { query: string, topK?: number }',
      handler: (input) => searchIncidentHistory(env, tenantId, input as { query: string; topK?: number }),
    },
    {
      name: 'create_pr',
      description: 'Create a GitHub PR for a proposed fix. Input: { title: string, body: string, branch: string, files: Array<{path: string, content: string}> }',
      handler: (input) => createGitHubPR(env, input as Parameters<typeof createGitHubPR>[1]),
    },
    {
      name: 'deploy_rollback',
      description: 'Trigger ArgoCD rollback to a previous revision. REQUIRES human approval. Input: { application: string, revision?: string }',
      handler: (input) => triggerArgoRollback(env, input as { application: string; revision?: string }),
    },
    {
      name: 'notify_slack',
      description: 'Send a message to a Slack channel. Input: { channel: string, text: string }',
      handler: (input) => notifySlack(env, input as { channel: string; text: string }),
    },
    {
      name: 'request_approval',
      description: 'Send a Slack approval request for a high-risk action. Input: { action: string, description: string, riskLevel: string }',
      handler: (input) => sendSlackApprovalRequest(env, input as { action: string; description: string; riskLevel: string }),
    },
    {
      name: 'create_ticket',
      description: 'Create or update a Jira incident ticket. Input: { summary: string, description: string, priority: string, incidentId: string }',
      handler: (input) => createJiraTicket(env, input as Parameters<typeof createJiraTicket>[1]),
    },
  ];

  return {
    descriptions: tools.map((t) => ({ name: t.name, description: t.description })),
    call: async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        return { success: false, error: `Unknown tool: ${name}`, latencyMs: 0 };
      }
      const start = Date.now();
      try {
        return await tool.handler(input, tenantId);
      } catch (err) {
        return {
          success: false,
          error: String(err instanceof Error ? err.message : err).slice(0, 500),
          latencyMs: Date.now() - start,
        };
      }
    },
  };
}
