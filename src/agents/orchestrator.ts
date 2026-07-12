import { callLLM } from '../llm/gateway';
import { buildToolRegistry, type ToolRegistry } from '../tools/registry';
import { wrapExternalDataForPrompt } from '../security/prompt-guard';
import { maskPIIInObject } from '../middleware/pii-mask';
import { buildDurableObjectId } from '../middleware/tenant';
import type { Env, IncidentEvent, AgentContext, AgentStep, RCAHypothesis } from '../types';
import { TRIAGE_SYSTEM_PROMPT, RCA_SYSTEM_PROMPT } from '../llm/prompts';

export interface ReActResponse {
  thought: string;
  action: 'FINISH' | string;
  actionInput: Record<string, unknown>;
  confidence?: number;
}

export async function runIncidentAgent(event: IncidentEvent, env: Env): Promise<void> {
  const maxSteps = parseInt(env.MAX_AGENT_STEPS, 10) || 10;
  const confidenceThreshold = parseFloat(env.RCA_CONFIDENCE_THRESHOLD) || 0.85;

  // Initialize or load session from Durable Object
  const doId = env.INCIDENT_SESSION.idFromName(
    buildDurableObjectId(event.tenantId, event.id),
  );
  const session = env.INCIDENT_SESSION.get(doId);

  const initCtx: AgentContext = {
    incidentId: event.id,
    tenantId: event.tenantId,
    steps: [],
    observations: [],
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const existingCtx = await getSessionContext(session);
  let ctx: AgentContext = existingCtx ?? initCtx;

  await saveSessionContext(session, ctx);

  const tools: ToolRegistry = buildToolRegistry(env, event.tenantId);

  // ReAct loop
  for (let step = ctx.steps.length; step < maxSteps; step++) {
    const systemPrompt = step === 0 ? TRIAGE_SYSTEM_PROMPT : RCA_SYSTEM_PROMPT;
    const userMessage = buildReActPrompt(event, ctx, tools);

    const llmResponse = await callLLM(env, {
      model: step < 2 ? env.WORKERS_AI_MODEL : env.LLM_FALLBACK_MODEL,
      systemPrompt,
      userMessage,
      maxTokens: 1024,
      temperature: 0.1,
    });

    const parsed = parseReActResponse(llmResponse.content);
    if (!parsed) {
      await escalate(env, event, ctx, 'Failed to parse LLM response');
      break;
    }

    const agentStep: AgentStep = {
      stepNumber: step,
      thought: parsed.thought,
      action: parsed.action,
      actionInput: parsed.actionInput,
      timestamp: Date.now(),
    };

    if (parsed.action === 'FINISH') {
      const hypothesis: RCAHypothesis = {
        title: String(parsed.actionInput.title ?? 'Incident RCA'),
        description: String(parsed.actionInput.description ?? ''),
        evidence: (parsed.actionInput.evidence as string[]) ?? [],
        confidence: parsed.confidence ?? 0,
        suggestedMitigations: [],
      };

      if ((parsed.confidence ?? 0) < confidenceThreshold) {
        ctx.status = 'pending_approval';
        ctx.currentHypothesis = hypothesis;
        agentStep.observation = 'Low confidence — escalating to on-call';
        ctx.steps.push(agentStep);
        await saveSessionContext(session, ctx);
        await escalate(env, event, ctx, 'Low confidence RCA — human review required');
        return;
      }

      ctx.currentHypothesis = hypothesis;
      ctx.status = 'pending_approval';
      ctx.steps.push(agentStep);
      await saveSessionContext(session, ctx);
      await sendRCAToSlack(env, event, hypothesis);
      return;
    }

    // Execute tool call
    const toolResult = await tools.call(parsed.action, parsed.actionInput);
    const safeResult = maskPIIInObject(toolResult);
    agentStep.observation = JSON.stringify(safeResult).slice(0, 2000);

    ctx.steps.push(agentStep);
    ctx.observations.push({
      source: parsed.action,
      data: safeResult,
      timestamp: Date.now(),
    });

    await saveSessionContext(session, ctx);

    // Persist each step to D1 for audit trail
    await persistStepToD1(env, event, agentStep);
  }

  // Exceeded max steps
  await escalate(env, event, ctx, 'Max agent steps exceeded without resolution');
}

function buildReActPrompt(event: IncidentEvent, ctx: AgentContext, tools: ToolRegistry): string {
  const toolDescs = tools.descriptions
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  const history = ctx.steps
    .map(
      (s) =>
        `Step ${s.stepNumber}:\nThought: ${s.thought}\nAction: ${s.action}\nInput: ${JSON.stringify(s.actionInput)}\nObservation: ${s.observation ?? 'pending'}`,
    )
    .join('\n\n');

  const incidentData = wrapExternalDataForPrompt(
    JSON.stringify({ title: event.title, description: event.description, service: event.service, severity: event.severity }),
    'incident',
  );

  return `${incidentData}

Available tools:
${toolDescs}

History:
${history || 'No steps taken yet.'}

Respond in JSON format:
{
  "thought": "<your reasoning>",
  "action": "<tool name or FINISH>",
  "actionInput": { ... },
  "confidence": <0.0-1.0, required when action=FINISH>
}`;
}

export function parseReActResponse(content: string): ReActResponse | null {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as ReActResponse;
  } catch {
    return null;
  }
}

async function escalate(env: Env, event: IncidentEvent, ctx: AgentContext, reason: string): Promise<void> {
  ctx.status = 'escalated';
  const { notifySlack } = await import('../tools/slack');
  await notifySlack(env, {
    channel: env.SLACK_INCIDENT_CHANNEL_ID,
    text: `*[ESCALATION]* Incident \`${event.id}\` requires human attention.\nReason: ${reason}\nService: ${event.service} | Severity: ${event.severity}`,
  });
}

async function sendRCAToSlack(env: Env, event: IncidentEvent, rca: RCAHypothesis): Promise<void> {
  const { notifySlack } = await import('../tools/slack');
  const mitigations = rca.suggestedMitigations
    .map((m) => `• ${m.description} (risk: ${m.riskLevel}, ETA: ${m.estimatedRecoveryMinutes}min)`)
    .join('\n');

  await notifySlack(env, {
    channel: env.SLACK_INCIDENT_CHANNEL_ID,
    text: `*[SRE Agent RCA]* Incident \`${event.id}\`
*Service:* ${event.service} | *Severity:* ${event.severity}
*Root Cause:* ${rca.title}
*Confidence:* ${(rca.confidence * 100).toFixed(0)}%

*Evidence:*
${rca.evidence.map((e) => `• ${e}`).join('\n')}

*Suggested Mitigations:*
${mitigations || 'None identified — escalating to on-call'}`,
  });
}

async function persistStepToD1(env: Env, event: IncidentEvent, step: AgentStep): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO agent_actions (incident_id, tenant_id, step_number, action, action_input, observation, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      event.id,
      event.tenantId,
      step.stepNumber,
      step.action,
      JSON.stringify(step.actionInput).slice(0, 4000),
      (step.observation ?? '').slice(0, 4000),
      step.timestamp,
    )
    .run();
}

async function getSessionContext(stub: DurableObjectStub): Promise<AgentContext | null> {
  const res = await stub.fetch('http://do/context');
  if (!res.ok) return null;
  return res.json<AgentContext | null>();
}

async function saveSessionContext(stub: DurableObjectStub, ctx: AgentContext): Promise<void> {
  await stub.fetch('http://do/context', {
    method: 'PUT',
    body: JSON.stringify(ctx),
    headers: { 'Content-Type': 'application/json' },
  });
}
