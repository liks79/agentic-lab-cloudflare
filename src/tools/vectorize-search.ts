import type { Env, ToolResult } from '../types';

interface HistorySearchInput {
  query: string;
  topK?: number;
}

export async function searchIncidentHistory(
  env: Env,
  tenantId: string,
  input: HistorySearchInput,
): Promise<ToolResult> {
  const start = Date.now();
  const topK = input.topK ?? 3;

  // Generate embedding for the query
  const embeddingResult = await env.AI.run(
    env.EMBEDDING_MODEL as BaseAiTextEmbeddingsModels,
    { text: [input.query] },
  );

  const vector = embeddingResult.data?.[0];
  if (!vector) {
    return { success: false, error: 'Failed to generate embedding', latencyMs: Date.now() - start };
  }

  // Search Vectorize with tenant namespace filter
  const results = await env.INCIDENT_VECTORS.query(vector, {
    topK,
    filter: { tenantId },
    returnValues: false,
    returnMetadata: 'all',
  });

  const incidents = results.matches.map((m) => ({
    id: m.id,
    score: m.score,
    metadata: m.metadata,
  }));

  return { success: true, data: { incidents }, latencyMs: Date.now() - start };
}

export async function indexIncident(
  env: Env,
  tenantId: string,
  incidentId: string,
  text: string,
  metadata: Record<string, string | number | boolean>,
): Promise<void> {
  const embeddingResult = await env.AI.run(
    env.EMBEDDING_MODEL as BaseAiTextEmbeddingsModels,
    { text: [text] },
  );

  const vector = embeddingResult.data?.[0];
  if (!vector) throw new Error('Embedding failed');

  await env.INCIDENT_VECTORS.insert([
    {
      id: `${tenantId}::${incidentId}`,
      values: vector,
      metadata: { tenantId, incidentId, ...metadata },
    },
  ]);
}
