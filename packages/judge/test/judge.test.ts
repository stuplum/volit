import { describe, expect, test } from 'bun:test';
import { buildEvidence, JudgeError } from '../src/index.ts';
describe('permitted evidence', () => {
  test('discloses only allowlisted text and prioritises the request and newest useful continuity', () => {
    const result = buildEvidence({
      request: 'yes',
      maxChars: 10,
      context: [
        { role: 'user', text: 'old secret context' },
        { role: 'assistant', text: 'abcdefghi', toolOutput: 'private tool output', image: 'private image' },
        { role: 'user', text: '   ' },
      ],
      systemPrompt: 'private system prompt',
    } as Parameters<typeof buildEvidence>[0]);
    expect(result).toEqual({ request: 'yes', context: [{ role: 'assistant', text: 'cdefghi' }], omitted: true });
  });

  test('marks request truncation rather than hiding lost evidence', () => {
    expect(buildEvidence({ request: '0123456789', maxChars: 5 })).toEqual({ request: '01234', context: [], omitted: true });
    expect(buildEvidence({ request: 'a😀b', maxChars: 2 })).toEqual({ request: 'a', context: [], omitted: true });
  });

  test('preserves chronology and does not mark fully included permitted evidence omitted', () => {
    expect(buildEvidence({ request: 'yes', maxChars: 30, context: [{ role: 'user', text: 'review' }, { role: 'assistant', text: 'this change?' }] })).toEqual({
      request: 'yes', context: [{ role: 'user', text: 'review' }, { role: 'assistant', text: 'this change?' }], omitted: false,
    });
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an unusable evidence budget %s', (maxChars) => {
    expect(() => buildEvidence({ request: 'work', maxChars })).toThrow(JudgeError);
  });

  test('rejects empty work and raw host message roles', () => {
    expect(() => buildEvidence({ request: ' ', maxChars: 20 })).toThrow(JudgeError);
    expect(() => buildEvidence({ request: 'work', maxChars: 20, context: [{ role: 'tool', text: 'secret' }] } as never)).toThrow(JudgeError);
  });
});
