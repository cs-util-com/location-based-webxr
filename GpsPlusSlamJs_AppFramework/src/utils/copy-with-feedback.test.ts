/**
 * The one "copy to the clipboard, and say how it went" sequence (Tour
 * Viewer follow-up F7, root CLAUDE.md DEC-H3 and its async-UI rule).
 *
 * Why these tests matter: the Tour Viewer alone ran this sequence twice,
 * and five more copies live in other apps. One of them stuck at "Copying…"
 * on a phone without a clipboard because the write threw before it
 * returned a promise (Tour Viewer M4 review #1). The contract is small and
 * easy to get wrong in exactly that way: busy before the write, the write
 * INSIDE the chain, the real outcome after, the button usable again in
 * every case.
 */
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { copyWithFeedback } from './copy-with-feedback';

const LABELS = { busy: 'Copying…', done: 'Copied', failed: 'Copy failed' };

function button(): { disabled: boolean; textContent: string | null } {
  return { disabled: false, textContent: 'Copy' };
}

describe('copyWithFeedback', () => {
  it('is busy and disabled while the write runs, then says it is done', async () => {
    let release: () => void = () => undefined;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const b = button();
    const copied = copyWithFeedback(b, 'text', write, LABELS);
    expect(b).toEqual({ disabled: true, textContent: 'Copying…' });
    // The write runs a microtask later, inside the chain - that is what
    // turns a write that throws at once into "failed".
    await vi.waitFor(() => {
      expect(write).toHaveBeenCalledWith('text');
    });
    release();
    await expect(copied).resolves.toBe(true);
    expect(b).toEqual({ disabled: false, textContent: 'Copied' });
  });

  it('says it failed when the write rejects', async () => {
    const b = button();
    const failed = vi.fn();
    await expect(
      copyWithFeedback(b, 'text', () => Promise.reject(new Error('denied')), {
        ...LABELS,
        onFailed: failed,
      })
    ).resolves.toBe(false);
    expect(b).toEqual({ disabled: false, textContent: 'Copy failed' });
    expect(failed).toHaveBeenCalledWith(expect.any(Error));
  });

  it('fails, never sticks at busy, when the write throws before it returns a promise', async () => {
    // No clipboard on an http page or in some in-app browsers: the call
    // itself throws (M4 review #1).
    const b = button();
    await expect(
      copyWithFeedback(
        b,
        'text',
        () => {
          throw new TypeError('no clipboard');
        },
        LABELS
      )
    ).resolves.toBe(false);
    expect(b).toEqual({ disabled: false, textContent: 'Copy failed' });
  });

  it('fails when there is no write at all', async () => {
    const b = button();
    await expect(copyWithFeedback(b, 'text', undefined, LABELS)).resolves.toBe(
      false
    );
    expect(b.textContent).toBe('Copy failed');
  });

  it('runs the failed hook once, after the label', async () => {
    const b = button();
    const seen: (string | null)[] = [];
    await copyWithFeedback(b, 'text', () => Promise.reject(new Error('x')), {
      ...LABELS,
      onFailed: () => seen.push(b.textContent),
    });
    expect(seen).toEqual(['Copy failed']);
  });

  it('runs the done hook once, after the label', async () => {
    const b = button();
    const seen: (string | null)[] = [];
    await copyWithFeedback(b, 'text', () => Promise.resolve(), {
      ...LABELS,
      onDone: () => seen.push(b.textContent),
    });
    expect(seen).toEqual(['Copied']);
  });

  it('for any text and any kind of write, writes that text and ends enabled on the matching label (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.constantFrom('resolve', 'reject', 'throw', 'missing'),
        fc.boolean(),
        async (text, kind, startDisabled) => {
          const b = { disabled: startDisabled, textContent: 'Copy' };
          const written: string[] = [];
          const write =
            kind === 'missing'
              ? undefined
              : (t: string) => {
                  written.push(t);
                  if (kind === 'throw') throw new Error('x');
                  return kind === 'resolve'
                    ? Promise.resolve()
                    : Promise.reject(new Error('x'));
                };
          const ok = await copyWithFeedback(b, text, write, LABELS);
          expect(b.disabled).toBe(false);
          expect(b.textContent).toBe(ok ? 'Copied' : 'Copy failed');
          expect(ok).toBe(kind === 'resolve');
          expect(written).toEqual(kind === 'missing' ? [] : [text]);
        }
      )
    );
  });
});
