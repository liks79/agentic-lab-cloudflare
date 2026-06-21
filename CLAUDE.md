# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Local Wrangler dev server (miniflare)
npm run type-check       # TypeScript type check (no emit)
npm test                 # Run Vitest once
npm run test:watch       # Vitest in watch mode
npm run lint             # ESLint on src/

npm run deploy           # Deploy to production
npm run deploy:staging   # Deploy to staging environment

npm run db:migrate:local   # Apply D1 migrations to local miniflare DB
npm run db:migrate:remote  # Apply D1 migrations to production D1

# One-off setup (run once per environment)
wrangler d1 create sre-agent-db
wrangler kv namespace create CONFIG_KV
wrangler r2 bucket create sre-agent-incident-docs
wrangler queues create sre-agent-incidents
npm run vectorize:create

# Secrets — never put values in wrangler.toml
wrangler secret put <KEY_NAME>   # e.g. ANTHROPIC_API_KEY, SLACK_BOT_TOKEN

# Tail live logs
wrangler tail --env production

# Query D1 ad-hoc
wrangler d1 execute sre-agent-db --command "SELECT ..." --remote
```

Local environment variables go in `.dev.vars` (copied from `.env.example`). This file is gitignored.

## Architecture

### Request Flow

```
Webhook (PagerDuty / Datadog / Slack)
  → Workers Ingress: HMAC-SHA256 verify + rate limit + PII mask
  → Cloudflare Queue (incident event)
  → Queue Consumer → Durable Object (IncidentSession)
  → ReAct Agent Orchestrator (loop: Thought → Tool Call → Observe)
  → AI Gateway (Workers AI primary, Claude Sonnet fallback)
  → Tools: Datadog, CloudWatch, Vectorize RAG, GitHub, ArgoCD, Slack, Jira
  → D1 audit log + R2 RCA doc + Vectorize indexing
```

Two export paths from `src/index.ts`: `fetch` (Hono router for HTTP) and `queue` (batch processor for the Queues consumer). The `IncidentSession` Durable Object class is also re-exported from `src/index.ts` — this is required by the Wrangler DO binding.

### Key Architectural Patterns

**ReAct agent loop** (`src/agents/orchestrator.ts`): Each cycle calls the LLM with a prompt containing incident context + tool descriptions + step history, parses a `{thought, action, actionInput, confidence}` JSON response, executes the named tool, and appends the observation. Max 10 steps; `FINISH` action terminates the loop. JSON parse failure → immediate escalation (fail-safe).

**Durable Objects for session state**: `IncidentSession` (in `src/agents/incident-session.ts`) stores the `AgentContext` struct per incident. DO is addressed by `{tenantId}::{incidentId}` — this is what enforces cross-incident isolation. All reads/writes within a loop iteration go through the same DO stub to avoid race conditions.

**LLM routing** (`src/llm/gateway.ts`): Steps 0–1 use Workers AI (Llama 3.1 70B, cheap). Steps 2+ or when confidence is low fall back to Claude Sonnet via AI Gateway proxy. All calls route through the AI Gateway endpoint for audit logging and cost tracking.

**Tool registry pattern** (`src/tools/registry.ts`): Tools are registered as `{ name, description, handler }` entries. The orchestrator calls `tools.call(name, input)` — it never imports tool modules directly. Adding a new tool requires only adding an entry to `buildToolRegistry()`.

**Tenant isolation**: `getTenantId()` in `src/middleware/tenant.ts` extracts the tenant from the CF Access JWT claim (header). D1 queries must always use parameterized `WHERE tenant_id = ?`. Vectorize queries always include `filter: { tenantId }`. DO namespace includes `tenantId` as a prefix.

**Prompt injection defense** (`src/security/prompt-guard.ts`): External data (log content, alert descriptions) is wrapped in `<external_data label="...">` tags before insertion into prompts. The system prompt instructs the model to never follow instructions inside those tags. `guardExternalInput()` also regex-scans for known injection patterns and sanitizes.

**PII masking** (`src/middleware/pii-mask.ts`): Applied at ingress (before queueing) and before any LLM call. Covers emails, phone numbers, card numbers, AWS keys, GitHub PATs, Slack tokens. Call `maskPII(string)` or `maskPIIInObject(object)`.

**Human-in-the-loop**: The orchestrator calls `sendSlackApprovalRequest()` for any tool where `requiresApproval: true` (deploy_rollback, create_pr for review, traffic_block). This is enforced in the tool registry, not by LLM policy.

### Env / Bindings

All Cloudflare bindings and secrets are typed in `src/types.ts` as the `Env` interface. `wrangler.toml` declares bindings but contains no secret values. The `[vars]` section holds non-secret configuration (`MAX_AGENT_STEPS`, `RCA_CONFIDENCE_THRESHOLD`, model names).

### D1 Schema

Five tables in `src/db/migrations/001_initial.sql`:
- `incidents` — one row per incident, tracks lifecycle status and MTTR
- `agent_actions` — immutable step log (INSERT only; `UNIQUE (incident_id, step_number)`)
- `llm_calls` — token count + cost tracking per LLM invocation
- `approval_events` — human approve/reject decisions with Slack user ID
- `rca_documents` — R2 key pointers for generated RCA docs + Vectorize index status

All tables have a `tenant_id` column and index. Every query must filter by tenant.

### Eval Framework

`evals/run_eval.py` sends incidents to `/webhook/eval`, measures keyword F1 against ground truth `rca_keywords`, and records MTTR. Scenarios are JSON files in `evals/scenarios/`. Results (may contain incident data) are gitignored. Run with `EVAL_API_KEY=<key> python evals/run_eval.py --env staging`.
