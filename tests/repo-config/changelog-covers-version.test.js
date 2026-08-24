// Repo-meta test: the AppFramework's manifest version must have a matching
// CHANGELOG heading.
//
// WHY THIS EXISTS. `CHANGELOG.md` was maintained through 1.3.0 (2026-06-13)
// and then simply was not, for ten weeks of active development. By the time
// anyone noticed, the 1.4.0 -> 1.19.0 range was undocumented: ten published
// versions, and roughly 500 source commits. Nothing anywhere failed, because
// nothing anywhere looked. The release procedure does not mention the
// changelog at all, which is arguably the root cause.
//
// The package ships Apache-2.0 from the public repo, so the readers of that
// file are EXTERNAL consumers deciding whether and how to upgrade. A silently
// stale changelog is worse for them than an absent one, because it looks
// current.
//
// WHEN IT FIRES. At the moment the version is bumped - which is exactly when
// the entry should be written, and when the author still remembers what the
// release contains. That is the whole design: the cost lands on the person who
// has the knowledge, not on an archaeologist ten weeks later.
//
// WHAT IT CANNOT DO, stated in full because a guard whose limits are unwritten
// gets read as covering everything:
//
//  - **It cannot tell a real entry from an empty or dishonest one.** A heading
//    followed by nothing passes. So does a pasted commit dump, which is the
//    specific failure this file's backfill had to avoid. This is a floor.
//  - **It checks only the version currently in the manifest.** A version that
//    is bumped and later superseded without ever publishing will briefly demand
//    an entry it may not deserve. That is accepted: at bump time nobody knows
//    whether it will publish, and the alternative (checking against npm) makes
//    a repo-config test depend on the network.
//  - **It does not check the core library**, whose package carries no changelog
//    at all, and which lives in the other workspace root anyway - out of reach
//    of a test rooted here.
//  - **It says nothing about ORDER, dates, or the versions in between.** The
//    backfill deliberately omits 1.5.0, 1.6.0, 1.12.0 and 1.15.0-1.18.0
//    because they were never published; a guard that demanded contiguous
//    headings would have to invent them.
//
// See GpsPlusSlamJs_Docs/docs/2026-08-24-2052-framework-changelog-backfill-plan.md
// in the private repo for the decision record (D5).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const frameworkDir = resolve(repoRoot, 'GpsPlusSlamJs_AppFramework');

/**
 * True when `changelog` carries a top-level heading for `version`.
 *
 * Exported shape kept trivially pure so the negative case below can prove the
 * guard is capable of failing - a guard only ever exercised against a passing
 * repo is indistinguishable from `expect(true).toBe(true)`.
 */
function hasVersionHeading(changelog, version) {
  // Matches `## [1.19.0]` at line start; the separator and date after it are
  // free-form, so a change of dash style cannot silently disarm this.
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s*\\[${escaped}\\]`, 'm').test(changelog);
}

describe('AppFramework CHANGELOG covers the released version', () => {
  it('detects a present heading and a missing one', () => {
    // Why this test matters: it is the proof that the assertion below can
    // fail. Without it, a typo in the regex would make the real check pass
    // unconditionally and the guard would be decorative.
    const sample = '# Changelog\n\n## [1.19.0] - 2026-08-24\n\n### Features\n';
    expect(hasVersionHeading(sample, '1.19.0')).toBe(true);
    expect(hasVersionHeading(sample, '1.20.0')).toBe(false);
    // `.` must not act as a wildcard: 1.1.0 must not match `1x1x0`.
    expect(hasVersionHeading('## [1x19x0] - x', '1.19.0')).toBe(false);
  });

  it('has an entry for the version currently in package.json', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(frameworkDir, 'package.json'), 'utf8'),
    );
    const changelog = readFileSync(
      resolve(frameworkDir, 'CHANGELOG.md'),
      'utf8',
    );

    expect(
      hasVersionHeading(changelog, pkg.version),
      `CHANGELOG.md has no "## [${pkg.version}]" heading. Add one describing ` +
        `what a consumer upgrading to ${pkg.version} receives - public API ` +
        `changes, changed defaults, and behaviour visible from outside. Write ` +
        `it now, at the bump, rather than reconstructing it from git later: ` +
        `that is how 1.4.0 through 1.19.0 ended up undocumented.`,
    ).toBe(true);
  });
});
