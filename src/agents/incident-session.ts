import type { AgentContext } from '../types';

export class IncidentSession implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/context') {
      const ctx = await this.state.storage.get<AgentContext>('context');
      return Response.json(ctx ?? null);
    }

    if (request.method === 'PUT' && path === '/context') {
      const ctx = (await request.json()) as AgentContext;
      ctx.updatedAt = Date.now();
      await this.state.storage.put('context', ctx);
      return Response.json({ ok: true });
    }

    if (request.method === 'DELETE' && path === '/context') {
      await this.state.storage.deleteAll();
      return Response.json({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  }

  async getContext(): Promise<AgentContext | null> {
    return this.state.storage.get<AgentContext>('context') ?? null;
  }

  async saveContext(ctx: AgentContext): Promise<void> {
    ctx.updatedAt = Date.now();
    await this.state.storage.put('context', ctx);
  }

  async alarm(): Promise<void> {
    // Clean up sessions older than 24h to control DO storage costs
    const ctx = await this.getContext();
    if (ctx && Date.now() - ctx.createdAt > 86_400_000) {
      await this.state.storage.deleteAll();
    }
  }
}
