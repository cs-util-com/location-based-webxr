// Why this test matters: test:changed is allowed to SKIP gates, so a wrong
// selection silently under-tests an iteration. Each case here encodes one of
// the plan's Phase B.2 guard rails; a regression in any of them reopens a
// documented footgun (root-file blindness, untracked-file blindness, or the
// generated-timings-file feedback loop).
import { describe, it, expect } from 'vitest';
import { selectPackages } from './select.mjs';

const DIRS = [
  'GpsPlusSlamJs_AppFramework',
  'GpsPlusSlamJs_RecorderApp',
  'GpsPlusSlamJs_Landing',
];

/** @param {Partial<Parameters<typeof selectPackages>[0]>} partial */
function select(partial) {
  return selectPackages({
    trackedChanges: [],
    untracked: [],
    packageDirs: DIRS,
    ...partial,
  });
}

describe('selectPackages', () => {
  it('maps package-dir changes to those packages, sorted and deduped', () => {
    expect(
      select({
        trackedChanges: [
          'GpsPlusSlamJs_RecorderApp/src/main.ts',
          'GpsPlusSlamJs_AppFramework/src/utils/logger.ts',
          'GpsPlusSlamJs_RecorderApp/src/ui/log-panel.ts',
        ],
      })
    ).toEqual({
      mode: 'packages',
      packages: ['GpsPlusSlamJs_AppFramework', 'GpsPlusSlamJs_RecorderApp'],
    });
  });

  it('falls back to the full cascade for any root-level file', () => {
    expect(select({ trackedChanges: ['package.json'] })).toEqual({
      mode: 'all',
      reason: 'package.json',
    });
    expect(
      select({ trackedChanges: ['scripts/test-timing/projects.mjs'] })
    ).toEqual({ mode: 'all', reason: 'scripts/test-timing/projects.mjs' });
  });

  it('falls back to the full cascade for unknown directories', () => {
    expect(select({ trackedChanges: ['SomeNewDir/file.ts'] })).toEqual({
      mode: 'all',
      reason: 'SomeNewDir/file.ts',
    });
  });

  it('counts untracked files as changes (git diff never lists them)', () => {
    expect(
      select({ untracked: ['GpsPlusSlamJs_Landing/src/new-file.test.ts'] })
    ).toEqual({ mode: 'packages', packages: ['GpsPlusSlamJs_Landing'] });
  });

  it('ignores generated docs/test-timings.md at root and package level', () => {
    expect(
      select({
        trackedChanges: [
          'docs/test-timings.md',
          'GpsPlusSlamJs_RecorderApp/docs/test-timings.md',
        ],
      })
    ).toEqual({ mode: 'packages', packages: [] });
  });

  it('does NOT ignore a timings-named file nested deeper than one package level', () => {
    // Only the two known generated locations are exempt; anything else that
    // happens to share the name is a real change.
    expect(
      select({
        trackedChanges: [
          'GpsPlusSlamJs_RecorderApp/src/docs/test-timings.md',
        ],
      })
    ).toEqual({ mode: 'packages', packages: ['GpsPlusSlamJs_RecorderApp'] });
  });

  it('normalizes backslash paths (Windows git output variants)', () => {
    expect(
      select({ trackedChanges: ['GpsPlusSlamJs_Landing\\src\\main.ts'] })
    ).toEqual({ mode: 'packages', packages: ['GpsPlusSlamJs_Landing'] });
  });

  it('returns an empty package list when nothing changed', () => {
    expect(select({})).toEqual({ mode: 'packages', packages: [] });
  });

  it('treats a bare top-level filename equal to a package dir as a root file', () => {
    // A FILE named like a package dir (no slash) lives at the root.
    expect(select({ trackedChanges: ['GpsPlusSlamJs_Landing'] })).toEqual({
      mode: 'all',
      reason: 'GpsPlusSlamJs_Landing',
    });
  });
});
