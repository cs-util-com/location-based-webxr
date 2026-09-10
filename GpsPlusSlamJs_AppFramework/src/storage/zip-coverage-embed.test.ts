/**
 * Tests for embedCoverageInSessionJson (B3 — in-zip coverage rewrite).
 *
 * Why this matters: the one-time backfill rewrites the user's recording files,
 * so the primitive that produces the rewritten zip must be exact and safe:
 *   - it embeds h3Cells/h3Resolution into session.json and nothing else;
 *   - every other entry is preserved byte-for-byte (no data loss);
 *   - it is idempotent (re-running the upgrade is a no-op);
 *   - a missing/malformed session.json leaves the zip untouched (never writes
 *     over a broken recording).
 *
 * @see ./zip-coverage-embed.ts
 */

import { describe, it, expect } from 'vitest';
import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';
import { produceTestZip } from '../test-utils/zip-round-trip-helpers';
import { loadSessionMetadataFromBlob } from './zip-reader';
import { embedCoverageInSessionJson } from './zip-coverage-embed';

const CELLS = ['8b1fa1da1d64fff', '8b1fa1da1d4afff'];

/** Read every non-directory entry's uncompressed bytes into a map. */
async function readEntryBytes(zip: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const entries = await reader.getEntries();
    const out = new Map<string, Uint8Array>();
    for (const entry of entries) {
      if (entry.directory || !entry.getData) {
        continue;
      }
      out.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
    }
    return out;
  } finally {
    await reader.close();
  }
}

/** Build a minimal hand-crafted zip from name→text pairs (negative cases). */
async function makeZip(
  files: Array<{ name: string; text: string }>
): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { level: 0 });
  for (const f of files) {
    await writer.add(f.name, new TextReader(f.text));
  }
  return writer.close();
}

describe('embedCoverageInSessionJson', () => {
  it('writes h3Cells + h3Resolution into a legacy session.json', async () => {
    const { zipData } = await produceTestZip({ scenarioName: 'Legacy' }); // no h3Cells
    const input = new Blob([zipData as BlobPart]);

    const out = await embedCoverageInSessionJson(input, CELLS, 11);

    expect(out).not.toBe(input); // a new blob was produced
    const meta = await loadSessionMetadataFromBlob(out);
    expect(meta?.h3Cells).toEqual(CELLS);
    expect(meta?.h3Resolution).toBe(11);
  });

  it('preserves all non-session entries byte-for-byte', async () => {
    const { zipData } = await produceTestZip({ scenarioName: 'Legacy' });
    const input = new Blob([zipData as BlobPart]);

    const out = await embedCoverageInSessionJson(input, CELLS, 11);

    const before = await readEntryBytes(input);
    const after = await readEntryBytes(out);

    // Same set of filenames (session.json included on both sides).
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());

    // Every entry except session.json is byte-identical.
    for (const [name, bytes] of before) {
      if (name.endsWith('session.json')) {
        continue;
      }
      expect(after.get(name)).toEqual(bytes);
    }
  });

  it('is idempotent: a zip already carrying coverage is returned unchanged', async () => {
    const { zipData } = await produceTestZip({
      scenarioName: 'Covered',
      h3Cells: CELLS,
    });
    const input = new Blob([zipData as BlobPart]);

    // Try to embed *different* cells — must be ignored (no overwrite).
    const out = await embedCoverageInSessionJson(
      input,
      ['8b1fa1da1d6ffff'],
      11
    );

    expect(out).toBe(input); // same reference — no rewrite happened
    const meta = await loadSessionMetadataFromBlob(out);
    expect(meta?.h3Cells).toEqual(CELLS); // original cells preserved
  });

  it('returns the input untouched when session.json is absent', async () => {
    const zip = await makeZip([
      { name: 'actions/000001.json', text: '{"type":"x"}' },
    ]);
    const out = await embedCoverageInSessionJson(zip, CELLS, 11);
    expect(out).toBe(zip);
  });

  it('returns the input untouched when session.json is malformed', async () => {
    const zip = await makeZip([{ name: 'session.json', text: 'not json{' }]);
    const out = await embedCoverageInSessionJson(zip, CELLS, 11);
    expect(out).toBe(zip);
  });
});

describe('a session.json the author-path rules would refuse', () => {
  it('backfills a `./session.json` instead of silently skipping the recording', async () => {
    // The live half of the PR #438 review finding. This function finds the
    // entry by SUFFIX, so it deliberately tolerates `./session.json` - a
    // shape some zip tools and re-zipped folders produce. It then handed
    // that same name to the rebuild as a NEW entry, where the author-path
    // rules refused it; the `catch` turned that into "leave the zip
    // untouched" and the recording was skipped with only a log line.
    //
    // Nothing the framework's own writer emits looks like this, so it only
    // ever bit archives from elsewhere - which is exactly the population a
    // backfill exists for.
    const zip = await makeZip([
      { name: './session.json', text: JSON.stringify({ odomCoordVersion: 5 }) },
      { name: 'keep.txt', text: 'keep' },
    ]);
    const out = await embedCoverageInSessionJson(zip, CELLS, 11);
    expect(out).not.toBe(zip);
    const after = await readEntryBytes(out);
    // Written back at the name the archive used - not moved to the root.
    const session = JSON.parse(
      new TextDecoder().decode(after.get('./session.json'))
    ) as Record<string, unknown>;
    expect(session['h3Cells']).toEqual(CELLS);
    expect(session['h3Resolution']).toBe(11);
    expect(after.has('keep.txt')).toBe(true);
  });
});

describe('a session.json that parses to a non-object', () => {
  it('returns the input untouched instead of throwing out of the function', async () => {
    // Why this test matters: `JSON.parse` succeeds on `null`, `3` and
    // `"text"`, and this function promises to hand the input back on ANY
    // unexpected read - a backfill over many recordings wants that rather
    // than an exception per file. Reading a property off a non-object
    // threw from outside every try, so one odd recording aborted the whole
    // backfill. Merging into one would have been destructive too: the
    // spread produces a fresh object and overwrites what the file held.
    for (const body of ['null', '3', '"text"', '[1,2]']) {
      const writer = new ZipWriter(new BlobWriter('application/zip'), {
        level: 0,
      });
      await writer.add('session.json', new TextReader(body));
      const zip = await writer.close();
      const out = await embedCoverageInSessionJson(zip, CELLS, 11);
      expect(out, body).toBe(zip);
    }
  });
});
