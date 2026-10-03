import type { Candidate, Mode, Policy, Profile, Route } from '@volit/core';
import type { JudgeProvider } from '@volit/judge';

export interface Target { id: string; provider: string; model: string; effort: string }
export interface Config {
  profiles: Profile[];
  targets: Target[];
  policy: Policy;
  outputReserve: number;
  evidenceMaxChars: number;
  timeoutMs: number;
  delegationTools: string[];
}
export interface Model {
  provider: string;
  id: string;
  contextWindow: number;
  reasoning?: boolean;
  supportsTools?: boolean;
  input?: readonly string[];
  thinking?: { efforts?: readonly string[] };
  cost?: { input?: number };
}
export interface State {
  mode: Mode;
  disclosure: boolean;
  judge?: Pick<JudgeProvider, 'id' | 'destination'>;
  pin: { model: boolean; effort: boolean };
  revision: number;
  lastRoute?: Route;
  lastChangeAt?: number;
  profileId?: string;
  suspended?: string;
}
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be non-empty text`);
  return value;
}
function number(value: unknown, name: string, minimum: number, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} is out of range`);
  return value;
}
function list(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}
function unique(values: string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${name}`);
}
export function parseConfig(value: unknown): Config {
  if (!object(value)) throw new Error('Volit configuration must be an object');
  if (Object.hasOwn(value, 'endpoint')) throw new Error('Endpoint cannot be configured by a project; use explicit --volit-endpoint');
  const targets = list(value.targets, 'targets').map(item => {
    if (!object(item)) throw new Error('Invalid target');
    return { id: text(item.id, 'target id'), provider: text(item.provider, 'provider'), model: text(item.model, 'model'), effort: text(item.effort, 'effort') };
  });
  unique(targets.map(target => target.id), 'target');
  const profiles = list(value.profiles, 'profiles').map(item => {
    if (!object(item)) throw new Error('Invalid profile');
    const ids = list(item.targets, 'profile targets').map(id => text(id, 'target id'));
    if (!ids.length || ids.some(id => !targets.some(target => target.id === id))) throw new Error('Profile target is outside the allowlist');
    unique(ids, 'profile target');
    const id = text(item.id, 'profile id');
    if (id === 'insufficient_evidence') throw new Error('Reserved profile id');
    return { id, description: text(item.description, 'description'), targets: ids };
  });
  unique(profiles.map(profile => profile.id), 'profile');
  if (!profiles.length || profiles.length > 254 || !targets.length) throw new Error('Configure between 1 and 254 profiles and at least one target');
  const p = value.policy;
  if (!object(p)) throw new Error('Explicit versioned policy is required');
  const transitions = list(p.downgradeTransitions, 'downgradeTransitions').map(item => {
    if (!object(item)) throw new Error('Invalid downgrade transition');
    const from = text(item.from, 'from');
    const to = text(item.to, 'to');
    if (![from, to].every(id => profiles.some(profile => profile.id === id))) throw new Error('Unknown downgrade profile');
    return { from, to };
  });
  const policy: Policy = {
    version: text(p.version, 'policy version'),
    minimumProbability: number(p.minimumProbability, 'minimumProbability', 0, 1),
    minimumMargin: number(p.minimumMargin, 'minimumMargin', 0, 1),
    downgradeProbability: number(p.downgradeProbability, 'downgradeProbability', 0, 1),
    cooldownMs: number(p.cooldownMs, 'cooldownMs', 0),
    downgradeTransitions: transitions,
    ...(p.maxColdInputCost === undefined ? {} : { maxColdInputCost: number(p.maxColdInputCost, 'maxColdInputCost', 0) }),
  };
  if (policy.downgradeProbability < policy.minimumProbability) throw new Error('Downgrade threshold cannot be weaker than minimumProbability');
  for (const key of ['outputReserve', 'evidenceMaxChars', 'timeoutMs']) if (!Number.isSafeInteger(value[key])) throw new Error(`${key} must be a safe integer`);
  const delegationTools = value.delegationTools === undefined ? ['read'] : list(value.delegationTools, 'delegationTools').map(tool => text(tool, 'tool'));
  if (delegationTools.some(tool => !['read', 'grep', 'glob'].includes(tool))) throw new Error('Delegation supports only explicitly allowed read, grep and glob tools');
  unique(delegationTools, 'delegation tool');
  return { profiles, targets, policy, outputReserve: number(value.outputReserve, 'outputReserve', 1), evidenceMaxChars: number(value.evidenceMaxChars, 'evidenceMaxChars', 1, 100000), timeoutMs: number(value.timeoutMs, 'timeoutMs', 1, 120000), delegationTools };
}
export function restoreState(entries: readonly unknown[]): State {
  let result: State = { mode: 'off', disclosure: false, pin: { model: false, effort: false }, revision: 0 };
  for (const entry of entries) {
    if (!object(entry) || entry.type !== 'custom' || entry.customType !== 'volit' || !object(entry.data) || entry.data.version !== 1 || !object(entry.data.state)) continue;
    const s = entry.data.state;
    if (!['off', 'observe', 'auto'].includes(String(s.mode)) || typeof s.disclosure !== 'boolean' || !object(s.pin) || typeof s.pin.model !== 'boolean' || typeof s.pin.effort !== 'boolean' || !Number.isSafeInteger(s.revision) || Number(s.revision) < 0) continue;
    const mode: Mode = s.mode === 'auto' ? 'auto' : s.mode === 'observe' ? 'observe' : 'off';
    const judge = object(s.judge) && typeof s.judge.id === 'string' && s.judge.id.trim() && typeof s.judge.destination === 'string' && s.judge.destination.trim() ? { id: s.judge.id, destination: s.judge.destination } : undefined;
    result = { mode: s.disclosure && judge ? mode : 'off', disclosure: s.disclosure && judge !== undefined, pin: { model: s.pin.model, effort: s.pin.effort }, revision: Number(s.revision), ...(judge ? { judge } : {}) };
    if (object(s.lastRoute) && typeof s.lastRoute.provider === 'string' && typeof s.lastRoute.model === 'string' && typeof s.lastRoute.effort === 'string') result.lastRoute = { provider: s.lastRoute.provider, model: s.lastRoute.model, effort: s.lastRoute.effort };
    if (typeof s.lastChangeAt === 'number' && Number.isFinite(s.lastChangeAt)) result.lastChangeAt = s.lastChangeAt;
    if (typeof s.profileId === 'string') result.profileId = s.profileId;
    if (typeof s.suspended === 'string') result.suspended = s.suspended;
  }
  return result;
}
export function bindJudge(state: State, provider: Pick<JudgeProvider, 'id' | 'destination'>): State {
  const judge = { id: text(provider.id, 'Judge identity'), destination: text(provider.destination, 'Judge destination') };
  if (state.judge?.id === judge.id && state.judge.destination === judge.destination) return state;
  return { ...state, judge, mode: 'off', disclosure: false, revision: state.revision + 1 };
}
export function transitionControl(state: State, command: string): State {
  const parts = command.trim().split(/\s+/);
  const action = parts[0];
  if (!['off', 'observe', 'auto', 'pin', 'unpin'].includes(action ?? '') || parts.slice(1).some(part => part !== '--accept-disclosure')) throw new Error('Use status, off, observe --accept-disclosure, auto --accept-disclosure, pin or unpin');
  const next: State = { ...state, pin: { ...state.pin }, revision: state.revision + 1 };
  if (action === 'observe' || action === 'auto') {
    if (!state.judge) throw new Error('A judgement provider must be selected before accepting disclosure');
    if (!state.disclosure && !parts.includes('--accept-disclosure')) throw new Error('Explicit --accept-disclosure required: bounded request and prior user/assistant text are shared with the selected judgement provider, including potentially sensitive user text');
    next.disclosure = true;
    next.mode = action;
    delete next.suspended;
  } else if (action === 'off') next.mode = 'off';
  else next.pin = { model: action === 'pin', effort: action === 'pin' };
  return next;
}
export function extractContext(entries: readonly unknown[]): { role: 'user' | 'assistant'; text: string }[] {
  const result: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const entry of entries) {
    if (!object(entry) || entry.type !== 'message' || !object(entry.message)) continue;
    const message = entry.message;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.filter(part => object(part) && part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') : '';
    if (content) result.push({ role: message.role, text: content });
  }
  return result;
}
export function snapshotCandidates(config: Config, models: { resolve(selector: string): Model | undefined; available: readonly Model[] }, effort: string, nativeEffort: boolean): Candidate[] {
  return config.targets.map(target => {
    const model = models.resolve(`${target.provider}/${target.model}`);
    const actual = model?.provider === target.provider && model.id === target.model ? model : undefined;
    const selectedEffort = nativeEffort ? effort : target.effort;
    return { id: target.id, route: { provider: target.provider, model: target.model, effort: selectedEffort }, available: !!actual && models.available.some(item => item.provider === target.provider && item.id === target.model), tools: !!actual && actual.supportsTools !== false, images: actual?.input?.includes('image') ?? false, contextWindow: actual?.contextWindow ?? 0, supportedEfforts: actual?.thinking?.efforts ?? ['off'], ...(actual?.cost?.input === undefined ? {} : { inputCostPerMillion: actual.cost.input }) };
  });
}

export function foreignRouteChange(previous: Route, current: Route, nativeEffort: boolean): boolean {
  return previous.provider !== current.provider || previous.model !== current.model || (!nativeEffort && previous.effort !== current.effort);
}

export function effectivePrewalk(global: Record<string, unknown>, project: Record<string, unknown>): boolean {
  const inherited = object(global.prewalk) ? global.prewalk.enabled : undefined;
  const override = object(project.prewalk) ? project.prewalk.enabled : undefined;
  return (override ?? inherited) === true;
}
