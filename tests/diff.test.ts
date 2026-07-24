import { describe, expect, it } from 'vitest';
import { computeDiff } from '../lib/ui/panel/diff';

describe('word and grapheme safe diffing', () => {
  it.each([
    [
      'لطفاً یک پاسخ کوتاه و روشن بنویس.',
      'لطفاً یک پاسخ دقیق و روشن بنویس.',
      ['کوتاه', 'دقیق'],
    ],
    [
      'اكتب جوابا سريعا وواضحا.',
      'اكتب جوابا موجزا وواضحا.',
      ['سريعا', 'موجزا'],
    ],
    [
      'Use the 👩🏽‍💻 example in the answer.',
      'Use the 👨🏻‍💻 example in the answer.',
      ['👩🏽‍💻', '👨🏻‍💻'],
    ],
  ])('keeps changed runs whole for %s', (original, enhanced, changedWords) => {
    const runs = computeDiff(original, enhanced);
    expect(
      runs
        .filter((run) => run.kind !== 'added')
        .map((run) => run.value)
        .join(''),
    ).toBe(original);
    expect(
      runs
        .filter((run) => run.kind !== 'removed')
        .map((run) => run.value)
        .join(''),
    ).toBe(enhanced);

    const changes = runs
      .filter((run) => run.kind !== 'same')
      .map((run) => run.value.trim());
    for (const expected of changedWords) expect(changes).toContain(expected);
    for (const change of changes) {
      expect(change).not.toMatch(/^\p{Mark}|\p{Mark}$/u);
      expect(change).not.toMatch(/^\u200d|\u200d$/u);
    }
  });
});
