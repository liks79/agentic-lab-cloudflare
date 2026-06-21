import type { Env, ToolResult } from '../types';

interface SlackMessage {
  channel: string;
  text: string;
  blocks?: unknown[];
}

interface ApprovalRequest {
  action: string;
  description: string;
  riskLevel: string;
  incidentId?: string;
}

export async function notifySlack(env: Env, msg: SlackMessage): Promise<ToolResult> {
  const start = Date.now();
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(msg),
    signal: AbortSignal.timeout(5000),
  });

  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    return { success: false, error: `Slack error: ${data.error}`, latencyMs: Date.now() - start };
  }
  return { success: true, data, latencyMs: Date.now() - start };
}

export async function sendSlackApprovalRequest(
  env: Env,
  req: ApprovalRequest,
): Promise<ToolResult> {
  const riskEmoji = { low: ':white_check_mark:', medium: ':warning:', high: ':rotating_light:' }[req.riskLevel] ?? ':question:';

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${riskEmoji} *Approval Required* — Risk: *${req.riskLevel.toUpperCase()}*\n*Action:* ${req.action}\n*Details:* ${req.description}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          value: JSON.stringify({ action: req.action, approved: true, incidentId: req.incidentId }),
          action_id: 'approve_action',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Reject' },
          style: 'danger',
          value: JSON.stringify({ action: req.action, approved: false, incidentId: req.incidentId }),
          action_id: 'reject_action',
        },
      ],
    },
  ];

  return notifySlack(env, {
    channel: env.SLACK_INCIDENT_CHANNEL_ID,
    text: `Approval required: ${req.action}`,
    blocks,
  });
}
