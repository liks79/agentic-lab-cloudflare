# ADR-004: Vectorize for Historical Incident RAG

**Status**: Accepted  
**Date**: 2026-06-21

## Context

Identifying similar past incidents is critical for rapid RCA. We need semantic search over 200+ historical incident summaries.

## Decision

Use Cloudflare Vectorize with `@cf/baai/bge-large-en-v1.5` embeddings (1024 dimensions, cosine similarity).

## Rationale

- **Zero-hop from Workers**: Vectorize is a binding, not an HTTP endpoint — search latency is ~5-15ms vs 50-150ms for Pinecone/Weaviate
- **Tenant isolation via metadata filter**: `{ tenantId }` filter prevents cross-tenant data leakage without separate indexes
- **Cost**: Vectorize free tier covers 30K vectors; 200 incidents × 5 chunks each = 1K vectors (well within free tier)
- **Embedding model**: `bge-large-en-v1.5` is available on Workers AI — no external embedding API call needed

**Pinecone rejected**: External HTTP dependency, ~100ms additional latency per search, monthly cost $70+ at production scale.

## Index Schema

```
vector: float32[1024]
metadata: {
  tenantId: string,
  incidentId: string,
  severity: string,
  service: string,
  resolvedAt: number,
  rootCause: string (truncated to 500 chars)
}
```

## Consequences

- Vectorize max 30K vectors on free tier (use Workers Paid for 10M+)
- Index is eventually consistent after insert (~seconds)
- `returnValues: false` in queries to save bandwidth (only metadata needed for RAG context)
