// Why this test matters: the stage runs the narrowed format through the
// tool's own bin (package-bin.mjs), and that lookup throws when the package
// does not resolve the tool. Every other uncertainty in the stage degrades to
// the whole-package command; this one turned the format stage into an
// uncaught stack trace and a red gate (PR #877 review). The stage must say
// "whole package" and run the command as written instead.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./changed-files-stage.mjs', import.meta.url));

/** @type {string} */
let dir;
/** @param {string[]} args */
const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

beforeAll(() => {
  // Outside the workspace, so no node_modules above it resolves prettier.
  dir = mkdtempSync(path.join(tmpdir(), 'changed-files-stage-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'test']);
  mkdirSync(path.join(dir, 'pkg'));
  writeFileSync(path.join(dir, 'pkg', 'a.ts'), 'export const a = 1;\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  writeFileSync(path.join(dir, 'pkg', 'a.ts'), 'export const a = 2;\n');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('changed-files-stage', () => {
  it('runs the whole command when the tool bin does not resolve from the package', () => {
    const run = spawnSync(process.execPath, [SCRIPT, 'prettier', '--check', '--ignore-unknown', '.'], {
      cwd: path.join(dir, 'pkg'),
      encoding: 'utf8',
      // pnpm sets NODE_PATH to its store, which would resolve prettier anyway.
      env: { ...process.env, NODE_PATH: '', GATE_UNIT_RELATED_REF: 'HEAD' },
    });
    expect(run.stdout).toMatch(/^changed-files: whole package - prettier does not resolve from this package/m);
    expect(run.stdout).not.toMatch(/only the 1 changed file/);
    expect(run.stderr).not.toMatch(/at toolBin|ERR_MODULE_NOT_FOUND/);
  });
});
