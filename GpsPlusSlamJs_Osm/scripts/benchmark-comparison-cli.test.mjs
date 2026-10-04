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
      // Pinned since the pool became the default: this test asserts ARM ORDER
      // across rounds, and a six-host product would bury that in 36 cells.
      // Two operators, so the single-host guard is satisfied honestly.
      "--hosts",
      "overpass-api.de,maps.mail.ru",
    ]);
    expect(process.status).toBe(0);
    const { cells, site } = JSON.parse(process.stdout);
    expect(site.id).toBe("cologne-res10");
    // 3 profiles x 2 hosts x 2 rounds. Derived rather than literal, so a
    // changed pool fails loudly at the product instead of puzzlingly.
    expect(cells).toHaveLength(3 * 2 * 2);
    // The ARM ORDER REVERSES between rounds - the property this test exists
    // for, since the historical sweep confounded arm with server load. Read it
    // per host, because each host sees the full arm set in each round.
    const armsFor = (round, url) =>
      cells
        .filter((cell) => cell.round === round && cell.url === url)
        .map((cell) => cell.profile);
    const main = "https://overpass-api.de/api/interpreter";
    expect(armsFor(1, main)).toEqual([
      "everything",
      "everything-areal",
      "full-production180",
    ]);
    expect(armsFor(2, main)).toEqual([
      "full-production180",
      "everything-areal",
      "everything",
    ]);
    // Both requested hosts are actually planned, and they are two operators -
    // which is the whole point of the default the guard now enforces.
    expect(new Set(cells.map((cell) => cell.url)).size).toBe(2);
    expect(new Set(cells.map((cell) => cell.operator)).size).toBe(2);
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
      // This test is deliberately about the z ALIAS resolving, so it is exactly
      // the single-host case the guard refuses by default. Acknowledging it
      // here is the guard working, not the guard being worked around.
      "--accept-single-host",
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

  // Why: the single-host default is what produced a shipped-and-reverted
  // regression on 2026-09-20. The one-statement relation query measured
  // 1.7-2.2x faster on `z.overpass-api.de` and halved the success rate on the
  // other four; the benchmark never asked them, because `--hosts` defaulted to
  // one. The default is the guard.
  it("compares across the WHOLE endpoint pool by default", () => {
    const process = dryRun([
      "--site",
      "cologne",
      "--res",
      "10",
      "--profiles",
      "full-production180",
      "--repeats",
      "1",
    ]);
    expect(process.status).toBe(0);
    const { cells } = JSON.parse(process.stdout);
    const hosts = new Set(cells.map((cell) => cell.url));
    expect(hosts.size).toBeGreaterThanOrEqual(5);
    // And more than one OPERATOR, which is the property that actually matters:
    // five hostnames behind one operator would still be one verdict.
    expect(new Set(cells.map((cell) => cell.operator)).size).toBeGreaterThan(1);
  });

  it("refuses a single-host comparison unless it is made explicit", () => {
    // Why a refusal and not a warning: the 2026-09-20 write-up DID record "one
    // operator, one instance... inferred, not measured" in its limitations, and
    // that sentence did not stop the change from shipping. A named limitation
    // is not a mitigation, so narrowing the pool has to be a deliberate act
    // that shows up in the command line and therefore in the artifact.
    const narrowed = dryRun([
      "--site",
      "cologne",
      "--res",
      "10",
      "--profiles",
      "full-production180",
      "--hosts",
      "z.overpass-api.de",
    ]);
    expect(narrowed.status).not.toBe(0);
    expect(`${narrowed.stderr}${narrowed.stdout}`).toMatch(
      /single-host|--accept-single-host/i,
    );

    const acknowledged = dryRun([
      "--site",
      "cologne",
      "--res",
      "10",
      "--profiles",
      "full-production180",
      "--hosts",
      "z.overpass-api.de",
      "--accept-single-host",
    ]);
    expect(acknowledged.status).toBe(0);
  });

  it("allows a narrowed pool that still spans more than one operator", () => {
    // The guard is about one VERDICT-CARRYING sample, not about pool size. Two
    // operators is enough to disagree, which is all the guard is protecting.
    const process = dryRun([
      "--site",
      "cologne",
      "--res",
      "10",
      "--profiles",
      "full-production180",
      "--hosts",
      "z.overpass-api.de,maps.mail.ru",
    ]);
    expect(process.status).toBe(0);
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
