import type { Judgement, WorkProfile } from '@volit/judge';

export type Mode = "off" | "observe" | "auto";
export type Owner = "volit" | "host" | "unknown";
export type Action = "stay" | "switch" | "adjust" | "delegate";

export interface Route {
  provider: string;
  model: string;
  effort: string;
}

export interface Identity {
  sessionId: string;
  branchId: string;
  revision: number;
  boundaryId: string;
}

export interface Candidate {
  id: string;
  route: Route;
  available: boolean;
  tools: boolean;
  images: boolean;
  contextWindow: number;
  supportedEfforts: readonly string[];
  inputCostPerMillion?: number;
}

export interface Profile extends WorkProfile {
  targets: readonly string[];
}


export interface Delegation {
  request: string;
  context: readonly string[];
  tools: readonly string[];
  cwd: string;
  recipient: string;
  successCriteria: string;
  allowNested: boolean;
}

export interface RoutingSnapshot {
  identity: Identity;
  boundary: "request" | "delegation";
  mode: Mode;
  disclosure: boolean;
  pin: { model: boolean; effort: boolean };
  current: Route;
  currentProfileId?: string;
  currentContextWindow: number;
  currentAvailable: boolean;
  candidates: readonly Candidate[];
  profiles: readonly Profile[];
  requirements: {
    tools: boolean;
    images: boolean;
    inputTokens?: number;
    conservative: boolean;
    outputReserve: number;
  };
  capabilities: { switch: boolean; adjust: boolean; delegate: boolean };
  ownership: { model: Owner; effort: Owner };
  now: number;
  lastChangeAt?: number;
  delegation?: Delegation;
}

export interface Policy {
  version: string;
  minimumProbability: number;
  minimumMargin: number;
  downgradeProbability: number;
  cooldownMs: number;
  downgradeTransitions: readonly { from: string; to: string }[];
  maxColdInputCost?: number;
}

export interface Decision {
  identity: Identity;
  from: Route;
  action: Action;
  apply: boolean;
  policyVersion: string;
  reasons: readonly string[];
  target?: Route;
  targetId?: string;
  profileId?: string;
  judgement?: Judgement;
  coldInputCost?: number;
}
