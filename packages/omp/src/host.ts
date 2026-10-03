import type { Model } from './state.ts';

export interface Context {
  cwd: string;
  hasUI: boolean;
  model?: Model;
  mode?: string;
  agent?: { kind: string };
  ui: { notify(message: string, type?: 'info' | 'warning' | 'error'): void };
  models: { resolve(selector: string): Model | undefined; current(): Model | undefined };
  modelRegistry: { getAvailable(): Model[]; authStorage: unknown };
  sessionManager: { getSessionId(): string; getLeafId(): string | null; getBranch(): unknown[] };
  isIdle(): boolean;
  getContextUsage(): { tokens: number; contextWindow: number } | undefined;
}
export interface Event { prompt?: string; images?: unknown[]; systemPrompt?: string[] }
export interface ChildSession {
  prompt(text: string): Promise<unknown>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
  model?: Model;
  state: { messages: unknown[] };
}
interface Schema {
  min(value: number): Schema;
  max(value: number): Schema;
}
export interface Api {
  on(event: string, handler: (event: Event, context: Context) => Promise<void> | void): void;
  registerFlag(name: string, options: { type: 'string' | 'boolean'; default?: string | boolean; description: string }): void;
  getFlag(name: string): string | boolean | undefined;
  registerCommand(name: string, options: { description: string; handler(args: string, context: Context): Promise<void> }): void;
  appendEntry(type: string, data: unknown): void;
  getThinkingLevel(): string | undefined;
  setThinkingLevel(level: string): void;
  setModel(model: Model): Promise<boolean>;
  getActiveTools(): string[];
  zod: { string(): Schema; array(schema: Schema): Schema; object(shape: Record<string, Schema>): Schema };
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    approval: 'read';
    loadMode: 'essential';
    parameters: Schema;
    execute(id: string, params: unknown, signal: AbortSignal | undefined, update: unknown, context: Context): Promise<{ content: { type: 'text'; text: string }[]; details: Record<string, unknown> }>;
  }): void;
  pi: {
    getAgentDir(): string;
    settings?: { getGlobalSettings(): Record<string, unknown>; getProjectSettings(): Record<string, unknown> };
    Settings: { isolated(overrides?: Record<string, unknown>): unknown };
    SessionManager: { inMemory(cwd?: string): unknown };
    createAgentSession(options: Record<string, unknown>): Promise<{ session: ChildSession }>;
  };
}
export function notify(context: Context, message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
  const text = `[Volit] ${message}`;
  if (context.hasUI) context.ui.notify(text, type);
  else console.error(text);
}
