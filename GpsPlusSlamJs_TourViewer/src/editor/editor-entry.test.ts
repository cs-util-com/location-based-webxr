import { describe, expect, it } from "vitest";
import {
  addScanSafely,
  notOpenedLine,
  openWithScan,
  scanFailedLine,
  entryStepLine,
  type AddScanOutcome,
} from "./editor-entry.js";
import type { EditorEntryStep } from "./editor-view.js";
import { describeOpenError } from "../open-errors.js";

const file = (name: string) => new File(["x"], name);
/**
 * Why these tests matter (the async-UI rule): opening a tour with a scan is
 * one busy state - the person sees it start, sees the second half, and
 * sees it end on every path; a scan that fails must not cost the tour, and
 * a tour that does not open must not have its scan read.
 */
describe("openWithScan", () => {
  function run(
    open: () => Promise<boolean>,
    add: () => Promise<AddScanOutcome | null>,
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
    const refused = run(
      () => Promise.resolve(false),
      () => Promise.resolve({ kind: "added" }),
    );
    expect(await refused.outcome).toEqual({ kind: "not-opened" });
    const thrown = new Error("no");
    const threw = run(
      () => Promise.reject(thrown),
      () => Promise.resolve({ kind: "added" }),
    );
    expect(await threw.outcome).toEqual({ kind: "not-opened", error: thrown });
    for (const r of [refused, threw]) {
      expect(r.adds).toEqual([]);
      expect(r.steps).toEqual(["opening", null]);
    }
  });

  // Why: an open that throws has said nothing itself (the page's open
  // says its own refusals, never a throw), so the page must say it, or a
  // drop fails silently.
  it("carries a thrown open's error out, in words for the page", async () => {
    const thrown = new Error("the disk went away");
    const r = run(
      () => Promise.reject(thrown),
      () => Promise.resolve({ kind: "added" }),
    );
    const outcome = await r.outcome;
    expect(notOpenedLine(outcome)).toBe(describeOpenError(thrown));
    expect(notOpenedLine({ kind: "not-opened" })).toBeNull();
    expect(notOpenedLine({ kind: "opened", scanAdded: false })).toBeNull();
  });

  // Why: when another tour opened while the scan was read, the scan was
  // never that tour's - a lasting line blaming the scan would name the
  // wrong tour and the wrong cause.
  it("says nothing when the tour changed under the add", async () => {
    const r = run(
      () => Promise.resolve(true),
      () => Promise.resolve(null),
    );
    expect(await r.outcome).toEqual({ kind: "opened", scanAdded: false });
    expect(r.steps.at(-1)).toBeNull();
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

// Why: an add that throws (a scan read past its own refusals) would be an
// unhandled rejection: the button clears, and nothing says why. Every add
// the page starts goes through this, so a throw is said like a refusal.
describe("addScanSafely", () => {
  it("passes an add's outcome through, and says a throw as a refusal", async () => {
    expect(
      await addScanSafely(() => Promise.resolve({ kind: "added" })),
    ).toEqual({ kind: "added" });
    expect(await addScanSafely(() => Promise.resolve(null))).toBeNull();
    expect(
      await addScanSafely(() => Promise.reject(new Error("disk gone"))),
    ).toEqual({ kind: "refused", reason: "disk gone" });
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
