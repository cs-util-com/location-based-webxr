/**
 * Why this test matters: `embedCoverageInSessionJson` became a wrapper over
 * `rebuildZipWithEntries`, which THROWS on failure; the wrapper's contract
 * is the opposite ("never partial, the input back by reference"), and that
 * one branch is the only new code the refactor added. The rebuild is
 * mocked to throw because no real archive that opens can make the rebuild
 * fail any more (M1 review #2 made it accept whatever names it finds).
 * Its own file: `vi.mock` is hoisted per module, and the sibling test
 * exercises the real rebuild.
 */

import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./zip-rebuild', () => ({
  rebuildZipWithEntries: () => Promise.reject(new Error('writer exploded')),
}));

import { embedCoverageInSessionJson } from './zip-coverage-embed';

describe('embedCoverageInSessionJson when the rebuild fails', () => {
  it('returns the input by reference instead of throwing or emitting a partial', async () => {
    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await writer.add('session.json', new TextReader('{"name":"legacy"}'));
    const input = await writer.close();
    const out = await embedCoverageInSessionJson(
      input,
      ['8b1fa1da1d64fff'],
      11
    );
    expect(out).toBe(input);
  });
});
