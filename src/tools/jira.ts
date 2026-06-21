import type { Env, ToolResult } from '../types';

interface JiraTicketInput {
  summary: string;
  description: string;
  priority: string;
  incidentId: string;
}

export async function createJiraTicket(env: Env, input: JiraTicketInput): Promise<ToolResult> {
  const start = Date.now();
  const auth = btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`);

  const priorityMap: Record<string, string> = {
    P1: 'Highest',
    P2: 'High',
    P3: 'Medium',
    P4: 'Low',
  };

  const res = await fetch(`${env.JIRA_BASE_URL}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      fields: {
        project: { key: env.JIRA_PROJECT_KEY },
        summary: input.summary.slice(0, 254),
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: input.description.slice(0, 32767) }],
            },
          ],
        },
        issuetype: { name: 'Incident' },
        priority: { name: priorityMap[input.priority] ?? 'Medium' },
        labels: ['sre-agent', `incident-${input.incidentId}`],
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  const data = (await res.json()) as { key?: string; id?: string };
  return {
    success: res.ok,
    data: { key: data.key, url: data.key ? `${env.JIRA_BASE_URL}/browse/${data.key}` : undefined },
    latencyMs: Date.now() - start,
  };
}
