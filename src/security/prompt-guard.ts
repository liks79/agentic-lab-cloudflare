// Prompt injection patterns that indicate adversarial log content
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|prior|above|all)\s+instructions?/i,
  /system\s*:/i,
  /<\s*system\s*>/i,
  /\[\s*system\s*\]/i,
  /you\s+are\s+now\s+(?:a|an)\s+/i,
  /disregard\s+(?:your|all|the)\s+/i,
  /forget\s+(?:everything|all|your)\s+/i,
  /new\s+instructions?\s*:/i,
  /override\s+(?:instructions?|mode|behavior)/i,
  /act\s+as\s+(?:a|an)\s+(?:DAN|jailbreak)/i,
];

export interface GuardResult {
  safe: boolean;
  flaggedPatterns: string[];
  sanitized: string;
}

export function guardExternalInput(text: string): GuardResult {
  const flagged: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      flagged.push(pattern.source);
    }
  }

  return {
    safe: flagged.length === 0,
    flaggedPatterns: flagged,
    sanitized: sanitizeForPrompt(text),
  };
}

function sanitizeForPrompt(text: string): string {
  // Strip anything that looks like XML/HTML tags that could confuse instruction parsing
  return text
    .replace(/<[^>]{0,200}>/g, '[TAG_REMOVED]')
    .replace(/\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>>/g, '[REMOVED]')
    .slice(0, 8000); // Hard cap to prevent token exhaustion
}

export function wrapExternalDataForPrompt(data: string, label: string): string {
  const guard = guardExternalInput(data);
  const note = guard.safe ? '' : '\n[SECURITY NOTE: Potential injection patterns detected and sanitized]';
  return `<external_data label="${label}">${note}\n${guard.sanitized}\n</external_data>`;
}
