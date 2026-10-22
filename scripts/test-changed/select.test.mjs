// Why this test matters: test:changed is allowed to SKIP gates, so a wrong
// selection silently under-tests an iteration. Each case here encodes one of
// the plan's Phase B.2 guard rails; a regression in any of them reopens a
// documented footgun (root-file blindness, untracked-file blindness, or the
// generated-timings-file feedback loop).
import { describe, it, expect } from 'vitest';
import {
  selectPackages,
  gateCommands,
  cascadeCommands,
  describeRun,
  FRAMEWORK_BUILD_IF_STALE,
} from './select.mjs';

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
    // happens to share the name is a real change. Being markdown under a
    // `docs/` dir, it is a doc-only change (its package's format stage).
    expect(
      select({
        trackedChanges: [
          'GpsPlusSlamJs_RecorderApp/src/docs/test-timings.md',
        ],
      })
    ).toEqual({
      mode: 'packages',
      packages: [],
      docsOnly: ['GpsPlusSlamJs_RecorderApp/src/docs/test-timings.md'],
    });
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
    expect(commands).toHaveLength(4);

    // The build BEFORE the repo-config tests: one of them reads the
    // framework's dist when present, and must not read a stale one.
    expect(commands[0].command).toBe(FRAMEWORK_BUILD_IF_STALE);
    expect(commands[1].command).toBe('pnpm run test:repo-config');

    // The changed package: plain `--filter`, no env, so its own e2e runs.
    expect(commands[2].command).toContain('--filter gps-plus-slam-osm');
    expect(commands[2].command).not.toContain('...');
    expect(commands[2].env).toEqual({});

    // Dependents: the closure MINUS the package that just ran, in skip mode.
    expect(commands[3].command).toContain('--filter "...gps-plus-slam-osm"');
    expect(commands[3].command).toContain('--filter "!gps-plus-slam-osm"');
    expect(commands[3].env).toEqual({ [ENV]: '1' });
  });

  // Why this test matters (stale-dist follow-up 2026-09-28-1910, option 1):
  // the Tour Viewer, AnchorStarter and the other demo apps resolve the
  // framework through its package `exports`, i.e. through `dist`, and their
  // own `build:framework` stage comes AFTER `typecheck` and `test:unit`. On a
  // framework change the framework's own gate builds nothing, so without this
  // step a dependent type-checked and unit-tested against whatever `dist` was
  // on disk: a false green whenever the source had removed an export the old
  // `dist` still had. CI was safe only because it builds first.
  it('builds the framework dist (when stale) before ANY package gate runs', () => {
    const commands = gateCommands(['gps-plus-slam-app-framework'], {
      skipBrowserEnv: ENV,
    });
    const build = commands.findIndex(
      (c) => c.command === FRAMEWORK_BUILD_IF_STALE
    );
    expect(build).toBeGreaterThan(-1);
    commands.forEach((c, i) => {
      if (/\btest$/.test(c.command)) {
        expect(i).toBeGreaterThan(build);
      }
    });
    // Through the staleness check, never an unconditional build: a fresh dist
    // costs an mtime walk, not a ~5 s build per commit.
    expect(FRAMEWORK_BUILD_IF_STALE).toContain(
      'build-workspace-package-if-stale.mjs gps-plus-slam-app-framework GpsPlusSlamJs_AppFramework'
    );
  });

  it('runs no build when no package gate runs', () => {
    expect(
      gateCommands([], { skipBrowserEnv: ENV }).map((c) => c.command)
    ).not.toContain(FRAMEWORK_BUILD_IF_STALE);
  });

  // The full-cascade fallback gets the same step: the cascade runs knip
  // (which resolves workspace packages through their `dist`) before any
  // package stage has built the framework.
  it('builds the framework (when stale) before the full cascade too', () => {
    expect(cascadeCommands()).toEqual([
      { command: FRAMEWORK_BUILD_IF_STALE, env: {} },
      { command: 'pnpm test', env: {} },
    ]);
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
    const [, , , dependents] = gateCommands(['a', 'b', 'c'], {
      skipBrowserEnv: ENV,
    });
    for (const name of ['a', 'b', 'c']) {
      expect(dependents.command).toContain(`--filter "...${name}"`);
      expect(dependents.command).toContain(`--filter "!${name}"`);
    }
  });
});

// WHY (globe plan 2026-09-26-0539 §8, "the lab smoke must run on a
// globe-only commit"): the design system does not DEPEND on the globe
// package, it SERVES it through its routes, so pnpm's graph never selects
// it and a globe change would skip the only browser check the globe has.
// The served-by edge adds it, in full. Deliberately for the globe only: the
// framework and OsmDemo are served too, but adding them would put the design
// system's ~11 min e2e on every framework commit (an owner decision, filed).
describe('the served-by edge', () => {
  const SERVED = [...DIRS, 'GpsPlusSlamJs_Globe', 'GpsPlusSlamJs_DesignSystem'];
  it('selects the design system with any globe change', () => {
    expect(
      selectPackages({
        trackedChanges: ['GpsPlusSlamJs_Globe/src/globe-surface.ts'],
        untracked: [],
        packageDirs: SERVED,
      })
    ).toEqual({
      mode: 'packages',
      packages: ['GpsPlusSlamJs_DesignSystem', 'GpsPlusSlamJs_Globe'],
    });
  });

  it('adds nothing for a change the design system does not serve', () => {
    expect(
      selectPackages({
        trackedChanges: ['GpsPlusSlamJs_RecorderApp/src/main.ts'],
        untracked: [],
        packageDirs: SERVED,
      })
    ).toEqual({ mode: 'packages', packages: ['GpsPlusSlamJs_RecorderApp'] });
  });

  it('adds nothing when the design system is not a workspace package', () => {
    expect(
      selectPackages({
        trackedChanges: ['GpsPlusSlamJs_Globe/src/globe-surface.ts'],
        untracked: [],
        packageDirs: [...DIRS, 'GpsPlusSlamJs_Globe'],
      })
    ).toEqual({ mode: 'packages', packages: ['GpsPlusSlamJs_Globe'] });
  });
});

// WHY: any path outside a package used to send the commit gate to the full
// cascade, so a commit that changed one package file and one repo-config
// guard ran every package's gate, rolled the
// dice of every random-seed property in the workspace and could hold the
// machine slot for hours. In two months 161 commits did that, 95 of them
// touching only root files that nothing but root stages read. These cases pin
// the narrowed classes AND every counter-example found, because a wrong
// narrowing silently skips a gate the change needed.
describe('narrowed root paths and doc-only markdown', () => {
  const ALL = [
    ...DIRS,
    'GpsPlusSlamJs_Globe',
    'GpsPlusSlamJs_DesignSystem',
    'GpsPlusSlamJs_TourViewer',
  ];
  const sel = (
    /** @type {string[]} */ paths,
    /** @type {string[]} */ untracked = []
  ) => selectPackages({ trackedChanges: paths, untracked, packageDirs: ALL });

  it('(a) a repo-config test runs repo-config and knip, not the cascade', () => {
    expect(sel(['tests/repo-config/hud-overlay-nesting.test.js'])).toEqual({
      mode: 'packages',
      packages: [],
      rootChecks: ['check:deadcode'],
      rootFiles: ['tests/repo-config/hud-overlay-nesting.test.js'],
    });
  });

  it('(a) a NEW, untracked repo-config file counts the same way', () => {
    expect(sel([], ['tests/repo-config/new-guard.test.js'])).toEqual({
      mode: 'packages',
      packages: [],
      rootChecks: ['check:deadcode'],
      rootFiles: ['tests/repo-config/new-guard.test.js'],
    });
  });

  it('(a) with a package change: that package, not the cascade', () => {
    expect(
      sel([
        'tests/repo-config/hud-overlay-nesting.test.js',
        'GpsPlusSlamJs_TourViewer/src/walk-sheet.ts',
      ])
    ).toEqual({
      mode: 'packages',
      packages: ['GpsPlusSlamJs_TourViewer'],
      rootChecks: ['check:deadcode'],
      rootFiles: ['tests/repo-config/hud-overlay-nesting.test.js'],
    });
  });

  it('(a) knip.json runs knip', () => {
    expect(sel(['knip.json'])).toEqual({
      mode: 'packages',
      packages: [],
      rootChecks: ['check:deadcode'],
      rootFiles: ['knip.json'],
    });
  });

  it('(b) root markdown, .github and .vscode run repo-config only', () => {
    const paths = [
      'README.md',
      'docs/dev-server-ports.md',
      'knip.json.md',
      'scripts/test-timing/README.md',
      'scripts/test-changed/select.mjs.md',
      '.github/workflows/ci.yml',
      '.vscode/settings.json',
    ];
    expect(sel(paths)).toEqual({
      mode: 'packages',
      packages: [],
      rootFiles: [...paths].sort(),
    });
  });

  it('(c) a package sidecar is doc-only, and pulls in no served-by edge', () => {
    expect(sel(['GpsPlusSlamJs_Globe/src/flight-pace.ts.md'])).toEqual({
      mode: 'packages',
      packages: [],
      docsOnly: ['GpsPlusSlamJs_Globe/src/flight-pace.ts.md'],
    });
  });

  it('(c) a README, a CHANGELOG and docs/ markdown are doc-only', () => {
    const paths = [
      'GpsPlusSlamJs_AppFramework/CHANGELOG.md',
      'GpsPlusSlamJs_AppFramework/README.md',
      'GpsPlusSlamJs_TourViewer/docs/notes.md',
    ];
    expect(sel(paths)).toEqual({
      mode: 'packages',
      packages: [],
      docsOnly: [...paths].sort(),
    });
  });

  it('(c) a doc file beside a code change is formatted by the full package gate', () => {
    expect(
      sel(['GpsPlusSlamJs_Landing/src/a.ts', 'GpsPlusSlamJs_Landing/src/a.ts.md'])
    ).toEqual({ mode: 'packages', packages: ['GpsPlusSlamJs_Landing'] });
  });

  it('counter-examples: markdown that a package stage READS keeps its package gate', () => {
    for (const [path, reader] of [
      ['GpsPlusSlamJs_DesignSystem/hud-design-brief.md', 'check-tokens.mjs'],
      [
        'GpsPlusSlamJs_DesignSystem/labs/terrain/fixtures/PROVENANCE.md',
        'terrain-fixtures.test.mjs',
      ],
      [
        'GpsPlusSlamJs_Globe/assets/PROVENANCE.md',
        'the asset budget in globe-sources.test.ts',
      ],
      [
        'GpsPlusSlamJs_Globe/assets/README.md',
        'the asset budget sums every file under assets/',
      ],
      ['GpsPlusSlamJs_DesignSystem/assets/README.md', 'build-lookdev.test.mjs'],
      [
        'GpsPlusSlamJs_TourViewer/public/prototypes/x/README.md',
        'public/ is shipped as it is',
      ],
      ['GpsPlusSlamJs_TourViewer/public/notes.ts.md', 'public/ is shipped as it is'],
    ]) {
      const dir = path.split('/')[0];
      // The Globe keeps its served-by edge to the design system too.
      const packages =
        dir === 'GpsPlusSlamJs_Globe' ? ['GpsPlusSlamJs_DesignSystem', dir] : [dir];
      expect(sel([path]), reader).toEqual({ mode: 'packages', packages });
    }
  });

  it('counter-examples: gate tooling, shared inputs and root configs stay on the full cascade', () => {
    for (const path of [
      'scripts/test-timing/run-stage.mjs',
      'scripts/test-changed/select.mjs',
      'scripts/e2e/browser-launch.mjs',
      'scripts/build-site.mjs',
      'pnpm-lock.yaml',
      'package.json',
      'pnpm-workspace.yaml',
      'patches/some.patch',
      '.nvmrc',
      'vitest.config.js',
      'wrangler.toml',
      '.gitignore',
      '.gitattributes',
      'tests/other/x.test.js',
      'tests/repo-config',
    ]) {
      expect(sel([path]), path).toEqual({ mode: 'all', reason: path });
    }
  });

  it('a narrowed root path beside a forcing one still runs the full cascade', () => {
    expect(
      sel(['README.md', 'tests/repo-config/a.test.js', 'pnpm-lock.yaml'])
    ).toEqual({ mode: 'all', reason: 'pnpm-lock.yaml' });
  });
});

describe('gateCommands for the narrowed classes', () => {
  const ENV = 'GATE_SKIP_BROWSER_STAGES';
  const commandsOf = (/** @type {Parameters<typeof gateCommands>} */ ...args) =>
    gateCommands(...args).map((c) => c.command);

  it('root checks only: the framework build FIRST, then repo-config, then knip', () => {
    expect(
      commandsOf([], { skipBrowserEnv: ENV, rootChecks: ['check:deadcode'] })
    ).toEqual([
      FRAMEWORK_BUILD_IF_STALE,
      'pnpm run test:repo-config',
      'pnpm run check:deadcode',
    ]);
  });

  it('doc-only: repo-config and the package format stage, nothing else', () => {
    expect(
      commandsOf([], {
        skipBrowserEnv: ENV,
        docOnlyNames: ['gps-plus-slam-globe'],
      })
    ).toEqual([
      'pnpm run test:repo-config',
      'pnpm --workspace-concurrency=1 --filter gps-plus-slam-globe run --if-present format',
    ]);
  });

  it('everything at once, in order: build, repo-config, format, knip, full gates, dependents', () => {
    const commands = gateCommands(['gps-plus-slam-tour-viewer'], {
      skipBrowserEnv: ENV,
      rootChecks: ['check:deadcode'],
      docOnlyNames: ['gps-plus-slam-globe'],
    });
    expect(commands.map((c) => c.command)).toEqual([
      FRAMEWORK_BUILD_IF_STALE,
      'pnpm run test:repo-config',
      'pnpm --workspace-concurrency=1 --filter gps-plus-slam-globe run --if-present format',
      'pnpm run check:deadcode',
      'pnpm --workspace-concurrency=1 --filter gps-plus-slam-tour-viewer test',
      'pnpm --workspace-concurrency=1 --filter "...gps-plus-slam-tour-viewer" --filter "!gps-plus-slam-tour-viewer" test',
    ]);
    expect(commands.at(-1)?.env).toEqual({ [ENV]: '1' });
  });
});

// The rule for a run that covers less than the full gate is that it says so,
// in one place: what changed, and everything that will run.
describe('describeRun', () => {
  it('names a narrowed run and everything it runs, in one line', () => {
    const line = describeRun(
      {
        mode: 'packages',
        packages: ['GpsPlusSlamJs_TourViewer'],
        rootChecks: ['check:deadcode'],
        rootFiles: ['tests/repo-config/hud-overlay-nesting.test.js'],
        docsOnly: [
          'GpsPlusSlamJs_Globe/README.md',
          'GpsPlusSlamJs_Globe/src/a.ts.md',
        ],
      },
      'HEAD'
    );
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toBe(
      'test-changed: vs HEAD - changed GpsPlusSlamJs_TourViewer; root files (1): tests/repo-config/hud-overlay-nesting.test.js; doc-only markdown in GpsPlusSlamJs_Globe (2 files) => runs: the framework build if stale, test:repo-config, format in GpsPlusSlamJs_Globe, check:deadcode, the full gate of GpsPlusSlamJs_TourViewer, then its dependents without browser stages'
    );
  });

  it('names a run with nothing selected', () => {
    expect(describeRun({ mode: 'packages', packages: [] }, 'HEAD')).toBe(
      'test-changed: vs HEAD - no package changes => runs: test:repo-config'
    );
  });

  it('names a root-markdown-only run, listing at most three files', () => {
    expect(
      describeRun(
        {
          mode: 'packages',
          packages: [],
          rootFiles: ['README.md', 'a.md', 'b.md', 'docs/x.md'],
        },
        'abc123'
      )
    ).toBe(
      'test-changed: vs abc123 - root files (4): README.md, a.md, b.md, ... => runs: test:repo-config'
    );
  });
});
