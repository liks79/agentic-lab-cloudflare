import { runIncidentAgent } from './orchestrator';
import type { Env, IncidentEvent } from '../types';

export async function processIncidentQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const event = message.body as IncidentEvent;
    try {
      await runIncidentAgent(event, env);
      message.ack();
    } catch (err) {
      console.error(`Failed to process incident ${event?.id}:`, err);
      // retry delivery; DLQ will catch after max_retries
      message.retry();
    }
  }
}
