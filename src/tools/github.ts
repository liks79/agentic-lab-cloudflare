import type { Env, ToolResult } from '../types';

interface PRInput {
  title: string;
  body: string;
  branch: string;
  files: Array<{ path: string; content: string }>;
  baseBranch?: string;
}

export async function createGitHubPR(env: Env, input: PRInput): Promise<ToolResult> {
  const start = Date.now();
  const { GITHUB_TOKEN: token, GITHUB_REPO_OWNER: owner, GITHUB_REPO_NAME: repo } = env;
  const base = input.baseBranch ?? 'main';
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  // 1. Get base branch SHA
  const refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${base}`,
    { headers, signal: AbortSignal.timeout(10000) },
  );
  if (!refRes.ok) {
    return { success: false, error: `Failed to get base ref: ${refRes.status}`, latencyMs: Date.now() - start };
  }
  const refData = (await refRes.json()) as { object: { sha: string } };
  const baseSha = refData.object.sha;

  // 2. Create branch
  const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: baseSha }),
    signal: AbortSignal.timeout(10000),
  });
  if (!branchRes.ok && branchRes.status !== 422) {
    return { success: false, error: `Failed to create branch: ${branchRes.status}`, latencyMs: Date.now() - start };
  }

  // 3. Commit files
  for (const file of input.files) {
    const encoded = btoa(unescape(encodeURIComponent(file.content)));
    await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `[SRE Agent] ${input.title}`,
        content: encoded,
        branch: input.branch,
      }),
      signal: AbortSignal.timeout(10000),
    });
  }

  // 4. Create PR
  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: input.title,
      body: `${input.body}\n\n---\n*Created automatically by SRE Agent*`,
      head: input.branch,
      base,
      draft: true,
    }),
    signal: AbortSignal.timeout(10000),
  });

  const prData = (await prRes.json()) as { html_url?: string; number?: number };
  return {
    success: prRes.ok,
    data: { prUrl: prData.html_url, prNumber: prData.number },
    latencyMs: Date.now() - start,
  };
}
