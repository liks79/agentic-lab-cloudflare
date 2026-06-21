const PII_PATTERNS: [RegExp, string][] = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]'],
  [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE]'],
  [/\b(?:\d[ -]?){13,16}\b/g, '[CARD]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  // AWS keys
  [/(AKIA|ASIA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}/g, '[AWS_KEY]'],
  // Generic API key patterns (40+ hex or base62 chars after key=/secret=/token=)
  [/(?:key|secret|token|password|passwd|pwd)=["']?[A-Za-z0-9/+_-]{32,}["']?/gi, '[REDACTED_CREDENTIAL]'],
  // GitHub PATs
  [/ghp_[A-Za-z0-9]{36}/g, '[GITHUB_PAT]'],
  [/github_pat_[A-Za-z0-9_]{82}/g, '[GITHUB_PAT]'],
  // Slack tokens
  [/xox[bpas]-[A-Za-z0-9-]+/g, '[SLACK_TOKEN]'],
  // IPv4 private addresses (optional — comment out if you need these in logs)
  // [/\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+\b/g, '[PRIVATE_IP]'],
];

export function maskPII(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function maskPIIInObject<T>(obj: T): T {
  if (typeof obj === 'string') return maskPII(obj) as T;
  if (Array.isArray(obj)) return obj.map(maskPIIInObject) as T;
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, maskPIIInObject(v)]),
    ) as T;
  }
  return obj;
}
