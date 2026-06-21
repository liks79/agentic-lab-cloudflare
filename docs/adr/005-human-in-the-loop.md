# ADR-005: Human-in-the-Loop Design for Destructive Actions

**Status**: Accepted  
**Date**: 2026-06-21

## Context

The agent can trigger production changes: deployment rollbacks, traffic blocks, config changes. Autonomous execution of these actions without human oversight poses significant risk.

## Decision

All actions with blast radius > 1 service or marked `requiresApproval: true` must go through the Slack approval workflow before execution. This is enforced at the tool layer, not by LLM policy.

## Approval Matrix

| Action | Autonomous | Requires Approval |
|--------|-----------|------------------|
| log_search | Yes | No |
| metrics_query | Yes | No |
| incident_history | Yes | No |
| notify_slack (read-only alert) | Yes | No |
| create_ticket | Yes | No |
| create_pr (draft) | Yes | No |
| create_pr (ready for review) | No | Yes |
| deploy_rollback | **Always** | **Yes** |
| traffic_block | **Always** | **Yes** |
| config_change (production) | **Always** | **Yes** |

## Implementation

The `requiresApproval` flag in `MitigationAction` is checked by the orchestrator before calling any tool. The `sendSlackApprovalRequest()` function sends an interactive message with Approve/Reject buttons. The Slack interaction webhook handler records the decision in D1's `approval_events` table before proceeding.

**Break-glass exception**: Emergency rollback (P1 with confirmed blast radius) can be approved by any on-call engineer; the decision is logged for post-incident review.

## Rationale

- GDPR Article 22: decisions with significant impact on people must not be fully automated
- Production incidents have caused major outages when automated rollbacks triggered at the wrong time
- Slack approval adds < 2 minutes to MTTR but eliminates a class of agent-caused incidents
- All approvals are immutably logged in D1 for audit purposes

## Consequences

- Requires Slack bot to have `chat:write` and interactive components enabled
- Approval timeout (30 minutes) → automatic escalation to senior on-call
- Rejected actions → agent attempts alternative mitigations if available
