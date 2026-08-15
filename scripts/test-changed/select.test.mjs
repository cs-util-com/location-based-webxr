// Why this test matters: test:changed is allowed to SKIP gates, so a wrong
// selection silently under-tests an iteration. Each case here encodes one of
// the plan's Phase B.2 guard rails; a regression in any of them reopens a
// documented footgun (root-file blindness, untracked-file blindness, or the
// generated-timings-file feedback loop).
import { describe, it, expect } from 'vitest';
import { selectPackages, gateCommands } from './select.mjs';

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

// Why this test matters: DEC-G2's whole guarantee lives in the SHAPE of these
// commands. If the dependent command ever lost its env var, or the changed
// packages stopped running first, the gate would still exit 0 while proving
// materially less — the silent-weakening failure this split was designed to
// avoid. The dependent SET is pnpm's job (`...X` closure) and is not asserted
// here; `selectPackages` cannot compute it.
describe('gateCommands', () => {
  const ENV = 'GATE_SKIP_BROWSER_STAGES';

  it('runs only the repo-config tests when nothing changed', () => {
    expect(gateCommands([], { skipBrowserEnv: ENV })).toEqual([
      { command: 'pnpm run test:repo-config', env: {} },
    ]);
  });

  it('runs changed packages in FULL and first, then dependents without e2e', () => {
    const commands = gateCommands(['gps-plus-slam-osm'], {
      skipBrowserEnv: ENV,
    });
    expect(commands).toHaveLength(3);

    expect(commands[0].command).toBe('pnpm run test:repo-config');

    // The changed package: plain `--filter`, no env, so its own e2e runs.
    expect(commands[1].command).toContain('--filter gps-plus-slam-osm');
    expect(commands[1].command).not.toContain('...');
    expect(commands[1].env).toEqual({});

    // Dependents: the closure MINUS the package that just ran, in skip mode.
    expect(commands[2].command).toContain('--filter "...gps-plus-slam-osm"');
    expect(commands[2].command).toContain('--filter "!gps-plus-slam-osm"');
    expect(commands[2].env).toEqual({ [ENV]: '1' });
  });

  it('never puts the changed packages in skip mode', () => {
    // The inverse of the assertion above, stated separately because it is the
    // one that would break silently: a changed package running without its own
    // e2e is exactly what DEC-G2 does NOT license.
    for (const command of gateCommands(['a', 'b'], { skipBrowserEnv: ENV })) {
      if (Object.keys(command.env).length > 0) {
        expect(command.command).toContain('--filter "!a"');
        expect(command.command).toContain('--filter "!b"');
      }
    }
  });

  it('subtracts every changed package from the dependent run', () => {
    const [, , dependents] = gateCommands(['a', 'b', 'c'], {
      skipBrowserEnv: ENV,
    });
    for (const name of ['a', 'b', 'c']) {
      expect(dependents.command).toContain(`--filter "...${name}"`);
      expect(dependents.command).toContain(`--filter "!${name}"`);
    }
  });
});
