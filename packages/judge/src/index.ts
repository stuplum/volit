export interface WorkProfile {
  id: string;
  description: string;
}

export interface Evidence {
  request: string;
  context: readonly { role: 'user' | 'assistant'; text: string }[];
  omitted: boolean;
}

export interface Judgement {
  provider: string;
  profileId: string;
  probabilities: Record<string, number>;
  confidence?: { value: number; semantics: string };
  model: string;
  questionVersion: string;
}

export interface JudgeRequest {
  evidence: Evidence;
  profiles: readonly WorkProfile[];
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface JudgeProvider {
  readonly id: string;
  readonly destination: string;
  judge(request: JudgeRequest): Promise<Judgement>;
}

export interface BuildEvidenceOptions {
  request: string;
  context?: Evidence['context'];
  maxChars: number;
}

export type JudgeErrorCode = 'invalid_input' | 'invalid_response' | 'http_error' | 'network_error' | 'timeout' | 'aborted' | 'response_too_large';

const messages: Record<JudgeErrorCode, string> = {
  invalid_input: 'Invalid judgement input.',
  invalid_response: 'The provider returned an invalid judgement.',
  http_error: 'The provider returned an unsuccessful HTTP status.',
  network_error: 'The judgement connection failed.',
  timeout: 'The judgement deadline expired.',
  aborted: 'The judgement was cancelled.',
  response_too_large: 'The judgement response exceeded the byte limit.',
};

export class JudgeError extends Error {
  readonly code: JudgeErrorCode;

  constructor(code: JudgeErrorCode) {
    super(messages[code]);
    this.name = 'JudgeError';
    this.code = code;
  }
}

export const INSUFFICIENT_EVIDENCE = 'insufficient_evidence';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function prefix(text: string, length: number): string {
  let end = Math.min(text.length, length);
  if (end > 0 && end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
  return text.slice(0, end);
}

function suffix(text: string, length: number): string {
  let start = Math.max(0, text.length - length);
  if (start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff && text.charCodeAt(start - 1) >= 0xd800 && text.charCodeAt(start - 1) <= 0xdbff) start++;
  return text.slice(start);
}

export function buildEvidence(options: BuildEvidenceOptions): Evidence {
  if (!options || !nonempty(options.request) || !Number.isSafeInteger(options.maxChars) || options.maxChars < 1) throw new JudgeError('invalid_input');
  const source = options.context ?? [];
  if (!Array.isArray(source) || source.some((entry: unknown) => !record(entry) || (entry.role !== 'user' && entry.role !== 'assistant') || typeof entry.text !== 'string')) throw new JudgeError('invalid_input');
  const request = prefix(options.request, options.maxChars);
  if (!nonempty(request)) throw new JudgeError('invalid_input');
  let remaining = options.maxChars - request.length;
  let omitted = request.length !== options.request.length;
  const context: { role: 'user' | 'assistant'; text: string }[] = [];
  for (let index = source.length - 1; index >= 0; index--) {
    const entry = source[index]!;
    if (!entry.text.trim()) continue;
    const text = suffix(entry.text, remaining);
    if (text.length !== entry.text.length) omitted = true;
    if (text.trim()) {
      context.push({ role: entry.role, text });
      remaining -= text.length;
    }
  }
  context.reverse();
  return { request, context, omitted };
}

export function validateJudgement({ judgement, profiles, providerId }: { judgement: unknown; profiles?: readonly WorkProfile[]; providerId?: string }): Judgement {
  const invalid = (): never => { throw new JudgeError('invalid_response'); };
  if (!record(judgement) || !nonempty(judgement.provider) || !nonempty(judgement.model) || !nonempty(judgement.questionVersion) || !nonempty(judgement.profileId) || !record(judgement.probabilities)) return invalid();
  if (providerId !== undefined && judgement.provider !== providerId) return invalid();
  const entries = Object.entries(judgement.probabilities);
  if (profiles) {
    const ids = new Set([...profiles.map(profile => profile.id), INSUFFICIENT_EVIDENCE]);
    if (entries.length !== ids.size || entries.some(([id]) => !ids.has(id))) return invalid();
  }
  let sum = 0;
  let maximum = 0;
  const probabilities: [string, number][] = [];
  for (const [id, value] of entries) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return invalid();
    probabilities.push([id, value]);
    sum += value;
    maximum = Math.max(maximum, value);
  }
  if (!Object.hasOwn(judgement.probabilities, judgement.profileId) || Math.abs(sum - 1) > 0.000001 || judgement.probabilities[judgement.profileId] !== maximum) return invalid();
  const confidence = judgement.confidence;
  if (confidence !== undefined && (!record(confidence) || typeof confidence.value !== 'number' || !Number.isFinite(confidence.value) || !nonempty(confidence.semantics))) return invalid();
  return {
    provider: judgement.provider,
    profileId: judgement.profileId,
    probabilities: Object.fromEntries(probabilities),
    model: judgement.model,
    questionVersion: judgement.questionVersion,
    ...(confidence === undefined ? {} : { confidence: { value: confidence.value as number, semantics: confidence.semantics as string } }),
  };
}
