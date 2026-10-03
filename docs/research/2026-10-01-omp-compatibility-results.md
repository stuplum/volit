# OMP 18.4.8 compatibility gate: observed results

Date: 2026-10-01. Scope: the approved compatibility gate, not a production adapter or a model-quality evaluation.

## Decision

**Stock OMP 18.4.8 fails the original atomic cancellation/manual-precedence guarantees. Model selection itself works through the public extension API.**

The decisive counterexample is a real asynchronous `api.setModel()` operation: while its LM Studio metadata lookup was held, a manual RPC model selection completed successfully. Releasing the older automated setter overwrote that acknowledged manual selection, and inference ran on the automated model. A pre-setter revision check cannot prevent this interleaving.

There are separate failures: `input` is absent in print/RPC; `before_agent_start` runs after old-model credential preflight and system-prompt preparation; an acknowledged abort does not prevent a held extension handler from subsequently changing the model. None of these findings is inferred merely from source.

**The standalone SDK import path failed because of installed package resolution.** Both standalone import and a parent extension importing SDK source fail before child construction. This is a path-specific result, not proof that every public child-execution route is broken.

After reviewing these findings, Stuart chose opt-in automatic switching on stock OMP rather than a modified build, explicitly accepting the simultaneous manual-selection race. The integration retains pre-application checks and documents the remaining cancellation limitation. No upstream changes are required for that revised contract.

A subsequent actual-CLI probe accessed the SDK through the extension's public `api.pi` object instead of importing SDK source. `createAgentSession`, `Settings` and `SessionManager` were available; a restricted child completed on model `child` with only the `read` tool and `CHILD_ONLY` context, while its parent continued on `parent` with `PARENT_ONLY`. This resolves the construction blocker through the supported bundled API. The original gate table below remains the record of the earlier source-import experiments; production delegation verification is recorded separately.

## Pinned runtime and isolation

| Item | Observed value |
| --- | --- |
| OMP | `@oh-my-pi/pi-coding-agent` **18.4.8**; `omp --help` also prints `omp v18.4.8` |
| Bun | **1.4.2**, help identifies revision `744846f84` |
| Bun executable | `/Users/stuart.plumbley/.asdf/installs/bun/1.4.2/bin/bun` |
| Installed CLI | `/Users/stuart.plumbley/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js` |
| Package JSON SHA-256 | `37b37499ac486b5ef8e43215e8cd694c1394912c3112fadecf79873f819dc325` |
| CLI SHA-256 | `e81e710e7636d91cb3417059c3cac12a8b8d1db82fbfe17bd030ea81cd67384b` |
| Package repository metadata | `https://github.com/can1357/oh-my-pi`, directory `packages/coding-agent` |
| Disposable root | `/var/folders/21/vkwbc_5n4012fynv011dl12r0000gw/T/volit-omp-probe-DzYlUD` |
| Loopback provider | `127.0.0.1:55519`; secondary synthetic metadata service `127.0.0.1:57548` |

Fixture files were materialised from the gate plan under the fresh `mkdtemp` root. Each OMP/SDK child received an explicit allowlisted environment: scratch HOME, all four XDG directories, scratch `PI_CODING_AGENT_DIR`, system-only PATH, TERM, LANG and fixture variables. The lazy-metadata case additionally set `LM_STUDIO_BASE_URL` to the secondary loopback fixture. No inherited provider keys, personal settings or personal sessions were supplied. All sessions read or resumed were generated under that root. Provider keys were synthetic constants. The failing credential-preflight case used only the synthetic command `!/usr/bin/false`.

Common actual CLI arguments:

```text
bun <installed-dist-cli> --cwd <root>/work --model volit-probe/a
  --no-extensions --extension <root>/extension.ts
  --no-skills --no-rules --no-lsp --no-pty --no-title --no-tools
```

Print added `--print <prompt>`. RPC added `--mode rpc --no-ui`; the driver waited for the actual `ready` frame, correlated responses by `id`, and waited for `prompt_result`, not merely prompt acknowledgement. Actual TUI runs used a PTY with neither print nor RPC options.

Ledger sequence numbers below are fixture arrival order, not a universal ordering of simultaneous host operations. Race ordering is established by gate entry, **awaited successful RPC acknowledgement**, then gate release. All inference requests were loopback synthetic responses; no paid inference or Jev calls occurred. The TUI displayed OMP's normal “18.4.9 is available” update notification; this investigation does not claim that the stock CLI performs no ancillary network activity.

## Per-invariant verdicts

`pass` is limited to the behaviour actually described. A passing route-selection subcase does not override a failed lifecycle requirement.

| Invariant | Verdict | Observed evidence |
| --- | --- | --- |
| Interactive input | **pass** for route selection | Real PTY `input` case: 140–149, provider 147 uses `b`; terminal shows `Volit probe b` and `FIXTURE_RESPONSE:b`. Fresh `before_agent_start` TUI: 154–163, provider 161 uses `b`; same completed terminal output. |
| Print input | **fail** for input-hook coverage; **pass** for late-hook route selection | 8–14: `input` never runs, actual CLI returns `FIXTURE_RESPONSE:a`. 15–23: `before_agent_start` calls setter successfully, actual CLI returns `FIXTURE_RESPONSE:b`, provider 21 uses `b`. |
| RPC input | **fail** for input-hook coverage; **pass** for late-hook route selection | 24–29: `input` selector leaves `a`, terminal `prompt_result` completed. 30–37: late hook selects `b`, terminal result completed and `get_state.model.id=b`. |
| Queued input | **pass** for delivered-user boundary | 56–72: queued follow-up observed through `get_state`; no decision while first provider gate owns execution; decision 65 occurs after release 62, delivered second request 68 uses `b`. |
| Repeated identical prompt | **pass** | 73–87: two separately completed `VOLIT_ROUTE repeat` prompts produce decision IDs 1 and 2, not one text-hash decision. |
| Before model-dependent preparation | **fail** | 224–225 and actual CLI error: old-route API-key validation fails before `before_agent_start` can run. 90/105 also expose an already-prepared `volit-probe/a` system prompt to the hook. |
| Prepared prompt consistency after switch | **unproven** in general; observed simple prompt refresh succeeds | Provider requests on `b` carry the stock workstation model line `volit-probe/b`, so there is no claim that this simple prompt remained stale. Old-model preflight/recovery work and arbitrary earlier extension preparation are not undone by that successful refresh. |
| Context incompatibility | **unproven** | 116–126 switch to advertised 4096-window `small`; provider 124 accepts the synthetic short prompt. This is not a conservative target-model sizing proof and not evidence of safety near overflow. No transcript was truncated to force a pass. |
| Manual change during judgement | **fail** for naive candidate hook | 38–48: acknowledged manual choice `manual` is overwritten by held decision selecting `b`. An adapter can detect a completed earlier change through live route/leaf revalidation; that does not solve the inside-setter race below. |
| Manual change during awaited setter | **fail**, actual interleaving | 231–240: automated setter enters; real lazy metadata request holds; RPC manual change completes; release resumes old setter; final selected and provider model is `delayed`. |
| Abort during judgement | **fail** for stale mutation prevention; provider cancellation itself passes | 49–55: abort acknowledgement precedes release, terminal prompt status is `aborted`, no provider request occurs, but setter returns accepted and final selected model is `b`. |
| Branch/resume persistence | **pass** for active-branch visibility; **fail** for naive stale transition mutation | 186–189: branching to real user entry preserves only decision 1; resuming original scratch session restores decisions 1 and 2. 190–197: `new_session` succeeds during held advice; releasing old handler still reports accepted application against the new session. |
| Removed queued work | **pass** | 210–221: RPC removal returns `removed:true`, queue becomes empty; after releasing the first request, there is no second decision/provider request. |
| Extension ordering | **fail** for order-independent observation | Route-first observer sees `b` at 93. Observer-first sees `a` at 104, then routing selects `b`. A normal late hook cannot promise earlier extensions prepared against the chosen model. |
| Native controller ownership | **unproven** for complete provenance/coexistence | Native RPC cycling and thinking selection execute; persisted entries expose route/configured thinking, but no general public model/effort change event or atomic ownership revision is exposed. Native prewalk, automatic thinking judgement and fallback were not executed. |
| Child selected context | **unproven** | SDK import fails before child creation. No child provider request exists. |
| Child permissions / actual read / denied write | **unproven** | Same import blocker. No real read or forbidden-write result was produced; do not infer permission enforcement from `toolNames`. |
| Child parent cancellation | **unproven** | Standalone and parent extension paths both fail before a child can be constructed. |
| Child return / parent continuity | **unproven** | Real parent CLI rejects the delegate extension import, then continues its ordinary baseline request. This is not successful delegation. |

## Captured counterexamples and successful boundaries

### Baseline and execution modes

The baseline print command completed with exit 0, stdout `FIXTURE_RESPONSE:a`, stderr `Working...`; provider request 5 had `model:a`. This established valid fixture transport before interpreting any routing result.

Print results:

```text
VOLIT_PROBE_HOOK=input
prompt: VOLIT_ROUTE print-input
exit: 0
stdout: FIXTURE_RESPONSE:a
ledger: 9 before_agent_start; 12 provider_request model=a; no input event

VOLIT_PROBE_HOOK=before_agent_start
prompt: VOLIT_ROUTE print-agent-start
exit: 0
stdout: FIXTURE_RESPONSE:b
ledger: 16 before_agent_start; 18 decision_applied accepted=true; 21 provider_request model=b
```

RPC in separate fresh processes:

```json
{"type":"prompt_result","id":"first","agentInvoked":true,"status":"completed","sessionSettled":true}
```

Both runs emitted that terminal frame. The input-selector run settled on `a`; the before-agent-start run settled on `b`.

For queue delivery, first prompt `VOLIT_PROVIDER_HOLD first` reached provider gate 61. `follow_up` acknowledged successfully and `get_state` returned:

```json
{"steering":[],"followUp":["VOLIT_ROUTE queued-second"]}
```

Releasing provider gate 62 allowed `before_agent_start` 64 with prompt exactly `VOLIT_ROUTE queued-second`; decision 65/66 selected `b`. Provider request 68 used `b`. The retained hold marker in history caused a second deliberate provider hold at 69, separately released at 70. The original prompt then returned `completed`, `sessionSettled:true`. Only one queued message was supplied; multi-message batch semantics were not independently exercised.

Repeated prompt snapshots used session `01a0f806-c9cf-7336-9704-e2f5e9dada62`: decision 1 at 75 observed leaf `ef6bb531`; decision 2 at 82 observed leaf `3f9f9800`. The driver separately awaited terminal frames `repeat1` and `repeat2`. Identical text therefore produced two distinct decision invocations.

### Real TUI proof

Two real PTY services ran the isolated launcher. Initial first-run onboarding intercepted the first attempted input as provider search; it was cancelled with Ctrl-C without logging in. The actual prompt was then submitted to the editor. This unsuccessful initial submission is not counted as a prompt boundary.

Observed completed terminal content for the input-selector run:

```text
Volit probe b
volit-probe
VOLIT_ROUTE interactive
FIXTURE_RESPONSE:b
π > … Volit probe b … 131K
```

The fresh before-agent-start run similarly displayed `VOLIT_ROUTE interactive-start`, `FIXTURE_RESPONSE:b`, and selected `Volit probe b`. Both owned PTY services were stopped after observing their completed replies. No SDK or RPC result was substituted for TUI evidence.

### Preparation and ordering

Instrumentation recorded the actual `before_agent_start` event keys as `type,prompt,images,systemPrompt`. At 90 and 105 its system prompt already contained `Model: volit-probe/a`, while route selection occurred later. The simple stock prompt was rebuilt to `b` before actual inference, as observed in provider bodies. This successful refresh does not retroactively move the hook before preflight.

To prove preflight ordering, a second synthetic provider `volit-noauth/a` used `apiKey:'!/usr/bin/false'`, while the allowed target `volit-probe/b` remained available. With `VOLIT_PROBE_HOOK=before_agent_start` and `VOLIT_ROUTE preflight-command`, the actual print process exited 1:

```text
Working...
error: No API key found for volit-noauth.
```

Only session-start records 224–225 appeared. There was no `before_agent_start`, setter or provider request. An earlier attempt to register this provider without any `apiKey` was rejected at startup with `"apiKey" or "oauth" is required when defining models`; that fixture-configuration error is not the ordering result.

The two-extension order probe loaded the observer before and after the router. The observer saw `b` in route-first order (93) and `a` in observer-first order (104). The result is an actual dependency on extension load order, not speculation about callbacks.

### Manual selection during pending judgement

The real RPC driver performed this ordered exchange:

```text
prompt hold: VOLIT_ROUTE VOLIT_DECISION_HOLD
41 gate_enter decision
set_model(provider=volit-probe,modelId=manual)
response id=manual command=set_model success=true data.id=manual
42 gate_release decision waiting=1
44 decision_applied accepted=true state.model=volit-probe/b
47 provider_request model=b
prompt_result id=hold status=completed sessionSettled=true
get_state model.id=b
```

This diagnostic hook deliberately lacks a guard. A live session/leaf/current-route check could reject an already completed change before calling the setter. It cannot establish precedence over a change that lands while the setter is awaiting host work.

### Decisive manual selection during the actual awaited setter

The proposed `fetchDynamicModels` gate did **not** produce an in-setter race. Its callback ran at 198 with `inSetter:false`; setter enter 202 and exit 203 completed without another catalogue callback. It would be incorrect to call that startup refresh evidence of a race.

The reachable public seam was LM Studio's lazy runtime metadata refresh. A diagnostic extension registered a synthetic `lm-studio/delayed` model pointing at the loopback metadata fixture, with `LM_STUDIO_BASE_URL` set to the same fixture. The fixture served model catalogue metadata normally at startup, then held `/api/v0/models` only after the extension armed it immediately before calling the **real** `api.setModel`. No private field, setter replacement or installed package edit was used.

Captured ordering:

```text
228 lazy_metadata_request /api/v0/models armed=false
229 lazy_metadata_request /v1/models armed=false
231 lazy_setter_enter model=a leaf=2578b054
232 lazy_metadata_request /api/v0/models armed=true
233 gate_enter metadata
RPC request id=manual-during-setter type=set_model provider=volit-probe modelId=manual
RPC response id=manual-during-setter success=true data.id=manual
234 gate_release metadata waiting=1
235 gate_exit metadata
236 lazy_setter_exit accepted=true model=delayed leaf=0536a152
240 provider_request model=delayed
prompt_result id=lazy-race status=completed sessionSettled=true
get_state model.id=delayed
```

A post-first-response metadata refresh also reached gate 242; it was explicitly released during teardown. That later background refresh is not the claimed setter race.

This proves failure of manual-change precedence inside the awaited host setter, even if an adapter checked current route, leaf and its own decision revision immediately before invocation. Trying to restore the manual model afterwards is another unconditional asynchronous write; it is not an atomic guarantee and could overwrite a still newer selection.

### Abort and transitions

Abort experiment:

```text
52 gate_enter decision
RPC response id=abort command=abort success=true
53 gate_release decision waiting=1
55 decision_applied accepted=true state.model=volit-probe/b state.idle=true
prompt_result id=abort-case status=aborted sessionSettled=true
get_state model.id=b messageCount=0
```

There was **no** inference after abort in this case. OMP invalidated delivery, but did not invalidate the extension's later unconditional setter. `isIdle()` is observable; it is not a stable cancellation token and does not make the asynchronous setter conditional.

Persistence used only `api.appendEntry('volit-probe',{decision,model})` after accepted selection. RPC `get_entries` and `get_tree` supplied the actual eligible user entry `6d8367a4`. Branching at it succeeded and created session `01a0f80b-1ca2-7535-9c2a-5ad3164243d4`, leaf `729b940c`; the active branch exposed decision 1 only (187), not abandoned decision 2. Switching back to the recorded original scratch session succeeded; leaf `19efa53d`, both decision entries visible (189). Custom routing entries were not copied into provider context.

A later held decision accepted `new_session` (`success:true`, `cancelled:false`) while waiting at 192. A `session_switch` event occurred at 193. After release, the old handler still returned `decision_applied accepted:true` at 197. The old prompt's terminal status was aborted. A session-change listener can invalidate adapter advice before calling a setter, but the host setter itself does not enforce that ownership.

### Native ownership observations

In a fresh isolated RPC session, `cycle_model` succeeded and changed `a` to `b`; the response said `isScoped:false` despite the supplied two-model `--models` argument. This observation is recorded without attributing an uninvestigated cause. `set_thinking_level(high)` and `set_thinking_level(auto)` both acknowledged success. These synthetic models are non-reasoning: the persisted effective thinking level was `null`; the final configured value was `auto`. This does not exercise a TypeSafe automatic judgement and does not establish effort adjustment on a reasoning model.

Session entries expose completed `model_change` and `thinking_level_change` records. They do not establish a globally atomic revision or reliable manual/native provenance. Conservative coexistence can compare the current route and active branch with the last confirmed adapter outcome and suspend on an unexplained difference. Specific `retry_fallback_applied`/`retry_fallback_succeeded` events exist, but there is no general public change event covering manual model/effort changes, prewalk and all controllers. Full native prewalk, fallback and automatic-thinking coexistence therefore remains unproven. No personal TypeSafe credentials were supplied to make it run.

## SDK child result: installed import blocker

All following attempts used the isolated allowlisted environment and **failed before creating any child session**:

1. Plan's standalone `child.ts` importing the public `src/index.ts` entrypoint.
2. Same entrypoint with Bun's explicit documented `--extension-order=.ts,.tsx,.js,.jsx,.json` and `--no-install`.
3. Direct exported `src/sdk.ts` import of `createAgentSession` with `--no-install`.
4. Actual bundled OMP CLI loading `delegate-extension.ts`, which imports `runChildProbe` from `child.ts`.

Standalone output, exit 1:

```text
SyntaxError: Export named 'createRatchetPrelude' not found in module
'/Users/stuart.plumbley/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/ratchet/prelude.js'.
Bun v1.4.2 (macOS arm64)
```

Actual parent CLI stderr:

```text
Failed to load extension …/delegate-extension.ts: Failed to load extension:
Export named 'createRatchetPrelude' not found in module '…/src/ratchet/prelude.js'.
Working...
```

The parent then completed `FIXTURE_RESPONSE:a` with exit 0. Its ordinary completion is **not** evidence of child success. No child-model provider request occurred anywhere in the ledger.

Installed `src/sdk.ts:271` imports `./ratchet/prelude` and uses `createRatchetPrelude` at 2328. Both `src/ratchet/prelude.js` and `prelude.ts` are shipped; the factory is exported by `prelude.ts:279`, while runtime import resolved the `.js` file. Package exports map `.` to `src/index.ts` and `./*` to `src/*.ts`; direct SDK import therefore does not bypass the collision. The installed source/binary was not patched, copied into a modified replacement, bundled anew or monkey-patched to manufacture a passing stock result.

### Child implementation recipe to validate after package repair

This is a concrete **unverified recipe**, not an implemented or permission-proven adapter:

- Use the public `AuthStorage`, `ModelRegistry`, `Settings`, `SessionManager` and `createAgentSession` exports after the packaging defect is fixed.
- Parent tool receives the already supplied bounded task/selected context and its actual execution `AbortSignal`; do not read/copy parent history. Capture parent session and route for result ownership.
- For the synthetic gate use separate scratch auth storage, `Settings.isolated()`, explicit registered child model and `SessionManager.inMemory()`.
- Construct with explicit cwd/agentDir/model/registry/auth, bounded explicit system prompt, `toolNames:['read']`, `restrictToolNames:true`, `disableExtensionDiscovery:true`, empty skills/rules/contextFiles/promptTemplates/slashCommands, `enableMCP:false`, `enableLsp:false`, `enableIrc:false`, `cacheWarming:false`, `skipPythonPreflight:true`, and `bindProcessState:false`.
- Check pre-aborted signal before dispatch; register an abort listener forwarding to public `session.abort()`; check again after prompt settlement and before returning. Reject assistant error/aborted stop reasons. Await abort settlement, `session.dispose()`, then close owned auth storage in nested `finally` cleanup.
- The real parent tool must return exactly one result for its originating call only if neither cancellation nor parent/session ownership invalidation occurred. Preserve parent route rather than changing it to simulate delegation.
- Next runtime proof must capture the actual child wire tool schema, issue a real read of a unique scratch value, observe that tool result in the next provider request, request forbidden write and verify unchanged bytes, then repeat cancellation through the real parent tool signal and observe no late delivery.
- Tool availability is **not** a filesystem/OS sandbox. Production must inherit or explicitly preserve host restrictions and provider permissions; the synthetic separate auth store is not a production credential-handling design. If those restrictions cannot be carried through the public SDK, that is an additional host-contract blocker, not permission to enable broader defaults.

## Smallest required upstream public contract

The following can be one host-owned admission/proposal operation plus a route-change notification; a generic plugin framework or private Volit fork is unnecessary. Names are illustrative, not claimed existing APIs.

1. **Delivered-user routing boundary before model-dependent preparation.** Fire once for each actually admitted direct user turn or delivered queued user batch across TUI, print, RPC and SDK paths. It must precede usage/auth preflight, recovery/compaction, model-specific system/tool preparation and provider dispatch. Preserve ordinary transforms/batch attribution explicitly; do not fire for every tool continuation or removed queued item.
2. **Host-owned identity and cancellation.** Supply stable delivery ID, session ID, branch/leaf identity, monotonic execution/route/effort revision and an `AbortSignal`. Abort, replacement, branch/session transition and disposal invalidate it immediately, including while a handler or metadata refresh is awaiting. Adapter-owned counters supplement but cannot replace this host revision.
3. **Conditional atomic application.** Accept an allowed model/effort proposal together with the expected host revision/owner and boundary token. After every asynchronous prerequisite, commit only if that exact boundary remains live and revisions still match. Model and effort must be committed together or return an explicit partial outcome. An old request must never write its route or effort after a newer manual selection is acknowledged. Manual/native commands increment the revision when admitted, not only after their own slow work completes. Host serialisation or compare-and-set must cover metadata refresh, provider-session reset, thinking reapplication, persistence and synchronisation—not just an early extension-side check.
4. **Preparation and fit contract.** On an accepted selection, prepare the system/tools/transcript for the winning model and expose a conservative target-specific context bound including overhead/output reserve, or return incompatibility/unknown before mutation. Do not silently compact or truncate merely to accommodate an automated smaller target. An unchanged route retains normal explicit host recovery/error behaviour.
5. **Ownership visibility.** Expose configured and effective effort separately, native-auto ownership, and route/effort changes with an origin or an explicit `unknown` origin plus revision. Unknown foreign changes must allow conservative suspension. Do not force Volit to infer provenance from model equality or restore a user's native controller by guessing settings.
6. **Settled outcome and visible errors.** Return `applied`, `rejected-stale`, `cancelled`, `incompatible`, or an explicit partial/unknown outcome with observed final state/revision. Keep failures visible in TUI/print/RPC; only persist confirmed application. Do not convert an extension error into a false successful recommendation/application record.
7. **SDK packaging prerequisite.** Repair the public SDK import collision without requiring consumers to patch private imports; ship a version whose exported `createAgentSession` actually imports in the supported runtime. Then validate the child restriction/cancellation/return recipe and supply any missing native permission inheritance contract revealed by those probes.

Relevant installed source, relative to the package root:

| Source | Evidence, not a runtime substitute |
| --- | --- |
| `src/extensibility/extensions/types.ts:458–510` | Public context has current model, model query facade, `isIdle()`, `abort()` action and read-only session manager; no delivered-boundary cancellation token or conditional setter revision. Ephemeral-turn inherited cancellation is specific to that API, not a general signal for Jev/setModel. |
| `src/extensibility/extensions/types.ts:817–824` | `BeforeAgentStartEvent` exposes prompt/images/systemPrompt only. |
| `src/extensibility/extensions/types.ts:1353–1420` | Event registrations include session transitions, input, retry-fallback and provider events; no general route/effort mutation or prompt-aborted revision event. |
| `src/extensibility/extensions/types.ts:1592–1599` | `setModel(model):Promise<boolean>`; effective thinking getter and unconditional thinking setter. No expected generation/signal argument. |
| `src/session/agent-session.ts:7355–7378,7441–7506,7563–7605` | Internal generations and setup signal exist, but are not passed to the extension event. Model preflight/auth/recovery precede the hook; auto thinking and further compaction follow it. |
| `src/session/agent-session.ts:9117–9144` | Abort increments private prompt generation and aborts private setup controller. |
| `src/session/model-controls.ts:224–262,273–301` | Setter awaits metadata refresh before model commit; no expected revision comparison, followed by session entry, thinking reapplication and asynchronous synchronisation. |
| `src/config/model-registry.ts:657–698` | Lazy runtime metadata path for llama.cpp/LM Studio, used by the successful race instrument. |
| `src/config/model-discovery.ts:737–769` | Actual LM Studio `/api/v0/models` selected-model metadata refresh. |
| `src/sdk.ts:271,2328`, `src/ratchet/prelude.ts:279`, package export map | Public SDK packaging blocker described above. |

A new hook without conditional atomic application is insufficient. A CAS setter without an early all-mode boundary and cancellation is also insufficient. A TUI-only `input` integration, post-hoc route restoration, provider request rewriting or a separate launcher wrapper does not satisfy the approved design.

## What is safe to deliver on stock OMP

A non-mutating **observe-only** extension can use `before_agent_start` for delivered prompt recommendations in the successful TUI/print/RPC/queue cases. It must be explicitly enabled, disclose the bounded evidence sent to Jev, use its own network deadline, never invoke route/effort setters, and never represent a recommendation as an applied change. It must conservatively suppress or clearly mark stale advice after observable route/session changes.

This is a narrower product capability, **not completion of the approved automatic adapter**. Stock API cannot immediately propagate a pre-start abort into an arbitrary pending Jev fetch through a public boundary signal; an extension must not claim that cancellation property. Independent child execution is not currently proven usable even in observe mode because public SDK import fails. Parent should request approval for the upstream prerequisite rather than silently relabel this narrower behaviour as the agreed end-to-end result.

## Limits and cleanup

No tests, builds, linters, formatters, package installations, commits or upstream edits were run. This was actual runtime investigation only. No real-provider quality, cache economics, Jev calibration, context-limit enforcement or permission sandbox was evaluated by synthetic completions.

The report preserves relevant output and event sequences, not the complete synthetic ledger. Owned provider, metadata, PTY and RPC/SDK processes were terminated; every entered fixture gate was released. Disposable fixtures/state were removed only from the exact root returned by `mkdtemp`. The two related design/research documents were intentionally left to the parent integration owner; this worker owned only this report and disposable scratch files.

## Production extension verification after the accepted contract revision

The implemented extension was loaded into the unchanged installed OMP 18.4.8 CLI from `/Users/stuart.plumbley/Personal Workspace/volit/packages/omp/src/index.ts`. Bun was 1.4.2. The fixture used a temporary HOME, XDG directories, OMP agent directory and workspace, plus a synthetic key and loopback Jev/inference endpoints. No personal sessions or provider credentials were used.

The launch used explicit `--extension` arguments for the fixture provider and Volit, `--tools read,volit_delegate`, and `--volit-endpoint` for the loopback judgement endpoint. Tests exercised the production core, Jev client and extension together. These are real OMP runtime results with synthetic model replies, not a claim about model quality.

### Observed production behaviour

| Scenario | Captured result |
| --- | --- |
| Automatic model change | One Jev request; `Applied switch: volit-fixture/b:low`; provider model `b`; stdout `RESULT:b` |
| Suitable current route | One Jev request; `current_route_suitable`; provider model `a` |
| Effort change | `Applied adjust: volit-fixture/a:high`; provider model remains `a` |
| Observe | Recommendation selects `b`; actual provider remains `a` |
| Off, installation default, activation without consent | Zero Jev requests; provider remains `a` |
| Explicit off when resuming enabled state | Zero Jev requests; restored automatic mode does not override `--volit off` |
| Jev deadline | A visible `Judgement timeout` message; current route `a` preserved |
| Smaller-context and unavailable targets | Those profiles are absent from the transmitted choice options; current route remains `a` |
| Manual choice while judgement is pending | RPC `set_model` acknowledges `manual`; old advice is discarded; final model remains `manual` |
| Pin | `/volit pin` followed by a routing prompt produces zero Jev requests and retains model `a`, effort `low` |
| Queued delivery | First request runs on `a`; a follow-up is queued; its delivered boundary selects `b`; final queue is empty |
| Repeated identical prompts | Two separately completed prompts produce two Jev requests, not a text-hash cache hit |
| Active branch restoration | Branching away from a later `off` entry restores the ancestor's enabled state |
| Cancellation while Jev is pending | No provider request; terminal RPC result is `aborted`; stale advice is discarded |
| Real terminal surface | PTY displays `Applied switch: volit-fixture/b:low`, `RESULT:b` and selected model `b` |

The queued-delivery capture's first judgement timed out while its fixture gate was held. The second delivered prompt still selected `b`; this is evidence of delivery-boundary routing, not a claim that both judgements completed successfully.

### Bounded delegation

The production `volit_delegate` tool used `api.pi.createAgentSession` from the bundled host. Its child inherited neither parent message history nor additional tools.

- The actual child provider request selected model `child`, offered exactly the `read` tool and contained the explicit `CHILD_TASK READ_VALUE` brief with `ONLY_SELECTED_CONTEXT`.
- A real read returned `VOLIT_UNIQUE_READ_7E18`. The parent received those findings as the result of `delegate-0` and resumed inference on model `a`.
- A child-requested write returned `Tool write not found`. The protected file was subsequently read and still contained `VOLIT_UNIQUE_READ_7E18`.
- Two concurrent delegates each returned the real read result to their distinct `delegate-0` and `delegate-1` calls. An initial failure exposed the SDK's default `Main` agent identity collision; assigning distinct public child identities fixed it.
- Cancelling the parent while its child request was held produced an acknowledged RPC abort, terminal status `aborted`, settled session state and parent model `a`. Captured provider calls stopped at the initial parent and child requests.

Read-only tool admission is not an OS/filesystem sandbox. The documented child working-directory restriction does not turn OMP's read tool into a chroot.

### Native ownership

The initial `--thinking auto` selection can precede any persisted thinking-change entry. Ownership detection therefore also considers the actual CLI selection and public project/global defaults. The corrected status capture identifies the host as effort owner.

A production-adapter fixture drove an effective-effort transition from low to high while the host owned effort. Automation remained enabled; a later foreign model change suspended it. This fixture used a synthetic public host facade, not a paid native classifier. An actual stock-OMP auto-thinking model switch also reached `b` at high effort; the ledger includes the host's synthetic fallback-classifier requests separately from Volit's judgement.

An uninspectable generic OMP `--config` overlay conservatively suspends automatic model ownership. Volit's own `--volit-config` is supported normally.

### Review corrections

Final review found a gap between executor selection and child dispatch: changing Volit controls or removing admitted tools while the SDK constructed the child did not prevent its first inference call. Delegation now retains a validation closure across construction and checks current authorisation and tool admission before dispatch and result delivery. Project-level `prewalk.enabled: false` also now overrides a global enable rather than incorrectly suspending Volit.

The corrective smoke ran the production extension, core and loopback Jev transport against a controlled public host facade. It deliberately held SDK construction. Switching to off or observe, pinning, removing the read tool or changing sessions each prevented inference and disposed the constructed child. Two parallel delegates still completed and disposed independently. With global prewalk enabled and project prewalk disabled, the actual routing handler retained auto mode without suspension.

This corrective fixture used a synthetic SDK facade, not another real coding-model or paid classifier run. Its command, output, configuration and complete source are retained in `local://volit-omp-remediation-evidence.json`. Both delegation regressions failed before the fix and passed afterwards; scoped re-review found no remaining actionable findings.

### Checks, evidence and limits

- `bun run check`: strict TypeScript check passed; 93 tests passed, zero failed.
- `bun install --frozen-lockfile`: the complete three-package workspace installs without changing the lockfile.
- The core's inherited-probability and first-decision downgrade regressions were observed failing before their fixes and passing afterwards.
- Primary stdout, stderr, RPC frames, provider/Jev payloads, PTY capture, fixture sources and execution helpers are retained in the session artefact `local://volit-omp-smoke-evidence.json`. The actual native-auto switch stdout was preserved from the observed tool output with provenance recorded in that artefact; its original event ledger was retained.
- All owned probe processes were stopped and the exact temporary workspace was removed. No installed OMP files, global settings, Git commits or remote repositories were changed.

**Not exercised:** a live TypeSafe call or real coding-model quality evaluation. Neither `VOLIT_JEV_API_KEY` nor `TYPESAFE_API_KEY` was present in the implementation session. Loopback success does not establish Jev accuracy, calibrate the example thresholds or replace the live-service acceptance check.

The user-accepted late-hook, cancellation and inside-setter manual-selection limitations remain. The successful pending-judgement checks above must not be misread as atomic host guarantees.

## Provider-contract extraction verification

Stuart approved a provider-neutral contract with Jev as the only bundled implementation and comparative evaluation outside this repository. After extraction, `bun run check` passed strict TypeScript checking and all 100 tests. The updated four-package workspace also passed `bun install --frozen-lockfile`. A source review found no actionable defects.

Before implementation, three core regressions failed: rejecting an otherwise usable judgement without vendor confidence, treating a tagged diagnostic score as a probability, and accepting a distribution with omitted alternatives. A separate regression showed legacy unbound disclosure incorrectly resuming automatic mode. All passed after the contract and consent changes.

An isolated consumer workspace containing only `@volit/core`, `@volit/judge` and `@volit/jev` ran the real provider against a loopback HTTP service. Automatic mode selected `deep`; observe recommended that route without applying it; off made no request. The two transmitted requests preserved closure-bound credentials and destination even when the caller supplied conflicting extra fields. Results retained provider, returned model, question version and explicitly labelled confidence. No OMP package was present. Source and output are retained in `local://volit-portable-provider-smoke.ts` and `local://volit-portable-provider-smoke-output.txt`.

Fresh runs of unchanged OMP 18.4.8 and Bun 1.4.2 exercised production extension code with isolated directories and synthetic loopback inference:

| Scenario | Actual runtime result |
| --- | --- |
| Default Jev composition, auto | One Jev request; actual inference used `b`; stdout `RESULT:b`; persisted `jev`, `jev-fixture`, `volit-work-profile-v1` |
| Default composition, off | Zero judgement requests; actual inference used `a`; stdout `RESULT:a` |
| Injected keyless local fixture, no confidence field | One local judgement, zero Jev calls and no Jev key; actual inference used `b`; persisted local provider/model/question identity |
| Actual saved Jev session resumed with a different provider | Consent cleared and routing off; zero judgements; actual inference used `a` |
| Explicit RPC acceptance of that provider | One local judgement; actual inference switched to `b` |
| Same provider ID, changed destination | Consent cleared; zero judgements; inference used `a`; explicit RPC reacceptance restored routing to `b` |

Generic RPC status identified `local-fixture` and its actual destination rather than TypeSafe. Captured custom-provider requests contained workload IDs/descriptions, not target mappings. The custom provider was a deterministic smoke fixture, not a shipped adapter or a quality evaluation.

An extra CLI experiment deliberately forced `a` while saved route ownership recorded `b`. The existing foreign-route guard suspended automatic application even after CLI disclosure acceptance. Its fixture then returned a profile absent from the offered choices and was rejected. This unsuccessful extra run is retained, not counted as successful routing; the explicit RPC control subsequently restored ownership and routed to `b`.

Commands, environments, stdout/stderr, RPC frames, actual session records, loopback payloads and fixture sources are retained in `local://volit-provider-smoke-evidence.json`. Owned processes and servers were stopped and temporary workspaces removed. No personal credentials, paid calls, model downloads, global settings changes, commits or pushes were involved. Live TypeSafe verification remains credential-dependent and unrun; provider comparison and threshold tuning remain out of scope.

## Npm artefact verification (2026-10-03)

Stuart authorised committing and pushing the implementation before packaging, then publishing to npm, and selected MIT. The implementation was pushed to `stuplum/volit` as `2c88e55`. This section records pre-publication artefact checks, not a registry-publication claim.

The initial candidate was one `volit@0.1.0` package with compiled ESM, declarations and no runtime dependencies. Its public entry points were `volit`, `volit/core`, `volit/judge`, `volit/jev` and `volit/omp`. The default entry was the Jev-backed OMP extension.

The first archive used npm `bundledDependencies`. Empty-cache, offline npm installation and a Node consumer succeeded, but Bun 1.4.2 tried to fetch the bundled `@volit/*` manifests from the registry and failed. This matches [Bun issue 27418](https://github.com/oven-sh/bun/issues/27418). The final package contains the compiled modules directly, with syntax-aware relative-import rewriting in JavaScript and declarations. It has no dependency manifests for Bun to resolve.

TypeScript 7.0.2 remains the checker and emitter. Its root module no longer provides the legacy compiler API; `typescript-ast` pins the TypeScript 6.0.3 compiler API for the build-only rewrite. Scripts select the TypeScript 7 executable explicitly so the alias cannot change the checker through a shared `tsc` shim. Neither compiler is included in the release.

`bun run check` passed all 100 tests and strict typechecking. `bun run pack` produced an archive whose SHA-256 is `6d82abd88f96a99b3cab9c85b07248beb4502932f80f0d5ca005a9c91feb3e51`.

| Installed artefact check | Observed result |
| --- | --- |
| npm installation with empty cache and `--offline --ignore-scripts` | One package installed without dependency fetches |
| Plain Node 25.6.0 consumer | Auto switched to `deep`; observe did not apply; off made no request; malformed transport results retained the public `JudgeError` identity |
| Strict TypeScript 7 NodeNext consumer with no ambient `@types` packages | All five public entry points and their declarations resolved; no source-workspace or Bun types required |
| Bun 1.4.2 local tarball installation | One package installed; all compiled public entry points loaded; no registry requests |
| Native OMP 18.4.8 installation of the extracted archive | Plugin discovered without an explicit Volit extension argument |
| Installed plugin, off | Zero Jev requests; actual inference and persisted assistant message used `a`; stdout `RESULT:a` |
| Installed plugin, explicit auto and disclosure | One Jev request; actual inference used `b`; stdout `RESULT:b`; persisted provider/model/question and consent binding matched |
| Native uninstall | Listing and runtime path removed; subsequent inference used `a`, with no Jev request or Volit session entry |

Stock OMP treats a filesystem install target as a directory, so it cannot install a local tarball directly. The native smoke linked a directory extracted from the archive, never the source checkout. Registry installation uses Bun. OMP 18.4.8 also accepts `--local` without applying it to plugin install/uninstall; the README distinguishes user-profile installation from npm project-local installation.

Primary native commands, HTTP payloads, session records and fixture sources are retained in `local://volit-packed-omp-smoke-evidence.json`; the initial Bun failure is retained separately in `local://volit-packed-omp-initial-failure-evidence.json`. The successful fixture passed 51 assertions, stopped all owned children and its server, and removed its temporary root. Node installation also used and removed an isolated temporary workspace. No real inference credentials or personal OMP settings were used. Live TypeSafe quality verification remains unrun.

### Approved npm scope

The registry rejected unscoped `volit` with `E403` because its name is too similar to `lit` and `split`; nothing was published. Stuart approved `@stuplum/volit`. The package name, install commands and public import examples now use that scope. Development-only `@volit/*` workspace names and the `/volit` control remain unchanged.

The rebuilt `/Users/stuart.plumbley/Personal Workspace/volit/dist/stuplum-volit-0.1.0.tgz` has SHA-256 `4822f9f5c9690c20d5d6fcaf5f5eb227df32cc835fe6222bac07ac99a9685bf7`. All 100 tests and strict checking passed again. Empty-cache offline npm installation, Node execution, declarations, Bun installation and native OMP discovery/routing/uninstall passed under the scoped name. The native fixture again passed 51 assertions.

Scoped pre-publication evidence is retained in `local://volit-scoped-packed-consumer-evidence.json` and `local://volit-scoped-packed-omp-smoke-evidence.json`. These checks used the exact scoped tarball and isolated temporary directories; they do not claim registry publication.
