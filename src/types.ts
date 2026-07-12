export interface Env {
  // Durable Objects
  INCIDENT_SESSION: DurableObjectNamespace;

  // Storage
  DB: D1Database;
  CONFIG_KV: KVNamespace;
  INCIDENT_DOCS: R2Bucket;

  // Queue
  INCIDENT_QUEUE: Queue;

  // Vectorize
  INCIDENT_VECTORS: VectorizeIndex;

  // AI
  AI: Ai;

  // Secrets (injected at runtime)
  CF_AI_GATEWAY_ENDPOINT: string;
  ANTHROPIC_API_KEY: string;
  PAGERDUTY_WEBHOOK_SECRET: string;
  DATADOG_API_KEY: string;
  DATADOG_APP_KEY: string;
  DATADOG_SITE: string;
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  SLACK_INCIDENT_CHANNEL_ID: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: string;
  JIRA_PROJECT_KEY: string;
  ARGOCD_SERVER_URL: string;
  ARGOCD_TOKEN: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;

  // Vars
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  MAX_AGENT_STEPS: string;
  RCA_CONFIDENCE_THRESHOLD: string;
  LLM_FALLBACK_MODEL: string;
  WORKERS_AI_MODEL: string;
  EMBEDDING_MODEL: string;
}

export type Severity = 'P1' | 'P2' | 'P3' | 'P4';

export interface IncidentEvent {
  id: string;
  tenantId: string;
  source: 'pagerduty' | 'datadog' | 'github' | 'slack';
  severity: Severity;
  service: string;
  title: string;
  description: string;
  alertUrl?: string;
  receivedAt: number;
  metadata: Record<string, unknown>;
}

export interface AgentContext {
  incidentId: string;
  tenantId: string;
  steps: AgentStep[];
  observations: Observation[];
  currentHypothesis?: RCAHypothesis;
  status: 'active' | 'pending_approval' | 'resolved' | 'escalated';
  createdAt: number;
  updatedAt: number;
}

export interface AgentStep {
  stepNumber: number;
  thought: string;
  action: string;
  actionInput: Record<string, unknown>;
  observation?: string;
  timestamp: number;
}

export interface Observation {
  source: string;
  data: unknown;
  timestamp: number;
}

export interface RCAHypothesis {
  title: string;
  description: string;
  evidence: string[];
  confidence: number;
  suggestedMitigations: MitigationAction[];
}

export interface MitigationAction {
  type: 'rollback' | 'traffic_block' | 'cache_purge' | 'config_change' | 'scale_up';
  description: string;
  requiresApproval: boolean;
  estimatedRecoveryMinutes: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  latencyMs: number;
}

export interface LLMRequest {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}
