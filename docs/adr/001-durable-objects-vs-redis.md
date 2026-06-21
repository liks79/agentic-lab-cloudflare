# ADR-001: Durable Objects for Incident Session State

**Status**: Accepted  
**Date**: 2026-06-21

## Context

Incident sessions require tracking multi-step ReAct agent state across multiple asynchronous tool calls. The state must be strongly consistent — two concurrent operations on the same incident must not create conflicting observations.

## Options Considered

1. **Cloudflare Durable Objects** (chosen)
2. Upstash Redis via HTTP
3. Workers KV (eventually consistent)
4. D1 SQLite

## Decision

Use Durable Objects for per-incident session state.

## Rationale

- **Strong consistency**: Each DO instance runs as a single-threaded JavaScript execution context. No distributed locks needed.
- **Zero network hops**: DO stub calls from Workers are in-process within Cloudflare's network (~1ms).
- **Stateful compute**: DO can run alarm() for cleanup without external schedulers.
- **Platform coherence**: Eliminates Upstash as an external dependency; everything stays within Cloudflare.

**Redis tradeoffs rejected**:
- Network round-trip to Upstash adds 20-50ms per step
- TTL management and distributed lock (SETNX + expiry) add complexity
- External dependency increases blast radius

**KV rejected**: Eventually consistent — unacceptable for step sequencing.

**D1 rejected for hot path**: D1 write latency (~50ms) is too high for per-step updates inside the ReAct loop.

## Consequences

- DO storage has a 1GB per-namespace limit (non-issue at portfolio scale)
- DO sessions are scoped to a single Cloudflare region by default (acceptable — incidents are tenant-specific)
- Cost: $0.20/million DO requests (negligible for SRE use case with low-frequency writes)
- Cleanup: alarm() set to 24h TTL prevents storage accumulation
