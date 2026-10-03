import { describe, expect, test } from 'bun:test';
import { bindJudge, parseConfig, extractContext, restoreState, transitionControl, snapshotCandidates, foreignRouteChange, effectivePrewalk } from '../src/state.ts';

const selectedJudge = { id: 'fixture', destination: 'local:fixture' };
const initialState = () => bindJudge(restoreState([]), selectedJudge);

const configInput = () => ({
  profiles: [{ id: 'implementation', description: 'Implementation work', targets: ['main'] }],
  targets: [{ id: 'main', provider: 'fixture', model: 'main', effort: 'high' }],
  policy: { version: 'reviewed-v1', minimumProbability: 0.8, minimumMargin: 0.2, downgradeProbability: 0.9, cooldownMs: 0, downgradeTransitions: [] },
  outputReserve: 1024,
  evidenceMaxChars: 4000,
  timeoutMs: 500,
});

describe('configuration boundaries', () => {
  test('project prewalk settings override global settings without losing inheritance', () => {
    expect(effectivePrewalk({ prewalk: { enabled: true } }, { prewalk: { enabled: false } })).toBe(false);
    expect(effectivePrewalk({ prewalk: { enabled: false } }, { prewalk: { enabled: true } })).toBe(true);
    expect(effectivePrewalk({ prewalk: { enabled: true } }, { prewalk: { model: 'other' } })).toBe(true);
  });

  test('rejects a profile targeting a route outside the configured allowlist', () => {
    const input = configInput();
    input.profiles[0]!.targets = ['not-allowed'];
    expect(() => parseConfig(input)).toThrow();
  });

  test('rejects invented optimal defaults by requiring explicit policy thresholds', () => {
    const { policy: _, ...input } = configInput();
    expect(() => parseConfig(input)).toThrow();
  });

  test('rejects duplicate target identities rather than silently replacing a route', () => {
    const input = configInput();
    input.targets.push({ ...input.targets[0]!, model: 'other' });
    expect(() => parseConfig(input)).toThrow();
  });

  test('rejects a project-selected endpoint before it can receive a bearer credential', () => {
    expect(() => parseConfig({ ...configInput(), endpoint: 'https://attacker.invalid/judge' })).toThrow();
  });

  test('rejects fractional transport limits and weaker downgrade thresholds at load time', () => {
    expect(() => parseConfig({ ...configInput(), timeoutMs: 1.5 })).toThrow();
    expect(() => parseConfig({ ...configInput(), evidenceMaxChars: 4.5 })).toThrow();
    const input = configInput();
    input.policy.downgradeProbability = 0.1;
    expect(() => parseConfig(input)).toThrow();
  });

  test('does not invent tool support or effort levels for explicitly incapable models', () => {
    const config = parseConfig(configInput());
    const model = { provider: 'fixture', id: 'main', contextWindow: 32000, reasoning: true, supportsTools: false, input: ['text'] };
    const candidates = snapshotCandidates(config, { resolve: () => model, available: [model] }, 'high', false);
    expect(candidates[0]?.tools).toBe(false);
    expect(candidates[0]?.supportedEfforts).not.toContain('high');
  });

  test('does not treat a configured but unavailable model as an eligible target', () => {
    const config = parseConfig(configInput());
    const models = [{ provider: 'fixture', id: 'main', contextWindow: 32000, reasoning: true, input: ['text'], thinking: { efforts: ['low', 'high'] }, cost: { input: 2 } }];
    const candidates = snapshotCandidates(config, { resolve: () => models[0], available: [] }, 'high', false);
    expect(candidates[0]?.available).toBe(false);
  });

  test('preserves native effort ownership instead of configuring an automated adjustment', () => {
    const config = parseConfig(configInput());
    const model = { provider: 'fixture', id: 'main', contextWindow: 32000, reasoning: true, input: ['text'], thinking: { efforts: ['low', 'high'] }, cost: { input: 2 } };
    const candidates = snapshotCandidates(config, { resolve: () => model, available: [model] }, 'low', true);
    expect(candidates[0]?.route.effort).toBe('low');
  });

  test('native effort handoffs retain model ownership without hiding foreign model changes', () => {
    const previous = { provider: 'fixture', model: 'main', effort: 'low' };
    expect(foreignRouteChange(previous, { ...previous, effort: 'high' }, true)).toBe(false);
    expect(foreignRouteChange(previous, { ...previous, effort: 'high' }, false)).toBe(true);
    expect(foreignRouteChange(previous, { ...previous, model: 'manual', effort: 'high' }, true)).toBe(true);
  });
});

describe('disclosure and user controls', () => {
  test('does not reuse unbound disclosure from an older session for a selected provider', () => {
    const restored = restoreState([{ type: 'custom', customType: 'volit', data: { version: 1, state: { mode: 'auto', disclosure: true, pin: { model: false, effort: false }, revision: 1 } } }]);
    expect(restored.mode).toBe('off');
    expect(restored.disclosure).toBe(false);
    expect(() => transitionControl(restored, 'auto')).toThrow();
  });
  test.each([
    { id: 'different-provider', destination: 'local:fixture' },
    { id: 'fixture', destination: 'https://different-recipient.invalid' },
  ])('requires fresh consent when the provider identity or destination changes: %j', judge => {
    const enabled = transitionControl(initialState(), 'auto --accept-disclosure');
    const rebound = bindJudge(enabled, judge);
    expect(rebound.mode).toBe('off');
    expect(rebound.revision).toBeGreaterThan(enabled.revision);
    expect(() => transitionControl(rebound, 'observe')).toThrow();
    expect(transitionControl(rebound, 'observe --accept-disclosure').mode).toBe('observe');
  });

  test('preserves consent and a pin when restoring the same provider and destination', () => {
    const pinned = transitionControl(transitionControl(initialState(), 'auto --accept-disclosure'), 'pin');
    const restored = restoreState([{ type: 'custom', customType: 'volit', data: { version: 1, state: pinned } }]);
    const rebound = bindJudge(restored, { ...selectedJudge });
    expect(transitionControl(rebound, 'observe').mode).toBe('observe');
    expect(rebound.pin).toEqual({ model: true, effort: true });
  });


  test('does not activate disclosure or routing merely because installed state is absent', () => {
    expect(restoreState([])).toMatchObject({ mode: 'off', disclosure: false, pin: { model: false, effort: false } });
  });

  test('requires explicit disclosure acceptance before observing or automatically routing', () => {
    expect(() => transitionControl(initialState(), 'auto')).toThrow();
    expect(() => transitionControl(initialState(), 'observe')).toThrow();
  });

  test('turning off invalidates a previously enabled decision', () => {
    const enabled = transitionControl(initialState(), 'auto --accept-disclosure');
    const disabled = transitionControl(enabled, 'off');
    expect(disabled.mode).toBe('off');
    expect(disabled.revision).toBeGreaterThan(enabled.revision);
  });

  test('pin protects both model and effort until explicitly cleared', () => {
    const enabled = transitionControl(initialState(), 'auto --accept-disclosure');
    const pinned = transitionControl(enabled, 'pin');
    expect(pinned.pin).toEqual({ model: true, effort: true });
    expect(transitionControl(pinned, 'unpin').pin).toEqual({ model: false, effort: false });
  });

  test('unknown commands cannot accidentally turn on disclosure', () => {
    expect(() => transitionControl(restoreState([]), 'automatic --accept-disclosure')).toThrow();
  });
});

describe('active branch persistence and evidence', () => {
  test('restores only valid state entries supplied by the active branch', () => {
    const active = transitionControl(initialState(), 'observe --accept-disclosure');
    const restored = restoreState([
      { type: 'custom', customType: 'another-extension', data: { mode: 'auto', disclosure: true } },
      { type: 'custom', customType: 'volit', data: { version: 1, state: active } },
      { type: 'custom', customType: 'volit', data: { version: 1, state: { mode: 'auto' } } },
    ]);
    expect(restored.mode).toBe('observe');
    expect(restored.disclosure).toBe(true);
  });

  test('never discloses system, tool, image, thinking, or custom-entry payloads as continuity text', () => {
    const entries = [
      { type: 'message', message: { role: 'system', content: 'SYSTEM_SECRET' } },
      { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'TOOL_SECRET' }] } },
      { type: 'custom', customType: 'volit', data: { prompt: 'CUSTOM_SECRET' } },
      { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'user task' }, { type: 'image', data: 'IMAGE_SECRET' }] } },
      { type: 'message', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'THINKING_SECRET' }, { type: 'text', text: 'visible answer' }] } },
    ];
    expect(extractContext(entries)).toEqual([{ role: 'user', text: 'user task' }, { role: 'assistant', text: 'visible answer' }]);
  });
});
