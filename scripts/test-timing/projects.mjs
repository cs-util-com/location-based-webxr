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
  command:
    'node ../scripts/build-workspace-package-if-stale.mjs gps-plus-slam-app-framework GpsPlusSlamJs_AppFramework',
  counts: /** @type {null} */ (null),
  wrapperScript: false,
});

/** The same, for the OSM library.
 *
 * Unlike `build:framework` this must run BEFORE `typecheck`, not after it.
 * OsmDemo resolves `gps-plus-slam-osm` through the package `exports`, i.e.
 * through dist — where RecorderApp maps the framework to SOURCE via tsconfig
 * `paths` and so never needs the framework built to typecheck. Nothing else in
 * the workspace builds this package, so with the stage missing entirely the
 * Cloudflare deployment of /osm/ failed on "Cannot find module
 * 'gps-plus-slam-osm'" while every local run passed against a stale dist left
 * behind by an earlier e2e run. */
const BUILD_OSM_STAGE = Object.freeze({
  name: 'build:osm',
  command:
    'node ../scripts/build-workspace-package-if-stale.mjs gps-plus-slam-osm GpsPlusSlamJs_Osm',
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
 * @param {string[]} [extraCycleRoots] - additional dpdm entry points, for
 *   packages whose graph has a root the app entry cannot reach. A module worker
 *   is spawned from a URL string, and that is the ONE reference dpdm cannot
 *   follow — so without its own root, everything the worker owns exclusively is
 *   outside the cycle gate with nothing reporting it (PR #241).
 *   `projects.test.mjs` derives the required roots from the source and fails if
 *   one is missing.
 * @returns {StageConfig[]}
 */
function demoAppStages(extraCycleRoots = []) {
  const cycleRoots = ['./src/main.ts', ...extraCycleRoots].join(' ');
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
      command: `dpdm -T --exit-code circular:1 --no-warning --no-tree ${cycleRoots}`,
      counts: null,
    },
    {
      name: 'check:boundaries',
      command: 'depcruise -c config/.dependency-cruiser.cjs src',
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
      // ONE workspace-wide knip for the whole cascade, not one per package.
      // It used to sit in seven package stage lists running the IDENTICAL
      // analysis each time — ~26 s warm, plus a ~25 s cold pass in whichever
      // package happened to run first.
      //
      // PLACED HERE, NOT EARLIER, so its preconditions are unchanged: knip
      // resolves workspace dependencies through their dist, and this is exactly
      // where it first ran before — after the framework and osm gates have built
      // theirs. Moving it to the front would fail faster and sometimes for the
      // wrong reason.
      //
      // A standalone `pnpm --filter X test` no longer checks dead code. That is
      // a deliberate narrowing (F3, 2026-05-30 static-analysis open items):
      // .github/workflows/ci.yml runs a dedicated root-level `deadcode` job that
      // the same doc calls the authoritative gate.
      {
        name: 'check:deadcode',
        command: 'knip',
        counts: null,
      },
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
        // Both module workers are cycle roots of their own: they are spawned
        // from URL strings, which dpdm cannot follow from `main.ts` (PR #241).
        command:
          'dpdm -T --exit-code circular:1 --no-warning --no-tree ./src/main.ts ./src/recording/image-quality.worker.ts ./src/workers/occlusion-mesher.worker.ts',
        counts: null,
      },
      {
        name: 'check:boundaries',
        command: 'depcruise -c config/.dependency-cruiser.cjs src',
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
    // Registered by hand rather than with demoAppProject() for two reasons.
    //
    // 1. It needs `build:osm` FIRST. Every other app's dependency build sits
    //    after `typecheck`, which is safe only because RecorderApp maps the
    //    framework to SOURCE via tsconfig `paths`. Nothing maps
    //    `gps-plus-slam-osm`, so `tsc` cannot see one of its types until dist
    //    exists — and until this stage was added, nothing in the workspace
    //    built it at all, which is what broke the /osm/ deployment.
    // 2. It needs `build:framework` FIRST TOO, since 2026-08-15. It used to
    //    have no such stage at all — see the retracted paragraph below — and
    //    that made the gate's correctness depend on a side effect of the e2e
    //    stage. `tsc` and `vitest` here resolve `gps-plus-slam-app-framework`
    //    through the package `exports` -> dist (this package declares NO
    //    tsconfig `paths`; only RecorderApp does), so the same argument that
    //    puts `build:osm` first puts this first.
    //
    //    RETRACTED, and kept because the reasoning reads plausible: "It has no
    //    `build:framework` stage, because `pnpm run dev` — the
    //    Playwright webServer command — already runs `build:deps`, whose cost
    //    lands inside the `test:e2e` row rather than a row of its own. Since
    //    2026-08-09 that build goes through the same staleness check as the
    //    stage above, so the webServer no longer rebuilds what the gate just
    //    built — it was costing ~3.5 s per e2e package, in six of them."
    //
    //    It is true that the webServer builds it. What it misses is that the
    //    build was then reachable ONLY through a stage that DEC-G2 removes,
    //    and that the other five consumers keep their own build — so a
    //    dependent run would have type-checked OsmDemo against whichever
    //    framework dist a sibling package happened to leave on disk.
    //
    // Otherwise it now runs the SAME stage set as every other demo app. It
    // previously ran only typecheck/test:unit/test:e2e — no format, lint,
    // lint:css, check:dup, check:cycles, check:boundaries or
    // typecheck:tests — because the package was created without the demo-app
    // tooling (no config/ directory and none of the 14 tool devDependencies).
    name: 'GpsPlusSlamJs_OsmDemo',
    dir: 'GpsPlusSlamJs_OsmDemo',
    chainNames: ['test:core', 'check:all'],
    stages: [
      BUILD_OSM_STAGE,
      // FIRST, not in demoAppStages' post-typecheck slot — see reason 2 above.
      // The filter below drops that late copy so this one is the only build.
      BUILD_FRAMEWORK_STAGE,
      // The worker entry is a second cycle root: `main.ts` reaches it only
      // through `new Worker(new URL(...))`, so `demo-worker.ts` and the three
      // modules it alone imports were outside the cycle gate until PR #241.
      ...demoAppStages(['./src/worker/demo-worker.ts'])
        .filter((stage) => stage.name !== 'build:framework')
        // THE ONE STAGE IN THIS REPO WITH A WALL-CLOCK CEILING, and it is the
        // one that has demonstrably regrown: `test:e2e` here went from ~200 s to
        // ~547 s serial in five days after PR #244 fused 66 tests to 45 to buy
        // that time, because rounds 7-10 each added a feature test with its own
        // app boot. Nothing was watching, and by the time it was measured every
        // lever for recovering it was spent (findings 2026-08-07, Areas 3-5b).
        //
        // 900 s is the recorded MEDIAN (690.1 s) plus ~30 %. Loose on purpose:
        // this suite is contention-bound — its own Playwright config records a
        // 21x inflation of identical work under load — so a tight ceiling would
        // be one more load-dependent failure rather than a regrowth alarm.
        // `budget.mjs` carries the rule for changing it.
        //
        // RE-DERIVED 2026-08-17, and the reason matters more than the number.
        // The previous ceiling was 740 s = median 567 s + 30 %. The median has
        // since risen to 690.1 s (history in `GpsPlusSlamJs_OsmDemo/docs/
        // test-timings.md`), which left the ceiling only +7 % above it — so the
        // guard had quietly stopped being the LOOSE regrowth alarm it is
        // designed as and become a tight performance target, firing on ordinary
        // load. It tripped on a comments-and-docs change that added no e2e test
        // (56 tests, +0): 769.3 s and 770.6 s on consecutive runs, against
        // 707.1 s for the same 56 tests two hours earlier on the same tree.
        //
        // ⚠️ THE 22 % GROWTH FROM 567 s TO 690 s IS REAL AND IS NOT EXPLAINED
        // HERE. Re-deriving the ceiling restores the alarm's sensitivity to
        // FUTURE growth; it does not account for the growth already banked
        // across r519-r525. `budget.mjs` is right that removing work is the
        // better fix, and that remains owed. Owner decision, 2026-08-17.
        //
        // LOCAL RUNS ONLY, since 2026-08-10: this is a same-machine median plus
        // 30 %, and CI records no median of its own, so enforcing it there
        // measured the runner and failed two all-green PRs. See the CI note in
        // `budget.mjs`.
        .map((stage) =>
          stage.name === 'test:e2e' ? { ...stage, budgetSeconds: 900 } : stage
        ),
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

/**
 * Does this stage boot a browser?
 *
 * Matched on the COMMAND, deliberately, not on `counts: 'playwright'`. That
 * field names the JSON reporter to inject — it happens to select the same rows
 * today, but a stage could run playwright without being counted by it, and the
 * thing being decided here is "does this cost a headless Chromium", not "how is
 * it reported". Nor on the stage NAME: `test:e2e` is a convention, and a
 * convention is what a future stage breaks.
 *
 * @param {{ command: string }} stage
 * @returns {boolean}
 */
export function isBrowserStage(stage) {
  // `playwright` as a WHOLE TOKEN — the command invokes the CLI. `\bplaywright\b`
  // was the first attempt and it is wrong: `\b` matches at the hyphen, so the
  // shared app `format` command, which lists the `"playwright-tests"` DIRECTORY
  // among prettier's targets, was classified as a browser stage and silently
  // dropped from dependent runs. Caught by running the mode for real, not by the
  // unit test — which had compared the implementation against its own regex.
  return /(?:^|\s)playwright(?:\s|$)/.test(stage.command);
}

/**
 * The stages a gate run should execute.
 *
 * `skipBrowser` is DEC-G2's dependent mode: a package that is only in the run
 * because something it depends on changed pays for its static checks, its
 * builds and its unit tests, but not for a browser.
 *
 * **Builds are never excluded, and that is the whole point of routing this
 * through the real stage list.** Two earlier designs for this mode were
 * rejected because each dropped a build that a `typecheck` downstream of it
 * depends on — `test:core` omits `build:osm`, and "the stage list minus
 * playwright" omitted `build:framework` back when OsmDemo had no such stage and
 * got its framework built as a side effect of the e2e webServer. Both produced
 * the same failure: a green local gate type-checking against a stale dist.
 * `projects.test.mjs` pins that builds survive, for every project.
 *
 * @param {ProjectConfig} project
 * @param {{ skipBrowser?: boolean }} [options]
 * @returns {readonly StageConfig[]}
 */
export function gateStages(project, { skipBrowser = false } = {}) {
  return skipBrowser
    ? project.stages.filter((stage) => !isBrowserStage(stage))
    : project.stages;
}

/** Env var that puts a gate run in DEC-G2's dependent mode. */
export const SKIP_BROWSER_ENV = 'GATE_SKIP_BROWSER_STAGES';

/**
 * Resolve the gate mode from the environment.
 *
 * **An env var on the existing `test` script, NOT a new per-package script.**
 * The rejected alternative was `pnpm --filter "...<x>" run <mode-script>`, and
 * it fails silently: pnpm errors only when NO selected package has the script,
 * so a package missing it is skipped with a green exit code. Every package
 * already has `test`, so this cannot select nothing by accident.
 *
 * @param {Record<string, string | undefined>} [env] - process.env or a stub.
 *   Omitted means "no mode": a caller that forgets it runs the FULL gate, which
 *   is the safe direction.
 * @returns {{ skipBrowser: boolean }}
 */
export function resolveGateMode(env = {}) {
  const raw = env[SKIP_BROWSER_ENV];
  // Same truthiness rule as `budgetBreach`'s CI check: any non-empty value
  // means on. `'0'` deliberately counts as ON — an env var set to a string is
  // set, and inventing a second falsy spelling is how a mode gets enabled by
  // accident and disabled by a typo.
  return { skipBrowser: Boolean(raw) };
}
