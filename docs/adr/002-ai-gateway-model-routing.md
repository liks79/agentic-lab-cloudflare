# ADR-002: AI Gateway for LLM Routing and Cost Control

**Status**: Accepted  
**Date**: 2026-06-21

## Context

The agent needs to call LLMs for triage, RCA generation, and mitigation planning. We need cost control, audit logging, and the ability to fall back to more capable models when needed.

## Decision

Route all LLM calls through Cloudflare AI Gateway with a two-tier model strategy:
- **Tier 1 (default)**: Workers AI — `@cf/meta/llama-3.1-70b-instruct`
- **Tier 2 (fallback)**: Claude Sonnet (via AI Gateway proxy) when confidence < 0.7

## Rationale

**AI Gateway benefits**:
- Automatic request/response logging to R2 (compliance audit trail at zero extra code)
- Per-tenant token budget enforcement without custom billing logic
- Single endpoint for model switching — no code changes when swapping models
- Caching for repeated prompts (runbook lookups hit cache 60%+ of the time)

**Workers AI as default**:
- ~$0.0001/1K tokens vs Claude at ~$0.003/1K — 30x cheaper
- Zero egress cost (compute stays within Cloudflare)
- Acceptable quality for structured log analysis and triage

**Claude fallback**:
- Complex multi-hop reasoning (e.g., correlating 5+ log sources)
- Code generation for PR content
- Triggered only when Workers AI confidence score < 0.7 or step > 5

## Consequences

- AI Gateway is a paid Cloudflare feature (included in Workers Paid plan)
- Anthropic API key must be managed as a Workers Secret
- Latency for Tier 2 calls adds ~500ms (acceptable for async agent loop)
- Token cost per incident: ~$0.05 average (Workers AI) vs ~$1.50 (Claude-only)
