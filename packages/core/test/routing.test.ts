import { describe, expect, test } from "bun:test";
import { decide, revalidateDecision, routeWork, type RoutingSnapshot, type Policy } from "../src/index.ts";
import type { Judgement } from "@volit/judge";

const policy: Policy = {
  version: "test-policy",
  minimumProbability: 0.75,
  minimumMargin: 0.25,
  downgradeProbability: 0.95,
  cooldownMs: 1000,
  downgradeTransitions: [{ from: "investigation", to: "implementation" }],
};

const snapshot: RoutingSnapshot = {
  identity: { sessionId: "session-a", branchId: "branch-a", revision: 3, boundaryId: "turn-4" },
  boundary: "request",
  mode: "auto",
  disclosure: true,
  pin: { model: false, effort: false },
  current: { provider: "provider-a", model: "ordinary", effort: "low" },
  currentProfileId: "implementation",
  currentContextWindow: 100000,
  currentAvailable: true,
  candidates: [
    { id: "ordinary", route: { provider: "provider-a", model: "ordinary", effort: "low" }, available: true, tools: true, images: false, contextWindow: 100000, supportedEfforts: ["low"], inputCostPerMillion: 1 },
    { id: "investigator", route: { provider: "provider-b", model: "investigator", effort: "high" }, available: true, tools: true, images: true, contextWindow: 200000, supportedEfforts: ["low", "high"], inputCostPerMillion: 10 },
  ],
  profiles: [
    { id: "implementation", description: "Ordinary implementation", targets: ["ordinary"] },
    { id: "investigation", description: "Deep investigation", targets: ["investigator"] },
  ],
  requirements: { tools: true, images: false, inputTokens: 50000, conservative: true, outputReserve: 4000 },
  capabilities: { switch: true, adjust: true, delegate: true },
  ownership: { model: "volit", effort: "volit" },
  now: 10000,
};

const judgement: Judgement = {
  provider: "fixture",
  profileId: "investigation",
  probabilities: { implementation: 0.03, investigation: 0.96, insufficient_evidence: 0.01 },
  confidence: { value: 0.85, semantics: "fixture-confidence" },
  model: "fixture-1",
  questionVersion: "profile-v1",
};

const changes = [
  { label: "unavailable", change: { available: false } },
  { label: "missing tool support", change: { tools: false } },
  { label: "insufficient prepared context capacity", change: { contextWindow: 53000 } },
  { label: "unsupported reasoning effort", change: { supportedEfforts: ["low"] } },
];

describe("routing policy", () => {
  test("routes without requiring a vendor-specific confidence score", () => {
    const { confidence: _confidence, ...advice } = judgement;
    expect(decide({ snapshot, judgement: advice, policy }).action).toBe("switch");
  });

  test("does not confuse a provider's diagnostic score with routing probability", () => {
    const advice = { ...judgement, confidence: { value: -2.5, semantics: "fixture-log-margin" } };
    expect(decide({ snapshot, judgement: advice, policy }).action).toBe("switch");
  });

  test("rejects a distribution that omits offered alternatives", async () => {
    const result = await routeWork({ snapshot, policy, judge: async () => ({ ...judgement, probabilities: { investigation: 1 } }) });
    expect(result.action).toBe("stay");
    expect(result.apply).toBe(false);
  });

  test("switches for a sufficiently distinct workload without a workflow phase", () => {
    const result = decide({ snapshot, judgement, policy });
    expect(result.action).toBe("switch");
    expect(result.target).toEqual({ provider: "provider-b", model: "investigator", effort: "high" });
    expect(result.apply).toBe(true);
    expect(result.coldInputCost).toBe(0.5);
  });

  test("preserves a suitable current route rather than the first configured target", () => {
    const eligible = { ...snapshot, profiles: [{ id: "investigation", description: "Deep work", targets: ["investigator", "ordinary"] }] };
    expect(decide({ snapshot: eligible, judgement, policy }).action).toBe("stay");
  });

  test("retains the current route when workload evidence is marginal", () => {
    const marginal = { ...judgement, probabilities: { implementation: 0.44, investigation: 0.55, insufficient_evidence: 0.01 } };
    expect(decide({ snapshot, judgement: marginal, policy }).action).toBe("stay");
  });

  test("requires a stronger probability for an explicitly configured downgrade", () => {
    const downgrade = { ...snapshot, currentProfileId: "investigation", current: snapshot.candidates[1]!.route };
    const advice = { ...judgement, profileId: "implementation", probabilities: { implementation: 0.9, investigation: 0.09, insufficient_evidence: 0.01 } };
    expect(decide({ snapshot: downgrade, judgement: advice, policy }).action).toBe("stay");
    expect(decide({ snapshot: downgrade, judgement: { ...advice, probabilities: { implementation: 0.96, investigation: 0.03, insufficient_evidence: 0.01 } }, policy }).action).toBe("switch");
  });

  test("enforces the configured downgrade threshold before any routing history exists", () => {
    const { currentProfileId: _profile, ...withoutHistory } = snapshot;
    const initial = { ...withoutHistory, current: snapshot.candidates[1]!.route };
    const advice = { ...judgement, profileId: "implementation", probabilities: { implementation: 0.9, investigation: 0.09, insufficient_evidence: 0.01 } };
    expect(decide({ snapshot: initial, judgement: advice, policy }).action).toBe("stay");
  });

  test("does not switch again during the configured cooldown", () => {
    expect(decide({ snapshot: { ...snapshot, lastChangeAt: 9500 }, judgement, policy }).action).toBe("stay");
    expect(decide({ snapshot: { ...snapshot, lastChangeAt: 9000 }, judgement, policy }).action).toBe("switch");
  });

  for (const { label, change } of changes) {
    test(`rejects a target with ${label}`, () => {
      const candidates = [snapshot.candidates[0]!, { ...snapshot.candidates[1]!, ...change }];
      expect(decide({ snapshot: { ...snapshot, candidates }, judgement, policy }).action).toBe("stay");
    });
  }

  test("keeps image-bearing work off text-only routes", () => {
    const candidates = snapshot.candidates.map(candidate => ({ ...candidate, images: false }));
    expect(decide({ snapshot: { ...snapshot, candidates, requirements: { ...snapshot.requirements, images: true } }, judgement, policy }).action).toBe("stay");
  });

  test("refuses a smaller context window without a conservative input bound", () => {
    const candidates = [snapshot.candidates[0]!, { ...snapshot.candidates[1]!, contextWindow: 80000 }];
    const uncertain = { ...snapshot, candidates, requirements: { tools: true, images: false, conservative: false, outputReserve: 4000 } };
    expect(decide({ snapshot: uncertain, judgement, policy }).action).toBe("stay");
  });

  test("enforces a hard cold-input limit without inventing missing prices", () => {
    expect(decide({ snapshot, judgement, policy: { ...policy, maxColdInputCost: 0.49 } }).action).toBe("stay");
    const { inputCostPerMillion: _price, ...unpriced } = snapshot.candidates[1]!;
    const unknownPrice = { ...snapshot, candidates: [snapshot.candidates[0]!, unpriced] };
    expect(decide({ snapshot: unknownPrice, judgement, policy: { ...policy, maxColdInputCost: 10 } }).action).toBe("stay");
    const noLimit = decide({ snapshot: unknownPrice, judgement, policy });
    expect(noLimit.action).toBe("switch");
    expect(noLimit.coldInputCost).toBeUndefined();
  });

  test("does not apply an observed recommendation", () => {
    const result = decide({ snapshot: { ...snapshot, mode: "observe" }, judgement, policy });
    expect(result.action).toBe("switch");
    expect(result.apply).toBe(false);
  });

  test("respects a model pin while allowing an independently owned effort change", () => {
    const high = { ...snapshot.candidates[0]!, id: "ordinary-high", route: { ...snapshot.current, effort: "high" }, supportedEfforts: ["low", "high"] };
    const effort = { ...snapshot, pin: { model: true, effort: false }, candidates: [...snapshot.candidates, high], profiles: [{ id: "investigation", description: "More reasoning", targets: ["ordinary-high"] }] };
    expect(decide({ snapshot: effort, judgement, policy }).action).toBe("adjust");
    expect(decide({ snapshot: { ...effort, ownership: { model: "volit", effort: "host" } }, judgement, policy }).action).toBe("stay");
    expect(decide({ snapshot: { ...snapshot, pin: { model: true, effort: false } }, judgement, policy }).action).toBe("stay");
  });

  test("does not override host-owned or unknown model control", () => {
    for (const owner of ["host", "unknown"] as const) {
      expect(decide({ snapshot: { ...snapshot, ownership: { ...snapshot.ownership, model: owner } }, judgement, policy }).action).toBe("stay");
    }
  });

  test("cannot route to a model invented by the judge", () => {
    expect(decide({ snapshot, judgement: { ...judgement, profileId: "unlisted" }, policy }).action).toBe("stay");
  });

  test("leaves the host's unavailable-current-route recovery intact", () => {
    expect(decide({ snapshot: { ...snapshot, currentAvailable: false }, judgement, policy }).action).toBe("stay");
  });

  test("delegates an explicit bounded task without making a parent switch decision", () => {
    const task = { request: "Review the supplied function", context: ["function add(a,b) { return a+b; }"], tools: ["read"], cwd: "/synthetic/work", recipient: "call-7", successCriteria: "Return correctness defects", allowNested: false };
    const delegated = { ...snapshot, boundary: "delegation" as const, delegation: task };
    expect(decide({ snapshot: delegated, judgement, policy }).action).toBe("delegate");
    expect(decide({ snapshot: { ...snapshot, boundary: "delegation" }, judgement, policy }).action).toBe("stay");
    expect(decide({ snapshot: { ...delegated, capabilities: { ...snapshot.capabilities, delegate: false } }, judgement, policy }).action).toBe("stay");
  });

  test("rejects a selected probability inherited from an object prototype", () => {
    const configured = { ...snapshot, profiles: [{ id: "constructor", description: "Deep investigation", targets: ["investigator"] }] };
    const malformed = { ...judgement, profileId: "constructor", probabilities: { insufficient_evidence: 1 } };
    expect(decide({ snapshot: configured, judgement: malformed, policy }).action).toBe("stay");
  });

  test("rejects invalid policy thresholds rather than silently enabling changes", () => {
    expect(() => decide({ snapshot, judgement, policy: { ...policy, minimumProbability: Number.NaN } })).toThrow();
  });
});

describe("judgement lifecycle", () => {
  test("makes no disclosure while off, without consent or fully pinned", async () => {
    let calls = 0;
    const judge = async () => { calls++; return judgement; };
    for (const gated of [{ ...snapshot, mode: "off" as const }, { ...snapshot, disclosure: false }, { ...snapshot, pin: { model: true, effort: true } }]) {
      expect((await routeWork({ snapshot: gated, policy, judge })).action).toBe("stay");
    }
    expect(calls).toBe(0);
  });

  test("excludes unsupported profile targets before disclosure", async () => {
    const candidates = [snapshot.candidates[0]!, { ...snapshot.candidates[1]!, tools: false }];
    let offered: readonly string[] = [];
    await routeWork({ snapshot: { ...snapshot, candidates }, policy, judge: async profiles => { offered = profiles.map(profile => profile.id); return judgement; } });
    expect(offered).toEqual(["implementation"]);
  });

  test("preserves the route and hides raw errors when judgement fails", async () => {
    const result = await routeWork({ snapshot, policy, judge: async () => { throw new Error("secret request text"); } });
    expect(result.action).toBe("stay");
    expect(result.reasons).toContain("judgement_failed");
    expect(JSON.stringify(result)).not.toContain("secret request text");
  });

  test("rejects an answer arriving after cancellation", async () => {
    const controller = new AbortController();
    const result = await routeWork({ snapshot, policy, signal: controller.signal, judge: async () => { controller.abort(); return judgement; } });
    expect(result.action).toBe("stay");
    expect(result.reasons).toContain("cancelled");
  });

  test("does not reapply a decision to a changed branch, turn, revision or manual route", () => {
    const decision = decide({ snapshot, judgement, policy });
    expect(revalidateDecision({ decision, snapshot, policy })).toBe(true);
    for (const identity of [{ ...snapshot.identity, branchId: "branch-b" }, { ...snapshot.identity, boundaryId: "turn-5" }, { ...snapshot.identity, revision: 4 }, { ...snapshot.identity, sessionId: "session-b" }]) {
      expect(revalidateDecision({ decision, snapshot: { ...snapshot, identity }, policy })).toBe(false);
    }
    expect(revalidateDecision({ decision, snapshot: { ...snapshot, current: { ...snapshot.current, model: "manual" } }, policy })).toBe(false);
    expect(revalidateDecision({ decision, snapshot: { ...snapshot, mode: "observe" }, policy })).toBe(false);
    expect(revalidateDecision({ decision, snapshot: { ...snapshot, candidates: [snapshot.candidates[0]!] }, policy })).toBe(false);
  });

  test("treats identical prompts at different semantic boundaries as distinct decisions", async () => {
    let calls = 0;
    const judge = async () => { calls++; return judgement; };
    const first = await routeWork({ snapshot, policy, judge });
    const second = await routeWork({ snapshot: { ...snapshot, identity: { ...snapshot.identity, boundaryId: "turn-5" } }, policy, judge });
    expect(calls).toBe(2);
    expect(first.identity.boundaryId).toBe("turn-4");
    expect(second.identity.boundaryId).toBe("turn-5");
  });
});
