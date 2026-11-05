// Why these tests matter: run-projects.mjs promises exit code 2 on a
// malformed command line, and the gate reads that code. A `--project` that
// names no project of the plan is such a line: it must say so in one line
// and exit 2, never fall over with a stack trace and exit 1, which reads as
// a red test run.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CHANGED_REF_ENV } from "./project-runs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "run-projects.mjs");
const tourViewer = path.resolve(here, "../../GpsPlusSlamJs_TourViewer");

/** The script run from the Tour Viewer with its own plan and `args`. */
function run(args) {
  const env = { ...process.env };
  delete env[CHANGED_REF_ENV];
  return spawnSync(
    process.execPath,
    [
      script,
      "playwright-tests/e2e-plan.js",
      "playwright",
      "test",
      "--config",
      "playwright-tests/playwright.config.js",
      ...args,
    ],
    { cwd: tourViewer, encoding: "utf8", env, timeout: 60_000 },
  );
}

describe("run-projects.mjs on a malformed command line", () => {
  it("exits 2 with one line for a --project the plan does not know", () => {
    const result = run(["--project", "no-such-project"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no-such-project");
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it("exits 2 without the arguments it needs", () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: tourViewer,
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
  });
});
