import { expect, test } from 'bun:test';
import { registerDelegate } from '../src/delegate.ts';
import type { Api, Context } from '../src/host.ts';
import type { Config } from '../src/state.ts';

for (const revoke of ['authorization', 'tools'] as const) {
  test(`revoked ${revoke} during child construction prevents inference and disposes the child`, async () => {
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const constructing = new Promise<void>(resolve => { reached = resolve; });
    let execute!: Parameters<Api['registerTool']>[0]['execute'];
    let authorized = true;
    let activeTools = ['read'];
    let inference = 0;
    let disposed = false;
    const model = { provider: 'fixture', id: 'child', contextWindow: 100_000 };
    const schema = { min() { return this; }, max() { return this; } };
    const api = {
      registerTool(tool: Parameters<Api['registerTool']>[0]) { execute = tool.execute; },
      getActiveTools: () => activeTools,
      zod: { string: () => schema, array: () => schema, object: () => schema },
      pi: {
        getAgentDir: () => process.cwd(),
        Settings: { isolated: () => ({}) },
        SessionManager: { inMemory: () => ({}) },
        async createAgentSession() {
          reached();
          await gate;
          return { session: {
            model,
            state: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Private findings' }] }] },
            async prompt() { inference++; },
            async abort() {},
            async dispose() { disposed = true; },
          } };
        },
      },
    } as unknown as Api;
    const ctx = { cwd: process.cwd(), model: { provider: 'fixture', id: 'parent' }, modelRegistry: {}, sessionManager: { getSessionId: () => 'parent' } } as unknown as Context;
    registerDelegate(api, () => ({ delegationTools: ['read'] }) as Config, async () => ({ model, effort: 'low', validate() { if (!authorized) throw new Error('Delegation authorization changed'); } }));
    const outcome = execute('task', { task: 'Read selected context', context: ['bounded'], allowedTools: ['read'], successCriteria: 'Report the selected fact', cwd: '.' }, undefined, undefined, ctx).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    await constructing;
    if (revoke === 'authorization') authorized = false;
    else activeTools = [];
    release();
    const result = await outcome;
    expect(result.error).toBeInstanceOf(Error);
    expect(inference).toBe(0);
    expect(disposed).toBe(true);
  });
}
