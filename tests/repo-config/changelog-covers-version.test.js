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
//    followed by nothing passes. So does a pasted commit dump. This is a floor.
//  - **It checks only the version currently in the manifest.** A version that
//    is bumped and later superseded without ever publishing will briefly demand
//    an entry it may not deserve. That is accepted: at bump time nobody knows
//    whether it will publish, and the alternative (checking against npm) makes
//    a repo-config test depend on the network.
//  - **It says nothing about ORDER, dates, or the versions in between.** The
//    backfill deliberately omits 1.5.0, 1.6.0, 1.12.0 and 1.15.0-1.18.0
//    because they were never published; a guard that demanded contiguous
//    headings would have to invent them.
//  - **It cannot see a version that was published but never bumped HERE.**
//    That happened to the core library on 2026-09-10: the bump lived only on
//    an isolated release branch, so this repo's manifest and changelog agreed
//    with each other at the old version while the registry served the new one.
//    Only a comparison against the registry sees that, and this file stays off
//    the network by the rule above. The counter-measure is procedural and
//    lives in the release guide.
//
// This file was written on branch r568 (2026-08-24) and never merged; it is
// re-created here rather than revived, because the changelog content beside it
// on that branch has been superseded twice over.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const frameworkDir = resolve(repoRoot, 'GpsPlusSlamJs_AppFramework');

/**
 * True when `changelog` carries a top-level heading for `version`.
 *
 * Kept trivially pure so the negative case below can prove the guard is
 * capable of failing - a guard only ever exercised against a passing repo is
 * indistinguishable from `expect(true).toBe(true)`.
 *
 * BOTH heading styles are accepted, because the two packages in this workspace
 * do not agree: the framework writes `## [1.24.0] - date`, the core library
 * writes a bare `## 1.24.0`. A pattern copied from one and applied to the
 * other fails on arrival, which is how this was found.
 */
export function hasVersionHeading(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `[ \t]` rather than `\s`, which matches NEWLINES: with `\s*` a bare
  // `##` line followed by a line beginning with the version passes with no
  // heading present at all. And a NEGATIVE LOOKAHEAD rather than "whitespace
  // follows", so the separator really is free-form - `## [1.24.0]-2026-09-05`
  // counts - while a longer version that merely starts with this one still
  // does not (PR #461 review).
  return new RegExp(`^##[ \\t]*\\[?${escaped}\\]?(?![\\d.])`, 'm').test(
    changelog
  );
}

describe('AppFramework CHANGELOG covers the released version', () => {
  it('detects a present heading and a missing one', () => {
    // Why this test matters: it is the proof that the assertion below can
    // fail. Without it, a typo in the pattern would make the real check pass
    // unconditionally and the guard would be decorative.
    const bracketed = '# Changelog\n\n## [1.19.0] - 2026-08-24\n\n### Features\n';
    expect(hasVersionHeading(bracketed, '1.19.0')).toBe(true);
    expect(hasVersionHeading(bracketed, '1.20.0')).toBe(false);

    // The library's style, which the original pattern refused.
    const bare = '# Changelog\n\n## 1.25.0\n\nNotes.\n';
    expect(hasVersionHeading(bare, '1.25.0')).toBe(true);

    // `.` must not act as a wildcard: 1.19.0 must not match `1x19x0`.
    expect(hasVersionHeading('## [1x19x0] - x', '1.19.0')).toBe(false);
    // Nor may a heading match a LONGER version that merely starts with it -
    // `## 1.2.50` is not an entry for 1.2.5.
    expect(hasVersionHeading('## 1.2.50\n', '1.2.5')).toBe(false);
    // An "Unreleased" section is not an entry for anything.
    expect(hasVersionHeading('## Unreleased\n', '1.25.0')).toBe(false);
    // A bare `##` must not reach across a line break to a version below it.
    expect(hasVersionHeading('## \n\n1.24.0 needs Node 26\n', '1.24.0')).toBe(
      false
    );
    // A separator with no space before it is still a heading.
    expect(hasVersionHeading('## [1.24.0]-2026-09-05\n', '1.24.0')).toBe(true);
  });

  it('has an entry for the version currently in package.json', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(frameworkDir, 'package.json'), 'utf8')
    );
    const changelog = readFileSync(
      resolve(frameworkDir, 'CHANGELOG.md'),
      'utf8'
    );

    expect(
      hasVersionHeading(changelog, pkg.version),
      `CHANGELOG.md has no "## [${pkg.version}]" heading. Add one describing ` +
        `what a consumer upgrading to ${pkg.version} receives - public API ` +
        `changes, changed defaults, and behaviour visible from outside. Write ` +
        `it now, at the bump, rather than reconstructing it from git later: ` +
        `that is how 1.4.0 through 1.19.0 ended up undocumented.`
    ).toBe(true);
  });
});
