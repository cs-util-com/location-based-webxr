// Why this test matters: the waiter on a detached gate (wait-gate.mjs) sizes
// its quiet window from the watchdog limit the GATE states in its log, since
// the waiter's own shell may carry another GATE_STALL_MIN. If the commit
// gate stopped writing that line, every wait would silently fall back to its
// own environment again. Run as the CLI with --dry-run, which takes no slot
// and runs nothing.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseWatchLine } from '../test-timing/stall-watch.mjs';

const SCRIPT = fileURLToPath(new URL('./test-changed.mjs', import.meta.url));
const SCRIPTS_DIR = fileURLToPath(new URL('..', import.meta.url));

/** @param {Record<string, string>} env */
function dryRun(env) {
  const result = spawnSync(process.execPath, [SCRIPT, '--all', '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe('test-changed states its watchdog limit in its log', { timeout: 30_000 }, () => {
  it('writes the limit its stages run with', () => {
    const { status, out } = dryRun({ GATE_STALL_MIN: '7' });
    expect(status).toBe(0);
    expect(parseWatchLine(out)).toEqual({ minutes: 7 });
  });

  it('writes that the watch is off', () => {
    expect(parseWatchLine(dryRun({ GATE_STALL_MIN: 'off' }).out)).toEqual({ off: true });
  });
});

// Why these matter: select.test.mjs proves the refusal's decision, not the
// shell around it: what the shell feeds it from git, that a refused run exits
// 2 before it queues, and that a dry run says the same and exits 0. Without
// the exit a merge passes as a green gate that checked no package. The script
// finds its root from its own path, so these run a copy of it in a throwaway
// repository whose head can be a merge. A run that wrongly goes on stops
// short: no slot, and no pnpm script exists there.
describe('test-changed on a committed merge', { timeout: 60_000 }, () => {
  const REFUSED = 'HEAD is a merge commit and nothing is uncommitted';
  /** @type {string} */
  let repo;

  /** @param {string[]} args */
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

  /** @param {string} name */
  const commitFile = (name) => {
    writeFileSync(path.join(repo, 'Pkg', name), name);
    git('add', '.');
    git('commit', '-m', name);
  };

  /** @param {string[]} args */
  const run = (...args) => runIn({ GATE_SLOT_DIR: 'off' }, ...args);

  /**
   * @param {Record<string, string>} env
   * @param {string[]} args
   */
  const runIn = (env, ...args) => {
    const result = spawnSync(
      process.execPath,
      [path.join(repo, 'scripts', 'test-changed', 'test-changed.mjs'), ...args],
      {
        cwd: repo,
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, ...env },
      },
    );
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  };

  beforeAll(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'test-changed-merge-'));
    cpSync(SCRIPTS_DIR, path.join(repo, 'scripts'), {
      recursive: true,
      filter: (source) => !/\.(test\.mjs|md)$/.test(source),
    });
    mkdirSync(path.join(repo, 'Pkg'));
    writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - Pkg\n');
    writeFileSync(path.join(repo, 'Pkg', 'package.json'), '{"name":"pkg"}\n');
    git('init', '--initial-branch=main');
    git('add', '.');
    git('commit', '-m', 'base');
    git('checkout', '-b', 'side');
    commitFile('side.txt');
    git('checkout', '-b', 'feature', 'main');
    commitFile('feature.txt');
    git('merge', '--no-ff', '-m', 'merge side', 'side');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('refuses with exit 2, before the machine slot', () => {
    git('checkout', 'feature');
    const { status, out } = run();
    expect(status).toBe(2);
    expect(out).toContain(REFUSED);
    expect(out).not.toContain('stage watchdog');
  });

  it('prints the same refusal on a dry run and exits 0', () => {
    git('checkout', 'feature');
    const { status, out } = run('--dry-run');
    expect(status).toBe(0);
    expect(out).toContain(REFUSED);
    expect(out).not.toContain('stage watchdog');
  });

  it('takes a named base or --all instead of refusing', () => {
    git('checkout', 'feature');
    // HEAD selects nothing here, so only the named base keeps it from refusing.
    const nothing = run('--ref', 'HEAD', '--dry-run');
    expect(nothing.status).toBe(0);
    expect(nothing.out).not.toContain(REFUSED);
    const named = run('--ref', 'HEAD~1', '--dry-run');
    expect(named.status).toBe(0);
    expect(named.out).not.toContain(REFUSED);
    expect(named.out).toContain('Pkg');
    const all = run('--all', '--dry-run');
    expect(all.status).toBe(0);
    expect(all.out).not.toContain(REFUSED);
    expect(all.out).toContain('--all');
  });

  it('does not refuse an ordinary commit', () => {
    git('checkout', 'side');
    const { status, out } = run('--dry-run');
    expect(status).toBe(0);
    expect(out).not.toContain(REFUSED);
    expect(out).toContain('stage watchdog');
  });

  it('takes no machine slot on a dry run', () => {
    git('checkout', 'side');
    const slots = path.join(repo, '..', `${path.basename(repo)}-slots`);
    const { status } = runIn({ GATE_SLOT_DIR: path.join(slots, 'gate') }, '--dry-run');
    const touched = existsSync(slots);
    rmSync(slots, { recursive: true, force: true });
    expect(status).toBe(0);
    expect(touched).toBe(false);
  });

  it('names a full cascade on a dry run of a root change, and runs nothing', () => {
    git('checkout', 'side');
    const manifest = path.join(repo, 'package.json');
    writeFileSync(manifest, '{}\n');
    const { status, out } = run('--dry-run');
    rmSync(manifest);
    expect(status).toBe(0);
    expect(out).toContain('full cascade');
    expect(out).not.toContain('test-changed: pnpm');
  });

  it('does not refuse a merge already on main, where a fresh branch starts', () => {
    git('checkout', 'main');
    git('merge', '--no-ff', '-m', 'merge side', 'side');
    const { status, out } = run('--dry-run');
    expect(status).toBe(0);
    expect(out).not.toContain(REFUSED);
    expect(out).toContain('stage watchdog');
  });
});
