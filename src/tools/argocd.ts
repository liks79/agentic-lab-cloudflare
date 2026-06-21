import type { Env, ToolResult } from '../types';

interface RollbackInput {
  application: string;
  revision?: string;
}

export async function triggerArgoRollback(env: Env, input: RollbackInput): Promise<ToolResult> {
  const start = Date.now();

  // ArgoCD REST API — rollback to a previous revision (or latest good)
  const url = `${env.ARGOCD_SERVER_URL}/api/v1/applications/${encodeURIComponent(input.application)}/rollback`;

  const body: Record<string, unknown> = { dryRun: false };
  if (input.revision) body.id = parseInt(input.revision, 10);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.ARGOCD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      success: false,
      error: `ArgoCD rollback failed: ${res.status} — ${text.slice(0, 200)}`,
      latencyMs: Date.now() - start,
    };
  }

  const data = await res.json();
  return { success: true, data, latencyMs: Date.now() - start };
}

export async function getArgoCDAppStatus(env: Env, application: string): Promise<ToolResult> {
  const start = Date.now();
  const res = await fetch(
    `${env.ARGOCD_SERVER_URL}/api/v1/applications/${encodeURIComponent(application)}`,
    {
      headers: { Authorization: `Bearer ${env.ARGOCD_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!res.ok) {
    return { success: false, error: `ArgoCD status check failed: ${res.status}`, latencyMs: Date.now() - start };
  }

  const data = (await res.json()) as Record<string, unknown>;
  const status = (data.status as Record<string, unknown>)?.health ?? {};
  return { success: true, data: { health: status }, latencyMs: Date.now() - start };
}
