// Repo-meta test: no scratch or temporary artefacts are tracked in git.
//
// Why this test matters: `GpsPlusSlamJs_Osm/scripts/.rules-tmp.csv` — a 97 KB
// intermediate dump from probing the affordance rule sheet — was committed and
// went unnoticed through a full session and a code review, because a leading-dot
// filename hides from `ls`, adds nothing to any diff a human reads, and breaks
// no test. It was caught by an automated reviewer listing the PR's files, which
// is not a mechanism we should depend on.
//
// Committed scratch files are not merely untidy. They are stale by definition —
// this one duplicated data that `src/rules/default-rules.ts` now owns and
// versions properly — so the next reader has two sources and no way to tell
// which is authoritative.
//
// Coverage limits: this checks the *tracked* file list only. It cannot tell a
// deliberate fixture from an accidental dump (that judgement is what the
// allowlist below is for), and it says nothing about large files in general —
// `src/testdata/*.json` are legitimately several MB and are meant to be there.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Filename patterns that indicate a working artefact rather than a deliberate
 * source or fixture file.
 *
 * Deliberately narrow. A broad "no dotfiles" rule would fight the many
 * legitimate ones (`.gitignore`, `.npmrc`, `.github/…`), so this targets the
 * shapes that actually mean "I was mid-task": an explicit tmp/temp/scratch
 * marker, an editor or merge leftover, or a `.csv`/`.json` dump sitting in a
 * `scripts/` directory, which is for executables rather than data.
 */
const SCRATCH_PATTERNS = [
  /(^|[.\-_])tmp([.\-_]|$)/i,
  /(^|[.\-_])temp([.\-_]|$)/i,
  /(^|[.\-_])scratch([.\-_]|$)/i,
  /\.(orig|rej|bak|swp|swo)$/i,
  /^~\$/, // Office lock files
  /\.DS_Store$/,
];

/** Paths that look scratch-like but are deliberate. Empty is the goal. */
const ALLOWLIST = new Set([]);

function trackedFiles() {
  return execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })
    .split('\n')
    .filter((line) => line !== '');
}

describe('no scratch artefacts are tracked in git', () => {
  const files = trackedFiles();

  it('finds a non-trivial number of tracked files (the check is actually running)', () => {
    // Guards the failure mode where `git ls-files` returns nothing — from a
    // wrong cwd or a broken git — and every assertion below passes vacuously.
    expect(files.length).toBeGreaterThan(100);
  });

  it('tracks no file whose NAME marks it as a working artefact', () => {
    const offenders = files.filter(
      (file) =>
        !ALLOWLIST.has(file) &&
        SCRATCH_PATTERNS.some((pattern) => pattern.test(basename(file))),
    );
    expect(offenders).toEqual([]);
  });

  it('tracks no data dump sitting loose in a scripts/ directory', () => {
    // `scripts/` holds executables. A `.csv` or `.json` loose beside them is an
    // input or an output that escaped — data belongs in testdata/ or in a
    // versioned module, both of which carry provenance headers that a loose dump
    // does not.
    //
    // A `__test-fixtures__/` directory is exempt, and that exemption is the
    // point rather than a concession: a directory named that is an explicit
    // declaration of intent, which is exactly what the accidental dump lacked.
    // Exempting the CONVENTION keeps the rule meaningful; allowlisting the two
    // individual paths would have rotted the moment a third fixture appeared.
    const offenders = files.filter(
      (file) =>
        !ALLOWLIST.has(file) &&
        /(^|\/)scripts\//.test(file) &&
        /\.(csv|json|ndjson|txt)$/i.test(file) &&
        !/(^|\/)__(test-)?fixtures__\//.test(file) &&
        !/(^|\/)fixtures\//.test(file) &&
        // package.json and tsconfig.json legitimately live beside scripts.
        !/(^|\/)(package|tsconfig)[^/]*\.json$/i.test(file),
    );
    expect(offenders).toEqual([]);
  });

  it('still rejects a dump that is merely NEAR a fixtures directory', () => {
    // Guards the exemption above from being too generous: `scripts/fixtures.json`
    // is a loose dump, not a fixtures directory, and must still fail.
    const looksExempt = (path) =>
      /(^|\/)__(test-)?fixtures__\//.test(path) || /(^|\/)fixtures\//.test(path);

    expect(looksExempt('scripts/test-timing/__test-fixtures__/a.json')).toBe(true);
    expect(looksExempt('scripts/fixtures/a.json')).toBe(true);
    expect(looksExempt('scripts/fixtures.json')).toBe(false);
    expect(looksExempt('scripts/my-fixtures-dump.csv')).toBe(false);
  });
});
