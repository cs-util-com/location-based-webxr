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
// Coverage limits: this checks the *tracked* file list only, and by NAME. It
// cannot tell a deliberate fixture from an accidental dump (that judgement is
// what the allowlist below is for), and it says nothing about a file's size —
// a well-named fixture of any size passes here.
//
// Size is `max-file-size.test.js`'s job, and it had to be written because that
// gap was not hypothetical: `GpsPlusSlamJs_Osm/src/testdata/sites/cologne-cathedral.non-areal.json`
// was committed at 41.4 MB under a perfectly reasonable name. The sentence this
// comment replaced said `src/testdata/*.json` were "legitimately several MB and
// are meant to be there" — true when written, and by 2026-08-04 the largest was
// 1.25 MB after the minify pass, with 2 MiB now the enforced ceiling.

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
const SCRATCH_MARKERS = ['tmp', 'temp', 'scratch'];

/** Extensions that are always a working artefact, wherever they appear. */
const SCRATCH_EXTENSIONS = [
  /\.(orig|rej|bak|swp|swo)$/i,
  /^~\$/, // Office lock files
  /\.DS_Store$/,
];

/**
 * Does this basename mark the file as a working artefact?
 *
 * The marker must sit at the START or the END of the name's first segment —
 * `tmp-dump.csv`, `.rules-tmp.csv` — not merely somewhere inside it.
 *
 * That precision is not fussiness. The first version of this check matched the
 * marker anywhere, and promptly flagged **this very file**: `no-scratch-files`
 * is a name *about* scratch files, not the name *of* one. A rule that cannot
 * tell those apart gets an allowlist entry on its first day and a second on its
 * second, and stops meaning anything.
 */
function looksLikeScratch(name) {
  if (SCRATCH_EXTENSIONS.some((pattern) => pattern.test(name))) return true;

  // Leading dot is a hiding mechanism, not part of the name; `.rules-tmp.csv`
  // should be judged as `rules-tmp`.
  const stem = name.replace(/^\./, '').split('.')[0] ?? '';
  return SCRATCH_MARKERS.some(
    (marker) =>
      new RegExp(`^${marker}([-_]|$)`, 'i').test(stem) ||
      new RegExp(`([-_]|^)${marker}$`, 'i').test(stem),
  );
}

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
      (file) => !ALLOWLIST.has(file) && looksLikeScratch(basename(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('tells a scratch file from a file ABOUT scratch files', () => {
    // Pinned because the first version of this rule failed exactly here: it
    // matched the marker anywhere in the name and flagged its own test file.
    // The distinction is what keeps the rule from acquiring an allowlist entry
    // per false positive until it means nothing.
    for (const scratch of [
      '.rules-tmp.csv',
      'tmp-dump.json',
      'dump-tmp.json',
      'scratch.md',
      'notes-scratch.txt',
      'temp_output.csv',
      'thing.orig',
      '.DS_Store',
    ]) {
      expect(looksLikeScratch(scratch), `${scratch} should be flagged`).toBe(
        true,
      );
    }

    for (const deliberate of [
      'no-scratch-files.test.js',
      'temperature-sensor.ts',
      'template.html',
      'attempt-log.ts',
      'contemporary.md',
    ]) {
      expect(
        looksLikeScratch(deliberate),
        `${deliberate} should NOT be flagged`,
      ).toBe(false);
    }
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
