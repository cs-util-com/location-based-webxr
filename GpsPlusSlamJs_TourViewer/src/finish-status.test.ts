/**
 * Why these tests matter: every reader of the phone's Finish (the panel,
 * the AR button, Done, the measuring and the editing locks) goes through
 * these selectors, so each one must say exactly what the save status
 * holds - the progress in the Finish's own words, the failure with its
 * label, and a waiting Done as its own fact.
 */

import { describe, expect, it } from "vitest";
import {
  createProgressGate,
  finishErrorLine,
  finishProgressLine,
  finishRunning,
  finishWaitsForMeasurement,
} from "./finish-status.js";
import { FINISH_LABELS } from "./qr-author-mode.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  initialTourDocumentState,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

function open(): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest: tourOf([]) }));
}

describe("finish status selectors", () => {
  it("read nothing running, no line, no failure and no wait on a fresh tour", () => {
    const state = open();
    expect(finishRunning(state)).toBe(false);
    expect(finishProgressLine(state)).toBe("");
    expect(finishErrorLine(state)).toBeNull();
    expect(finishWaitsForMeasurement(state)).toBe(false);
  });

  it("say the running Finish's progress in its own words", () => {
    let state = reduce(open(), act.saveClaimed({ by: "explicit" }));
    expect(finishRunning(state)).toBe(true);
    expect(finishProgressLine(state)).toBe("");
    state = reduce(
      state,
      act.saveProgressed({ progress: { kind: "reading", bytes: 2_500_000 } }),
    );
    expect(finishProgressLine(state)).toBe(FINISH_LABELS.reading(2_500_000));
    state = reduce(
      state,
      act.saveProgressed({
        progress: { kind: "rebuilding", done: 3, total: 7 },
      }),
    );
    expect(finishProgressLine(state)).toBe(FINISH_LABELS.rebuilding(3, 7));
  });

  it("label a failure until the next Finish claims the slot", () => {
    let state = reduce(open(), act.saveClaimed({ by: "explicit" }));
    state = reduce(state, act.saveReleased({ error: "disk full" }));
    expect(finishRunning(state)).toBe(false);
    expect(finishErrorLine(state)).toBe(FINISH_LABELS.failed("disk full"));
    state = reduce(state, act.saveClaimed({ by: "explicit" }));
    expect(finishErrorLine(state)).toBeNull();
  });

  it("read a waiting Done as its own fact", () => {
    const state = reduce(open(), act.finishWaitsChanged({ waits: true }));
    expect(finishWaitsForMeasurement(state)).toBe(true);
    expect(finishRunning(state)).toBe(false);
  });
});

describe("the rebuild progress gate", () => {
  // Why: every dispatch wakes every store subscriber, and a tour can hold
  // thousands of entries; the gate bounds the Finish to about one report
  // per whole percent, and the panel must still end on the last count.
  it("lets 1,000 entries through as exactly 101 reports, the last at 100 %", () => {
    const gate = createProgressGate();
    const passed: [number, number][] = [];
    // The rebuild reports each entry, then the end once more.
    for (let done = 1; done <= 1000; done += 1) {
      if (gate(done, 1000)) passed.push([done, 1000]);
    }
    if (gate(1000, 1000)) passed.push([1000, 1000]);
    expect(passed).toHaveLength(101);
    expect(passed.at(-1)).toEqual([1000, 1000]);
    expect(passed.filter(([done]) => done === 1000)).toHaveLength(1);
  });

  it("lets every entry of a small tour through, and an empty one once", () => {
    const gate = createProgressGate();
    expect([1, 2, 3].map((done) => gate(done, 3))).toEqual([true, true, true]);
    expect(gate(3, 3)).toBe(false);
    const empty = createProgressGate();
    expect([empty(0, 0), empty(0, 0)]).toEqual([true, false]);
  });

  it("starts afresh for each Finish", () => {
    const first = createProgressGate();
    expect(first(5, 10)).toBe(true);
    expect(createProgressGate()(5, 10)).toBe(true);
  });
});
