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

  // Why: the decomposition arms are the primary contrast for the next run
  // (owner decision D1/D2, 2026-09-20), so the CLI must actually reach them —
  // a plan built by hand in a unit test would not prove the flag is wired.
  it("plans the selector-decomposition contrast against the z alias", () => {
    const process = dryRun([
      "--site",
      "cologne",
      "--res",
      "10",
      "--profiles",
      "full-production180,nw-only-32,rel-only-32,prod-33",
      "--hosts",
      "z.overpass-api.de",
      "--repeats",
      "1",
    ]);
    expect(process.status).toBe(0);
    const { cells } = JSON.parse(process.stdout);
    expect(cells).toHaveLength(4);
    expect(new Set(cells.map((cell) => cell.profile))).toEqual(
      new Set(["full-production180", "nw-only-32", "rel-only-32", "prod-33"]),
    );
    expect(
      cells.every(
        (cell) => cell.url === "https://z.overpass-api.de/api/interpreter",
      ),
    ).toBe(true);
    // Same operator as the main host, so the shared cooldown still applies —
    // using the alias is about which INSTANCE answers, not about extra quota.
    expect(new Set(cells.map((cell) => cell.operator)).size).toBe(1);
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
