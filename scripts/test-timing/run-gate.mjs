#!/usr/bin/env node
// Full-gate orchestrator: a package's `pnpm test` runs this. Executes every
// stage of the cwd-resolved project sequentially with fail-fast semantics
// (like the old `&&` chain), lets each stage record itself, then records the
// synthetic `total` row and prints the consolidated delta table. A timing
// failure never changes the gate's exit code; only the underlying commands
// do.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { budgetBreach } from './budget.mjs';
import { checkChainDrift } from './chain-guard.mjs';
import {
  resolveProject,
  PROJECTS,
  TOTAL_STAGE,
  stageOrder,
  gateStages,
  resolveGateMode,
  SKIP_BROWSER_ENV,
} from './projects.mjs';
import {
  WORKSPACE_ROOT,
  projectRoot,
  timingsPath,
  recordStage,
  runStage,
} from './run-stage.mjs';

/** @typedef {import('./delta.mjs').TestCounts} TestCounts */

const project = resolveProject(process.cwd(), WORKSPACE_ROOT);
if (!project) {
  console.error(
    `test-timing: no project configured for cwd "${process.cwd()}" — known: ${PROJECTS.map((p) => p.dir).join(', ')}`
  );
  process.exit(2);
}

function warnOnChainDrift() {
  try {
    const packageJson = /** @type {{ scripts?: Record<string, string> }} */ (
      JSON.parse(
        readFileSync(path.join(projectRoot(project), 'package.json'), 'utf8')
      )
    );
    const rawStageNames = project.stages
      .filter((stage) => stage.wrapperScript === false)
      .map((stage) => stage.name);
    for (const warning of checkChainDrift(
      packageJson.scripts ?? {},
      stageOrder(project),
      project.chainNames,
      rawStageNames
    )) {
      console.warn(`test-timing: chain drift: ${warning}`);
    }
  } catch (error) {
    console.warn(`test-timing: chain-drift check failed: ${String(error)}`);
  }
}

/**
 * @param {(TestCounts | null)[]} counts
 * @returns {TestCounts | null}
 */
function sumCounts(counts) {
  const present = counts.filter((c) => c !== null);
  if (present.length === 0) {
    return null;
  }
  return present.reduce(
    (acc, c) => ({
      passed: acc.passed + c.passed,
      failed: acc.failed + c.failed,
      skipped: acc.skipped + c.skipped,
      todo: acc.todo + c.todo,
    }),
    { passed: 0, failed: 0, skipped: 0, todo: 0 }
  );
}

/** Prints the Latest table of the freshly written md as the run-end summary. */
function printSummaryTable() {
  try {
    const filePath = timingsPath(project);
    if (!existsSync(filePath)) {
      return;
    }
    const md = readFileSync(filePath, 'utf8');
    console.log(
      `\n⏱ Test-timing summary for ${project.name} (details: docs/test-timings.md)`
    );
    for (const line of md.split('\n')) {
      if (line.startsWith('|')) {
        console.log(line);
      }
    }
  } catch (error) {
    console.warn(`test-timing: summary rendering failed: ${String(error)}`);
  }
}

warnOnChainDrift();

const { skipBrowser } = resolveGateMode(process.env);
const stages = gateStages(project, { skipBrowser });

if (skipBrowser) {
  // NAMED, never silent. The repo's rule for a run that covers less than the
  // full gate is that it says so — a quiet subset reads as "everything passed".
  const skipped = project.stages
    .filter((stage) => !stages.includes(stage))
    .map((stage) => stage.name);
  console.log(
    `\n⏭ ${project.name}: ${SKIP_BROWSER_ENV} set — running ${stages.length} of ${project.stages.length} stages, skipping ${skipped.join(', ') || '(none)'}.\n   Dependent mode (DEC-G2): builds, static checks and unit tests only.`
  );
}

const gateStart = performance.now();
/** @type {(TestCounts | null)[]} */
const stageCounts = [];
let allRecorded = true;

for (const stage of stages) {
  console.log(`\n▶ ${project.name} ${stage.name}`);
  const result = await runStage(project, stage.name, []);
  if (result.exitCode !== 0) {
    console.error(
      `\n✖ gate failed at stage "${stage.name}" (exit ${result.exitCode})`
    );
    process.exit(result.exitCode);
  }
  // AFTER the pass/fail check, so a red stage still reports its own failure
  // rather than a budget message about a run that never finished its work.
  // `process.env` because the ceiling is calibrated from the local median and
  // CI records none of its own — see the CI note in budget.mjs.
  const breach = budgetBreach(stage, result.durationMs, process.env);
  if (breach !== null) {
    console.error(`\n✖ gate failed on a wall-clock budget:\n${breach}`);
    process.exit(1);
  }
  stageCounts.push(result.tests);
  allRecorded = allRecorded && result.recorded;
}

const totalMs = Math.round(performance.now() - gateStart);
// The total row must reflect a complete recorded gate run; if any stage
// skipped recording (e.g. CI), the total is skipped too.
//
// AND NOT IN DEPENDENT MODE, which is the same rule for a different reason and
// is load-bearing: a browser-less OsmDemo run totals ~119 s against a real
// ~700 s, `HISTORY_LIMIT` is 10, so ten dependent runs would evict every
// genuine cascade total from the artefact. The next full run would then flag
// itself 🔺 slower by ~500 % against a median built from partial runs, and
// every flag in between is noise. The 2026-08-09 gate-cost decision (§4)
// permits a LABELLED discontinuity in this artefact and forbids a silent one;
// this is silent by construction, so the row is simply not written. Per-stage
// rows are unaffected — same command, same work, comparable to their history.
if (allRecorded && !skipBrowser) {
  try {
    console.log(
      `\n${recordStage(project, TOTAL_STAGE, totalMs, sumCounts(stageCounts))}`
    );
  } catch (error) {
    console.warn(
      `test-timing: total recording failed (gate unaffected): ${String(error)}`
    );
  }
  printSummaryTable();
}
process.exit(0);
