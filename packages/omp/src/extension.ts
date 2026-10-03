import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { routeWork, revalidateDecision } from '@volit/core';
import type { Decision, Delegation, Route, RoutingSnapshot } from '@volit/core';
import { buildEvidence, JudgeError, validateJudgement } from '@volit/judge';
import type { JudgeProvider } from '@volit/judge';
import { registerDelegate } from './delegate.ts';
import { notify } from './host.ts';
import type { Api, Context, Event } from './host.ts';
import { bindJudge, effectivePrewalk, extractContext, foreignRouteChange, object, parseConfig, restoreState, snapshotCandidates, transitionControl } from './state.ts';
import type { Config, State } from './state.ts';

export const DISCLOSURE = 'Latest request and bounded prior user/assistant text are shared with the selected judgement provider; system/tool/file/image payloads are excluded, but user text can contain secrets. Observe also discloses.';
export const STOCK_LIMITATION = 'Stock OMP uses a late hook; model preparation may already have occurred. Abort or a simultaneous manual selection can race an awaited model update. Manual simultaneous changes are your responsibility.';

function currentRoute(api: Api, ctx: Context): Route {
  return { provider: ctx.model?.provider ?? '', model: ctx.model?.id ?? '', effort: api.getThinkingLevel() ?? 'off' };
}
function equalRoute(a: Route, b: Route): boolean {
  return a.provider === b.provider && a.model === b.model && a.effort === b.effort;
}
function nativeAuto(api: Api, ctx: Context): boolean {
  const latest = ctx.sessionManager.getBranch().findLast(entry => object(entry) && entry.type === 'thinking_level_change');
  if (object(latest) && Object.hasOwn(latest, 'configured')) return latest.configured === 'auto';
  const index = process.argv.findLastIndex(value => value === '--thinking' || value.startsWith('--thinking='));
  if (index >= 0) return (process.argv[index] === '--thinking' ? process.argv[index + 1] : process.argv[index]?.slice(11)) === 'auto';
  if (process.argv.some(value => value === '--config' || value.startsWith('--config='))) return true;
  try {
    const settings = api.pi.settings;
    if (!settings) return true;
    const project = settings.getProjectSettings();
    const global = settings.getGlobalSettings();
    return (project.defaultThinkingLevel ?? global.defaultThinkingLevel) === 'auto';
  } catch { return true; }
}
function controllerWarning(api: Api): string | undefined {
  if (process.argv.some(value => value === '--plan-yolo' || value === '--prewalk' || value.startsWith('--prewalk-into'))) return 'Native prewalk/plan-yolo owns model selection';
  if (process.argv.some(value => value === '--config' || value.startsWith('--config='))) return 'Native controller ownership in an external settings overlay is not exposed; model automation suspended';
  const settings = api.pi.settings;
  if (!settings) return 'Native model-controller configuration is unavailable';
  try {
    if (!process.argv.includes('--no-prewalk') && effectivePrewalk(settings.getGlobalSettings(), settings.getProjectSettings())) return 'Native prewalk owns model selection';
  } catch { return 'Native model-controller configuration is unavailable'; }
  return undefined;
}

export function createVolitExtension({ createProvider }: { createProvider: () => JudgeProvider }): (api: Api) => void {
  return api => installVolit({ api, createProvider });
}

function installVolit({ api, createProvider }: { api: Api; createProvider: () => JudgeProvider }): void {
  api.registerFlag('volit', { type: 'string', description: 'Volit mode: off, observe or auto; enablement requires --volit-accept-disclosure' });
  api.registerFlag('volit-accept-disclosure', { type: 'boolean', default: false, description: DISCLOSURE });
  api.registerFlag('volit-config', { type: 'string', description: 'Path to explicit Volit JSON configuration (default cwd/volit.config.json)' });
  let provider: JudgeProvider | undefined;
  const destination = () => provider ? `${provider.id} at ${provider.destination}` : 'unconfigured';
  let config: Config | undefined;
  let state: State = restoreState([]);
  let pending: AbortController | undefined;
  const delegates = new Set<AbortController>();
  let boundary = 0;
  let firstStart = true;
  let applying = false;

  const invalidate = () => {
    pending?.abort();
    pending = undefined;
    for (const controller of delegates) controller.abort();
    delegates.clear();
    state.revision++;
  };
  const persist = (decision?: Decision, outcome?: string) => {
    api.appendEntry('volit', {
      version: 1,
      state: structuredClone(state),
      ...(decision ? { decision: { identity: decision.identity, action: decision.action, target: decision.target, profileId: decision.profileId, reasons: decision.reasons, policyVersion: decision.policyVersion, judgement: decision.judgement } } : {}),
      ...(outcome ? { outcome } : {}),
    });
  };
  const suspend = (ctx: Context, reason: string) => {
    invalidate();
    state.suspended = reason;
    if (state.mode !== 'off') state.mode = 'observe';
    state.lastRoute = currentRoute(api, ctx);
    persist(undefined, 'suspended');
    notify(ctx, `${reason}; automatic application suspended. Use /volit auto to explicitly resume.`, 'warning');
  };
  const load = async (ctx: Context) => {
    config = undefined;
    provider = undefined;
    const flag = api.getFlag('volit-config');
    try {
      const loadedConfig = parseConfig(JSON.parse(await readFile(resolve(ctx.cwd, typeof flag === 'string' ? flag : 'volit.config.json'), 'utf8')));
      const consent = state.disclosure;
      try {
        const selected = createProvider();
        state = bindJudge(state, selected);
        provider = selected;
      } catch {
        throw new Error('Judgement provider is unavailable or invalid');
      }
      config = loadedConfig;
      if (consent && !state.disclosure) {
        persist(undefined, 'disclosure_required');
        notify(ctx, 'Judgement provider or destination changed; routing is off until disclosure is explicitly accepted again', 'warning');
      }
      if (state.mode !== 'off' || api.getFlag('volit') === 'auto' || api.getFlag('volit') === 'observe') notify(ctx, `Judgement provider: ${destination()}`);
    }
    catch (error) {
      if (typeof flag === 'string' || state.mode !== 'off') notify(ctx, `Configuration unavailable: ${error instanceof Error ? error.message : 'invalid configuration'}`, 'error');
    }
  };
  const restore = async (_event: Event, ctx: Context) => {
    invalidate();
    const revision = state.revision;
    state = restoreState(ctx.sessionManager.getBranch());
    state.revision = Math.max(state.revision, revision);
    await load(ctx);
    if (firstStart) {
      firstStart = false;
      const flag = api.getFlag('volit');
      if (flag === 'auto' || flag === 'observe') {
        try {
          state = transitionControl(state, `${flag}${api.getFlag('volit-accept-disclosure') === true ? ' --accept-disclosure' : ''}`);
          if (!config) throw new Error('Valid Volit configuration is required');
          persist();
          notify(ctx, `${DISCLOSURE} ${STOCK_LIMITATION}`, 'warning');
        } catch (error) { state.mode = 'off'; notify(ctx, error instanceof Error ? error.message : 'Activation failed', 'error'); }
      } else if (flag === 'off') {
        state = transitionControl(state, 'off');
        persist();
      } else if (flag !== undefined) {
        state.mode = 'off';
        notify(ctx, 'Invalid --volit mode; routing remains off', 'error');
      }
    }
    state.lastRoute ??= currentRoute(api, ctx);
  };
  for (const event of ['session_start', 'session_switch', 'session_branch', 'session_tree']) api.on(event, restore);
  api.on('session_shutdown', invalidate);
  for (const event of ['session_before_switch', 'session_before_branch', 'session_before_tree', 'session_before_compact']) api.on(event, invalidate);
  for (const event of ['retry_fallback_applied', 'retry_fallback_succeeded']) api.on(event, (_event, ctx) => { if (state.mode === 'auto') suspend(ctx, 'Native fallback changed model ownership'); });

  api.registerCommand('volit', {
    description: 'Status, off, observe/auto --accept-disclosure, pin, unpin',
    async handler(args, ctx) {
      const command = args.trim() || 'status';
      if (command === 'status') {
        notify(ctx, `mode=${state.mode}; pin=${state.pin.model ? 'model+effort' : 'none'}; effort owner=${nativeAuto(api, ctx) ? 'host (auto or unknown)' : 'Volit when enabled'}; route=${ctx.model?.provider}/${ctx.model?.id}; ${state.suspended ?? 'not suspended'}. Judge: ${destination()}. ${STOCK_LIMITATION} ${DISCLOSURE}`);
        return;
      }
      try {
        if (['auto', 'observe'].includes(command.split(/\s+/)[0] ?? '') && !config) { await load(ctx); if (!config) throw new Error('Valid Volit configuration is required'); }
        const next = transitionControl(state, command);
        invalidate();
        next.revision = state.revision;
        next.lastRoute = currentRoute(api, ctx);
        state = next;
        persist();
        notify(ctx, `mode=${state.mode}; pin=${state.pin.model ? 'model+effort' : 'none'}. ${state.mode === 'off' ? 'No judgement requests.' : `Judge: ${destination()}. ${DISCLOSURE} ${STOCK_LIMITATION}`}`);
      } catch (error) { notify(ctx, error instanceof Error ? error.message : 'Control failed', 'error'); }
    },
  });

  const snapshot = (ctx: Context, identity: RoutingSnapshot['identity'], images: boolean, delegation?: Delegation): RoutingSnapshot => {
    if (!config) throw new Error('Volit configuration unavailable');
    const current = currentRoute(api, ctx);
    const native = !delegation && nativeAuto(api, ctx);
    const available = ctx.modelRegistry.getAvailable();
    const candidates = snapshotCandidates(config, { resolve: selector => ctx.models.resolve(selector), available }, current.effort, native);
    const usage = ctx.getContextUsage();
    return {
      identity,
      boundary: delegation ? 'delegation' : 'request',
      mode: state.mode,
      disclosure: state.disclosure,
      pin: { ...state.pin },
      current,
      ...(state.profileId ? { currentProfileId: state.profileId } : {}),
      currentContextWindow: ctx.model?.contextWindow ?? 0,
      currentAvailable: available.some(model => model.provider === current.provider && model.id === current.model),
      candidates,
      profiles: config.profiles,
      requirements: { tools: delegation ? delegation.tools.length > 0 : api.getActiveTools().length > 0, images, ...(usage ? { inputTokens: usage.tokens } : {}), conservative: false, outputReserve: config.outputReserve },
      capabilities: { switch: !state.suspended, adjust: !native && !state.suspended, delegate: true },
      ownership: { model: state.suspended ? 'unknown' : 'volit', effort: native ? 'host' : 'volit' },
      now: Date.now(),
      ...(state.lastChangeAt === undefined ? {} : { lastChangeAt: state.lastChangeAt }),
      ...(delegation ? { delegation } : {}),
    };
  };

  const decide = async (prompt: string, ctx: Context, images: boolean, delegation?: Delegation, externalSignal?: AbortSignal) => {
    if (!config || !provider) throw new Error('Volit configuration or judgement provider unavailable');
    const selectedProvider = provider;
    const selectedConfig = config;
    if (!delegation) invalidate();
    const controller = new AbortController();
    if (delegation) delegates.add(controller);
    else pending = controller;
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) controller.abort();
    const identity = { sessionId: ctx.sessionManager.getSessionId(), branchId: ctx.sessionManager.getLeafId() ?? 'root', revision: state.revision, boundaryId: `${++boundary}` };
    const captured = snapshot(ctx, identity, images, delegation);
    try {
      const decision = await routeWork({
        snapshot: captured,
        policy: selectedConfig.policy,
        signal: controller.signal,
        judge: async (profiles, signal) => {
          const entries = ctx.sessionManager.getBranch();
          const evidence = buildEvidence({ request: prompt, context: delegation ? delegation.context.map(text => ({ role: 'user' as const, text })) : extractContext(entries), maxChars: selectedConfig.evidenceMaxChars });
          if (images || (!delegation && entries.some(entry => object(entry) && entry.type === 'message' && object(entry.message) && (entry.message.role === 'toolResult' || (Array.isArray(entry.message.content) && entry.message.content.some(part => object(part) && part.type !== 'text')))))) evidence.omitted = true;
          try {
            const judgement = await selectedProvider.judge({
              evidence,
              profiles: profiles.map(({ id, description }) => ({ id, description })),
              timeoutMs: selectedConfig.timeoutMs,
              ...(signal ? { signal } : {}),
            });
            return validateJudgement({ judgement, profiles, providerId: selectedProvider.id });
          } catch (error) {
            notify(ctx, error instanceof JudgeError ? `Judgement ${error.code}: ${new JudgeError(error.code).message}` : 'Judgement provider failed; no recommendation applied', 'warning');
            throw error;
          }
        },
      });
      const freshIdentity = { ...identity, sessionId: ctx.sessionManager.getSessionId(), branchId: delegation ? identity.branchId : ctx.sessionManager.getLeafId() ?? 'root', revision: state.revision };
      return { decision, fresh: snapshot(ctx, freshIdentity, images, delegation), stale: controller.signal.aborted || freshIdentity.sessionId !== identity.sessionId || freshIdentity.branchId !== identity.branchId || freshIdentity.revision !== identity.revision || !equalRoute(captured.current, currentRoute(api, ctx)) };
    } finally {
      externalSignal?.removeEventListener('abort', abort);
      delegates.delete(controller);
      if (pending === controller) pending = undefined;
    }
  };

  api.on('before_agent_start', async (event, ctx) => {
    if (ctx.agent?.kind === 'sub' || !config || state.mode === 'off') return;
    const observed = currentRoute(api, ctx);
    if (state.lastRoute && foreignRouteChange(state.lastRoute, observed, nativeAuto(api, ctx)) && state.mode === 'auto') suspend(ctx, 'An external model or effort change was detected');
    state.lastRoute = observed;
    const warning = controllerWarning(api);
    if (warning && state.mode === 'auto') suspend(ctx, warning);
    try {
      const { decision, fresh, stale } = await decide(event.prompt ?? '', ctx, !!event.images?.length);
      if (stale || ctx.isIdle()) { notify(ctx, 'Discarded stale or cancelled judgement; route unchanged', 'warning'); return; }
      if (!decision.apply || decision.action === 'stay') {
        persist(decision, decision.action === 'stay' ? 'unchanged' : 'observed');
        notify(ctx, `${decision.apply ? 'Applied' : state.mode === 'observe' ? 'Observed' : 'Unchanged'} ${decision.action}${decision.target ? ` ${decision.target.provider}/${decision.target.model}:${decision.target.effort}` : ''}: ${decision.reasons.join(', ')}`);
        return;
      }
      if (!revalidateDecision({ decision, snapshot: fresh, policy: config.policy }) || !decision.target) { notify(ctx, 'Decision no longer eligible; route unchanged', 'warning'); return; }
      const target = ctx.models.resolve(`${decision.target.provider}/${decision.target.model}`);
      if (!target || target.provider !== decision.target.provider || target.id !== decision.target.model) throw new Error('Selected target is no longer available');
      applying = true;
      try {
        if (decision.action === 'switch' && !(await api.setModel(target))) throw new Error('OMP declined the selected model');
        if (state.revision !== decision.identity.revision || ctx.sessionManager.getSessionId() !== decision.identity.sessionId || ctx.isIdle()) throw new Error('Routing ownership changed during host mutation');
        if (!nativeAuto(api, ctx) && !state.pin.effort && api.getThinkingLevel() !== decision.target.effort) api.setThinkingLevel(decision.target.effort);
        const actual = currentRoute(api, ctx);
        if (foreignRouteChange(decision.target, actual, nativeAuto(api, ctx))) throw new Error('Actual route differs from selected route after application');
        state.lastRoute = actual;
        state.lastChangeAt = Date.now();
        if (decision.profileId !== undefined) state.profileId = decision.profileId;
        persist(decision, 'applied');
        notify(ctx, `Applied ${decision.action}: ${actual.provider}/${actual.model}:${actual.effort}; ${decision.reasons.join(', ')}`);
      } catch (error) { suspend(ctx, `Application incomplete: ${error instanceof Error ? error.message : 'host mutation failed'}`); }
      finally { applying = false; }
    } catch (error) { notify(ctx, `Routing failed; no new recommendation applied: ${error instanceof Error ? error.message : 'unknown error'}`, 'error'); }
  });
  api.on('agent_end', (_event, ctx) => {
    const observed = currentRoute(api, ctx);
    if (!applying && state.mode === 'auto' && state.lastRoute && foreignRouteChange(state.lastRoute, observed, nativeAuto(api, ctx))) suspend(ctx, 'Another controller changed the route during execution');
    if (nativeAuto(api, ctx)) state.lastRoute = observed;
  });

  registerDelegate(api, () => config, async (task, ctx, signal) => {
    if (!config || state.mode !== 'auto' || !state.disclosure || state.suspended) throw new Error('Bounded delegation requires explicitly enabled, unsuspended Volit auto');
    const { decision, fresh, stale } = await decide(`${task.request}\nSuccess criteria: ${task.successCriteria}`, ctx, false, task, signal);
    if (stale || !revalidateDecision({ decision, snapshot: fresh, policy: config.policy }) || decision.action !== 'delegate' || !decision.target) throw new Error(`No eligible delegate selected: ${decision.reasons.join(', ')}`);
    const model = ctx.models.resolve(`${decision.target.provider}/${decision.target.model}`);
    if (!model || model.provider !== decision.target.provider || model.id !== decision.target.model) throw new Error('Delegate target became unavailable');
    const selectedConfig = config;
    const validate = () => {
      if (config !== selectedConfig || state.mode !== 'auto' || !state.disclosure || state.suspended || state.pin.model || state.pin.effort || state.revision !== decision.identity.revision || ctx.sessionManager.getSessionId() !== decision.identity.sessionId || foreignRouteChange(decision.from, currentRoute(api, ctx), nativeAuto(api, ctx))) throw new Error('Delegation authorization changed before completion');
    };
    return { model, effort: decision.target.effort, validate };
  });
}
