import { describe, it, expect, vi, afterEach } from 'vitest';
import { callLLM } from './gateway';
import type { Env } from '../types';

const fakeEnv = {
  CF_AI_GATEWAY_ENDPOINT: 'https://gateway.example/v1/acct/gw',
  ANTHROPIC_API_KEY: 'sk-ant-test-key',
  OPENAI_API_KEY: 'sk-openai-test-key',
} as unknown as Env;

function mockFetch(responseBody: unknown) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(responseBody), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callExternalViaGateway auth headers', () => {
  it('sends the Anthropic key via x-api-key, not cf-aig-authorization', async () => {
    const calls = mockFetch({
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const res = await callLLM(fakeEnv, {
      model: 'claude-sonnet-4-6',
      systemPrompt: 'sys',
      userMessage: 'hi',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://gateway.example/v1/acct/gw/anthropic/v1/messages');
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-test-key');
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01');
    expect(calls[0].headers['cf-aig-authorization']).toBeUndefined();
    expect(res.content).toBe('hello');
    expect(res.inputTokens).toBe(10);
  });

  it('sends the OpenAI key via Authorization bearer', async () => {
    const calls = mockFetch({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const res = await callLLM(fakeEnv, {
      model: 'gpt-4o',
      systemPrompt: 'sys',
      userMessage: 'hi',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://gateway.example/v1/acct/gw/openai/v1/chat/completions');
    expect(calls[0].headers['Authorization']).toBe('Bearer sk-openai-test-key');
    expect(calls[0].headers['cf-aig-authorization']).toBeUndefined();
    expect(res.content).toBe('hello');
  });
});
