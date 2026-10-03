# Research: Volit routing integrations

## Scope

Establish what a harness-independent, session-aware router can observe and control, with OMP as its first integration. Check Jev's actual judgement contract and jcode as a second integration boundary without letting AGTX or any other launcher define Volit's architecture.

Research date: 2026-10-01. This is source and documentation research, not proof of a functioning integration.

## What exists today

The local Volit directory was empty. The project is https://github.com/stuplum/volit. The starting brief is https://chatgpt.com/share/6abe550f-02bc-83ed-8e57-d46536feaea5.

User requirements established in this conversation:

- Volit must not base decisions on AGTX or require AGTX integration.
- OMP is the first intended execution environment, regardless of what launches it.
- This repository can also host Volit integrations for jcode and other harnesses.
- Jev supplies judgements; deterministic policy owns constraints and execution decisions.
- Appropriate capability, rather than minimum cost, is the objective.
- Not Diamond is excluded.

## OMP 18.4.8

Verified by the installed package manifest and `omp --help`. Source root: `/Users/stuart.plumbley/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`.

### Public extension surface

In `/Users/stuart.plumbley/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts`:

- Lines 412-430: `ctx.models.list()`, `current()`, `resolve()` and `family()`. The list is documented as authenticated models available to the session; this is not proof a live request will succeed. Family identity is not cache identity.
- Lines 458-510: current model, mode, context usage, read-only session manager, idle/pending status and agent identity. `runEphemeralTurn` is optional, inherits context/provider hooks, and does not execute tool calls.
- Lines 816-838: `before_agent_start` receives transformed prompt text and images; `before_subagent_spawn` receives agent name, model patterns and an optional spawn key. The latter does not include the delegated task's prompt or acceptance criteria.
- Lines 1008-1014: `input` is documented as interactive-only, despite its source union including other names.
- Lines 1574-1599: custom session entries, model selection and concrete thinking-level selection.
- Lines 539-552: `invokeTool` is same-tool delegation for a re-registered built-in. It is not a general-purpose arbitrary-tool execution API.

### Timing matters

The only `emitInput()` invocation found in the installed source is `/Users/stuart.plumbley/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/controllers/input-controller.ts:924`. The runner implementation is at `/Users/stuart.plumbley/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/runner.ts:1909-1933`.

In `/Users/stuart.plumbley/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/agent-session.ts`:

- Lines 7315-7345: queued user-containing batches also reach agent-start preparation when actually delivered.
- Lines 7355-7378: system-prompt preparation precedes the awaited `before_agent_start` event.
- Lines 7441-7506: usage preflight, current-model/auth checks, recovery compaction and plan-yolo preparation precede that event on ordinary prompts.
- Lines 7563-7588: agent-start preparation precedes native automatic-thinking classification.
- Lines 7591-7606: normal pre-prompt compaction runs afterwards.

Therefore neither 'input handles every mode' nor 'before_agent_start precedes all model-dependent work' is a valid assumption. A working integration must demonstrate lifecycle safety, not merely call an available setter.

### Existing controllers

`/Users/stuart.plumbley/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/model-controls.ts:224-263` shows model selection validating configured auth, refreshing model metadata, resetting provider-session state, recording the selection, reapplying thinking and synchronising model-dependent state. It has awaited steps and is not a documented atomic compare-and-set operation.

The same file at lines 598-677 implements native auto-thinking: a bounded difficulty classification, generation checks, supported-effort clamping and session persistence. `omp --help` explicitly identifies TypeSafe judgements as powering automatic thinking and exposes `--thinking auto`.

OMP also has prewalk and plan-yolo model hand-offs, plus retry-fallback restoration. Volit must not silently fight these controllers or mistake every non-Volit model change for a manual user choice.

### Delegation limits

The public subagent-spawn hook can influence an already-requested child model. It cannot create a bounded task from nothing or judge a task it has not been given. A no-tool ephemeral side turn is not a substitute for an isolated tool-capable subagent. The general SDK is a possible execution route for an explicit bounded child task, but its context, permissions, cancellation, result delivery and extension inheritance still need an integration probe.

## Jev

Primary references:

- [HTTP API](https://docs.typesafe.ai/api)
- [Choice](https://docs.typesafe.ai/primitives/choice)
- [Confidence](https://docs.typesafe.ai/confidence)
- [Models and data handling](https://docs.typesafe.ai/models)
- [Known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

Verified documented contract:

- `POST https://api.typesafe.ai/v1/systemone`, bearer authentication.
- Request contains `model`, `state` and named `questions`. `state` accepts a string, object or array; `state.text` is an application convention, not a required API wrapper.
- Choice returns `choice`, a probability per configured option, and `confidence`. Confidence is derived from the distribution, not a second independent predictor of coding success. The formula in the documentation's interactive demo is explicitly an approximation, not a backend contract.
- Current documented version: `jev-1.13.0`. Aliases can move; evaluation should record the returned version and pin the requested version.
- Maximum 255 Choice options; 64k tokens per request, with a separate 32k limit for state plus the longest question. These are ceilings, not recommended routing-context sizes.
- Jev does not generate task briefs. Arithmetic, budgets, token limits, allowed actions and orchestration belong in code.
- The vendor documents failures with large irrelevant state, numerical reasoning and adversarial text. A routing judgement is not a permission grant.
- Requests go to a hosted service. The docs state no training on customer requests/responses and mention enterprise zero-data-retention terms. That does not establish zero retention for this account.

No Jev API call was made and no credentials were inspected. Classification quality, latency and calibration for Volit's actual workload remain unmeasured.

## Jcode

Ran `jcode --help`, `jcode version` and `jcode api-bridge --help`. Installed version: `0.84.0`, commit `57d587899`.

References:

- [Version-matched SDK README](https://github.com/1jehuang/jcode/blob/v0.84.0/sdk/typescript/README.md)
- [Current SDK guide](https://jcode.sh/sdk)

The TypeScript SDK exposes a versioned harness API with private-instance launch or explicit attachment, model enumeration/selection, reasoning-effort selection, session history and usage/events. An SDK-driven client can sequence selection before its own `sendMessage` or `run` call.

This does not establish a blocking interception hook for prompts entered in the native jcode UI. Event observation after message acceptance is not equivalent to owning the pre-inference boundary. Private SDK instances also inherit provider logins by default and are not OS sandboxes.

Jcode is a real second consumer candidate for a TypeScript core despite its Rust implementation. No jcode daemon was launched or existing session attached during this research.

## Prior art and conventions

[dirien/jev-router](https://github.com/dirien/jev-router) and its [design notes](https://github.com/dirien/jev-router/blob/main/docs/design.md) provide a useful proxy-based precedent: per-human-turn decisions, small decision context, explicit overrides, visible failures and an upward-only tier ratchet with reset conditions.

These are precedents, not requirements. A universal upward-only ladder may be inappropriate for specialist profiles or fresh bounded delegates. Proxy request rewriting, credential forwarding and provider reasoning-block conversion belong to the harness in Volit's proposed integration, not a new Volit gateway. No code was copied. The reference repository is Apache-2.0 licensed; future copying requires its licence/notice obligations to be reviewed.

## Open questions for planning

1. Can stock OMP safely apply decisions at the same semantic boundary across interactive, queued, print and RPC prompts, including cancellation and manual intervention? If not, which minimal public hook is missing?
2. Can the adapter reliably distinguish manual selection from native hand-offs and preserve a manual pin during an awaited decision?
3. Which context-size estimates and provider-session identifiers are available before switching, and when must an automatic switch be refused because they are unknown?
4. Can an isolated child session inherit the intended permission/tool restrictions and return a bounded result without routing recursion?
5. What disclosed subset of session text may be sent to Jev? How much context is sufficient for short continuation prompts?
6. Which workload profiles, target mappings and decision thresholds perform acceptably on held-out representative tasks?

These questions require bounded probes or user design approval. They are not reasons to make AGTX a dependency or to duplicate each harness's execution engine.
