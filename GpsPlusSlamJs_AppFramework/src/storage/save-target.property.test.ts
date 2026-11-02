/**
 * Why this property matters: the same-file check decides whether a page
 * writes over a file on disk. For any content and any touch of the file's
 * time, a check must say "same" exactly when the content the check reads
 * is the content opened: the whole file for the hash, the last 64 KiB for
 * the tail (with a same size, which every case here keeps).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SAME_FILE_TAIL_BYTES,
  createSaveTarget,
  type SameFileCheck,
  type WritableFileHandle,
} from './save-target';

function diskFile(bytes: Uint8Array, modified: number) {
  const state = { bytes, modified };
  const handle = {
    kind: 'file',
    name: 'f',
    getFile: () =>
      Promise.resolve(
        new File([state.bytes.slice()], 'f', { lastModified: state.modified })
      ),
  } as unknown as WritableFileHandle;
  return { handle, state };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

describe('createSaveTarget, the same-file check', () => {
  it('a touched file of the same size is "same" exactly when what the check reads is unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<SameFileCheck>('tail', 'hash'),
        fc.uint8Array({ minLength: 0, maxLength: 64 }),
        fc.nat({ max: 2 * SAME_FILE_TAIL_BYTES }),
        fc.func(fc.nat({ max: 255 })),
        fc.boolean(),
        async (check, seed, lead, edit, editLead) => {
          // A file of `lead` zero bytes before the seed: with a long lead
          // an edit there is outside the tail.
          const opened = new Uint8Array(lead + seed.length);
          opened.set(seed, lead);
          const now = opened.slice();
          if (editLead && lead > 0) now[0] = edit(0);
          else for (let i = 0; i < seed.length; i++) now[lead + i] = edit(i);
          const { handle, state } = diskFile(opened, 1000);
          const target = await createSaveTarget(
            handle,
            await handle.getFile(),
            { check }
          );
          state.bytes = now;
          state.modified = 2000;
          const tail = (b: Uint8Array) =>
            b.slice(Math.max(0, b.length - SAME_FILE_TAIL_BYTES));
          const expected =
            check === 'hash'
              ? sameBytes(opened, now)
              : sameBytes(tail(opened), tail(now));
          expect(await target.check()).toBe(expected ? 'same' : 'changed');
        }
      ),
      { numRuns: 60 }
    );
  });
});
