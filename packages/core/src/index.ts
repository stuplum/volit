import { validateJudgement } from "@volit/judge";
import type { Judgement } from "@volit/judge";
import type { Candidate, Decision, Policy, Profile, Route, RoutingSnapshot } from "./types.ts";
export type * from "./types.ts";

function sameRoute(a: Route, b: Route): boolean {
  return a.provider === b.provider && a.model === b.model && a.effort === b.effort;
}

function validatePolicy(policy: Policy): void {
  for (const value of [policy.minimumProbability, policy.minimumMargin, policy.downgradeProbability]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Policy probabilities must be between zero and one");
  }
  if (!policy.version.trim() || !Number.isFinite(policy.cooldownMs) || policy.cooldownMs < 0) throw new Error("Invalid policy version or cooldown");
  if (policy.downgradeProbability < policy.minimumProbability) throw new Error("Downgrades cannot have a weaker threshold");
  if (policy.maxColdInputCost !== undefined && (!Number.isFinite(policy.maxColdInputCost) || policy.maxColdInputCost < 0)) throw new Error("Invalid cold-input cost limit");
}

function gate(snapshot: RoutingSnapshot): string | undefined {
  if (snapshot.mode === "off") return "off";
  if (!snapshot.disclosure) return "disclosure_required";
  if (snapshot.pin.model && snapshot.pin.effort) return "pinned";
  if (!snapshot.currentAvailable) return "current_unavailable";
  if (!Number.isFinite(snapshot.now)) return "invalid_clock";
  if (snapshot.boundary === "delegation") {
    const task = snapshot.delegation;
    if (!task || !task.request.trim() || !task.successCriteria.trim() || !task.cwd.trim() || !task.recipient.trim()) return "bounded_task_required";
    if (!snapshot.capabilities.delegate) return "delegation_unsupported";
  }
  return undefined;
}

function inputCost(snapshot: RoutingSnapshot, candidate: Candidate): number | undefined {
  const tokens = snapshot.requirements.inputTokens;
  const price = candidate.inputCostPerMillion;
  if (!snapshot.requirements.conservative || tokens === undefined || price === undefined) return undefined;
  if (!Number.isFinite(tokens) || tokens < 0 || !Number.isFinite(price) || price < 0) return undefined;
  const cost = tokens * price / 1_000_000;
  return Number.isFinite(cost) ? cost : undefined;
}

function targetRejection({ snapshot, candidate, policy }: { snapshot: RoutingSnapshot; candidate: Candidate; policy: Policy }): string | undefined {
  if (!candidate.available) return "target_unavailable";
  if (!candidate.route.provider.trim() || !candidate.route.model.trim()) return "invalid_target";
  if (!candidate.supportedEfforts.includes(candidate.route.effort)) return "effort_unsupported";
  const requirements = snapshot.requirements;
  if (requirements.tools && !candidate.tools) return "tools_unsupported";
  if (requirements.images && !candidate.images) return "images_unsupported";
  if (!Number.isFinite(candidate.contextWindow) || candidate.contextWindow <= 0 || !Number.isFinite(requirements.outputReserve) || requirements.outputReserve < 0) return "context_unknown";
  if (requirements.conservative && requirements.inputTokens !== undefined) {
    if (!Number.isFinite(requirements.inputTokens) || requirements.inputTokens < 0) return "context_unknown";
    if (requirements.inputTokens + requirements.outputReserve > candidate.contextWindow) return "context_overflow";
  } else if (!Number.isFinite(snapshot.currentContextWindow) || candidate.contextWindow < snapshot.currentContextWindow) {
    return "smaller_context_unproven";
  }
  if (snapshot.boundary === "delegation") {
    if (!snapshot.capabilities.delegate || !snapshot.delegation) return "delegation_unsupported";
  } else {
    const modelChanged = candidate.route.provider !== snapshot.current.provider || candidate.route.model !== snapshot.current.model;
    const effortChanged = candidate.route.effort !== snapshot.current.effort;
    if (modelChanged && snapshot.pin.model) return "model_pinned";
    if (effortChanged && snapshot.pin.effort) return "effort_pinned";
    if (modelChanged && (!snapshot.capabilities.switch || snapshot.ownership.model !== "volit")) return "model_not_owned";
    if (effortChanged && (!snapshot.capabilities.adjust || snapshot.ownership.effort !== "volit")) return "effort_not_owned";
  }
  if (!sameRoute(candidate.route, snapshot.current) || snapshot.boundary === "delegation") {
    const cost = inputCost(snapshot, candidate);
    if (policy.maxColdInputCost !== undefined && (cost === undefined || cost > policy.maxColdInputCost)) return "cold_input_limit";
  }
  return undefined;
}

function eligibleProfiles({ snapshot, policy }: { snapshot: RoutingSnapshot; policy: Policy }): Profile[] {
  const ids = new Set<string>();
  for (const candidate of snapshot.candidates) {
    if (ids.has(candidate.id)) throw new Error("Candidate identifiers must be unique");
    ids.add(candidate.id);
  }
  const profileIds = new Set<string>();
  const profiles: Profile[] = [];
  for (const profile of snapshot.profiles) {
    if (!profile.id.trim() || profile.id === "insufficient_evidence" || profileIds.has(profile.id)) throw new Error("Invalid or duplicate profile identifier");
    profileIds.add(profile.id);
    const targets = profile.targets.filter(id => {
      const candidate = snapshot.candidates.find(value => value.id === id);
      return candidate !== undefined && targetRejection({ snapshot, candidate, policy }) === undefined;
    });
    if (targets.length) profiles.push({ ...profile, targets });
  }
  return profiles;
}

function stay({ snapshot, policy, reason, judgement }: { snapshot: RoutingSnapshot; policy: Policy; reason: string; judgement?: Judgement }): Decision {
  return {
    identity: { ...snapshot.identity },
    from: { ...snapshot.current },
    action: "stay",
    apply: false,
    policyVersion: policy.version,
    reasons: [reason],
    ...(judgement ? { judgement: { ...judgement, probabilities: { ...judgement.probabilities } } } : {}),
  };
}

export function decide({ snapshot, judgement, policy }: { snapshot: RoutingSnapshot; judgement: Judgement; policy: Policy }): Decision {
  validatePolicy(policy);
  const blocked = gate(snapshot);
  if (blocked) return stay({ snapshot, policy, reason: blocked });
  try {
    judgement = validateJudgement({ judgement });
  } catch {
    return stay({ snapshot, policy, reason: "invalid_judgement" });
  }
  if (judgement.profileId === "insufficient_evidence") return stay({ snapshot, policy, reason: "insufficient_evidence", judgement });
  const profile = eligibleProfiles({ snapshot, policy }).find(value => value.id === judgement.profileId);
  if (!profile) {
    const configured = snapshot.profiles.find(value => value.id === judgement.profileId);
    const candidate = snapshot.candidates.find(value => configured?.targets.includes(value.id));
    const reason = candidate ? targetRejection({ snapshot, candidate, policy }) ?? "no_eligible_target" : "unknown_profile";
    return stay({ snapshot, policy, reason, judgement });
  }
  const probability = judgement.probabilities[judgement.profileId]!;
  const alternative = Math.max(0, ...Object.entries(judgement.probabilities).filter(([id]) => id !== judgement.profileId).map(([, value]) => value));
  const candidates = profile.targets.map(id => snapshot.candidates.find(candidate => candidate.id === id)!);
  if (snapshot.boundary !== "delegation" && candidates.some(candidate => sameRoute(candidate.route, snapshot.current))) {
    return stay({ snapshot, policy, reason: "current_route_suitable", judgement });
  }
  const currentTargetIds = snapshot.candidates.filter(target => sameRoute(target.route, snapshot.current)).map(target => target.id);
  const currentProfiles = snapshot.profiles.filter(value => value.targets.some(id => currentTargetIds.includes(id))).map(value => value.id);
  const downgrade = policy.downgradeTransitions.some(transition => transition.to === profile.id && (transition.from === snapshot.currentProfileId || currentProfiles.includes(transition.from)));
  const threshold = downgrade ? policy.downgradeProbability : policy.minimumProbability;
  if (probability < threshold || probability - alternative < policy.minimumMargin) return stay({ snapshot, policy, reason: "weak_evidence", judgement });
  if (snapshot.boundary !== "delegation" && snapshot.lastChangeAt !== undefined && (!Number.isFinite(snapshot.lastChangeAt) || snapshot.now - snapshot.lastChangeAt < policy.cooldownMs)) {
    return stay({ snapshot, policy, reason: "cooldown", judgement });
  }
  const candidate = candidates.reduce((best, target) => {
    const bestSameModel = best.route.provider === snapshot.current.provider && best.route.model === snapshot.current.model;
    const targetSameModel = target.route.provider === snapshot.current.provider && target.route.model === snapshot.current.model;
    if (snapshot.boundary !== "delegation" && bestSameModel !== targetSameModel) return targetSameModel ? target : best;
    const bestCost = inputCost(snapshot, best);
    const targetCost = inputCost(snapshot, target);
    return bestCost !== undefined && targetCost !== undefined && targetCost < bestCost ? target : best;
  });
  const cost = inputCost(snapshot, candidate);
  const action = snapshot.boundary === "delegation" ? "delegate" : candidate.route.provider === snapshot.current.provider && candidate.route.model === snapshot.current.model ? "adjust" : "switch";
  return {
    identity: { ...snapshot.identity },
    from: { ...snapshot.current },
    action,
    apply: snapshot.mode === "auto",
    target: { ...candidate.route },
    targetId: candidate.id,
    profileId: profile.id,
    policyVersion: policy.version,
    reasons: ["workload_fit"],
    judgement: { ...judgement, probabilities: { ...judgement.probabilities } },
    ...(cost !== undefined ? { coldInputCost: cost } : {}),
  };
}

export async function routeWork({ snapshot, policy, judge, signal }: {
  snapshot: RoutingSnapshot;
  policy: Policy;
  judge: (profiles: readonly Profile[], signal?: AbortSignal) => Promise<Judgement>;
  signal?: AbortSignal;
}): Promise<Decision> {
  validatePolicy(policy);
  const captured = structuredClone(snapshot);
  const blocked = gate(captured);
  if (blocked) return stay({ snapshot: captured, policy, reason: blocked });
  if (signal?.aborted) return stay({ snapshot: captured, policy, reason: "cancelled" });
  const profiles = eligibleProfiles({ snapshot: captured, policy });
  if (!profiles.length) return stay({ snapshot: captured, policy, reason: "no_eligible_profiles" });
  try {
    const judgement = await judge(profiles, signal);
    if (signal?.aborted) return stay({ snapshot: captured, policy, reason: "cancelled" });
    if (judgement.profileId !== "insufficient_evidence" && !profiles.some(profile => profile.id === judgement.profileId)) return stay({ snapshot: captured, policy, reason: "unknown_profile" });
    return decide({ snapshot: captured, judgement: validateJudgement({ judgement, profiles }), policy });
  } catch {
    return stay({ snapshot: captured, policy, reason: signal?.aborted ? "cancelled" : "judgement_failed" });
  }
}

export function revalidateDecision({ decision, snapshot, policy }: { decision: Decision; snapshot: RoutingSnapshot; policy: Policy }): boolean {
  if (!decision.apply || decision.action === "stay" || !decision.judgement || decision.policyVersion !== policy.version || !sameRoute(decision.from, snapshot.current)) return false;
  const identity = decision.identity;
  if (identity.sessionId !== snapshot.identity.sessionId || identity.branchId !== snapshot.identity.branchId || identity.revision !== snapshot.identity.revision || identity.boundaryId !== snapshot.identity.boundaryId) return false;
  const current = decide({ snapshot, judgement: decision.judgement, policy });
  return current.apply && current.action === decision.action && current.targetId === decision.targetId && current.target !== undefined && decision.target !== undefined && sameRoute(current.target, decision.target);
}
