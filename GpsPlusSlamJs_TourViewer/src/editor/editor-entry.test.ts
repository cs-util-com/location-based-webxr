import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { EditorFileKind } from "./classify-editor-file.js";
import {
  NO_FILE,
  ONE_SCAN_AT_A_TIME,
  ONE_TOUR_AT_A_TIME,
  openWithScan,
  planEditorEntry,
  scanFailedLine,
  entryStepLine,
  scanNeedsTourLine,
  type AddScanOutcome,
} from "./editor-entry.js";
import type { EditorEntryStep } from "./editor-view.js";

const file = (name: string) => new File(["x"], name);
const tour = (name: string): EditorFileKind => ({
  kind: "tour",
  file: file(name),
});
const scan = (name: string): EditorFileKind => ({
  kind: "scan",
  file: file(name),
  scan: { kind: "recording" },
});
const neither = (name: string): EditorFileKind => ({
  kind: "neither",
  file: file(name),
  reason: `${name} is no use`,
});

/**
 * Why these tests matter: the order is forced - there is no add without a
 * tour - and a scan must never be opened as a tour. The plan is what the
 * open box does with whatever was chosen or dropped.
 */
describe("planEditorEntry", () => {
  it("opens a tour given alone", () => {
    const t = tour("t.zip");
    expect(planEditorEntry([t], false)).toEqual({
      kind: "open",
      tour: t.file,
      scan: null,
      ignored: [],
    });
  });

  it("opens a tour and then adds the scan given with it, in either order", () => {
    const t = tour("t.zip");
    const s = scan("s.zip");
    for (const list of [
      [t, s],
      [s, t],
    ]) {
      expect(planEditorEntry(list, false)).toEqual({
        kind: "open",
        tour: t.file,
        scan: s.file,
        ignored: [],
      });
    }
  });

  it("adds a scan alone to the tour already open", () => {
    const s = scan("s.zip");
    expect(planEditorEntry([s], true)).toEqual({
      kind: "add-scan",
      scan: s.file,
      ignored: [],
    });
  });

  it("refuses a scan alone when no tour is open, naming it", () => {
    expect(planEditorEntry([scan("walk.zip")], false)).toEqual({
      kind: "refuse",
      reason: scanNeedsTourLine("walk.zip"),
    });
  });

  it("refuses several tours, and several scans", () => {
    expect(planEditorEntry([tour("a.zip"), tour("b.zip")], true)).toEqual({
      kind: "refuse",
      reason: ONE_TOUR_AT_A_TIME,
    });
    expect(
      planEditorEntry([tour("a.zip"), scan("s.zip"), scan("r.zip")], true),
    ).toEqual({ kind: "refuse", reason: ONE_SCAN_AT_A_TIME });
  });

  // Why: a file that is neither goes to the open as before, so it is
  // refused in the open's own words (the e2e refusal specs read them).
  it("hands a lone unusable file to the open, which says why", () => {
    const n = neither("n.zip");
    expect(planEditorEntry([n], false)).toEqual({
      kind: "open",
      tour: n.file,
      scan: null,
      ignored: [],
    });
  });

  it("names unusable files that came along with a tour", () => {
    const t = tour("t.zip");
    const n = neither("n.txt");
    const plan = planEditorEntry([n, t], false);
    expect(plan).toMatchObject({ kind: "open", tour: t.file });
    if (plan.kind !== "open") throw new Error();
    expect(plan.ignored).toEqual([{ file: n.file, reason: "n.txt is no use" }]);
  });

  it("refuses an empty list", () => {
    expect(planEditorEntry([], true)).toEqual({
      kind: "refuse",
      reason: NO_FILE,
    });
  });

  // Why: whatever the mix, a scan is never what opens, and an add never
  // happens without a tour (given or open).
  it("never opens a scan, and never adds one without a tour", () => {
    const kind = fc.constantFrom<"tour" | "scan" | "neither">(
      "tour",
      "scan",
      "neither",
    );
    fc.assert(
      fc.property(
        fc.array(kind, { maxLength: 5 }),
        fc.boolean(),
        (kinds, open) => {
          const list = kinds.map((k, i) =>
            k === "tour"
              ? tour(`${i}.zip`)
              : k === "scan"
                ? scan(`${i}.zip`)
                : neither(`${i}.zip`),
          );
          const plan = planEditorEntry(list, open);
          const scans = new Set(
            list.filter((k) => k.kind === "scan").map((k) => k.file),
          );
          const opensScan = plan.kind === "open" && scans.has(plan.tour);
          const addsWithoutTour = plan.kind === "add-scan" && !open;
          const scanWithoutGivenTour =
            plan.kind === "open" &&
            plan.scan !== null &&
            !list.some((k) => k.kind === "tour" && k.file === plan.tour);
          expect([opensScan, addsWithoutTour, scanWithoutGivenTour]).toEqual([
            false,
            false,
            false,
          ]);
        },
      ),
    );
  });
});

/**
 * Why these tests matter (the async-UI rule): opening a tour with a scan is
 * one busy state - the person sees it start, sees the second half, and
 * sees it end on every path; a scan that fails must not cost the tour, and
 * a tour that does not open must not have its scan read.
 */
describe("openWithScan", () => {
  function run(
    open: () => Promise<boolean>,
    add: () => Promise<AddScanOutcome>,
    withScan = true,
  ) {
    const steps: (EditorEntryStep | null)[] = [];
    const adds: string[] = [];
    const outcome = openWithScan(
      file("t.zip"),
      withScan ? file("s.zip") : null,
      {
        open: () => open(),
        addScan: (s) => {
          adds.push(s.name);
          return add();
        },
        step: (s) => steps.push(s),
      },
    );
    return { outcome, steps, adds };
  }

  it("opens, then adds, stepping opening - adding - none", async () => {
    const r = run(
      () => Promise.resolve(true),
      () => Promise.resolve({ kind: "added" }),
    );
    expect(r.steps).toEqual(["opening"]);
    expect(await r.outcome).toEqual({ kind: "opened", scanAdded: true });
    expect(r.steps).toEqual(["opening", "adding-scan", null]);
    expect(r.adds).toEqual(["s.zip"]);
  });

  it("keeps the tour open and says so when the scan is refused", async () => {
    const r = run(
      () => Promise.resolve(true),
      () => Promise.resolve({ kind: "refused", reason: "it is broken." }),
    );
    expect(await r.outcome).toEqual({
      kind: "scan-failed",
      line: scanFailedLine("s.zip", "it is broken."),
    });
    expect(r.steps.at(-1)).toBeNull();
  });

  it("treats a throwing add as a failed add, the tour kept", async () => {
    const r = run(
      () => Promise.resolve(true),
      () => Promise.reject(new Error("disk gone")),
    );
    expect(await r.outcome).toEqual({
      kind: "scan-failed",
      line: scanFailedLine("s.zip", "disk gone"),
    });
    expect(r.steps.at(-1)).toBeNull();
  });

  it("never reads the scan when the tour did not open, and ends the step", async () => {
    for (const open of [
      () => Promise.resolve(false),
      () => Promise.reject(new Error("no")),
    ]) {
      const r = run(open, () => Promise.resolve({ kind: "added" }));
      expect(await r.outcome).toEqual({ kind: "not-opened" });
      expect(r.adds).toEqual([]);
      expect(r.steps).toEqual(["opening", null]);
    }
  });

  it("opens a tour without a scan with no entry step of its own", async () => {
    const r = run(
      () => Promise.resolve(true),
      () => Promise.resolve({ kind: "added" }),
      false,
    );
    expect(await r.outcome).toEqual({ kind: "opened", scanAdded: false });
    expect(r.adds).toEqual([]);
    expect(r.steps.every((s) => s === null)).toBe(true);
  });
});

// Why: the person must see that both halves belong to one action, and
// which file each half is about.
describe("entryStepLine", () => {
  it("names the tour and the scan while opening, the scan while adding", () => {
    expect(entryStepLine("opening", "t.zip", "s.zip")).toBe(
      "Opening t.zip, then adding the scan s.zip…",
    );
    expect(entryStepLine("adding-scan", "t.zip", "s.zip")).toBe(
      "Adding the scan s.zip…",
    );
  });
});
