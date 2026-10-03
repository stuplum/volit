import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createJevProvider } from '../src/index.ts';
import { INSUFFICIENT_EVIDENCE, JudgeError, type JudgeErrorCode, type JudgeRequest } from '@volit/judge';

const servers: Server[] = [];
const profiles = [
  { id: 'review', description: 'Independent review of an existing implementation' },
  { id: 'implementation', description: 'Implement a specified ordinary change' },
];
const evidence = { request: 'Review this implementation', context: [], omitted: false } as const;
const completeResponse = '{"model":"jev-1.13.1","answers":{"profile":{"type":"choice","choice":"review","probabilities":{"review":0.8,"implementation":0.15,"insufficient_evidence":0.05},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}';

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => unknown): Promise<string> {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  return `http://127.0.0.1:${address.port}/v1/systemone`;
}

async function call(endpoint: string, overrides: Partial<JudgeRequest> = {}) {
  return createJevProvider({ apiKey: 'synthetic-test-key', endpoint }).judge({ evidence, profiles, timeoutMs: 1_000, ...overrides });
}

async function failure(promise: Promise<unknown>, code: JudgeErrorCode) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(JudgeError);
    expect((error as JudgeError).code).toBe(code);
    return error as JudgeError;
  }
  throw new Error(`Expected ${code}`);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});


describe('bounded Jev transport', () => {
  test('uses the pinned choice API and stable allowlist, and preserves the returned distribution and model', async () => {
    let received: unknown;
    let method: string | undefined;
    let authorization: string | undefined;
    const endpoint = await serve(async (request, response) => {
      method = request.method;
      authorization = request.headers.authorization;
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      received = JSON.parse(body);
      response.setHeader('content-type', 'application/json');
      response.end(completeResponse);
    });
    const result = await call(endpoint, { evidence: { ...evidence, secret: 'do not disclose' } as never });
    expect(result).toEqual({ provider: 'jev', profileId: 'review', probabilities: { review: 0.8, implementation: 0.15, insufficient_evidence: 0.05 }, confidence: { value: 0.67, semantics: 'typesafe-confidence' }, model: 'jev-1.13.1', questionVersion: 'volit-work-profile-v1' });
    expect(method).toBe('POST');
    expect(authorization).toBe('Bearer synthetic-test-key');
    const payload = received as { model: string; state: unknown; questions: { profile: { type: string; instructions: string; criteria: Record<string, string> } } };
    expect(payload.model).toBe('jev-1.13.0');
    expect(payload.state).toEqual({ request: 'Review this implementation', context: [], omitted: false });
    expect(payload.questions.profile.type).toBe('choice');
    expect(Object.keys(payload.questions.profile.criteria)).toEqual(['review', 'implementation', 'insufficient_evidence']);
    expect(payload.questions.profile.criteria.review).toBe('Independent review of an existing implementation');
  });

  test('accepts insufficient evidence as an outcome rather than inventing a profile', async () => {
    const endpoint = await serve((_, response) => response.end('{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"insufficient_evidence","probabilities":{"review":0.1,"implementation":0.1,"insufficient_evidence":0.8},"confidence":0.68}},"usage":{"input_tokens":80,"output_tokens":30}}'));
    expect((await call(endpoint)).profileId).toBe(INSUFFICIENT_EVIDENCE);
  });

  test.each([
    ['unknown choice', '{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"unlisted","probabilities":{"review":0.8,"implementation":0.15,"insufficient_evidence":0.05},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['missing option', '{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"review","probabilities":{"review":0.8,"implementation":0.2},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['unknown option', '{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"review","probabilities":{"review":0.8,"implementation":0.15,"insufficient_evidence":0.05,"unlisted":0},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['inconsistent argmax', '{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"implementation","probabilities":{"review":0.8,"implementation":0.15,"insufficient_evidence":0.05},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['negative probability', '{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"review","probabilities":{"review":0.8,"implementation":0.3,"insufficient_evidence":-0.1},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['probability above one', '{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"review","probabilities":{"review":1.1,"implementation":0,"insufficient_evidence":0},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['nonfinite probability', '{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"review","probabilities":{"review":1e400,"implementation":0,"insufficient_evidence":0},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['unnormalised probabilities', '{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"review","probabilities":{"review":0.5,"implementation":0.1,"insufficient_evidence":0.1},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['string probability', '{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"review","probabilities":{"review":"0.8","implementation":0.15,"insufficient_evidence":0.05},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['invalid confidence', '{"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"review","probabilities":{"review":0.8,"implementation":0.15,"insufficient_evidence":0.05},"confidence":1.2}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['wrong answer type', '{"model":"jev-1.13.0","answers":{"profile":{"type":"noul","noul":0.8}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['missing model', '{"answers":{"profile":{"type":"choice","choice":"review","probabilities":{"review":0.8,"implementation":0.15,"insufficient_evidence":0.05},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['wrong question', '{"model":"jev-1.13.0","answers":{"other":{"type":"choice","choice":"review","probabilities":{"review":0.8,"implementation":0.15,"insufficient_evidence":0.05},"confidence":0.67}},"usage":{"input_tokens":318,"output_tokens":34}}'],
    ['invalid JSON', '{private response body'],
  ])('rejects %s without disclosing response content', async (_, body) => {
    const endpoint = await serve((_, response) => response.end(body));
    const error = await failure(call(endpoint), 'invalid_response');
    expect(error.message).not.toContain(body);
    expect(error.message).not.toContain('synthetic-test-key');
    expect(error.message).not.toContain(evidence.request);
  });

  test.each([
    [],
    [{ id: '', description: 'empty' }],
    [{ id: ' ', description: 'blank' }],
    [{ id: 'insufficient_evidence', description: 'reserved' }],
    [{ id: 'review', description: 'one' }, { id: 'review', description: 'two' }],
    Array.from({ length: 255 }, (_, index) => ({ id: `p${index}`, description: 'work' })),
  ].map((invalidProfiles) => [invalidProfiles] as const))('rejects invalid profile allowlists before disclosure %#', async (invalidProfiles) => {
    let requests = 0;
    const endpoint = await serve((_, response) => { requests++; response.end(completeResponse); });
    await failure(call(endpoint, { profiles: invalidProfiles }), 'invalid_input');
    expect(requests).toBe(0);
  });

  test.each([
    { evidence: { ...evidence, request: 'x'.repeat(28_001) } },
    { evidence: { ...evidence, request: 'é'.repeat(14_001) } },
    { evidence: { ...evidence, context: [{ role: 'assistant' as const, text: 'x'.repeat(28_001) }] } },
    { profiles: [{ id: 'review', description: 'x'.repeat(28_001) }] },
  ])('rejects oversized evidence or descriptions before disclosure %#', async (overrides) => {
    let requests = 0;
    const endpoint = await serve((_, response) => { requests++; response.end(completeResponse); });
    await failure(call(endpoint, overrides), 'invalid_input');
    expect(requests).toBe(0);
  });

  test('counts the full UTF-8 wire body at the request ceiling without silently truncating evidence', async () => {
    let requests = 0;
    let bodyBytes = 0;
    let receivedRequest = '';
    const endpoint = await serve(async (request, response) => {
      requests++;
      let body = '';
      for await (const chunk of request) {
        bodyBytes += Buffer.byteLength(chunk);
        body += chunk.toString();
      }
      receivedRequest = JSON.parse(body).state.request;
      response.end(completeResponse);
    });
    await call(endpoint, { evidence: { ...evidence, request: 'x' } });
    const overhead = bodyBytes - 1;
    bodyBytes = 0;
    const atLimit = 'x'.repeat(28_000 - overhead);
    await call(endpoint, { evidence: { ...evidence, request: atLimit } });
    expect(bodyBytes).toBe(28_000);
    expect(receivedRequest).toBe(atLimit);
    await failure(call(endpoint, { evidence: { ...evidence, request: `${atLimit}x` } }), 'invalid_input');
    expect(requests).toBe(2);
  });

  test('fails an HTTP error once without retrying or exposing the server body', async () => {
    let requests = 0;
    const endpoint = await serve((_, response) => { requests++; response.writeHead(429, { 'retry-after': '0' }); response.end('private provider failure'); });
    const error = await failure(call(endpoint), 'http_error');
    expect(requests).toBe(1);
    expect(error.message).not.toContain('private provider failure');
  });

  test('the overall deadline includes a stalled response body', async () => {
    const endpoint = await serve((_, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{"model":'); });
    await failure(call(endpoint, { timeoutMs: 50 }), 'timeout');
  });

  test('the overall deadline includes waiting for response headers', async () => {
    const endpoint = await serve(() => {});
    await failure(call(endpoint, { timeoutMs: 50 }), 'timeout');
  });

  test('pre-abort prevents network disclosure and does not expose the abort reason', async () => {
    let requests = 0;
    const endpoint = await serve((_, response) => { requests++; response.end(completeResponse); });
    const controller = new AbortController();
    controller.abort(new Error('private abort reason'));
    const error = await failure(call(endpoint, { signal: controller.signal }), 'aborted');
    expect(requests).toBe(0);
    expect(error.message).not.toContain('private abort reason');
  });

  test('in-flight abort stops a response whose body never finishes', async () => {
    const controller = new AbortController();
    const endpoint = await serve((_, response) => {
      response.writeHead(200);
      response.write('{');
      controller.abort(new Error('private abort reason'));
    });
    const error = await failure(call(endpoint, { signal: controller.signal }), 'aborted');
    expect(error.message).not.toContain('private abort reason');
  });

  test('does not follow a redirect or forward credentials even to the same origin', async () => {
    let redirected = 0;
    const endpoint = await serve((request, response) => {
      if (request.url === '/redirected') { redirected++; response.end(completeResponse); return; }
      response.writeHead(307, { location: '/redirected' });
      response.end();
    });
    await failure(call(endpoint), 'http_error');
    expect(redirected).toBe(0);
  });

  test('rejects streamed responses exceeding the byte budget', async () => {
    const endpoint = await serve((_, response) => { response.writeHead(200); response.write(' '.repeat(65_536)); response.end(completeResponse); });
    await failure(call(endpoint), 'response_too_large');
  });

  test('rejects oversized advertised bodies without awaiting the body', async () => {
    const endpoint = await serve((_, response) => { response.writeHead(200, { 'content-length': '99999999' }); response.flushHeaders(); });
    await failure(call(endpoint), 'response_too_large');
  });

  test.each(['http://example.com/v1/systemone', 'ftp://127.0.0.1/file', 'https://user:secret@example.com/v1/systemone'])('rejects unsafe endpoint %s before transmission', async (endpoint) => {
    await failure(call(endpoint), 'invalid_input');
  });
});
