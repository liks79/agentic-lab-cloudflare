import type { Env, LLMRequest, LLMResponse } from '../types';

type WorkersAITextGenerationModel = {
  [Name in keyof AiModels]: AiModels[Name] extends BaseAiTextGeneration ? Name : never;
}[keyof AiModels];

export async function callLLM(env: Env, req: LLMRequest): Promise<LLMResponse> {
  const start = Date.now();

  // Route through AI Gateway for audit logging + cost control
  const gatewayEndpoint = env.CF_AI_GATEWAY_ENDPOINT;
  const isWorkersAI = req.model.startsWith('@cf/');

  if (isWorkersAI) {
    return callWorkersAI(env, req, start);
  }

  // External model (Claude, GPT-4o) via AI Gateway proxy
  return callExternalViaGateway(env, req, gatewayEndpoint, start);
}

async function callWorkersAI(env: Env, req: LLMRequest, start: number): Promise<LLMResponse> {
  const response = await env.AI.run(req.model as WorkersAITextGenerationModel, {
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: req.userMessage },
    ],
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature ?? 0.1,
  });

  const content = typeof response === 'object' && 'response' in response
    ? String(response.response ?? '')
    : '';

  return {
    content,
    model: req.model,
    inputTokens: 0, // Workers AI doesn't expose token counts in all bindings
    outputTokens: 0,
    latencyMs: Date.now() - start,
  };
}

async function callExternalViaGateway(
  env: Env,
  req: LLMRequest,
  gatewayEndpoint: string,
  start: number,
): Promise<LLMResponse> {
  // Determine provider from model name
  const isAnthropic = req.model.startsWith('claude');
  const provider = isAnthropic ? 'anthropic' : 'openai';
  const url = `${gatewayEndpoint}/${provider}/v1/${isAnthropic ? 'messages' : 'chat/completions'}`;

  const apiKey = isAnthropic ? env.ANTHROPIC_API_KEY : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'cf-aig-authorization': `Bearer ${apiKey}`,
  };

  let body: string;
  if (isAnthropic) {
    body = JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 2048,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userMessage }],
    });
    headers['anthropic-version'] = '2023-06-01';
  } else {
    body = JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0.1,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userMessage },
      ],
    });
  }

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  if (isAnthropic) {
    const content = (data.content as Array<{ type: string; text: string }>)?.[0]?.text ?? '';
    const usage = data.usage as { input_tokens: number; output_tokens: number } | undefined;
    return {
      content,
      model: req.model,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      latencyMs: Date.now() - start,
    };
  }

  const choice = (data.choices as Array<{ message: { content: string } }>)?.[0];
  const usage = data.usage as { prompt_tokens: number; completion_tokens: number } | undefined;
  return {
    content: choice?.message?.content ?? '',
    model: req.model,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - start,
  };
}
