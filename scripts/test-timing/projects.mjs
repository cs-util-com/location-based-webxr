// Single source of truth for every package's test gate: stage order,
// canonical commands, and which JSON reporter (if any) provides exact test
// counts. This is the multi-package replacement for the library pilot's
// stages.mjs — one ProjectConfig per workspace package (plus one for the
// workspace root chain). Both shells (timed-stage.mjs, run-gate.mjs) resolve
// their project from the invoking cwd, and chain-guard.mjs cross-checks each
// project against its package.json chain scripts on every gate run.
//
// Commands run through a shell (`&&` is allowed) with the package's and the
// workspace root's node_modules/.bin on PATH, exactly like the previous
// inline package.json scripts. They live here rather than inline in
// package.json for the same reasons as the pilot (see stages.mjs upstream):
// compound commands survive, and "any forwarded arg ⇒ filtered run" stays
// trivially detectable.
//
// knip caveat (same as the pilot): binaries that now appear only here
// (jscpd, dpdm, depcruise, stylelint, …) are invisible to knip's
// package.json-script analysis; affected devDependencies need
// ignoreDependencies entries in the root knip.json.

import path from 'node:path';

/**
 * @typedef {Object} StageConfig
 * @property {string} name - pnpm script name; also the md row label
 * @property {string} command - canonical shell command (full-suite form)
 * @property {'vitest' | 'playwright' | null} counts - JSON reporter to inject
 * @property {readonly string[]} [filteredRunArgs] - appended (before the
 *   forwarded args) ONLY when a run is filtered by forwarded args; full-suite
 *   and CI runs never see them.
 * @property {string} [filteredRunCommand] - cheaper base command substituted
 *   ONLY on filtered runs (e.g. test:unit without --coverage — speedup plan
 *   C.1); recorded full-suite and CI runs always use `command`.
 * @property {boolean} [wrapperScript] - default true. false = the package.json
 *   script of the same name intentionally does NOT route through
 *   timed-stage.mjs (e.g. build:framework: dev flows and Playwright
 *   webServer `pnpm run dev` spawns reference the script and must not
 *   record timing rows); the gate still runs this stage via its `command`.
 */

/**
 * @typedef {Object} ProjectConfig
 * @property {string} name - display name used in the generated md header
 * @property {string} dir - directory relative to the workspace root ('.' for
 *   the root project); also the cwd key the shells resolve against
 * @property {readonly StageConfig[]} stages
 * @property {readonly string[]} chainNames - package.json `&&` chain scripts
 *   that chain-guard cross-checks against the stage order
 */

/** Name of the synthetic full-gate row; only run-gate.mjs writes it. */
export const TOTAL_STAGE = 'total';

/** Shared build:framework stage: skips the (identical) framework build when
 * dist/ is already fresh — the cascade otherwise rebuilds it once per
 * consumer package (speedup plan C.2). wrapperScript false: the package.json
 * build:framework script stays a RAW unconditional build because dev flows
 * and Playwright webServer `pnpm run dev` spawns call it and must neither
 * record timing rows nor inherit the skip. */
const BUILD_FRAMEWORK_STAGE = Object.freeze({
  name: 'build:framework',
  command: 'node ../scripts/build-framework-if-stale.mjs',
  counts: /** @type {null} */ (null),
  wrapperScript: false,
});

/** Format command shared by the app packages (framework differs). */
const APP_FORMAT_COMMAND =
  'prettier --log-level warn --write --ignore-unknown --no-error-on-unmatched-pattern "src" "config" "playwright-tests" index.html README.md package.json';

/**
 * The stage set shared verbatim by the four uniform demo apps (AnchorStarter,
 * QrTrackingDemo, PhysicsDemo, WayfindingHudDemo): identical package.json
 * chains, no coverage on unit tests, framework build split into its own
 * stage row before e2e (speedup plan Phase A.2).
 *
 * @returns {StageConfig[]}
 */
function demoAppStages() {
  return [
    { name: 'format', command: APP_FORMAT_COMMAND, counts: null },
    {
      name: 'lint',
      command: 'eslint . --config config/eslint.config.mjs',
      counts: null,
    },
    {
      name: 'lint:css',
      command:
        'stylelint "**/*.html" --config config/stylelint.config.mjs --allow-empty-input',
      counts: null,
    },
    {
      name: 'check:dup',
      command: 'jscpd --config config/.jscpd.json src',
      counts: null,
    },
    {
      name: 'check:cycles',
      command: 'dpdm -T --exit-code circular:1 --no-warning --no-tree ./src/main.ts',
      counts: null,
    },
    {
      name: 'check:boundaries',
      command: 'depcruise -c config/.dependency-cruiser.cjs src',
      counts: null,
    },
    {
      name: 'check:deadcode',
      command: 'pnpm --workspace-root run check:deadcode',
      counts: null,
    },
    {
      name: 'typecheck',
      command: 'tsc -p tsconfig.app.json --noEmit',
      counts: null,
    },
    {
      name: 'typecheck:tests',
      command: 'tsc -p tsconfig.vitest.json --noEmit',
      counts: null,
    },
    { name: 'test:unit', command: 'vitest run', counts: 'vitest' },
    BUILD_FRAMEWORK_STAGE,
    {
      name: 'test:e2e',
      command: 'playwright test --config playwright-tests/playwright.config.js',
      counts: 'playwright',
    },
  ];
}

/**
 * @param {string} dirName
 * @returns {ProjectConfig}
 */
function demoAppProject(dirName) {
  return {
    name: dirName,
    dir: dirName,
    chainNames: ['test:core', 'check:all'],
    stages: demoAppStages(),
  };
}

/**
 * @param {string} scriptName - root chain row label (e.g. 'test:recorder')
 * @param {string} packageName - pnpm workspace package name
 * @returns {StageConfig} duration-only row; the package gate it spawns
 *   records its own per-stage detail in that package's docs/test-timings.md
 */
function packageGateStage(scriptName, packageName) {
  return {
    name: scriptName,
    command: `pnpm --filter ${packageName} test`,
    counts: null,
  };
}

/** @type {readonly ProjectConfig[]} */
export const PROJECTS = [
  {
    // The workspace-root cascade: one duration row per package gate plus the
    // root repo-config tests. Includes PhysicsDemo and WayfindingHudDemo —
    // previously missing from the root chain entirely (speedup plan §1.1,
    // decided 2026-07-21).
    name: 'location-based-webxr',
    dir: '.',
    chainNames: [],
    stages: [
      {
        name: 'test:repo-config',
        command: 'vitest run --config vitest.config.js',
        counts: 'vitest',
      },
      packageGateStage('test:framework', 'gps-plus-slam-app-framework'),
      // Placed right after the framework and before every app: it is a pure
      // library with no framework dependency, so a break here is never caused
      // by an app and should surface before the slow app gates run.
      packageGateStage('test:osm', 'gps-plus-slam-osm'),
      packageGateStage('test:recorder', 'gps-plus-slam-recorder'),
      packageGateStage('test:starter', 'gps-plus-slam-anchor-starter'),
      packageGateStage('test:example', 'gps-plus-slam-minimal-example'),
      packageGateStage('test:qr-demo', 'gps-plus-slam-qr-tracking-demo'),
      packageGateStage('test:osm-demo', 'gps-plus-slam-osm-demo'),
      packageGateStage('test:landing', 'gps-plus-slam-landing'),
      packageGateStage('test:physics', 'gps-plus-slam-physics-demo'),
      packageGateStage('test:wayfinding', 'gps-plus-slam-wayfinding-hud-demo'),
    ],
  },
  {
    name: 'GpsPlusSlamJs_AppFramework',
    dir: 'GpsPlusSlamJs_AppFramework',
    chainNames: ['test:core'],
    stages: [
      {
        name: 'format',
        command:
          'prettier --log-level warn --write --ignore-unknown --no-error-on-unmatched-pattern "src" "config" package.json README.md',
        counts: null,
      },
      {
        name: 'lint',
        command: 'eslint . --config config/eslint.config.mjs --max-warnings 37',
        counts: null,
      },
      {
        // Previously a standalone script no gate ever ran (speedup summary
        // F6, owner decision 2026-07-21: gate it like every other package).
        name: 'check:cycles',
        command:
          'dpdm -T --exit-code circular:1 --no-warning --no-tree ./src/index.ts',
        counts: null,
      },
      {
        name: 'typecheck',
        command: 'tsc -p tsconfig.app.json --noEmit',
        counts: null,
      },
      {
        name: 'typecheck:tests',
        command: 'tsc -p tsconfig.vitest.json --noEmit',
        counts: null,
      },
      {
        name: 'test:unit',
        command: 'vitest run --coverage --config=config/vitest.config.ts',
        counts: 'vitest',
        // Filtered single-file TDD runs skip coverage collection (speedup
        // plan C.1): repo-wide coverage of a one-file run is meaningless
        // and expensive. Full-suite and CI runs keep `command`.
        filteredRunCommand: 'vitest run --config=config/vitest.config.ts',
      },
    ],
  },
  {
    // Pure-data library (OSM -> H3 affordance index). Modelled on the framework
    // entry rather than demoAppProject(): it has no vite build, no e2e, and no
    // build:framework stage because it does not depend on the framework at all.
    name: 'GpsPlusSlamJs_Osm',
    dir: 'GpsPlusSlamJs_Osm',
    chainNames: ['test:core'],
    stages: [
      {
        name: 'format',
        command:
          'prettier --log-level warn --write --ignore-unknown --no-error-on-unmatched-pattern "src" "config" "scripts" package.json README.md',
        counts: null,
      },
      {
        name: 'lint',
        command: 'eslint . --config config/eslint.config.mjs --max-warnings 0',
        counts: null,
      },
      {
        name: 'check:cycles',
        command:
          'dpdm -T --exit-code circular:1 --no-warning --no-tree ./src/index.ts',
        counts: null,
      },
      {
        name: 'typecheck',
        command: 'tsc -p tsconfig.app.json --noEmit',
        counts: null,
      },
      {
        name: 'typecheck:tests',
        command: 'tsc -p tsconfig.vitest.json --noEmit',
        counts: null,
      },
      {
        name: 'test:unit',
        command: 'vitest run --coverage --config=config/vitest.config.ts',
        counts: 'vitest',
        // Filtered single-file TDD runs skip coverage (speedup plan C.1).
        filteredRunCommand: 'vitest run --config=config/vitest.config.ts',
      },
    ],
  },
  {
    name: 'GpsPlusSlamJs_RecorderApp',
    dir: 'GpsPlusSlamJs_RecorderApp',
    chainNames: ['test:core', 'check:all'],
    stages: [
      { name: 'format', command: APP_FORMAT_COMMAND, counts: null },
      {
        name: 'lint',
        command: 'eslint . --config config/eslint.config.mjs --max-warnings 22',
        counts: null,
      },
      {
        name: 'lint:css',
        command:
          'stylelint "src/**/*.css" "**/*.html" --config config/stylelint.config.mjs --allow-empty-input',
        counts: null,
      },
      {
        name: 'check:dup',
        command: 'jscpd --config config/.jscpd.json src',
        counts: null,
      },
      {
        name: 'check:cycles',
        command:
          'dpdm -T --exit-code circular:1 --no-warning --no-tree ./src/main.ts',
        counts: null,
      },
      {
        name: 'check:boundaries',
        command: 'depcruise -c config/.dependency-cruiser.cjs src',
        counts: null,
      },
      {
        name: 'check:deadcode',
        command: 'pnpm --workspace-root run check:deadcode',
        counts: null,
      },
      {
        name: 'typecheck',
        command: 'tsc -p tsconfig.app.json --noEmit',
        counts: null,
      },
      {
        name: 'typecheck:tests',
        command: 'tsc -p tsconfig.vitest.json --noEmit',
        counts: null,
      },
      {
        name: 'test:unit',
        command: 'vitest run --coverage --config=config/vitest.config.ts',
        counts: 'vitest',
        // Filtered single-file TDD runs skip coverage collection (speedup
        // plan C.1); dropping --coverage also drops the config's global
        // thresholds. Full-suite and CI runs keep `command`.
        filteredRunCommand: 'vitest run --config=config/vitest.config.ts',
      },
      BUILD_FRAMEWORK_STAGE,
      {
        // The historical `pnpm exec playwright --version` install-probe was
        // removed from the timed path (speedup plan C.2): with the build
        // split into its own stage the probe was pure overhead, and a
        // missing browser still fails loudly inside playwright itself.
        name: 'test:e2e',
        command:
          'playwright test --config playwright-tests/playwright.config.js',
        counts: 'playwright',
      },
    ],
  },
  demoAppProject('GpsPlusSlamJs_AnchorStarter'),
  {
    name: 'GpsPlusSlamJs_MinimalExample',
    dir: 'GpsPlusSlamJs_MinimalExample',
    chainNames: [],
    stages: [
      {
        name: 'typecheck',
        command: 'tsc -p tsconfig.json --noEmit',
        counts: null,
      },
      { name: 'test:unit', command: 'vitest run', counts: 'vitest' },
    ],
  },
  {
    // Registered by hand rather than with demoAppProject(): it has no
    // `build:framework` stage, because `pnpm run dev` — the Playwright
    // webServer command — already runs `build:deps`. That build is therefore
    // unconditional (it does not get build-framework-if-stale.mjs's skip) and
    // its cost lands inside the `test:e2e` row rather than a row of its own.
    //
    // It DOES have an e2e suite; an earlier version of this comment said it did
    // not, which stopped being true the moment one was added.
    name: 'GpsPlusSlamJs_OsmDemo',
    dir: 'GpsPlusSlamJs_OsmDemo',
    chainNames: [],
    stages: [
      {
        name: 'typecheck',
        command: 'tsc -p tsconfig.json --noEmit',
        counts: null,
      },
      { name: 'test:unit', command: 'vitest run', counts: 'vitest' },
      {
        name: 'test:e2e',
        command:
          'playwright test --config playwright-tests/playwright.config.js',
        counts: 'playwright',
      },
    ],
  },
  demoAppProject('GpsPlusSlamJs_QrTrackingDemo'),
  {
    // Landing has no framework dependency: no build:framework stage, and its
    // e2e runs directly against the vite build.
    name: 'GpsPlusSlamJs_Landing',
    dir: 'GpsPlusSlamJs_Landing',
    chainNames: ['test:core', 'check:all'],
    stages: demoAppStages().filter((stage) => stage.name !== 'build:framework'),
  },
  demoAppProject('GpsPlusSlamJs_PhysicsDemo'),
  demoAppProject('GpsPlusSlamJs_WayfindingHudDemo'),
];

/**
 * @param {string} dirName - workspace-relative directory ('.', or a package
 *   directory basename like 'GpsPlusSlamJs_AppFramework')
 * @returns {ProjectConfig | undefined}
 */
export function getProject(dirName) {
  return PROJECTS.find((project) => project.dir === dirName);
}

/**
 * Resolves the project a shell invocation belongs to from its cwd. pnpm runs
 * package scripts with cwd = the package directory, and root scripts with
 * cwd = the workspace root, so the basename (or root equality) is a stable
 * key. Returns undefined for unknown directories — callers must fail loudly.
 *
 * @param {string} cwd - absolute invoking directory
 * @param {string} workspaceRoot - absolute workspace root path
 * @returns {ProjectConfig | undefined}
 */
export function resolveProject(cwd, workspaceRoot) {
  const normalizedCwd = path.resolve(cwd);
  if (normalizedCwd === path.resolve(workspaceRoot)) {
    return getProject('.');
  }
  return getProject(path.basename(normalizedCwd));
}

/**
 * @param {ProjectConfig} project
 * @param {string} name
 * @returns {StageConfig | undefined}
 */
export function getStage(project, name) {
  return project.stages.find((stage) => stage.name === name);
}

/**
 * @param {ProjectConfig} project
 * @returns {readonly string[]}
 */
export function stageOrder(project) {
  return project.stages.map((stage) => stage.name);
}
