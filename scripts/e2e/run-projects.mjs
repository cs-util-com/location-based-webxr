#!/usr/bin/env node
// Runs a package's Playwright projects one after the other, each at its own
// worker count, and narrows the run to the changed area inside a
// `test:changed` run. Used as a package's `test:e2e` stage command:
//
//   node ../scripts/e2e/run-projects.mjs <plan.js> playwright test --config <config> [forwarded...]
//
// `<plan.js>` (relative to the package) exports `PROJECTS` (names, in run
// order), `SPECS` (spec file name -> project and area), `specsOf(project)`,
// `LOCAL_DOM_WORKERS`, `RESULTS_DIR`, `RESULTS_NAME` and
// `selectSpecs(changedPaths)`; see
// GpsPlusSlamJs_TourViewer/playwright-tests/e2e-plan.js. The first project
// runs at the DOM worker count, every later one at one worker.
//
// Not Playwright's project `dependencies`: a red spec of the first project
// would skip every spec of the next one. Here every project runs, and the
// exit code is the first non-zero one (1 when a report was unreadable). The
// per-project JSON reports (the config's own reporter in CI mode, the gate's
// injected one when it records) are merged into the one file their reader
// expects; a missing one is warned about, an unreadable one fails the run
// after every project ran.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { changedPaths } from "../test-changed/changed-paths.mjs";
import {
  CHANGED_REF_ENV,
  intersectSelections,
  laneSpecs,
  developerFiltered,
  domWorkers,
  mayNarrow,
  mergeReports,
  namedProjects,
  projectArgs,
  projectReportName,
  readReport,
} from './project-runs.mjs';
import { DEVELOPER_FILTER_ENV, passesEmpty } from './tier.mjs';

const [planFile, cli, verb, configFlag, configFile, ...forwarded] =
  process.argv.slice(2);
if (
  !planFile ||
  cli !== "playwright" ||
  verb !== "test" ||
  configFlag !== "--config" ||
  !configFile
) {
  console.error(
    "usage: run-projects.mjs <plan.js> playwright test --config <config> [args...]",
  );
  process.exit(2);
}

const cwd = process.cwd();
const plan = await import(pathToFileURL(path.resolve(cwd, planFile)).href);
const playwrightCli = createRequire(path.join(cwd, "package.json")).resolve(
  "@playwright/test/cli",
);

/** @type {readonly string[] | null} the specs to run, null for all */
let selected = null;
/** Whether the run was cut to the changed area (a tier run may then select nothing). */
let areaNarrowed = false;
if (mayNarrow(process.env, forwarded)) {
  const ref = /** @type {string} */ (process.env[CHANGED_REF_ENV]);
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).stdout.trim();
  const selection = plan.selectSpecs(changedPaths(ref, root));
  if (selection.all) {
    console.log(
      `e2e areas: all specs (changed vs ${ref}: "${selection.reason}")`,
    );
  } else {
    selected = selection.specs;
    areaNarrowed = true;
    const areas = selection.areas.length > 0 ? selection.areas.join(', ') : 'none';
    console.log(
      `e2e areas: ${areas} vs ${ref} - ${selected.length} of ${Object.keys(plan.SPECS).length} spec files: ${selected.join(", ") || "(none)"}`,
    );
  }
}

// A CI lane (E2E_LANE): one job's share of the specs. An unknown or empty
// lane stops the run, so a job never passes having run no test.
try {
  const lane = laneSpecs(process.env, plan);
  if (lane !== null) {
    selected = intersectSelections(lane, selected);
    console.log(
      `e2e lane ${process.env.E2E_LANE}: ${selected.length} spec files: ${selected.join(', ') || '(none)'}`
    );
  }
} catch (error) {
  console.error(`e2e lane: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

// A developer's `--project` picks the passes; each pass names its own. One
// the plan does not know is a malformed command line: said, exit 2.
/** @type {ReturnType<typeof namedProjects>} */
let named;
try {
  named = namedProjects(forwarded, plan.PROJECTS);
} catch (error) {
  console.error(
    `run-projects.mjs: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}
const base = ['test', '--config', configFile, ...named.rest];
const resultsDir = path.resolve(cwd, plan.RESULTS_DIR);
/**
 * The JSON reports to merge after the runs: the config's own reporter (CI
 * mode, so expected only when CI is set; the config reads its file name from
 * E2E_RESULTS_NAME inside RESULTS_DIR) and the gate's injected one (a path,
 * when it records).
 * @type {{ env: string, file: string, expected: boolean, valueFor: (project: string) => string, fileFor: (project: string) => string }[]}
 */
const reportTargets = [
  {
    env: "E2E_RESULTS_NAME",
    file: path.join(resultsDir, plan.RESULTS_NAME),
    expected: Boolean(process.env.CI),
    valueFor: (p) => projectReportName(plan.RESULTS_NAME, p),
    fileFor: (p) =>
      path.join(resultsDir, projectReportName(plan.RESULTS_NAME, p)),
  },
];
const gateReport = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME;
if (gateReport) {
  reportTargets.push({
    env: "PLAYWRIGHT_JSON_OUTPUT_NAME",
    file: gateReport,
    expected: true,
    valueFor: (p) => projectReportName(gateReport, p),
    fileFor: (p) => projectReportName(gateReport, p),
  });
}

let exitCode = 0;
/**
 * target file -> the parsed per-project reports. Read right after each run:
 * the config's report sits inside Playwright's output folder, which the
 * NEXT project's run empties when it starts.
 * @type {Map<string, unknown[]>}
 */
const reports = new Map(reportTargets.map((t) => [t.file, []]));
for (const [index, project] of plan.PROJECTS.entries()) {
  if (!named.projects.includes(project)) continue;
  const specs = selected?.filter((name) =>
    plan.specsOf(project).includes(name),
  );
  if (specs && specs.length === 0) {
    console.log(`
e2e project ${project}: no spec selected, skipped`);
    continue;
  }
  const workers = index === 0 ? domWorkers(process.env, plan.LOCAL_DOM_WORKERS) : 1;
  // The config's tier reads whether this command line carries a developer's
  // selection from here: the spec filters below are the runner's own.
  const env = { ...process.env, [DEVELOPER_FILTER_ENV]: developerFiltered(forwarded) ? '1' : '0' };
  for (const t of reportTargets) {
    env[t.env] = t.valueFor(project);
    rmSync(t.fileFor(project), { force: true });
  }
  const args = projectArgs({
    base,
    project,
    workers,
    specs: specs ?? null,
    passWithNoTests: passesEmpty({
      developerFiltered: developerFiltered(forwarded),
      narrowed: areaNarrowed,
      env: process.env,
    }),
  });
  console.log(`
e2e project ${project} (${workers} worker${workers === 1 ? "" : "s"})`);
  const child = spawnSync(process.execPath, [playwrightCli, ...args], {
    cwd,
    env,
    stdio: "inherit",
  });
  const status = child.status ?? 1;
  if (status !== 0 && exitCode === 0) exitCode = status;
  for (const t of reportTargets) {
    const file = t.fileFor(project);
    const read = readReport(file, t.expected, {
      exists: existsSync,
      read: (f) => readFileSync(f, "utf8"),
    });
    if (read.warning) console.warn(`e2e project ${project}: ${read.warning}`);
    if (read.failed && exitCode === 0) exitCode = 1;
    if (read.report) reports.get(t.file)?.push(read.report);
    rmSync(file, { force: true });
  }
}

for (const [target, parsed] of reports) {
  if (parsed.length === 0) continue;
  writeFileSync(target, JSON.stringify(mergeReports(parsed), null, 2));
}
process.exit(exitCode);
