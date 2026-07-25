// The impure engine shared by timed-stage.mjs and run-gate.mjs: spawns a
// stage's canonical command through a shell, measures wall-clock, extracts
// test counts from injected JSON reporters, and updates the owning project's
// docs/test-timings.md atomically. Any error in the recording path is caught
// and reported as a warning — the underlying command's exit code is always
// what the caller gets (recording must never break the gate).
//
// Adapted from the GpsPlusSlamJs pilot: every entry point takes the
// ProjectConfig resolved by the calling shell instead of a module-level
// single-project constant.

import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeDelta } from './delta.mjs';
import { machineFingerprint, machineLabel } from './machine.mjs';
import { parsePlaywrightCounts, parseVitestCounts } from './reporter-parse.mjs';
import { buildStageCommand, decideRecording } from './stage-args.mjs';
import { getStage, stageOrder } from './projects.mjs';
import {
  appendRecording,
  formatSeconds,
  parseStore,
  renderMd,
} from './timing-store.mjs';

/** @typedef {import('./delta.mjs').TestCounts} TestCounts */
/** @typedef {import('./projects.mjs').ProjectConfig} ProjectConfig */

/** Absolute path of the workspace root (this file lives at
 * <root>/scripts/test-timing/). */
export const WORKSPACE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * @param {ProjectConfig} project
 * @returns {string} absolute project root directory
 */
export function projectRoot(project) {
  return path.resolve(WORKSPACE_ROOT, project.dir);
}

/**
 * @param {ProjectConfig} project
 * @returns {string} absolute path of the project's generated timings file
 */
export function timingsPath(project) {
  return path.join(projectRoot(project), 'docs', 'test-timings.md');
}

/** @returns {{ fingerprint: string, label: string }} */
function currentMachine() {
  const hostname = os.hostname();
  const cpus = os.cpus();
  const cpuModel = (cpus[0]?.model ?? 'unknown-cpu').trim();
  const cores = cpus.length;
  return {
    fingerprint: machineFingerprint(hostname, cpuModel, cores),
    label: machineLabel(hostname, cpuModel, cores),
  };
}

/**
 * @param {string} cwd
 * @returns {{ git: string | null, branch: string | null }}
 */
function currentGit(cwd) {
  /** @param {string[]} args @returns {string | null} */
  const tryGit = (args) => {
    try {
      return (
        execFileSync('git', args, { cwd, encoding: 'utf8' }).trim() || null
      );
    } catch {
      return null;
    }
  };
  return {
    git: tryGit(['rev-parse', '--short', 'HEAD']),
    branch: tryGit(['branch', '--show-current']),
  };
}

/**
 * Ensures node_modules/.bin dirs are on PATH so canonical commands resolve
 * even when the shells are invoked via plain `node` instead of a pnpm script.
 * Both the project's own bin dir and the workspace root's are added (pnpm
 * hoists shared tooling to the root).
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} root - the project root the command runs in
 */
function withBinPath(env, root) {
  const key =
    Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[key] = [
    path.join(root, 'node_modules', '.bin'),
    path.join(WORKSPACE_ROOT, 'node_modules', '.bin'),
    env[key] ?? '',
  ].join(path.delimiter);
}

/**
 * @param {string} command
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>}
 */
function execShell(command, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: 'inherit', cwd, env });
    child.on('error', (error) => {
      console.error(
        `test-timing: failed to spawn stage command: ${String(error)}`
      );
      resolve(1);
    });
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/**
 * @param {'vitest' | 'playwright'} kind
 * @param {string} file
 * @returns {TestCounts}
 */
function readCounts(kind, file) {
  const text = readFileSync(file, 'utf8');
  return kind === 'vitest'
    ? parseVitestCounts(text)
    : parsePlaywrightCounts(text);
}

/**
 * Reads, updates and atomically rewrites the project's docs/test-timings.md,
 * returning the one-line delta summary for the stage.
 *
 * @param {ProjectConfig} project
 * @param {string} stageName
 * @param {number} durationMs
 * @param {TestCounts | null} tests
 * @returns {string} human summary line
 */
export function recordStage(project, stageName, durationMs, tests) {
  const machine = currentMachine();
  const root = projectRoot(project);
  const { git, branch } = currentGit(root);
  const filePath = timingsPath(project);
  const existing = existsSync(filePath)
    ? readFileSync(filePath, 'utf8')
    : null;
  const { store, warning } = parseStore(existing, project.name);
  if (warning) {
    console.warn(`test-timing: ${warning}`);
  }
  const updated = appendRecording(
    store,
    stageName,
    {
      ts: new Date().toISOString(),
      durationMs,
      tests,
      machine: machine.fingerprint,
      git,
    },
    { machineLabel: machine.label, branch }
  );
  const md = renderMd(updated, stageOrder(project));
  // Unlike the library pilot, most packages here have no docs/ directory
  // until their first recorded run — create it rather than fail.
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, md, 'utf8');
  renameSync(tempPath, filePath);
  return summarizeStage(stageName, updated.stages[stageName]?.history ?? []);
}

/**
 * @param {string} stageName
 * @param {import('./delta.mjs').Recording[]} history
 * @returns {string}
 */
function summarizeStage(stageName, history) {
  if (history.length === 0) {
    return `⏱ ${stageName}: no recording`;
  }
  const latest = history[0];
  const delta = computeDelta(history);
  /** @type {string} */
  let deltaText;
  if (delta.kind === 'compared') {
    const deltaMs = /** @type {number} */ (delta.deltaMs);
    const sign = deltaMs >= 0 ? '+' : '−';
    const change = `${sign}${(Math.abs(deltaMs) / 1000).toFixed(1)} s`;
    deltaText =
      delta.flag === 'slower'
        ? `🔺 slower, ${change}`
        : delta.flag === 'faster'
          ? `🔻 faster, ${change}`
          : `≈, ${change}`;
  } else {
    deltaText =
      delta.kind === 'baseline-reset' ? 'baseline reset' : 'first recording';
  }
  const testsText = latest.tests
    ? ` · ${latest.tests.passed} tests${
        delta.deltaTests === null
          ? ''
          : ` (${delta.deltaTests >= 0 ? '+' : ''}${delta.deltaTests})`
      }`
    : '';
  return `⏱ ${stageName} ${formatSeconds(latest.durationMs)} (${deltaText})${testsText}`;
}

/**
 * @typedef {Object} StageResult
 * @property {number} exitCode
 * @property {number} durationMs
 * @property {TestCounts | null} tests
 * @property {boolean} recorded
 */

/**
 * Runs one stage of a project: canonical command + forwarded args, with
 * reporter injection and md recording on successful unfiltered non-CI runs.
 *
 * @param {ProjectConfig} project
 * @param {string} stageName
 * @param {readonly string[]} forwardedArgs
 * @returns {Promise<StageResult>}
 */
export async function runStage(project, stageName, forwardedArgs) {
  const stage = getStage(project, stageName);
  if (!stage) {
    console.error(
      `test-timing: unknown stage "${stageName}" for ${project.name} — known stages: ${stageOrder(project).join(', ')}`
    );
    return { exitCode: 1, durationMs: 0, tests: null, recorded: false };
  }

  const decision = decideRecording(forwardedArgs, process.env);
  let command = buildStageCommand(
    stage.command,
    decision,
    stage.filteredRunArgs,
    stage.filteredRunCommand
  );
  const root = projectRoot(project);
  const env = { ...process.env };
  withBinPath(env, root);

  /** @type {string | null} */
  let scratchDir = null;
  /** @type {string | null} */
  let countsFile = null;
  if (decision.record && stage.counts) {
    try {
      scratchDir = mkdtempSync(path.join(os.tmpdir(), 'test-timing-'));
      countsFile = path.join(scratchDir, 'report.json');
      if (stage.counts === 'vitest') {
        command += ` --reporter=default --reporter=json --outputFile.json="${countsFile}"`;
      } else {
        command += ' --reporter=list,json';
        env.PLAYWRIGHT_JSON_OUTPUT_NAME = countsFile;
      }
    } catch (error) {
      console.warn(
        `test-timing: could not prepare counts capture, recording duration only: ${String(error)}`
      );
      scratchDir = null;
      countsFile = null;
    }
  }

  const start = performance.now();
  const exitCode = await execShell(command, root, env);
  const durationMs = Math.round(performance.now() - start);

  let recorded = false;
  /** @type {TestCounts | null} */
  let tests = null;
  try {
    if (exitCode === 0 && decision.record) {
      if (countsFile) {
        try {
          tests = readCounts(
            /** @type {'vitest' | 'playwright'} */ (stage.counts),
            countsFile
          );
        } catch (error) {
          console.warn(
            `test-timing: could not read test counts for ${stageName}, recording duration only: ${String(error)}`
          );
        }
      }
      console.log(recordStage(project, stageName, durationMs, tests));
      recorded = true;
    }
  } catch (error) {
    console.warn(
      `test-timing: recording failed (gate unaffected): ${String(error)}`
    );
  } finally {
    if (scratchDir) {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  }

  return { exitCode, durationMs, tests, recorded };
}
