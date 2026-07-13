# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run commit           # Commitizen interactive prompt (conventional commits)

npm run dev              # Local Wrangler dev server (miniflare)
npm run type-check       # TypeScript type check (no emit)
npm test                 # Run Vitest once
npm run test:watch       # Vitest in watch mode
npm run lint             # ESLint on src/

npm run deploy           # Deploy to production
npm run deploy:staging   # Deploy to staging environment

npm run db:migrate:local   # Apply D1 migrations to local miniflare DB
npm run db:migrate:remote  # Apply D1 migrations to production D1
npm run db:migrate:staging # Apply D1 migrations to staging D1 (--env staging)
npm run secrets:list       # List configured secret names

# One-off setup (run once per environment)
wrangler d1 create sre-agent-db
wrangler kv namespace create CONFIG_KV
wrangler r2 bucket create sre-agent-incident-docs
wrangler queues create sre-agent-incidents
wrangler queues create sre-agent-incidents-dlq   # dead-letter queue (consumer references it)
npm run vectorize:create

# Secrets — never put values in wrangler.toml
wrangler secret put <KEY_NAME>   # e.g. ANTHROPIC_API_KEY, SLACK_BOT_TOKEN

# Tail live logs
wrangler tail --env production

# Query D1 ad-hoc
wrangler d1 execute sre-agent-db --command "SELECT ..." --remote
```

Local environment variables go in `.dev.vars` (copied from `.env.example`). This file is gitignored.

## Git Workflow

**Never commit directly to `main`.** All work happens on a feature branch and lands via PR:

```bash
git checkout -b <type>/<short-description>   # e.g. feat/runbook-lookup-tool, fix/webhook-hmac-check
# ... make changes, commit ...
git push -u origin <branch>
gh pr create --fill                          # or with an explicit --title/--body
```

Branch prefixes mirror the commit type below (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`, `perf/`).

Commits follow the **Conventional Commits** spec, enforced interactively via commitizen (`npm run commit`). When committing non-interactively (e.g. `git commit -m`), still hand-format the message to match cz-conventional-changelog's convention:

```
<type>(<optional scope>): <short summary>

<optional body>
```

Common types: `feat` · `fix` · `docs` · `chore` · `refactor` · `test` · `perf`.

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

**LLM routing** (`src/llm/gateway.ts`): The orchestrator picks the model by step index — `step < 2 ? WORKERS_AI_MODEL : LLM_FALLBACK_MODEL`. So steps 0–1 use Workers AI (Llama 3.1 70B, cheap) and steps 2+ use Claude Sonnet. This is a fixed step threshold, not confidence-driven (low confidence affects escalation at `FINISH`, not model choice). Step 0 uses `TRIAGE_SYSTEM_PROMPT`; steps 1+ use `RCA_SYSTEM_PROMPT`. All calls route through the AI Gateway endpoint for audit logging and cost tracking.

**Tool registry pattern** (`src/tools/registry.ts`): Tools are registered as `{ name, description, handler }` entries. The orchestrator calls `tools.call(name, input)` — it never imports tool modules directly. Adding a new tool requires only adding an entry to `buildToolRegistry()`. Registered tool names: `log_search` (Datadog), `metrics_query` (CloudWatch), `incident_history` (Vectorize RAG), `create_pr` (GitHub), `deploy_rollback` (ArgoCD), `notify_slack`, `request_approval`, `create_ticket` (Jira). `call()` wraps every handler in try/catch and returns a `ToolResult` (`{ success, error, latencyMs }`) — handlers never throw to the loop.

**Tenant isolation**: `getTenantId()` in `src/middleware/tenant.ts` extracts the tenant from the CF Access JWT claim (header). D1 queries must always use parameterized `WHERE tenant_id = ?`. Vectorize queries always include `filter: { tenantId }`. DO namespace includes `tenantId` as a prefix.

**Prompt injection defense** (`src/security/prompt-guard.ts`): External data (log content, alert descriptions) is wrapped in `<external_data label="...">` tags before insertion into prompts. The system prompt instructs the model to never follow instructions inside those tags. `guardExternalInput()` also regex-scans for known injection patterns and sanitizes.

**PII masking** (`src/middleware/pii-mask.ts`): Applied at ingress (before queueing) and before any LLM call. Covers emails, phone numbers, card numbers, AWS keys, GitHub PATs, Slack tokens. Call `maskPII(string)` or `maskPIIInObject(object)`.

**Human-in-the-loop**: Approval is currently **LLM-policy-driven, not hard-enforced**. High-risk tools flag it in their description text (e.g. `deploy_rollback` says "REQUIRES human approval"), and a dedicated `request_approval` tool sends a Slack approval request via `sendSlackApprovalRequest()`. The model is expected to call `request_approval` before a high-risk action, but the registry's `call()` does not block a tool if it skips that step. The `requiresApproval: boolean` field lives on the `MitigationAction` struct (part of the RCA output in `src/types.ts`), describing proposed mitigations — it is **not** read by the tool registry. Treat registry-level enforcement as a gap, not an existing guarantee.

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
