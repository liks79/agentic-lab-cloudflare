import { describe, expect, it } from 'vitest';
import { maskPII, maskPIIInObject } from './pii-mask';

describe('maskPII', () => {
  it('masks common secrets and identifiers in text', () => {
    const input = [
      'email=person@example.com',
      'card=4111 1111 1111 1111',
      'aws=AKIAABCDEFGHIJKLMNOP',
      'github=ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
      'slack=xoxb-team-bot-token',
    ].join(' ');

    const masked = maskPII(input);

    expect(masked).toContain('[EMAIL]');
    expect(masked).toContain('[CARD]');
    expect(masked).toContain('[AWS_KEY]');
    expect(masked).toContain('[GITHUB_PAT]');
    expect(masked).toContain('[SLACK_TOKEN]');
    expect(masked).not.toContain('person@example.com');
    expect(masked).not.toContain('4111 1111 1111 1111');
    expect(masked).not.toContain('AKIAABCDEFGHIJKLMNOP');
  });
});

describe('maskPIIInObject', () => {
  it('recursively masks strings inside objects and arrays', () => {
    const masked = maskPIIInObject({
      user: 'person@example.com',
      nested: {
        tokens: ['xoxp-secret-token'],
      },
    });

    expect(masked).toEqual({
      user: '[EMAIL]',
      nested: {
        tokens: ['[SLACK_TOKEN]'],
      },
    });
  });
});
