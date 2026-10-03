# Volit

Session-aware model routing for stock OMP, with a harness-independent TypeScript policy and an explicit judgement-provider contract. Jev is the bundled provider. No inference proxy, OMP fork or AGTX dependency.

## Installation

Install the npm package into your OMP user profile:

```sh
omp plugin install @stuplum/volit
```

OMP discovers the compiled extension through the package manifest. This installation applies to your user profile, not just the current project. Installation does not accept disclosure or enable routing.

For a project-only installation instead:

```sh
npm install --save-dev @stuplum/volit
omp --extension "$(pwd)/node_modules/@stuplum/volit/dist/index.js"
```

Do not use `omp plugin install --local` for project isolation: stock OMP 18.4.8 accepts that flag but does not apply it to installation.

The integration is verified against OMP 18.4.8 with Bun 1.4.2. The portable libraries require Node.js 22 or later and have no Bun or OMP runtime dependency.

The single `@stuplum/volit` package includes compiled ESM, TypeScript declarations, the configuration example and all internal libraries. No unpublished workspace package needs to be fetched separately.

| Import | API |
| --- | --- |
| `@stuplum/volit` | Default Jev-backed OMP extension |
| `@stuplum/volit/core` | Eligibility, continuity, cost limits and decision revalidation |
| `@stuplum/volit/judge` | Provider contract, evidence construction, validated results and safe errors |
| `@stuplum/volit/jev` | `createJevProvider`, binding credentials and transport to the shared contract |
| `@stuplum/volit/omp` | `createVolitExtension`, accepting an explicit provider factory |

## Development

Requires Bun 1.4.2. From the checkout:

```sh
bun install --frozen-lockfile
bun run check
bun run pack
```

The development workspaces use TypeScript source under `@volit/core`, `@volit/judge`, `@volit/jev` and `@volit/omp`. OMP can load the source entry directly with `omp --extension "$(pwd)/packages/omp/src/index.ts"`.

Packaging compiles JavaScript and declarations, stages a self-contained package under `dist/package`, and creates `dist/stuplum-volit-0.2.0.tgz`. The checkout remains private; publication uses the verified tarball, not the workspace root. The package is MIT-licensed.

Jcode is not implemented. Another adapter can reuse the core without importing OMP.

## Judgement backends

`JudgeProvider` from `@stuplum/volit/judge` has a stable `id`, a human-readable `destination`, and `judge(request): Promise<Judgement>`. `JudgeRequest` contains permitted evidence, offered workload IDs/descriptions, `timeoutMs` and an optional `AbortSignal`. Provider construction must not perform judgements; adapters enforce the requested deadline and cancellation and keep credentials out of their public identity.

Results identify the provider, actual returned model and question version. They contain a selected profile and a complete probability distribution over the offered profiles plus `insufficient_evidence`. Values must be finite and between zero and one, total one within `0.000001`, and select a most-probable outcome. Shared validation rejects incomplete distributions and mismatched provider identities.

Vendor `confidence` is optional diagnostic metadata with `{value, semantics}`; routing does not threshold it. Adapters must not manufacture probabilities from arbitrary scores or silently claim that different providers are equally calibrated. Unsupported or malformed results fail closed.

An extension selects its provider explicitly in trusted startup code:

```typescript
import { createVolitExtension } from '@stuplum/volit/omp';
import { createJevProvider } from '@stuplum/volit/jev';

export default createVolitExtension({
  createProvider: () => createJevProvider({
    apiKey: process.env.VOLIT_JEV_API_KEY ?? process.env.TYPESAFE_API_KEY ?? '',
  }),
});
```

The factory runs when session configuration is loaded, after OMP flags are available. Another adapter implements the same contract and replaces that factory; routing policy and OMP integration stay unchanged. `destination` identifies the actual recipient or local executor and must not contain secrets. Project JSON cannot load provider code or select a credential destination. `--volit-endpoint` belongs to the default Jev entry point, not the generic extension.

External tooling can import `@stuplum/volit/judge`, `@stuplum/volit/jev` and `@stuplum/volit/core` without loading the OMP adapter. Comparative datasets, quality/latency/cost benchmarks, provider rankings and threshold tuning are outside this repository. Volit runs an explicitly selected provider and policy; it has no automatic provider selection or fallback.

Laya is a prospective adapter, not a bundled implementation. Its native [`laya-serve` API](https://github.com/NandhaKishorM/laya/blob/main/docs/http-api.md) uses `/v1/systemone`, but a correct adapter must handle optional authentication, checkpoint metadata, rounded distributions, different confidence semantics and explicit truncation/option-collision metadata. Merely changing `--volit-endpoint` is not verified Laya support.

Prefer a local or self-hosted Laya endpoint for code. The [third-party public endpoint](https://laya.inference.zaitlabs.com/) states that requests may be stored and used to train models. Volit does not select that service, download Laya weights or start a model server automatically. Evaluate policy thresholds separately for each backend.

## Load into stock OMP

Set `VOLIT_JEV_API_KEY` in your environment, or use an existing `TYPESAFE_API_KEY`. The Volit-specific variable takes precedence and avoids configuring OMP's separate native Jev features.

Create a configuration with explicit profiles, allowed targets and policy thresholds in the project's `.volit` directory or your home `.volit` directory, as described below. After native plugin installation, start OMP:

```sh
omp
```

The extension starts off unless the active session branch contains previously enabled Volit state. Enable recommendations or automatic application explicitly:

```text
/volit observe --accept-disclosure
/volit auto --accept-disclosure
/volit status
/volit pin
/volit unpin
/volit off
```

`pin` protects both the current model and effort. `off` disables judgement requests. Accepted disclosure is remembered in the active session branch and bound to the judge ID and destination. A different provider or destination requires fresh acceptance; older entries without this binding resume off. Consent does not make a new session opt in.

Headless operation uses the same installed plugin:

```sh
omp --volit-config "$(pwd)/.volit/volit.config.json" \
  --volit auto --volit-accept-disclosure \
  --print "Review the changes in this project"
```

For project-only installation, also pass `--extension "$(pwd)/node_modules/@stuplum/volit/dist/index.js"`. Pass `--volit off` to disable routing even when resuming previously enabled state. The configuration flag is optional; default discovery uses the precedence below.

The destination defaults to TypeSafe. A deliberate `--volit-endpoint` override supports a trusted HTTPS endpoint or a loopback HTTP fixture. Project JSON cannot redirect the bearer key through an endpoint field.

To remove the native installation, run `omp plugin uninstall @stuplum/volit`. For project-only installation, stop passing the extension argument and run `npm uninstall @stuplum/volit`. Remove any manual extension registration you added yourself. Existing session metadata can remain; it does nothing without the extension loaded.

## Configuration

Configuration lookup uses the first applicable location:

1. `--volit-config <path>`. Relative paths resolve against OMP's working directory.
2. `$(pwd)/.volit/volit.config.json`, using OMP's working directory.
3. `$HOME/.volit/volit.config.json`, using the operating system's home directory.

Configurations are not merged. Without an explicit flag, a missing project file permits the user-wide fallback. Invalid JSON, invalid configuration or a read error stops lookup and never falls back. A missing explicit file also fails without fallback. Activation errors identify the failing file or list both searched default paths when neither exists.

Since 0.2.0, the former project-root default is no longer discovered. Move an existing configuration into the project's `.volit` directory, or keep selecting its old location explicitly with `--volit-config`.

Copy the bundled [volit.example.json](volit.example.json) to your chosen location and review its model mappings and thresholds. For native installation, `omp plugin list --json` reports the installed package's `path`; copy the example from that directory. For project-only installation:

```sh
mkdir -p "$(pwd)/.volit"
cp -n "$(pwd)/node_modules/@stuplum/volit/volit.example.json" "$(pwd)/.volit/volit.config.json"
```

For a user-wide configuration from a source checkout:

```sh
mkdir -p "$HOME/.volit"
cp -n "$(pwd)/volit.example.json" "$HOME/.volit/volit.config.json"
```

Review the file before enabling routing; these commands do not overwrite an existing configuration. A user-wide configuration lets the same OMP invocation work across projects, with a project configuration taking precedence where present.

After changing a configuration that has already loaded, start a new session or restart OMP.

The example maps ordinary implementation to `anthropic/claude-haiku-4-5` at low effort and investigation to `anthropic/claude-fable-5` at high effort. Both route IDs and efforts were present in the tested OMP catalogue; that does not establish account access or workload suitability. Replace the mappings with routes you have enabled and evaluated. The numeric thresholds are illustrative, not calibrated defaults; copying the file does not enable routing.

| Field | Meaning |
| --- | --- |
| `profiles` | Stable IDs, workload descriptions and ordered allowed target IDs |
| `targets` | Unique IDs mapped to concrete `provider`, `model` and `effort` |
| `policy.version` | Your policy revision, recorded with decisions |
| `policy.minimumProbability` | Minimum selected-profile probability for a change |
| `policy.minimumMargin` | Required lead over the next most probable outcome |
| `policy.downgradeProbability` | Stronger threshold for explicitly listed downgrade transitions |
| `policy.downgradeTransitions` | Directional `{from, to}` profile pairs; specialisms are not an implicit numeric ladder |
| `policy.cooldownMs` | Minimum interval between parent route changes |
| `policy.maxColdInputCost` | Optional hard USD input-cost cap; unknown cost blocks a change |
| `outputReserve` | Tokens reserved beyond prepared input when checking capacity |
| `evidenceMaxChars` | Total UTF-16 code-unit budget for request and permitted continuity text; surrogate pairs remain intact |
| `timeoutMs` | Overall judgement deadline; each adapter must include preparation and response consumption |
| `delegationTools` | Allowed subset of `read`, `grep`, `glob`; defaults to `read` |

Stock OMP's last-turn usage is not a conservative bound for its next prepared prompt. The adapter reports that uncertainty rather than treating it as current input cost. A hard cold-input cap can therefore prevent automatic OMP changes even when catalogue prices are known.

## Bounded delegation

With auto mode enabled, the `volit_delegate` tool accepts a task, an explicit array of selected context, success criteria, a working directory and a non-empty list of allowed tools. The executor is chosen from the configured target allowlist; the result returns to the originating tool call.

Delegation is read-only: the configured `delegationTools` allowlist is restricted to `read`, `grep` and `glob`, and defaults to `read`. Requested tools must also be admitted in the parent session. The child does not inherit the parent transcript, project rules, MCP servers or additional extensions; nested delegation and write/exec tools are not enabled.

The working directory must resolve inside the parent workspace. Tool restriction is not a filesystem sandbox: a permitted read tool retains its normal host access. Cancellation is forwarded to the child, teardown is awaited, and the parent route is not switched to execute the child.

## How routing works

At a delivered user-request boundary, Volit filters explicitly configured targets before asking the selected judge which workload profile fits. A judge cannot invent models, expand permissions or change the allowlist. Deterministic policy then decides to stay, switch model, adjust effort or select an executor for an explicitly supplied delegated task.

A suitable current route is preferred over unnecessary switching. Probability, margin, downgrade and cooldown thresholds are explicit configuration, not claims about calibrated coding-success probabilities. Prices are only used where known; unknown cost is not reported as savings. An unverifiable hard spending limit prevents a change.

`off` sends no judgement request. `observe` sends permitted evidence and shows recommendations without applying them. `auto` applies eligible recommendations. Installation and possession of an API key do not enable either disclosure or routing.

## Disclosure and transport

Enabling observe or auto permits sharing the latest request, bounded prior user/assistant text, and configured workload profile IDs/descriptions with the selected judge. The default Jev extension sends them to TypeSafe. System prompts, tool results, image data, thinking blocks, target mappings and custom session entries are excluded. Text can still contain secrets; this is not anonymisation. Truncation and known omissions are marked.

The Jev adapter requests `jev-1.13.0` using question version `volit-work-profile-v1`, preserving the returned model identifier and full probability distribution. It uses one overall deadline, including the response body, with no automatic retries or redirects. The complete request is capped at 28,000 UTF-8 bytes and the response at 65,536 bytes. The request ceiling is a conservative byte bound, not exact model-token accounting.

Timeouts, invalid responses, insufficient evidence and unavailable targets preserve the current route with a visible reason. OMP still owns provider authentication, inference, tools, transcripts and error recovery.

## Stock OMP limitations

The integration uses public APIs from OMP 18.4.8. It does not require a custom OMP build.

- Routing runs at `before_agent_start`, after the current model's authentication preflight and some preparation. Volit cannot rescue a request that fails before this hook.
- State is checked before application, but OMP's asynchronous setter has no atomic revision guard. A simultaneous manual model change can race an automatic change. This is an accepted limitation; do not change models concurrently if the final selection matters.
- The hook has no request-abort signal. Cancelling inference can leave a pending model change able to finish. Observable session/control changes invalidate advice, but this is not a guarantee of atomic cancellation.
- Native effort automation retains effort ownership. Volit does not silently disable other OMP controllers.
- OMP's generic `--config` overlay is not exposed through the inspected public settings facade. When present, Volit cannot establish controller ownership and suspends automatic model changes. This does not apply to Volit's own `--volit-config` flag.
- Unknown target-model context fit prevents smaller-window automatic switches. Volit does not truncate or compact your transcript to force a preferred route.

The original compatibility evidence is in [the runtime report](https://github.com/stuplum/volit/blob/main/docs/research/2026-10-01-omp-compatibility-results.md). Its failed atomic guarantees are documented limitations, not a requirement to fork OMP.

## Verification scope

The deterministic suites exercise the real policy and real loopback HTTP transport. Synthetic provider responses test integration mechanics, not Jev's judgement quality or coding-model quality.

A live TypeSafe smoke requires a key in `VOLIT_JEV_API_KEY` or `TYPESAFE_API_KEY`. Never put the key into a committed configuration file or paste it into a test fixture. Numerical thresholds should be evaluated on representative held-out work before relying on them for your own workload.
