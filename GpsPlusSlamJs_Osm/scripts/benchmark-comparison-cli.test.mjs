import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(
  new URL("./benchmark-endpoints.mjs", import.meta.url),
);
const dryRun = (args) =>
  spawnSync(
    process.execPath,
    [runner, "--compare-map3d", "--dry-run", ...args],
    { encoding: "utf8" },
  );

describe("comparison CLI integration (no network)", () => {
  // Why: exercise actual flag wiring and key-list reader, not only a hand-built plan.
  it("plans the requested broad queries without writing or contacting a server", () => {
    const process = dryRun([
      "--site",
      "cologne",
      "--res",
      "10",
      "--profiles",
      "everything,everything-areal,full-production180",
      "--repeats",
      "2",
    ]);
    expect(process.status).toBe(0);
    const { cells, site } = JSON.parse(process.stdout);
    expect(site.id).toBe("cologne-res10");
    expect(cells).toHaveLength(6);
    expect(cells.map((cell) => cell.profile)).toEqual([
      "everything",
      "everything-areal",
      "full-production180",
      "full-production180",
      "everything-areal",
      "everything",
    ]);
    expect(
      cells.every(
        (cell) => cell.url === "https://overpass-api.de/api/interpreter",
      ),
    ).toBe(true);
  });

  // Why: typoed narrowing flags must never silently launch a larger default run.
  it.each([
    ["--profiles", "typo"],
    ["--site", "typo"],
    ["--hosts", "typo"],
    ["--repeats", "NaN"],
    ["--budget-minutes", "-1"],
  ])("rejects invalid option %s %s", (...args) => {
    expect(dryRun(args).status).not.toBe(0);
  });
});
