// Repo-meta test: no tracked file exceeds the per-file size ceiling.
//
// Why this test matters: `GpsPlusSlamJs_Osm/src/testdata/sites/cologne-cathedral.non-areal.json`
// was committed at 41.4 MB across 1 128 493 lines — 66.6 % of PR #249's entire
// diff — and nothing went red. The capture script's own header had predicted "a
// few hundred kB"; it wrote ~140x that, and no gate compared the two.
//
// A ceiling DID already exist and did not fire. `src/testdata/sites/site-extracts.test.ts`
// asserts `bytes < 2 MiB` per site, in the very directory the 39.5 MiB file sat
// in — but it iterates `CORPUS_SITES`, a curated list, and the outlier was not a
// corpus site. That is the design lesson this file is built on: **a size gate
// must enumerate the tracked-file list, never a list someone maintains by hand**,
// or it guards only what was already remembered. `no-scratch-files.test.js`
// enumerates the same way for the same reason.
//
// Coverage limits: this measures the WORKING-TREE size of tracked files, which
// is what a diff and a checkout pay. It is not the repository cost — git
// zlib-compresses every blob, so the 41.4 MB file was always ~6.5 MB in `.git`.
// Confusing the two is what made "just gzip the fixtures" look like a fix worth
// 8x when it was worth 20 %.
//
// See GpsPlusSlamJs_Docs/docs/2026-08-04-0709-pr-249-diff-weight-audit.md (D4).

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Per-file ceiling, in bytes.
 *
 * 2 MiB, matching the number `site-extracts.test.ts` already applies to the six
 * corpus sites — one threshold in the repo rather than two that drift. Every
 * fixture clears it with room to spare after the 2026-08-04 minify pass: the
 * largest, `building-block.json`, is 1.25 MB.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Tracked files that are deliberately over the ceiling.
 *
 * The allowlist is the point of this gate rather than a concession to it: each
 * entry is an exception somebody had to write down and justify, which is
 * exactly what the 41 MB fixture never got.
 *
 * **Both groups here are irreplaceable in a way a fixture is not.** Every OSM
 * fixture can be re-fetched from Overpass; these cannot be re-recorded — they
 * are one afternoon's field test on specific hardware, and the sessions they
 * captured no longer exist to record again. That asymmetry, not their size, is
 * why they are allowed and a 41 MB regenerable capture was not.
 */
const ALLOWLIST = new Set([
  // Eight real RecorderApp field-test sessions from 2026-06-16 (Pixel 6A,
  // outdoor campus walks), kept in-repo as shared example and replay data.
  // `GpsPlusSlamJs_ExampleRecordings/README.md` documents their origin and
  // records the deliberate decision NOT to move them to LFS — the blobs are in
  // history either way, so an in-repo move shrinks no clone.
  'GpsPlusSlamJs_ExampleRecordings/2026-06-16_11-18-16utc.zip',
  'GpsPlusSlamJs_ExampleRecordings/2026-06-16_11-43-17utc.zip',
  'GpsPlusSlamJs_ExampleRecordings/2026-06-16_11-45-34utc.zip',
  'GpsPlusSlamJs_ExampleRecordings/2026-06-16_11-53-33utc.zip',
  'GpsPlusSlamJs_ExampleRecordings/2026-06-16_11-57-53utc.zip',
  'GpsPlusSlamJs_ExampleRecordings/2026-06-16_12-05-02utc.zip',
  'GpsPlusSlamJs_ExampleRecordings/2026-06-16_12-17-21utc.zip',
  'GpsPlusSlamJs_ExampleRecordings/2026-06-16_12-26-49utc.zip',

  // A live Playwright fixture: the physics demo's e2e suite imports this
  // recording to drive a replay. Shrinking it is a real change to what that
  // suite covers, so it gets an entry rather than a trim.
  'GpsPlusSlamJs_PhysicsDemo/playwright-tests/fixtures/sample-recording.zip',
]);

function trackedFiles() {
  return execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })
    .split('\n')
    .filter((line) => line !== '');
}

/** Size of a tracked path, or `undefined` if it is not on disk. */
function sizeOf(file) {
  try {
    return statSync(resolve(repoRoot, file)).size;
  } catch {
    // A tracked path can legitimately be absent from the working tree during a
    // sparse or partial checkout. Absent is not oversized.
    return undefined;
  }
}

describe('no tracked file exceeds the size ceiling', () => {
  const files = trackedFiles();

  it('finds a non-trivial number of tracked files (the check is actually running)', () => {
    // Guards the failure mode where `git ls-files` returns nothing — a wrong
    // cwd, a broken git, a non-repo — and every assertion below passes
    // vacuously over an empty list. This is the same guard
    // `no-scratch-files.test.js` carries, and it is the specific shape of
    // silent-green that a list-driven gate cannot even have.
    expect(files.length).toBeGreaterThan(100);
  });

  it('tracks no file over the ceiling that is not explicitly allowed', () => {
    const offenders = files
      .filter((file) => !ALLOWLIST.has(file))
      .map((file) => ({ file, bytes: sizeOf(file) }))
      .filter(({ bytes }) => bytes !== undefined && bytes >= MAX_BYTES)
      .sort((a, b) => b.bytes - a.bytes)
      .map(({ file, bytes }) => `${(bytes / 1048576).toFixed(2)} MiB  ${file}`);

    // Reported with sizes rather than as bare paths: the fix depends on how far
    // over the line a file is, and a reader who has to go and measure it
    // themselves is a reader who allowlists it instead.
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist honest — every entry is tracked and still oversized', () => {
    // An allowlist that outlives its reasons is worse than none: it reads as
    // "these were considered" while actually meaning "nobody rechecked". An
    // entry that has been deleted, renamed, or shrunk below the ceiling must be
    // removed, and this is what forces that.
    const tracked = new Set(files);
    const stale = [...ALLOWLIST].filter((file) => {
      if (!tracked.has(file)) return true;
      const bytes = sizeOf(file);
      return bytes !== undefined && bytes < MAX_BYTES;
    });
    expect(stale).toEqual([]);
  });
});
