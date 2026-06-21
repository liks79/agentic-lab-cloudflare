# Security Review

## Threat Model

**System**: SRE Incident Response Agent on Cloudflare Workers  
**Threat actors**: External attackers via webhook endpoints, malicious log content (prompt injection), compromised SaaS integrations

---

## Authentication & Authorization

### Webhook Ingress
- **PagerDuty**: HMAC-SHA256 signature verification (`X-PagerDuty-Signature: v1=<hex>`)
- **Datadog**: Bearer token verification (`Authorization: Bearer <DD_API_KEY>`)
- **Slack**: Request timestamp + HMAC-SHA256 (`X-Slack-Signature: v0=<hex>`), replay attack guard (5-minute window)

All signature verification uses `crypto.subtle` (constant-time comparison via WebCrypto API).

### API Access to External Services
All external API credentials are stored as **Workers Secrets** (AES-256 encrypted, never exposed in plaintext):
```
wrangler secret put PAGERDUTY_WEBHOOK_SECRET
wrangler secret put DATADOG_API_KEY
wrangler secret put SLACK_BOT_TOKEN
wrangler secret put GITHUB_TOKEN
wrangler secret put ARGOCD_TOKEN
```

Never commit `.dev.vars`, `.env`, or any file containing real credentials.

### Least Privilege Principles
- GitHub token: fine-grained PAT with `contents:read` + `pull_requests:write` only
- ArgoCD token: service account with `applications:get` + `applications/rollback:create` only
- Datadog app key: logs:read + metrics:read (no write access)

---

## Tenant Isolation

### Durable Objects
Incident sessions are namespaced as `{tenant_id}::{incident_id}` — cross-tenant access is impossible without knowing the exact namespace string.

### D1 Database
All queries include `WHERE tenant_id = ?` (parameterized). Row-level filtering is enforced at the application layer (no D1 native RLS in current API, so all queries must go through `buildD1TenantFilter()`).

### Vectorize
Each tenant's incident embeddings are tagged with `{ tenantId }` metadata filter in every query. Namespace-level isolation is planned for larger deployments.

---

## Prompt Injection Defense

External data (log content, alert descriptions, error messages) may contain adversarial instructions. Defense layers:

1. **Boundary tags**: All external data is wrapped in `<external_data label="...">` tags in the prompt. System prompt instructs the model to never follow instructions inside these tags.

2. **Pattern detection** (`src/security/prompt-guard.ts`): Regex detection of known injection patterns:
   - `ignore previous instructions`
   - `system:` prefix
   - `<system>` / `[system]` tags
   - `act as DAN` / jailbreak patterns

3. **Sanitization**: HTML/XML tag stripping, hard cap at 8000 characters, `[INST]` marker removal.

4. **High-risk action gates**: Regardless of LLM output, `deploy_rollback` and `create_pr` always require explicit human approval via Slack — the agent cannot bypass this.

---

## PII Protection

### Detection & Masking (`src/middleware/pii-mask.ts`)
Applied to all external data before LLM submission and before D1 storage:
- Email addresses → `[EMAIL]`
- Phone numbers → `[PHONE]`
- Credit card numbers → `[CARD]`
- SSNs → `[SSN]`
- AWS access keys → `[AWS_KEY]`
- GitHub PATs → `[GITHUB_PAT]`
- Slack tokens → `[SLACK_TOKEN]`
- Generic credential patterns → `[REDACTED_CREDENTIAL]`

### Data Retention
- Log snapshots in R2: 30-day lifecycle deletion policy
- D1 `agent_actions`: retain 90 days, then archive to R2
- Vectorize embeddings: retained indefinitely (no PII in embedding vectors)

---

## Rate Limiting

```toml
# wrangler.toml
[[unsafe.bindings]]
name = "RATE_LIMITER"
type = "ratelimit"
simple = { limit = 100, period = 60 }
```

Per-source limits enforced at Workers ingress:
- PagerDuty: 100 requests/minute
- Datadog: 100 requests/minute
- Slack: 50 requests/minute

---

## WAF Configuration (Recommended for Production)

Configure via Cloudflare dashboard or Terraform:
```
Security Level: High
Challenge Passage: 30 minutes
Bot Fight Mode: ON
OWASP Core Ruleset: Paranoia Level 2
Rate Limiting: /webhook/* — 200 req/min per IP
```

---

## Secret Rotation

Rotate all secrets every 90 days minimum:
1. Generate new secret in source system (PagerDuty, Datadog, etc.)
2. `wrangler secret put <KEY_NAME>` (update atomically)
3. Update in staging first, verify, then production
4. Revoke old secret in source system

GitHub Actions secrets: rotate `CLOUDFLARE_API_TOKEN` every 90 days via Cloudflare dashboard.

---

## OWASP Top 10 Assessment

| Risk | Mitigation |
|------|-----------|
| A01 Broken Access Control | Tenant isolation + Cloudflare Access JWT for dashboard |
| A02 Cryptographic Failures | WebCrypto for HMAC, Workers Secrets for storage, TLS enforced |
| A03 Injection | Parameterized D1 queries, prompt boundary tags, input sanitization |
| A04 Insecure Design | Human-in-the-loop for all destructive actions |
| A05 Security Misconfiguration | `.env.example` pattern, no secrets in `wrangler.toml` |
| A06 Vulnerable Components | `npm audit` in CI, Dependabot enabled |
| A07 Auth Failures | HMAC verification + replay guard, no session tokens |
| A08 Software Integrity Failures | GitHub Actions pinned to commit SHA, OIDC for CF deploy |
| A09 Logging Failures | D1 immutable audit log + AI Gateway request archive |
| A10 SSRF | External API calls use fixed known endpoints, no user-controlled URLs |
