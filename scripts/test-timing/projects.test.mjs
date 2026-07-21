// Why this test matters: projects.mjs is the single source of truth for
// every instrumented gate. If a config entry drifts from the real
// package.json wiring (a stage without a wrapped script, a `test` script
// that bypasses run-gate, a duplicate stage name), timings silently stop
// being recorded or the gate runs something other than what the md rows
// claim. chain-guard warns at runtime; this test FAILS the repo-config gate
// at review time, which is the stronger guarantee.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
