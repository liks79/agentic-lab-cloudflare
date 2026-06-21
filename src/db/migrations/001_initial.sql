-- Migration 001: Initial schema

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('P1','P2','P3','P4')),
  service TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  alert_url TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','pending_approval','resolved','escalated')),
  received_at INTEGER NOT NULL,
  resolved_at INTEGER,
  mttr_seconds INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant ON incidents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_received_at ON incidents(received_at);

-- Immutable audit log of every agent action (INSERT only — no UPDATE/DELETE)
CREATE TABLE IF NOT EXISTS agent_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  tenant_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  action_input TEXT,         -- JSON, max 4000 chars
  observation TEXT,          -- JSON result, max 4000 chars
  timestamp INTEGER NOT NULL,
  UNIQUE (incident_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_incident ON agent_actions(incident_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_tenant ON agent_actions(tenant_id);

-- LLM call log for cost tracking and audit
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  tenant_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_tenant ON llm_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_timestamp ON llm_calls(timestamp);

-- Human approval events
CREATE TABLE IF NOT EXISTS approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  tenant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  approved INTEGER NOT NULL CHECK (approved IN (0, 1)),
  approved_by TEXT,          -- Slack user ID (not name — IDs are stable)
  timestamp INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_approval_events_incident ON approval_events(incident_id);

-- RCA documents stored as references to R2
CREATE TABLE IF NOT EXISTS rca_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  tenant_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  rca_confidence REAL,
  vectorize_indexed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Prompt versions for A/B eval tracking
CREATE TABLE IF NOT EXISTS prompt_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  hash TEXT NOT NULL,
  content TEXT NOT NULL,
  avg_mttr_seconds REAL,
  rca_f1_score REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (name, version)
);
