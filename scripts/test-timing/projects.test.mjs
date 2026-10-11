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

  it('leaves the full stage list untouched when the mode is off', () => {
    for (const project of PROJECTS) {
      expect(gateStages(project).map((s) => s.name)).toEqual(stageOrder(project));
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
