// Repo-meta test: every `*.ts.md` sidecar has the `*.ts` it documents.
//
// Why this test matters: two sidecars —
// `GpsPlusSlamJs_AppFramework/src/utils/dom-helpers.ts.md` and `sentry.ts.md` —
// arrived in the repository's INITIAL commit as copies of files that live in
// `GpsPlusSlamJs_RecorderApp/src/utils/`, and their `.ts` never existed here.
// They sat there for the repo's entire life and nothing noticed, because every
// check runs in the other direction: `CLAUDE.md` mandates a sidecar per
// production file, and no gate asked whether a sidecar still has a file.
//
// The cost is not tidiness. `dom-helpers.ts.md` documents a
// `getRequiredElement(id, context?)` helper as if this package provided one; an
// agent reading the framework's `src/utils/` would find documentation for an
// API that is not there. A stale doc is worse than a missing one — it is
// confidently wrong, and that is what makes this a guard rather than a lint.
//
// Enumerates the tracked-file list rather than a curated one, for the reason
// `max-file-size.test.js` sets out at length: a gate over a hand-maintained
// list only guards what someone already remembered.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Source extensions that must exist when a `<name>.<ext>.md` sidecar does.
 *
 * Deliberately NOT every extension. A `README.md` is not a sidecar, and
 * `something.json.md` documenting a config file that was renamed is a different
 * (and much rarer) problem.
 */
const SIDECAR_EXTENSIONS = ['ts', 'tsx', 'js', 'mjs', 'cjs'];

const SIDECAR_PATTERN = new RegExp(`\\.(${SIDECAR_EXTENSIONS.join('|')})\\.md$`);

function trackedFiles() {
  return execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);
}

/**
 * The sidecars whose documented file is missing, as repo-relative paths.
 *
 * The sidecar itself must still be present too. `git ls-files` lists what is
 * TRACKED, so a sidecar deleted in the working tree but not yet committed is
 * still in that list — and reporting it as an orphan would fail the gate for
 * the very fix that resolves it.
 */
export function orphanSidecars(files, exists) {
  return files
    .filter((file) => SIDECAR_PATTERN.test(file))
    .filter((file) => exists(file))
    .filter((file) => !exists(file.slice(0, -'.md'.length)))
    .sort();
}

describe('sidecar coverage guard', () => {
  describe('orphanSidecars', () => {
    // The pure diff, tested directly so the guard's LOGIC is covered even in a
    // tree where it finds nothing — a green result must not be ambiguous
    // between "nothing is orphaned" and "the matcher matches nothing".
    it('flags a sidecar whose source file is gone', () => {
      const files = ['a/one.ts.md', 'a/two.ts.md'];
      const present = new Set(['a/one.ts.md', 'a/two.ts.md', 'a/two.ts']);
      const exists = (path) => present.has(path);

      expect(orphanSidecars(files, exists)).toEqual(['a/one.ts.md']);
    });

    it('ignores markdown that is not a sidecar', () => {
      const files = ['README.md', 'docs/plan.md', 'a/one.ts.md'];
      const exists = () => true;

      expect(orphanSidecars(files, exists)).toEqual([]);
    });
  });

  it('sees the real sidecars (so the guard is not vacuous)', () => {
    // Without this, deleting the pattern would leave a permanently green test.
    const sidecars = trackedFiles().filter((file) =>
      SIDECAR_PATTERN.test(file)
    );

    expect(sidecars.length).toBeGreaterThan(100);
    expect(sidecars).toContain(
      'GpsPlusSlamJs_AppFramework/src/utils/logger.ts.md'
    );
  });

  it('every sidecar documents a file that exists', () => {
    // A non-empty result names the orphan(s): either delete the sidecar, or
    // restore the file it documents.
    //
    // Existence is BOTH tracked and on disk, and the pairing matters on each
    // side. `existsSync` alone is case-insensitive on Windows, so a sidecar
    // `Foo.ts.md` beside `foo.ts` would pass here and fail on Linux CI; the
    // tracked-path set is case-exact and settles that. And the tracked set
    // alone would report a sidecar deleted in the working tree but not yet
    // committed — failing the gate for the very fix that resolves it.
    const tracked = new Set(trackedFiles());
    const exists = (path) =>
      tracked.has(path) && existsSync(resolve(repoRoot, path));

    expect(orphanSidecars(trackedFiles(), exists)).toEqual([]);
  });
});
