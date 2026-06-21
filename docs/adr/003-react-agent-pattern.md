# ADR-003: ReAct Pattern for Agent Orchestration

**Status**: Accepted  
**Date**: 2026-06-21

## Context

The incident response workflow requires multi-step reasoning: gather logs → query metrics → search history → form hypothesis → plan mitigation. The agent must interleave reasoning with tool execution.

## Decision

Implement the ReAct (Reasoning + Acting) pattern with a maximum step limit of 10.

## Rationale

**ReAct advantages for SRE incidents**:
- Transparent reasoning trace: each `thought` field is logged to D1, enabling post-incident review of agent decisions
- Adaptive tool selection: agent decides which logs to query based on previous observations
- Self-correcting: agent can change hypotheses if early evidence is contradicted by later data
- Auditable: on-call engineers can review the reasoning chain before approving actions

**Alternatives considered**:
- Chain-of-thought (CoT) without tools: cannot fetch live data
- Plan-and-execute: less adaptive to surprising observations
- LangGraph/LangChain: adds Python dependency, harder to deploy on Workers runtime

**Max steps = 10**:
- P1 incidents: typically resolved in 4-6 steps
- Hard cap prevents infinite loops and controls cost
- Exceeded max → automatic escalation to human (not failure)

## Consequences

- Response format must be strict JSON (`{"thought":..., "action":..., "actionInput":...}`)
- JSON parse failures trigger immediate escalation (fail-safe over silent failure)
- Each step's latency compounds: 10 steps × 3s avg = 30s max agent runtime (well within P1 MTTR targets)
