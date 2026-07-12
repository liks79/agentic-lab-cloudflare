---
description: Run type-check, unit tests, and lint; report a concise pass/fail summary
argument-hint: "[type-check|test|lint] (omit to run all three)"
---

Run the local verification suite for this repo (cloudflare-sre-agent).

Checks, in this order:
1. `npm run type-check`
2. `npm test`
3. `npm run lint`

If `$ARGUMENTS` names one or more of `type-check`, `test`, `lint`, run only those (in the order above). Otherwise run all three.

Rules:
- Run each check with Bash. Don't skip a later check just because an earlier one failed — run all requested checks and report every result.
- If a check passes, don't paste its output — one line is enough ("✅ type-check").
- If a check fails, show only the relevant error output (not the full log dump), and mark it "❌".
- End with a compact summary table: check → pass/fail. If everything passed, say so in one line and stop there — no further narration.
- Do not attempt to fix any failure unless the user asks — this command only reports status.
