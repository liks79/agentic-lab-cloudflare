import { z, type ZodTypeAny } from 'zod';
import type { Env, ToolResult } from '../types';
import { searchDatadogLogs } from './datadog';
import { queryCloudWatchMetrics } from './cloudwatch';
import { searchIncidentHistory } from './vectorize-search';
import { createGitHubPR } from './github';
import { triggerArgoRollback } from './argocd';
import { notifySlack, sendSlackApprovalRequest } from './slack';
import { createJiraTicket } from './jira';

const LogSearchInputSchema = z.object({
  query: z.string(),
  timeRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
  service: z.string().optional(),
});

const MetricsInputSchema = z.object({
  namespace: z.string(),
  metricName: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  dimensions: z.array(z.object({ Name: z.string(), Value: z.string() })).optional(),
  period: z.number().int().positive().optional(),
});

const HistorySearchInputSchema = z.object({
  query: z.string(),
  topK: z.number().int().positive().optional(),
});

const PRInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  branch: z.string(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  baseBranch: z.string().optional(),
});

const RollbackInputSchema = z.object({
  application: z.string(),
  revision: z.string().optional(),
});

const SlackMessageInputSchema = z.object({
  channel: z.string(),
  text: z.string(),
  blocks: z.array(z.unknown()).optional(),
});

const ApprovalRequestInputSchema = z.object({
  action: z.string(),
  description: z.string(),
  riskLevel: z.string(),
  incidentId: z.string().optional(),
});

const JiraTicketInputSchema = z.object({
  summary: z.string(),
  description: z.string(),
  priority: z.string(),
  incidentId: z.string(),
});

interface ToolDefinition {
  name: string;
  description: string;
  schema: ZodTypeAny;
  handler: (input: unknown) => Promise<ToolResult>;
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
      schema: LogSearchInputSchema,
      handler: (input) => searchDatadogLogs(env, input as { query: string; timeRange: { from: string; to: string }; service?: string }),
    },
    {
      name: 'metrics_query',
      description: 'Query AWS CloudWatch metrics. Input: { namespace: string, metricName: string, startTime: string, endTime: string }',
      schema: MetricsInputSchema,
      handler: (input) => queryCloudWatchMetrics(env, input as { namespace: string; metricName: string; startTime: string; endTime: string; dimensions?: Array<{ Name: string; Value: string }>; period?: number }),
    },
    {
      name: 'incident_history',
      description: 'Semantic search for similar past incidents. Input: { query: string, topK?: number }',
      schema: HistorySearchInputSchema,
      handler: (input) => searchIncidentHistory(env, tenantId, input as { query: string; topK?: number }),
    },
    {
      name: 'create_pr',
      description: 'Create a GitHub PR for a proposed fix. Input: { title: string, body: string, branch: string, files: Array<{path: string, content: string}> }',
      schema: PRInputSchema,
      handler: (input) => createGitHubPR(env, input as Parameters<typeof createGitHubPR>[1]),
    },
    {
      name: 'deploy_rollback',
      description: 'Trigger ArgoCD rollback to a previous revision. REQUIRES human approval. Input: { application: string, revision?: string }',
      schema: RollbackInputSchema,
      handler: (input) => triggerArgoRollback(env, input as { application: string; revision?: string }),
    },
    {
      name: 'notify_slack',
      description: 'Send a message to a Slack channel. Input: { channel: string, text: string }',
      schema: SlackMessageInputSchema,
      handler: (input) => notifySlack(env, input as { channel: string; text: string; blocks?: unknown[] }),
    },
    {
      name: 'request_approval',
      description: 'Send a Slack approval request for a high-risk action. Input: { action: string, description: string, riskLevel: string }',
      schema: ApprovalRequestInputSchema,
      handler: (input) => sendSlackApprovalRequest(env, input as { action: string; description: string; riskLevel: string; incidentId?: string }),
    },
    {
      name: 'create_ticket',
      description: 'Create or update a Jira incident ticket. Input: { summary: string, description: string, priority: string, incidentId: string }',
      schema: JiraTicketInputSchema,
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
      const parsed = tool.schema.safeParse(input);
      if (!parsed.success) {
        return {
          success: false,
          error: `Invalid input for ${name}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
          latencyMs: Date.now() - start,
        };
      }
      try {
        return await tool.handler(parsed.data);
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
