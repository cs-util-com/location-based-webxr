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

/** Zero-overrides for global coverage thresholds on filtered runs — covering
 * one file can never meet a whole-suite threshold (pilot behavior). */
const ZERO_COVERAGE_THRESHOLDS = Object.freeze([
  '--coverage.thresholds.statements=0',
  '--coverage.thresholds.branches=0',
  '--coverage.thresholds.functions=0',
  '--coverage.thresholds.lines=0',
]);

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
    {
      name: 'build:framework',
      command: 'pnpm --filter gps-plus-slam-app-framework run build',
      counts: null,
    },
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

/** @type {readonly ProjectConfig[]} */
export const PROJECTS = [
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
        filteredRunArgs: ZERO_COVERAGE_THRESHOLDS,
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
        filteredRunArgs: ZERO_COVERAGE_THRESHOLDS,
      },
      {
        name: 'build:framework',
        command: 'pnpm --filter gps-plus-slam-app-framework run build',
        counts: null,
      },
      {
        // `pnpm exec playwright --version` is the historical install-probe;
        // Phase C.2 of the speedup plan decides its fate with measurements.
        name: 'test:e2e',
        command:
          'pnpm exec playwright --version && playwright test --config playwright-tests/playwright.config.js',
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
