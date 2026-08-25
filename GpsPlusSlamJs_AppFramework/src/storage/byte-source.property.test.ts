import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { SwitchableByteSource, type ByteSource } from './byte-source.js';

/**
 * Why this test matters: the one-shot switch is the safety mechanism that
 * keeps a warmed local copy from corrupting an in-progress session. For ANY
 * sequence of switch attempts with arbitrary sizes, exactly the invariants
 * below must hold — `size` never changes, at most one attempt succeeds, and
 * the successful one is precisely the first size-matching candidate. A bug
 * here (say, a mismatch consuming the one allowed swap) would strand a
 * session on the slow remote path forever, silently.
 */

function sourceOfSize(size: number, fill: number): ByteSource {
  return {
    size,
    read: (offset, length) =>
      Promise.resolve(new Uint8Array(length).fill(fill)),
  };
}

describe('SwitchableByteSource — properties', () => {
  it('accepts exactly the first size-matching candidate, never changing size', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 64 }),
        fc.array(fc.integer({ min: 1, max: 64 }), { maxLength: 12 }),
        async (size, candidateSizes) => {
          const s = new SwitchableByteSource(sourceOfSize(size, 0));
          const results = candidateSizes.map((candidate, i) =>
            s.switchTo(sourceOfSize(candidate, i + 1))
          );

          expect(s.size).toBe(size);
          const firstMatch = candidateSizes.findIndex((c) => c === size);
          results.forEach((took, i) => expect(took).toBe(i === firstMatch));

          // Reads delegate to the accepted candidate (or the original when
          // none matched).
          const byte = (await s.read(0, 1))[0];
          expect(byte).toBe(firstMatch === -1 ? 0 : firstMatch + 1);
        }
      )
    );
  });
});
