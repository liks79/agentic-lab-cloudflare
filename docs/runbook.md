# Runbook: SRE Agent Operations

## Initial Setup

### 1. Cloudflare Resources

```bash
# Create D1 database
wrangler d1 create sre-agent-db
# → copy database_id to wrangler.toml

# Apply migrations
npm run db:migrate:local  # local dev
npm run db:migrate:remote # production

# Create KV namespace
wrangler kv namespace create CONFIG_KV
# → copy id to wrangler.toml

# Create R2 bucket
wrangler r2 bucket create sre-agent-incident-docs

# Create Queues
wrangler queues create sre-agent-incidents
wrangler queues create sre-agent-incidents-dlq

# Create Vectorize index
npm run vectorize:create
```

### 2. Set Secrets

```bash
# Run for each secret — never put values in wrangler.toml
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put CF_AI_GATEWAY_ENDPOINT
wrangler secret put PAGERDUTY_WEBHOOK_SECRET
wrangler secret put DATADOG_API_KEY
wrangler secret put DATADOG_APP_KEY
wrangler secret put SLACK_BOT_TOKEN
wrangler secret put SLACK_SIGNING_SECRET
wrangler secret put SLACK_INCIDENT_CHANNEL_ID
wrangler secret put GITHUB_TOKEN
wrangler secret put GITHUB_REPO_OWNER
wrangler secret put GITHUB_REPO_NAME
wrangler secret put JIRA_BASE_URL
wrangler secret put JIRA_EMAIL
wrangler secret put JIRA_API_TOKEN
wrangler secret put ARGOCD_SERVER_URL
wrangler secret put ARGOCD_TOKEN
wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY
wrangler secret put AWS_REGION
```

### 3. Configure GitHub Actions

Add to repository secrets:
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with `Workers Scripts:Edit` permission
- `CLOUDFLARE_ACCOUNT_ID` — Your Cloudflare account ID
- `AGENT_BASE_URL` — Deployed Workers URL (for eval)
- `EVAL_API_KEY` — Secret key for the `/webhook/eval` endpoint

### 4. Deploy

```bash
# Local development
npm run dev

# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy
```

## Operational Procedures

### Checking Agent Status

```bash
# View recent logs
wrangler tail --env production

# Query D1 for active incidents
wrangler d1 execute sre-agent-db --command \
  "SELECT id, service, severity, status, received_at FROM incidents WHERE status='active' ORDER BY received_at DESC LIMIT 10" \
  --remote
```

### Investigating a Failed Incident

```bash
# Get full step history for an incident
wrangler d1 execute sre-agent-db --command \
  "SELECT step_number, action, observation FROM agent_actions WHERE incident_id='<ID>' ORDER BY step_number" \
  --remote
```

### Clearing a Stuck Durable Object

```bash
# Force-expire a stuck incident session via the DELETE endpoint
curl -X DELETE "https://cloudflare-sre-agent.workers.dev/admin/session/<INCIDENT_ID>" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

### AWS CloudWatch Authentication (Production)

The CloudWatch tool requires AWS Signature V4. Options:
1. **Lambda proxy** (recommended): Deploy a lightweight Lambda that accepts unsigned requests from Cloudflare Tunnel and signs CloudWatch calls internally
2. **aws4fetch library**: Use `aws4fetch` npm package for in-Worker Signature V4 signing

See [cloudwatch.ts](../src/tools/cloudwatch.ts) for the integration point.

## Secret Rotation Procedure

1. Generate new secret in source system
2. `wrangler secret put <KEY_NAME>` (new value)
3. Verify in staging with a test webhook
4. Revoke old secret in source system
5. Record rotation date in your secrets management system

## Observability

### Key Metrics to Monitor

| Metric | Query |
|--------|-------|
| Active incidents | `SELECT COUNT(*) FROM incidents WHERE status='active'` |
| Avg MTTR (last 7d) | `SELECT AVG(mttr_seconds)/60 FROM incidents WHERE resolved_at > unixepoch()-604800` |
| LLM cost (daily) | `SELECT SUM(input_tokens+output_tokens) FROM llm_calls WHERE timestamp > unixepoch()-86400` |
| Escalation rate | `SELECT COUNT(*) FROM incidents WHERE status='escalated'` |

### Wrangler Analytics

```bash
wrangler analytics --env production
```
