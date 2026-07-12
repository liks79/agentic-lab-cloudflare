import { describe, expect, it } from 'vitest';
import { parseReActResponse } from './orchestrator';

describe('parseReActResponse', () => {
  it('parses a valid JSON ReAct response', () => {
    const parsed = parseReActResponse(JSON.stringify({
      thought: 'Need logs',
      action: 'log_search',
      actionInput: { query: 'error' },
    }));

    expect(parsed).toEqual({
      thought: 'Need logs',
      action: 'log_search',
      actionInput: { query: 'error' },
    });
  });

  it('extracts JSON from surrounding text', () => {
    const parsed = parseReActResponse(`
Thought before JSON
{
  "thought": "Done",
  "action": "FINISH",
  "actionInput": { "title": "RCA" },
  "confidence": 0.9
}
`);

    expect(parsed?.action).toBe('FINISH');
    expect(parsed?.confidence).toBe(0.9);
  });

  it('returns null for malformed JSON', () => {
    expect(parseReActResponse('{ "thought": "broken", ')).toBeNull();
  });

  it('returns null when no JSON object is present', () => {
    expect(parseReActResponse('I should search logs next.')).toBeNull();
  });
});
