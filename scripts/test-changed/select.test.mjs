// Why this test matters: test:changed is allowed to SKIP gates, so a wrong
// selection silently under-tests an iteration. Each case here encodes one of
// the plan's Phase B.2 guard rails; a regression in any of them reopens a
// documented footgun (root-file blindness, untracked-file blindness, or the
// generated-timings-file feedback loop).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, it, expect } from 'vitest';

import { playwrightGrep } from '../e2e/tier.mjs';
import {
  cleanMergeRefusal,
  selectPackages,
  gateCommands,
  cascadeCommands,
  cascadeTierBase,
  MAIN_LINES,
  firstMergeBase,
  fastGateOptions,
  describeRun,
  FRAMEWORK_BUILD_IF_STALE,
} from './select.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

  // Why: a full-cascade fallback (a root script changed) gave the browser
  // tier no diff base, so only the @pr tests ran and the branch's own
  // changed specs did not run whole, exactly on the widest runs.
  it("hands the cascade's browser tier a base, so a changed spec runs whole there", () => {
    const [, cascade] = cascadeCommands({ tierBase: 'abc123' });
    expect(cascade.env).toEqual({ E2E_TIER_BASE: 'abc123' });
    expect(cascade.env).not.toHaveProperty('GATE_CHANGED_REF');
    const configUrl = pathToFileURL(
      path.join(ROOT, 'GpsPlusSlamJs_TourViewer/playwright-tests/x.config.js'),
    ).href;
    /** @type {string[]} */
    const asked = [];
    const grep = playwrightGrep(configUrl, {
      env: { ...cascade.env },
      argv: ['node', 'cli.js', 'test'],
      io: {
        root: () => ROOT,
        changed: (/** @type {string} */ ref) => {
          asked.push(ref);
          return ['GpsPlusSlamJs_TourViewer/playwright-tests/editor.spec.js'];
        },
      },
    });
    expect(asked).toEqual(['abc123']);
    const selects = (/** @type {string} */ line) => grep?.some((re) => re.test(line)) ?? true;
    expect(selects('dom playwright-tests/editor.spec.js an untagged test')).toBe(true);
    expect(selects('dom playwright-tests/other.spec.js an untagged test')).toBe(false);
  });

  it('takes the tier base from CI, then from --ref, then from the merge-base', () => {
    const mergeBase = () => 'mb';
    expect(cascadeTierBase({ env: { E2E_TIER_BASE: 'ci' }, ref: 'r1', mergeBase })).toBe('ci');
    expect(cascadeTierBase({ env: {}, ref: 'r1', mergeBase })).toBe('r1');
    expect(cascadeTierBase({ env: {}, ref: null, mergeBase })).toBe('mb');
    expect(cascadeTierBase({ env: {}, ref: null, mergeBase: () => null })).toBeNull();
  });

  // Why: a clone whose GitHub remote is called `origin`, or one with only a
  // local `main`, found no merge-base with a hardcoded `origin2/main`, and
  // the cascade's browser tier silently ran only the @pr tests.
  it('takes the merge-base with the first main line that has one, in order', () => {
    expect(MAIN_LINES).toEqual(['origin2/main', 'origin/main', 'main']);
    /** @type {string[]} */
    const asked = [];
    const only = (/** @type {string} */ line) => (/** @type {string} */ candidate) => {
      asked.push(candidate);
      return candidate === line ? 'mb-' + candidate : null;
    };
    expect(firstMergeBase(only('origin2/main'))).toBe('mb-origin2/main');
    expect(asked).toEqual(['origin2/main']);
    asked.length = 0;
    expect(firstMergeBase(only('main'))).toBe('mb-main');
    expect(asked).toEqual(['origin2/main', 'origin/main', 'main']);
    expect(firstMergeBase(only('origin/main'))).toBe('mb-origin/main');
    expect(firstMergeBase(() => null)).toBeNull();
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

// Why this test matters: the related-only unit run is licensed for the
// CHANGED packages of the per-commit fast gate and nothing else. The ref
// reaches them only when the caller passes `relatedUnitEnv` (the fast gate
// does, the milestone run does not), and the dependents get it cleared, so an
// inherited value can never narrow a dependent's suite.
describe('gateCommands: related unit tests in the fast gate', () => {
  const ENV = 'GATE_SKIP_BROWSER_STAGES';
  const RELATED = 'GATE_UNIT_RELATED_REF';

  it('hands the ref to the changed packages and clears it for the dependents', () => {
    const commands = gateCommands(['gps-plus-slam-tour-viewer'], {
      skipBrowserEnv: ENV,
      relatedUnitEnv: RELATED,
      ref: 'HEAD',
    });
    const changed = commands.find((c) => c.command.endsWith('--filter gps-plus-slam-tour-viewer test'));
    const dependents = commands.find((c) => c.command.includes('"...gps-plus-slam-tour-viewer"'));
    expect(changed?.env[RELATED]).toBe('HEAD');
    expect(dependents?.env[RELATED]).toBe('');
  });

  it('never sets it without the option (the milestone run)', () => {
    for (const command of gateCommands(['a'], { skipBrowserEnv: ENV, ref: 'abc123' })) {
      expect(command.env).not.toHaveProperty(RELATED);
    }
  });

  it('never sets it without a ref', () => {
    for (const command of gateCommands(['a'], { skipBrowserEnv: ENV, relatedUnitEnv: RELATED })) {
      expect(command.env[RELATED] ?? '').toBe('');
    }
  });
});

// Why this test matters: in the fast gate the dependents are the packages the
// import graph reaches (impact-graph.mjs), not every package pnpm lists as
// depending on a changed one. A list given here is the whole dependent set:
// each runs by name, with the ref, so its unit stage runs only the tests the
// change reaches; an empty list runs no dependent at all (a test-only change).
describe('gateCommands: graph-chosen dependents in the fast gate', () => {
  const ENV = 'GATE_SKIP_BROWSER_STAGES';
  const RELATED = 'GATE_UNIT_RELATED_REF';
  const TRIM = 'GATE_DEPENDENT_TRIM';
  const options = { skipBrowserEnv: ENV, relatedUnitEnv: RELATED, dependentTrimEnv: TRIM, ref: 'HEAD' };

  it('runs exactly the listed dependents, by name, with the ref and the trim', () => {
    const commands = gateCommands(['fw'], { ...options, dependents: ['tour', 'kit'] });
    const last = commands[commands.length - 1];
    expect(last.command).toBe('pnpm --workspace-concurrency=1 --filter kit --filter tour test');
    expect(last.env).toEqual({ [ENV]: '1', [RELATED]: 'HEAD', [TRIM]: '1' });
    expect(commands.some((c) => c.command.includes('"...fw"'))).toBe(false);
  });

  it('runs no dependent when the list is empty', () => {
    const commands = gateCommands(['fw'], { ...options, dependents: [] });
    expect(commands[commands.length - 1].command).toBe('pnpm --workspace-concurrency=1 --filter fw test');
  });

  it('never lists a changed package as its own dependent', () => {
    const commands = gateCommands(['fw'], { ...options, dependents: ['fw', 'tour'] });
    expect(commands[commands.length - 1].command).toBe('pnpm --workspace-concurrency=1 --filter tour test');
  });
});

// Why this test matters: the dependent trim (projects.mjs
// DEPENDENT_TRIM_STAGES) is licensed for the DEPENDENTS of the per-commit fast
// gate only. A changed package always runs its static checks, so it gets the
// switch cleared, and without the option (the milestone run) nobody gets it.
describe('gateCommands: dependent trim in the fast gate', () => {
  const ENV = 'GATE_SKIP_BROWSER_STAGES';
  const TRIM = 'GATE_DEPENDENT_TRIM';

  it('sets it for the dependents and clears it for the changed packages', () => {
    const commands = gateCommands(['gps-plus-slam-app-framework'], {
      skipBrowserEnv: ENV,
      dependentTrimEnv: TRIM,
      ref: 'HEAD',
    });
    const changed = commands.find((c) => c.command.endsWith('--filter gps-plus-slam-app-framework test'));
    const dependents = commands.find((c) => c.command.includes('"...gps-plus-slam-app-framework"'));
    expect(changed?.env[TRIM]).toBe('');
    expect(dependents?.env[TRIM]).toBe('1');
    expect(dependents?.env[ENV]).toBe('1');
  });

  it('never sets it without the option (the milestone run)', () => {
    for (const command of gateCommands(['a'], { skipBrowserEnv: ENV, ref: 'abc123' })) {
      expect(command.env).not.toHaveProperty(TRIM);
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

  // WHY (globe editor plan GV5, finding 9): the Tour Viewer DEPENDS on the
  // editor kit, so pnpm selects it on a kit change, but only as a dependent,
  // whose browser stages are dropped (DEC-G2). Its editor e2e is the kit's
  // only browser check, so the edge selects it as a changed package, in full.
  it('selects the Tour Viewer, in full, with any editor kit change', () => {
    expect(
      selectPackages({
        trackedChanges: ['GpsPlusSlamJs_EditorKit/src/chrome/menu-button.ts'],
        untracked: [],
        packageDirs: [...SERVED, 'GpsPlusSlamJs_EditorKit', 'GpsPlusSlamJs_TourViewer'],
      })
    ).toEqual({
      mode: 'packages',
      packages: ['GpsPlusSlamJs_EditorKit', 'GpsPlusSlamJs_TourViewer'],
    });
  });

  it('adds nothing for the editor kit when the Tour Viewer is not a workspace package', () => {
    expect(
      selectPackages({
        trackedChanges: ['GpsPlusSlamJs_EditorKit/src/chrome/menu-button.ts'],
        untracked: [],
        packageDirs: [...DIRS, 'GpsPlusSlamJs_EditorKit'],
      })
    ).toEqual({ mode: 'packages', packages: ['GpsPlusSlamJs_EditorKit'] });
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
    'GpsPlusSlamJs_Osm',
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
      [
        'GpsPlusSlamJs_DesignSystem/labs/terrain/fixtures/README.md',
        'the terrain fixtures budget sums every file under fixtures/',
      ],
      [
        'GpsPlusSlamJs_Osm/src/testdata/README.md',
        'testdata/ is test input, read by the tests that load it',
      ],
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

// Why this test matters: the Tour Viewer's e2e narrows itself to the changed
// area only when its gate carries the diff ref, so the ref must reach exactly
// the changed packages' full gates. On a dependent it would be meaningless
// (no browser stage runs), and on the cascade it must be absent, because
// that is the run (like CI) that has to execute every spec.
describe('gateCommands hands the diff ref to the changed packages only', () => {
  const ENV = 'GATE_SKIP_BROWSER_STAGES';

  it('sets GATE_CHANGED_REF on the full gates and nowhere else', () => {
    const commands = gateCommands(['a'], { skipBrowserEnv: ENV, ref: 'abc123' });
    const full = commands.find((c) => c.command.endsWith('--filter a test'));
    expect(full?.env).toEqual({ GATE_CHANGED_REF: 'abc123' });
    for (const c of commands.filter((x) => x !== full)) {
      expect(c.env, c.command).not.toHaveProperty('GATE_CHANGED_REF');
    }
  });

  it('sets nothing without a ref, and the cascade never carries one', () => {
    for (const c of gateCommands(['a'], { skipBrowserEnv: ENV })) {
      expect(c.env).not.toHaveProperty('GATE_CHANGED_REF');
    }
    for (const c of cascadeCommands()) {
      expect(c.env).toEqual({});
    }
  });
});

// Why: the related-only unit run and the dependents' trim belong to the
// per-commit fast gate only. If the browser run of a milestone (no skip
// switch) got them too, it would test a slice and pass for the full gate.
describe('fastGateOptions', () => {
  it('turns the related run and the trim on only with the skip switch set', () => {
    expect(fastGateOptions({ GATE_SKIP_BROWSER_STAGES: '1' })).toEqual({
      relatedUnitEnv: 'GATE_UNIT_RELATED_REF',
      dependentTrimEnv: 'GATE_DEPENDENT_TRIM',
    });
    expect(fastGateOptions({})).toEqual({});
    expect(fastGateOptions({ GATE_SKIP_BROWSER_STAGES: '' })).toEqual({});
  });
});

// Why: the default diff base is HEAD, so a merge that is already committed
// leaves nothing to diff. The gate then ran test:repo-config alone and exited
// 0, and a builder who merged main and trusted it had checked no package.
describe('cleanMergeRefusal', () => {
  const nothing = { mode: 'packages', packages: [] };
  const merge = { refGiven: false, selection: nothing, headIsMerge: true, headOnMain: false };

  it('refuses a committed merge with nothing left to diff, and names the way out', () => {
    expect(cleanMergeRefusal(merge)).toMatch(/--ref HEAD~1/);
    for (const line of MAIN_LINES) expect(cleanMergeRefusal(merge)).toContain(line);
    expect(cleanMergeRefusal(merge)).toContain('--all');
  });

  it('lets an explicit --ref through: the caller chose the base', () => {
    expect(cleanMergeRefusal({ ...merge, refGiven: true })).toBeNull();
  });

  it('lets an ordinary commit through: its gate ran before the commit', () => {
    expect(cleanMergeRefusal({ ...merge, headIsMerge: false })).toBeNull();
  });

  // A fresh branch off main sits on main's own merge commit: nothing was merged here.
  it('lets a merge commit that is already on main through', () => {
    expect(cleanMergeRefusal({ ...merge, headOnMain: true })).toBeNull();
  });

  it('lets a run through that has something to check', () => {
    for (const selection of [
      { mode: 'all', reason: 'package.json' },
      { mode: 'packages', packages: ['GpsPlusSlamJs_Osm'] },
      { mode: 'packages', packages: [], rootFiles: ['README.md'] },
      { mode: 'packages', packages: [], docsOnly: ['GpsPlusSlamJs_Osm/README.md'] },
    ]) {
      expect(cleanMergeRefusal({ ...merge, selection })).toBeNull();
    }
  });
});
