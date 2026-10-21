// The impure engine shared by timed-stage.mjs and run-gate.mjs: spawns a
// stage's canonical command through a shell, measures wall-clock, extracts
// test counts from injected JSON reporters, and updates the owning project's
// docs/test-timings.md atomically. Any error in the recording path is caught
// and reported as a warning — the underlying command's exit code is always
// what the caller gets (recording must never break the gate).
//
// It also runs the no-output watchdog (stall-watch.mjs): an unfiltered leaf
// stage that prints nothing for GATE_STALL_MIN minutes (default 20) is killed
// with its whole process tree and returns STALL_EXIT (124).
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
import {
  STALL_EXIT,
  STALL_KILL_GRACE_MS,
  shouldReportSilence,
  silenceClock,
  silenceLine,
  stallLimitMs,
  stallMessage,
  stallPollMs,
} from './stall-watch.mjs';
import { gateBaseCommand, getStage, stageOrder } from './projects.mjs';
import {
  LOWERED_MARKER_ENV,
  spawnAtPriority,
  stageSpawnPriority,
} from './stage-priority.mjs';
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
 * Process groups of the stages running right now, POSIX only: a watched
 * stage runs `detached` there, in a group of its own, so the watchdog can
 * kill the whole tree. That also takes it out of the terminal's group, so a
 * Ctrl-C or a SIGTERM to the gate no longer reaches it on its own; these are
 * the groups `signalLiveStages` forwards to.
 *
 * @type {Map<number, { signalled: boolean }>}
 */
const liveGroups = new Map();

/**
 * Sends `signal` to every live stage's process group (POSIX). The gate's
 * signal handlers call it before they exit, and the `exit` hook below
 * forwards SIGTERM to any group nobody signalled yet.
 *
 * @param {NodeJS.Signals} signal
 */
export function signalLiveStages(signal) {
  for (const [pid, state] of liveGroups) {
    state.signalled = true;
    try {
      process.kill(-pid, signal);
    } catch {
      // Already gone.
    }
  }
}

process.on('exit', () => {
  for (const [pid, state] of liveGroups) {
    if (state.signalled) continue;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
});

/**
 * Exit with 130 on SIGINT, SIGTERM or SIGHUP, after forwarding the signal to
 * the live stage groups. For an entry point that has no handlers of its own
 * (timed-stage.mjs); run-gate.mjs forwards in its own handlers.
 */
export function forwardSignalsToStages() {
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.on(signal, () => {
      signalLiveStages(signal);
      process.exit(130);
    });
  }
}

/** @param {number} ms */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Kills a stalled stage's whole process tree: the shell, pnpm, vitest and its
 * forked workers. Killing only the shell would orphan a busy worker.
 *
 * - Windows: `taskkill /T /F` walks the tree by parent pid.
 * - POSIX: SIGTERM to the stage's process group, then SIGKILL once the group
 *   is still there after STALL_KILL_GRACE_MS. The grace lets Playwright close
 *   the browsers it starts in groups of their own, which a SIGKILL to this
 *   group would orphan.
 *
 * @param {number | undefined} pid
 * @returns {Promise<{ killed: true } | { killed: false, error: string }>}
 */
async function killStageTree(pid) {
  if (pid === undefined) return { killed: false, error: 'no pid' };
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      return { killed: true };
    } catch (error) {
      return { killed: false, error: String(error) };
    }
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    return { killed: false, error: String(error) };
  }
  const state = liveGroups.get(pid);
  if (state) state.signalled = true;
  const groupAlive = () => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let waited = 0; waited < STALL_KILL_GRACE_MS && groupAlive(); waited += 100) {
    await delay(100);
  }
  if (groupAlive()) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Gone between the check and the kill.
    }
  }
  return { killed: true };
}

/**
 * @typedef {{ stageName: string, limitMs: number, pollMs: number, longestMs?: number }} StageWatch
 */

/**
 * @param {string} command
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @param {number | null} priority - OS priority for the stage's process tree,
 *   or null to inherit (see stage-priority.mjs)
 * @param {StageWatch | null} [watch] - the silence watch, or null for none;
 *   `longestMs` is filled in when the stage ends
 * @returns {Promise<number>}
 */
function execShell(command, cwd, env, priority, watch = null) {
  // The watch has to SEE the output, so it pipes and re-emits it. Only when
  // our own stdout is not a terminal: the child then already sees a non-TTY,
  // so piping changes nothing it can observe (colours, live progress UIs).
  const piped = watch !== null && !process.stdout.isTTY;
  // POSIX: a group of its own, so a kill reaches every process in the tree.
  // Never on Windows, where `detached` opens a new console instead.
  const ownGroup = piped && process.platform !== 'win32';
  return new Promise((resolve) => {
    const child = spawnAtPriority(
      ({ lowered }) =>
        spawn(command, {
          shell: true,
          stdio: piped ? ['inherit', 'pipe', 'pipe'] : 'inherit',
          detached: ownGroup,
          cwd,
          // The marker tells the Playwright configs the stage really runs
          // lowered, so they may move the GPU work into the browser process.
          // Never inherited: a stage that is not lowered must not claim it.
          env: { ...env, [LOWERED_MARKER_ENV]: lowered ? '1' : undefined },
        }),
      priority,
      os
    );
    if (ownGroup && child.pid !== undefined) {
      liveGroups.set(child.pid, { signalled: false });
    }
    /** @type {ReturnType<typeof silenceClock> | null} */
    let clock = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    let timer = null;
    /** The kill and its banner, once the watch fired. @type {Promise<unknown> | null} */
    let stall = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let exitCap = null;
    let settled = false;
    /** @param {number} code */
    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      if (exitCap) clearTimeout(exitCap);
      if (child.pid !== undefined) liveGroups.delete(child.pid);
      if (watch && clock) watch.longestMs = clock.longest(Date.now());
      // A stalled stage's shell exits as soon as the kill lands, before the
      // banner is printed: the banner must come before the caller's verdict.
      if (stall !== null) void stall.then(() => resolve(STALL_EXIT));
      else resolve(code);
    };
    if (piped && watch) {
      const silence = silenceClock(watch.limitMs, Date.now());
      clock = silence;
      child.stdout?.on('data', (chunk) => {
        silence.heard(Date.now());
        process.stdout.write(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        silence.heard(Date.now());
        process.stderr.write(chunk);
      });
      timer = setInterval(() => {
        const { silentMs, stalled } = silence.check(Date.now());
        if (!stalled || stall !== null) return;
        if (timer) clearInterval(timer);
        stall = killStageTree(child.pid).then((kill) => {
          console.error(stallMessage(watch.stageName, silentMs, kill));
          // A failed kill may never produce an `exit`: do not wait for one.
          // A landed kill produces it at once; the cap only bounds the wait.
          if (!kill.killed) finish(STALL_EXIT);
          else exitCap = setTimeout(() => finish(STALL_EXIT), 10_000);
        });
      }, watch.pollMs);
    }
    child.on('error', (error) => {
      console.error(
        `test-timing: failed to spawn stage command: ${String(error)}`
      );
      finish(1);
    });
    child.on('exit', (code, signal) => {
      // The kill's verdict wins over whatever status the dying shell left.
      const status = code ?? (signal ? 1 : 0);
      if (!piped) {
        finish(status);
        return;
      }
      // Piped output can still be in flight when the process exits: wait for
      // the streams to close, so the stage's last lines come before the next
      // stage's first, but never longer than a moment, since a descendant
      // that outlives the shell can hold the pipe open.
      const drained = setTimeout(() => finish(status), 2_000);
      child.on('close', () => {
        clearTimeout(drained);
        finish(status);
      });
    });
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

  const baseCommand = gateBaseCommand(stage, process.env);
  // A run on a stage's per-commit fast command (e.g. the framework's unit
  // stage without --coverage, gate-speed plan G4) is NOT recorded: its
  // duration is not comparable with the history of the canonical command.
  const decision =
    baseCommand === stage.command
      ? decideRecording(forwardedArgs, process.env)
      : { ...decideRecording(forwardedArgs, process.env), record: false };
  let command = buildStageCommand(
    baseCommand,
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

  // The no-output watchdog (stall-watch.mjs): unfiltered leaf stages only,
  // unless a filtered run opts in through GATE_STALL_MIN.
  const limitMs = stallLimitMs(stage, process.env, {
    filtered: decision.extraArgs.length > 0,
  });
  /** @type {StageWatch | null} */
  const watch =
    limitMs === null
      ? null
      : {
          stageName: `${project.name} ${stageName}`,
          limitMs,
          pollMs: stallPollMs(process.env),
        };
  const start = performance.now();
  const exitCode = await execShell(
    command,
    root,
    env,
    stageSpawnPriority(stage, { platform: process.platform, env }),
    watch
  );
  const durationMs = Math.round(performance.now() - start);
  if (
    watch?.longestMs !== undefined &&
    exitCode !== STALL_EXIT &&
    shouldReportSilence(watch.longestMs, watch.limitMs)
  ) {
    console.log(silenceLine(watch.stageName, watch.longestMs, durationMs));
  }

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
