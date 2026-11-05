// Why this test matters: projects.mjs is the single source of truth for
// every instrumented gate. If a config entry drifts from the real
// package.json wiring (a stage without a wrapped script, a `test` script
// that bypasses run-gate, a duplicate stage name), timings silently stop
// being recorded or the gate runs something other than what the md rows
// claim. chain-guard warns at runtime; this test FAILS the repo-config gate
// at review time, which is the stronger guarantee.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isWrappedStageScript } from './chain-guard.mjs';
import {
  PROJECTS,
  TOTAL_STAGE,
  getProject,
  getStage,
  resolveProject,
  stageOrder,
  gateStages,
  isBrowserStage,
  resolveGateMode,
  gateBaseCommand,
  SKIP_BROWSER_ENV,
  UNIT_RELATED_ENV,
  RELATED_UNIT_SCRIPT,
  DEPENDENT_TRIM_ENV,
  DEPENDENT_TRIM_STAGES,
  dependentTrimMode,
} from './projects.mjs';

const WORKSPACE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** @param {import('./projects.mjs').ProjectConfig} project */
function readScripts(project) {
  const packageJson = JSON.parse(
    readFileSync(
      path.join(WORKSPACE_ROOT, project.dir, 'package.json'),
      'utf8'
    )
  );
  return packageJson.scripts ?? {};
}

/** The wrapper spelling depends on where the package.json lives relative to
 * the root-level scripts/ directory. */
function wrapperPrefix(project) {
  return project.dir === '.'
    ? 'node scripts/test-timing'
    : 'node ../scripts/test-timing';
}

/** Every `.ts`/`.js`/`.mjs` file under `dir`, recursively. */
function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(?:ts|js|mjs)$/.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * The worker entry modules a package spawns, as `./src/…`-style roots.
 *
 * A module worker is referenced ONLY as a URL string
 * (`new Worker(new URL('./x.worker.ts', import.meta.url))`), which is exactly
 * the reference no static-analysis tool can follow — hence the test below.
 */
function workerEntries(project) {
  const root = path.join(WORKSPACE_ROOT, project.dir);
  const pattern = /new Worker\(\s*new URL\(\s*['"]([^'"]+)['"]/g;
  const entries = new Set();
  for (const file of sourceFiles(path.join(root, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(pattern)) {
      const resolved = path.resolve(path.dirname(file), specifier);
      if (!existsSync(resolved)) continue;
      entries.add(`./${path.relative(root, resolved).split(path.sep).join('/')}`);
    }
  }
  return [...entries];
}

describe('projects.mjs config invariants', () => {
  it('has unique project dirs and names', () => {
    const dirs = PROJECTS.map((p) => p.dir);
    const names = PROJECTS.map((p) => p.name);
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(PROJECTS.map((p) => [p.name, p]))(
    '%s: stage names are unique, commands non-empty, counts valid, no stage named "total"',
    (_name, project) => {
      const names = stageOrder(project);
      expect(new Set(names).size).toBe(names.length);
      expect(names).not.toContain(TOTAL_STAGE);
      for (const stage of project.stages) {
        expect(stage.command.trim().length).toBeGreaterThan(0);
        expect([null, 'vitest', 'playwright']).toContain(stage.counts);
      }
    }
  );

  // Why: the stage watchdog skips a nestedGate row and watches its leaves
  // one level down. A row that spawns a whole package gate without the flag
  // would be watched twice and could kill a healthy gate from above, naming
  // the row instead of the leaf; a leaf with the flag would not be watched.
  it.each(PROJECTS.map((p) => [p.name, p]))(
    '%s: exactly the rows that run a package gate are marked nestedGate',
    (_name, project) => {
      for (const stage of project.stages) {
        const runsPackageGate = /^pnpm --filter \S+ test$/.test(stage.command);
        expect(Boolean(stage.nestedGate), stage.name).toBe(runsPackageGate);
      }
    }
  );
});

describe('check:cycles reaches the worker subgraphs', () => {
  // Why this test matters: `check:cycles` roots dpdm at the app entry, and a
  // module worker is reachable from there ONLY as a URL string — which is
  // precisely the reference dpdm cannot follow. So every module a worker owns
  // exclusively sits outside the cycle gate, silently: nothing fails, the row
  // is still green, and the subgraph is the most stateful code in the package.
  // PR #241 found ~1 100 lines of the OSM demo's worker code in that gap
  // (`demo-worker`, `mesh-planner`, `prefetch-queue`, `terrain-gate` — a cycle
  // between any two of them would never have been reported), and the RecorderApp
  // had the same gap for both of its workers.
  //
  // Asserting against a FILESYSTEM SCAN rather than a hard-coded list is the
  // point: a package that adds a worker tomorrow fails this test until its
  // cycle root is added, which is the only version of this that stays true.
  it.each(PROJECTS.map((p) => [p.name, p]))(
    '%s: roots dpdm at every worker entry it spawns',
    (_name, project) => {
      const cycles = getStage(project, 'check:cycles');
      if (cycles === undefined) return;
      for (const entry of workerEntries(project)) {
        expect(
          cycles.command,
          `check:cycles must root at ${entry}, or that worker's modules are outside the cycle gate`
        ).toContain(entry);
      }
    }
  );
});

describe('projects.mjs ↔ package.json wiring', () => {
  it.each(PROJECTS.map((p) => [p.name, p]))(
    '%s: every stage script invokes the timed-stage wrapper and `test` runs the gate',
    (_name, project) => {
      const scripts = readScripts(project);
      const prefix = wrapperPrefix(project);
      const names = stageOrder(project);
      for (const stage of project.stages) {
        const value = scripts[stage.name];
        expect(
          value,
          `script "${stage.name}" is missing from ${project.dir}/package.json`
        ).toBeDefined();
        if (stage.wrapperScript === false) {
          // Intentionally raw (e.g. build:framework: dev flows and
          // Playwright webServer spawns must not record timing rows) — the
          // script must NOT route through the wrapper.
          expect(
            isWrappedStageScript(String(value), stage.name, names),
            `script "${stage.name}" (${value}) must stay RAW (wrapperScript: false)`
          ).toBe(false);
          continue;
        }
        expect(
          isWrappedStageScript(String(value), stage.name, names),
          `script "${stage.name}" (${value}) must invoke ${prefix}/timed-stage.mjs ${stage.name} (optionally chained behind other stage scripts)`
        ).toBe(true);
      }
      expect(scripts.test, '`test` must run the gate orchestrator').toBe(
        `${prefix}/run-gate.mjs`
      );
    }
  );
});

describe('resolveProject', () => {
  it('resolves a package dir by basename and the workspace root by equality', () => {
    const first = PROJECTS[0];
    expect(
      resolveProject(path.join(WORKSPACE_ROOT, first.dir), WORKSPACE_ROOT)
    ).toBe(first);
    // The root project may not be configured yet; equality resolution must
    // return exactly the '.'-entry (or undefined), never a package.
    expect(resolveProject(WORKSPACE_ROOT, WORKSPACE_ROOT)).toBe(
      getProject('.')
    );
  });

  it('returns undefined for unknown directories', () => {
    expect(
      resolveProject(path.join(WORKSPACE_ROOT, 'NoSuchPackage'), WORKSPACE_ROOT)
    ).toBeUndefined();
  });
});

describe('getStage', () => {
  it('finds configured stages and returns undefined for unknown names', () => {
    const first = PROJECTS[0];
    expect(getStage(first, first.stages[0].name)).toBe(first.stages[0]);
    expect(getStage(first, 'no-such-stage')).toBeUndefined();
  });
});

// Why this test matters: DEC-G2 makes a dependent package run its gate WITHOUT
// the browser stages, and two earlier designs for that were rejected because
// each silently dropped a BUILD the package's typecheck depends on. Both
// failures had the same shape — the build was reachable only as a side effect
// of the stage being removed — so the invariant worth pinning is not "e2e is
// excluded" but "excluding e2e never removes a build".
describe('browser-stage exclusion (DEC-G2)', () => {
  it('classifies a stage by whether it INVOKES playwright, not by mentioning it', () => {
    // Stated as concrete commands rather than re-deriving the regex. The first
    // version of this test asserted `isBrowserStage(s) === /\bplaywright\b/`,
    // which is the implementation compared against itself: it passed while the
    // shared `format` command — prettier over `"src" "config" "playwright-tests"
    // …` — was being classified as a browser stage and dropped from every
    // dependent run. A real run caught it; this test could not.
    expect(
      isBrowserStage({
        command: 'playwright test --config playwright-tests/playwright.config.js',
      })
    ).toBe(true);
    expect(
      isBrowserStage({
        command:
          'prettier --log-level warn --write --ignore-unknown --no-error-on-unmatched-pattern "src" "config" "playwright-tests" index.html README.md package.json',
      })
    ).toBe(false);
    expect(isBrowserStage({ command: 'vitest run' })).toBe(false);
    expect(isBrowserStage({ command: 'tsc -p tsconfig.json --noEmit' })).toBe(
      false
    );
  });

  it('excludes e2e and NOTHING else across the real project configs', () => {
    // The whole-repo counterpart to the unit case above: whatever the regex
    // does, the only stages it may remove are the e2e ones.
    for (const project of PROJECTS) {
      const excluded = project.stages
        .filter(isBrowserStage)
        .map((stage) => stage.name);
      expect(
        excluded,
        `${project.name} excluded unexpected stages`
      ).toEqual(
        project.stages
          .map((stage) => stage.name)
          .filter((name) => name === 'test:e2e')
      );
    }
    // Non-empty, or the loop above passes vacuously.
    expect(
      PROJECTS.flatMap((p) => p.stages).filter(isBrowserStage).length
    ).toBeGreaterThan(0);
  });

  it.each(PROJECTS.map((p) => [p.name, p]))(
    '%s: excluding browser stages keeps every build stage',
    (_name, project) => {
      const kept = gateStages(project, { skipBrowser: true }).map((s) => s.name);
      const builds = project.stages
        .map((s) => s.name)
        .filter((name) => name.startsWith('build:'));
      for (const build of builds) {
        expect(
          kept,
          `${project.name}: "${build}" must survive browser exclusion — a dependent run type-checks against dist`
        ).toContain(build);
      }
    }
  );

  it('OsmDemo builds BOTH of its workspace dependencies as real stages', () => {
    // The bug this pins: OsmDemo declares gps-plus-slam-app-framework and
    // imports it in production files, resolving through `exports` -> dist with
    // no tsconfig `paths`. Until 2026-08-15 it had no `build:framework` stage —
    // the Playwright webServer (`pnpm run dev` -> `build:deps`) built it as a
    // side effect INSIDE the test:e2e row. So dropping e2e dropped the only
    // framework build, and whether a fresh dist existed depended on which
    // sibling package pnpm happened to gate first.
    const stages = gateStages(getProject('GpsPlusSlamJs_OsmDemo'), {
      skipBrowser: true,
    }).map((s) => s.name);
    expect(stages).toContain('build:osm');
    expect(stages).toContain('build:framework');
    expect(stages).not.toContain('test:e2e');
    // Both builds must precede the first stage that reads a dist.
    expect(stages.indexOf('build:osm')).toBeLessThan(stages.indexOf('typecheck'));
    expect(stages.indexOf('build:framework')).toBeLessThan(
      stages.indexOf('typecheck')
    );
  });

  it('TourViewer builds the OSM package before it reads a dist', () => {
    // Its 3D editor imports gps-plus-slam-osm (the geoid, the relief's
    // constants), resolved through `exports` -> dist with no tsconfig
    // `paths`, exactly as OsmDemo does: without the stage first, its
    // typecheck reads whatever dist a sibling gate left behind.
    const stages = gateStages(getProject('GpsPlusSlamJs_TourViewer'), {
      skipBrowser: true,
    }).map((s) => s.name);
    expect(stages).toContain('build:osm');
    expect(stages.indexOf('build:osm')).toBeLessThan(stages.indexOf('typecheck'));
    expect(stages.indexOf('build:osm')).toBeLessThan(stages.indexOf('test:unit'));
  });

  it('TourViewer runs its e2e through the project runner, still as a browser stage', () => {
    // The runner runs the DOM specs, then the WebGL specs, each at its own
    // worker count (playwright-tests/e2e-plan.js). It must still be a
    // browser stage, or GATE_SKIP_BROWSER_STAGES would stop dropping it and
    // every dependent run would pay for the whole Tour Viewer e2e.
    const e2e = getProject('GpsPlusSlamJs_TourViewer').stages.find(
      (s) => s.name === 'test:e2e'
    );
    expect(e2e?.command).toBe(
      'node ../scripts/e2e/run-projects.mjs playwright-tests/e2e-plan.js playwright test --config playwright-tests/playwright.config.js'
    );
    expect(e2e && isBrowserStage(e2e)).toBe(true);
    expect(
      gateStages(getProject('GpsPlusSlamJs_TourViewer'), { skipBrowser: true }).map((s) => s.name)
    ).not.toContain('test:e2e');
  });

  it('marks exactly the stages that run the project runner as narrowable', () => {
    // A narrowable stage records no timing row inside test:changed
    // (run-stage.mjs). A stage marked by mistake loses its history; one the
    // runner narrows but that is unmarked records a part of its suite as the
    // whole.
    for (const project of PROJECTS) {
      for (const stage of project.stages) {
        expect(Boolean(stage.narrowable), `${project.name} ${stage.name}`).toBe(
          stage.command.includes('scripts/e2e/run-projects.mjs')
        );
      }
    }
  });

  it('leaves the full stage list untouched when the mode is off', () => {
    for (const project of PROJECTS) {
      expect(gateStages(project).map((s) => s.name)).toEqual(stageOrder(project));
    }
  });
});

// Why this test matters: a DEPENDENT in the per-commit gate is re-run only
// because something it consumes changed, so a stage that reads nothing but the
// dependent's own files cannot change its verdict and is skipped. Each trimmed
// stage was checked for that (format, stylelint and jscpd list own paths;
// depcruise is includeOnly src). check:cycles is NOT trimmed: dpdm walks into
// the framework's dist (189 of the Recorder's 289 files). The Tour Viewer's
// boundaries stage reads the editor kit's source, so it is kept, and builds,
// lint, typecheck and unit tests are never trimmed.
describe('dependent trim (per-commit gate, dependents only)', () => {
  it('drops exactly the own-files stages, keeping builds, lint, cycles, typecheck and units', () => {
    expect([...DEPENDENT_TRIM_STAGES]).toEqual(['format', 'lint:css', 'check:dup', 'check:boundaries']);
    for (const project of PROJECTS) {
      const kept = gateStages(project, { skipBrowser: true, dependentTrim: true });
      for (const stage of project.stages) {
        const expectKept =
          !isBrowserStage(stage) &&
          (!DEPENDENT_TRIM_STAGES.includes(stage.name) || stage.readsUpstreamSources === true);
        expect(kept.includes(stage), `${project.name} ${stage.name}`).toBe(expectKept);
      }
    }
  });

  it('keeps the Tour Viewer boundaries stage, which reads the editor kit source', () => {
    const names = gateStages(getProject('GpsPlusSlamJs_TourViewer'), {
      skipBrowser: true,
      dependentTrim: true,
    }).map((s) => s.name);
    expect(names).toContain('check:boundaries');
    expect(names).toContain('check:cycles');
    expect(names).not.toContain('format');
    expect(names).toContain('build:osm');
    expect(names).toContain('lint');
    expect(names).toContain('test:unit');
  });

  it('the Tour Viewer depcruise config reaches outside its own src exactly where the flag says', () => {
    for (const project of PROJECTS) {
      const stage = project.stages.find((s) => s.name === 'check:boundaries');
      if (!stage) continue;
      const config = readFileSync(
        path.join(WORKSPACE_ROOT, project.dir, 'config/.dependency-cruiser.cjs'),
        'utf8'
      );
      const outside = /includeOnly:[^\n]*GpsPlusSlamJs_/.test(config);
      expect(stage.readsUpstreamSources === true, project.name).toBe(outside);
    }
  });

  it('is on only with the skip switch AND the trim switch set', () => {
    expect(dependentTrimMode({})).toBe(false);
    expect(dependentTrimMode({ [DEPENDENT_TRIM_ENV]: '1' })).toBe(false);
    expect(dependentTrimMode({ [SKIP_BROWSER_ENV]: '1' })).toBe(false);
    expect(dependentTrimMode({ [SKIP_BROWSER_ENV]: '1', [DEPENDENT_TRIM_ENV]: '' })).toBe(false);
    expect(dependentTrimMode({ [SKIP_BROWSER_ENV]: '1', [DEPENDENT_TRIM_ENV]: '1' })).toBe(true);
  });

  it('is off by default', () => {
    for (const project of PROJECTS) {
      expect(gateStages(project, { skipBrowser: true })).toEqual(
        project.stages.filter((s) => !isBrowserStage(s))
      );
    }
  });
});

// Why this test matters: ESLint's multithreaded linting was measured on the
// two largest lint stages (framework 33-42 s -> 26-29 s, Tour Viewer 46 s ->
// 34 s, three runs each, 8 cores) and adopted there only; the other packages
// were not measured and keep the single thread.
describe('ESLint concurrency', () => {
  it('runs the framework and Tour Viewer lint stages with --concurrency auto, and no other', () => {
    for (const project of PROJECTS) {
      for (const stage of project.stages.filter((s) => /(?:^|\s)eslint\s/.test(s.command))) {
        const expected = ['GpsPlusSlamJs_AppFramework', 'GpsPlusSlamJs_TourViewer'].includes(project.name);
        expect(stage.command.includes(' --concurrency auto'), `${project.name} ${stage.name}`).toBe(expected);
      }
    }
  });
});

// Why this test matters: the mode is selected by an environment variable, and
// the failure mode of getting it wrong is asymmetric — a run that silently
// covers less than it claims. "Unset means full gate" is the safe direction and
// is what a caller who forgets to pass env gets.
describe('resolveGateMode', () => {
  it('defaults to the FULL gate when nothing is set', () => {
    expect(resolveGateMode()).toEqual({ skipBrowser: false });
    expect(resolveGateMode({})).toEqual({ skipBrowser: false });
    expect(resolveGateMode({ [SKIP_BROWSER_ENV]: undefined })).toEqual({
      skipBrowser: false,
    });
    expect(resolveGateMode({ [SKIP_BROWSER_ENV]: '' })).toEqual({
      skipBrowser: false,
    });
  });

  it('treats any non-empty value as on, including "0"', () => {
    for (const value of ['1', 'true', 'yes', '0']) {
      expect(resolveGateMode({ [SKIP_BROWSER_ENV]: value })).toEqual({
        skipBrowser: true,
      });
    }
  });
});

// WHY (globe plan 2026-09-26-0539 §8, the new-package checklist): a package
// added to pnpm-workspace.yaml but not to projects.mjs has no gate at all,
// and one missing from the root chain is skipped by the full cascade and by
// CI. Adding GpsPlusSlamJs_Globe was the occasion; the rule holds for all.
describe('every workspace package is gated', () => {
  const workspace = readFileSync(
    path.join(WORKSPACE_ROOT, 'pnpm-workspace.yaml'),
    'utf8'
  );
  const dirs = [
    ...workspace.split(/^overrides:/m)[0].matchAll(/^\s+-\s+(\S+)\s*$/gm),
  ].map((m) => m[1]);
  const root = PROJECTS.find((p) => p.dir === '.');

  it('reads the workspace package list', () => {
    expect(dirs).toContain('GpsPlusSlamJs_AppFramework');
    expect(dirs).toContain('GpsPlusSlamJs_Globe');
  });

  it.each(dirs.map((d) => [d]))(
    '%s has a projects.mjs entry and a stage in the root chain',
    (dir) => {
      expect(PROJECTS.map((p) => p.dir)).toContain(dir);
      const manifest = JSON.parse(
        readFileSync(path.join(WORKSPACE_ROOT, dir, 'package.json'), 'utf8')
      );
      const stage = root.stages.find(
        (s) => s.command === `pnpm --filter ${manifest.name} test`
      );
      expect(stage, `no root stage runs ${manifest.name}`).toBeDefined();
    }
  );
});

// Why this test matters (gate-speed plan 2026-10-04, G4 / TS-2): coverage
// cost 29 % of the framework's unit stage (106.4 / 103.9 s with it, 74.2 /
// 74.8 s without, two quiet runs each at 4 workers), against a 15 % bar set
// before measuring. So the PER-COMMIT gate (GATE_SKIP_BROWSER_STAGES set)
// runs it without coverage, while CI, the milestone run and every recorded
// timing run keep the canonical command. The framework has no coverage
// thresholds; the Recorder has (87/75/87/88), so it must keep coverage on
// every run, and that is pinned here too.
describe('gateBaseCommand (fast per-commit command)', () => {
  const framework = getStage(getProject('GpsPlusSlamJs_AppFramework'), 'test:unit');
  const recorder = getStage(getProject('GpsPlusSlamJs_RecorderApp'), 'test:unit');

  it('drops coverage from the framework unit stage in the per-commit gate only', () => {
    expect(framework.command).toContain('--coverage');
    expect(gateBaseCommand(framework, { [SKIP_BROWSER_ENV]: '1' })).not.toContain(
      '--coverage'
    );
    expect(gateBaseCommand(framework, {})).toBe(framework.command);
  });

  it('keeps the Recorder on coverage in every mode: its thresholds gate', () => {
    expect(gateBaseCommand(recorder, { [SKIP_BROWSER_ENV]: '1' })).toBe(
      recorder.command
    );
    expect(recorder.command).toContain('--coverage');
  });

  it('is the canonical command for a stage with no fast form', () => {
    const lint = getStage(getProject('GpsPlusSlamJs_AppFramework'), 'lint');
    expect(gateBaseCommand(lint, { [SKIP_BROWSER_ENV]: '1' })).toBe(lint.command);
  });

  it('differs from the canonical command only by the coverage flag', () => {
    expect(framework.fastGateCommand).toBe(
      framework.command.replace(' --coverage', '')
    );
  });
});

// Why this test matters: in the per-commit fast gate a CHANGED package's
// unit stage runs only the tests related to the change (the related-unit
// wrapper). That trade is only acceptable because every other run stays
// whole: a dependent (no ref), the milestone run and a package's own
// `pnpm test` (no skip switch) and CI (the GitHub runner). Each of those
// must get the canonical command, byte for byte.
describe('gateBaseCommand (related unit tests in the fast gate only)', () => {
  const FAST = { [SKIP_BROWSER_ENV]: '1', [UNIT_RELATED_ENV]: 'HEAD' };
  const unitStages = PROJECTS.flatMap((project) =>
    project.stages
      .filter((stage) => stage.name === 'test:unit' && stage.counts === 'vitest')
      .map((stage) => ({ project: project.name, stage }))
  );

  it('finds the vitest unit stages (so the checks are not vacuous)', () => {
    expect(unitStages.length).toBeGreaterThanOrEqual(10);
  });

  it.each(unitStages)('$project wraps its unit stage in the fast gate of a changed package', ({ stage }) => {
    const base = stage.fastGateCommand ?? stage.command;
    expect(gateBaseCommand(stage, FAST)).toBe(`node ${RELATED_UNIT_SCRIPT} ${base}`);
  });

  it.each(unitStages)('$project keeps its unit stage whole everywhere else', ({ stage }) => {
    // A dependent: the skip switch, no ref.
    expect(gateBaseCommand(stage, { [SKIP_BROWSER_ENV]: '1' })).not.toContain(RELATED_UNIT_SCRIPT);
    expect(gateBaseCommand(stage, { [SKIP_BROWSER_ENV]: '1', [UNIT_RELATED_ENV]: '' })).not.toContain(
      RELATED_UNIT_SCRIPT
    );
    // The milestone run and a package's own gate: no skip switch.
    expect(gateBaseCommand(stage, { [UNIT_RELATED_ENV]: 'HEAD' })).toBe(stage.command);
    // CI.
    expect(gateBaseCommand(stage, { ...FAST, GITHUB_ACTIONS: 'true' })).not.toContain(
      RELATED_UNIT_SCRIPT
    );
  });

  it('wraps no other stage', () => {
    for (const project of PROJECTS) {
      for (const stage of project.stages) {
        if (stage.name === 'test:unit' && stage.counts === 'vitest') continue;
        expect(gateBaseCommand(stage, FAST), `${project.name} ${stage.name}`).not.toContain(
          RELATED_UNIT_SCRIPT
        );
      }
    }
  });

  it('points at the wrapper that exists', () => {
    expect(RELATED_UNIT_SCRIPT).toBe('../scripts/test-changed/related-unit.mjs');
    expect(existsSync(path.join(WORKSPACE_ROOT, 'scripts/test-changed/related-unit.mjs'))).toBe(true);
  });
});

// Why this test matters: every format stage runs `prettier --write`, which on the GitHub runner rewrote the
// checkout and exited 0, so a badly formatted PR was never red and CI had
// never checked formatting. On the runner the stage must CHECK. It is keyed on
// `GITHUB_ACTIONS`, not `CI`: every local gate sets `CI=1`, and a local format
// stage must keep fixing files, so the local rows here must stay `--write`.
describe('format stages check on the GitHub runner and write everywhere else', () => {
  const RUNNER = { GITHUB_ACTIONS: 'true', CI: 'true' };
  const formatStages = PROJECTS.flatMap((project) =>
    project.stages
      .filter((stage) => /(^|\s)prettier\s/.test(stage.command))
      .map((stage) => ({ project: project.name, stage }))
  );

  it('finds the format stages (so the check is not vacuous)', () => {
    expect(formatStages.length).toBeGreaterThanOrEqual(5);
  });

  it.each(formatStages)('$project $stage.name checks on the runner', ({ stage }) => {
    const command = gateBaseCommand(stage, RUNNER);
    expect(command).toMatch(/(^|\s)--check(\s|$)/);
    expect(command).not.toMatch(/(^|\s)--write(\s|$)/);
    // Same globs and options, only the mode differs.
    expect(command).toBe(stage.command.replace(' --write ', ' --check '));
  });

  it.each(formatStages)('$project $stage.name still writes in local gates', ({ stage }) => {
    expect(gateBaseCommand(stage, { CI: '1' })).toBe(stage.command);
    expect(
      gateBaseCommand(stage, { CI: '1', [SKIP_BROWSER_ENV]: '1' })
    ).toBe(stage.command);
    expect(gateBaseCommand(stage, { CI: '1', GITHUB_ACTIONS: '' })).toBe(stage.command);
    expect(stage.command).toMatch(/(^|\s)--write(\s|$)/);
  });

  it('leaves every other stage on the runner as it is', () => {
    for (const project of PROJECTS) {
      for (const stage of project.stages) {
        if (/(^|\s)prettier\s/.test(stage.command)) continue;
        expect(gateBaseCommand(stage, RUNNER), `${project.name} ${stage.name}`).toBe(
          stage.command
        );
      }
    }
  });
});

// Why this test matters (gate-speed plan 2026-10-04, G5): Prettier's cache
// skips files whose content it has already formatted. `content` keys it on a
// hash of the file, never on mtimes (which every checkout and format run
// rewrites), so a cached run formats exactly what an uncached run would.
// ESLint's cache is deliberately NOT used: it is unsafe with typed rules.
describe('format stages use Prettier\'s content cache', () => {
  const formatStages = PROJECTS.flatMap((project) =>
    project.stages
      .filter((stage) => /(^|\s)prettier\s/.test(stage.command))
      .map((stage) => ({ project: project.name, stage }))
  );

  it('finds the format stages (so the check is not vacuous)', () => {
    expect(formatStages.length).toBeGreaterThanOrEqual(5);
  });

  it.each(formatStages)('$project $stage.name', ({ stage }) => {
    expect(stage.command).toContain('--cache --cache-strategy content');
  });

  it('no lint stage uses ESLint\'s cache', () => {
    for (const project of PROJECTS) {
      for (const stage of project.stages) {
        if (/(^|\s)eslint\s/.test(stage.command)) {
          expect(stage.command).not.toContain('--cache');
        }
      }
    }
  });
});

describe('the format stage sees every page of a package (Tour Viewer follow-up F18)', () => {
  // Why this test matters: the shared app format command named
  // `index.html` alone, so a second page (`edit.html`, the RecorderApp's
  // test pages) drifted out of style while the gate stayed green - the
  // drift the 2026-08-17 lesson describes for a package with no format
  // stage at all. Every top-level page a package carries must be one the
  // format stage would reach.
  it('names a top-level *.html glob wherever a package has pages beside index.html', () => {
    for (const project of PROJECTS) {
      if (project.dir === '.') continue;
      const dir = path.join(WORKSPACE_ROOT, project.dir);
      const pages = readdirSync(dir).filter((name) => name.endsWith('.html'));
      if (pages.length < 2) continue;
      const format = project.stages.find((stage) => stage.name === 'format');
      expect(format, `${project.dir} has no format stage`).toBeDefined();
      expect(
        format?.command.includes('"*.html"'),
        `${project.dir} has ${pages.join(', ')} but formats only some of them`
      ).toBe(true);
    }
  });
});
