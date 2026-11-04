/**
 * Why these tests matter: the bottom panel's toggles carry a badge only
 * when there is something to see (a badge that is always up says nothing),
 * the panel's height must stay usable however it is dragged or whatever a
 * browser kept from an earlier visit, and the History tab's rows must say
 * which step the tour stands on and how many undo or redo steps a click
 * takes - a wrong count there silently undoes work the creator wanted.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  PANEL_HEIGHT,
  clampHeight,
  countdown,
  dragged,
  minutesAgo,
  historyBadge,
  historyRows,
  perfBadge,
  problemsBadge,
  readSaved,
  startHeight,
  tilesBadge,
  toggled,
  withNewFrames,
  type PanelState,
} from "./bottom-panel-model.js";

const LOAD = { waiting: 0, failed: 0, givenUp: 0, ceilingWaitS: 0 };

describe("the badges", () => {
  it("show no problems badge without a problem", () => {
    expect(problemsBadge({ error: 0, warning: 0, note: 0 })).toBeNull();
  });

  it("count every problem, toned by the worst", () => {
    expect(problemsBadge({ error: 1, warning: 2, note: 3 })).toMatchObject({
      text: "6",
      tone: "error",
    });
    expect(problemsBadge({ error: 0, warning: 2, note: 3 })).toMatchObject({
      text: "5",
      tone: "warning",
    });
    expect(problemsBadge({ error: 0, warning: 0, note: 1 })).toMatchObject({
      text: "1",
      tone: "note",
    });
  });

  it("show the history's place only when there are steps to redo", () => {
    expect(historyBadge({ position: 3, past: 3, future: 0 })).toBeNull();
    expect(historyBadge({ position: 3, past: 3, future: 2 })).toMatchObject({
      text: "3/5",
    });
  });

  it("show the map's wait, then its failures, then its loading", () => {
    expect(tilesBadge(null)).toBeNull();
    expect(tilesBadge(LOAD)).toBeNull();
    expect(tilesBadge({ ...LOAD, waiting: 4 })).toMatchObject({
      text: "4",
      tone: "busy",
    });
    expect(tilesBadge({ ...LOAD, waiting: 4, failed: 2 })).toMatchObject({
      text: "2",
      tone: "error",
    });
    expect(
      tilesBadge({ ...LOAD, waiting: 4, failed: 2, ceilingWaitS: 3.2 }),
    ).toMatchObject({ text: "0:04", tone: "warning" });
    expect(countdown(75.2)).toBe("1:16");
    expect(countdown(0)).toBe("0:00");
  });

  it("show slow frames only when there were some", () => {
    expect(perfBadge(0)).toBeNull();
    expect(perfBadge(3)).toMatchObject({ text: "3", tone: "warning" });
  });
});

describe("the panel's height", () => {
  it("is clamped between its least and the view less a margin", () => {
    expect(clampHeight(10, 800)).toBe(PANEL_HEIGHT.min);
    expect(clampHeight(500, 800)).toBe(500);
    expect(clampHeight(900, 800)).toBe(800 - PANEL_HEIGHT.topMargin);
  });

  it("starts at what was kept, at most half the view (but 120 px)", () => {
    expect(startHeight(null, 800)).toBe(PANEL_HEIGHT.default);
    expect(startHeight(300, 800)).toBe(300);
    expect(startHeight(600, 800)).toBe(400);
    expect(startHeight(600, 200)).toBe(PANEL_HEIGHT.startFloor);
  });

  it("closes when dragged low, maximises when dragged near the top", () => {
    expect(dragged(60, 800)).toEqual({ kind: "close" });
    expect(dragged(780, 800)).toEqual({ kind: "max" });
    expect(dragged(300, 800)).toEqual({ kind: "height", heightPx: 300 });
  });

  // Why: whatever the drag or the view, a height it keeps is a usable one.
  it("keeps any dragged height inside the clamp (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: 0, max: 4000, noNaN: true }),
        (h, main) => {
          const out = dragged(h, main);
          const kept = out.kind === "height" ? out.heightPx : null;
          expect(kept === null || kept === clampHeight(kept, main)).toBe(true);
          const start = startHeight(h, main);
          expect(start).toBeGreaterThanOrEqual(PANEL_HEIGHT.min);
        },
      ),
    );
  });
});

describe("what the browser kept", () => {
  it("reads a height and a tab, and nothing else", () => {
    expect(readSaved(JSON.stringify({ h: 300, tab: "history" }))).toEqual({
      heightPx: 300,
      tab: "history",
    });
    for (const bad of [
      null,
      "",
      "{",
      "[]",
      JSON.stringify({ h: "x", tab: "nope" }),
      JSON.stringify({ h: Infinity }),
    ]) {
      expect(readSaved(bad)).toEqual({ heightPx: null, tab: "problems" });
    }
  });
});

describe("toggled", () => {
  const closed: PanelState = { open: false, tab: "problems", max: false };

  it("opens on a tab, switches tabs, and closes on its own tab", () => {
    const opened = toggled(closed, "history");
    expect(opened).toEqual({ open: true, tab: "history", max: false });
    expect(toggled(opened, "perf")).toEqual({
      open: true,
      tab: "perf",
      max: false,
    });
    expect(toggled(opened, "history")).toEqual({
      open: false,
      tab: "history",
      max: false,
    });
  });

  it("opens or closes on the last tab without one (Ctrl+J)", () => {
    const opened = toggled({ ...closed, tab: "tiles" });
    expect(opened).toEqual({ open: true, tab: "tiles", max: false });
    expect(toggled({ ...opened, max: true })).toEqual({
      open: false,
      tab: "tiles",
      max: false,
    });
  });
});

describe("historyRows", () => {
  const step = (what: string) => ({ what });

  it("lists the steps newest first, the current one marked, the undone above it", () => {
    const rows = historyRows({
      past: [step("Moved A"), step("Named B")],
      future: [step("Added C"), step("Deleted D")],
      position: 2,
      savedAt: 1,
    });
    // future.at(-1) is the next redo: one step ahead.
    expect(rows.map((r) => [r.what, r.state, r.steps, r.saved])).toEqual([
      ["Added C", "undone", 2, false],
      ["Deleted D", "undone", 1, false],
      ["Named B", "current", 0, false],
      ["Moved A", "done", -1, true],
      ["Opened the tour", "done", -2, false],
    ]);
  });

  it("marks the opened tour current before any edit", () => {
    expect(
      historyRows({ past: [], future: [], position: 0, savedAt: null }),
    ).toEqual([
      {
        what: "Opened the tour",
        state: "current",
        steps: 0,
        saved: false,
        step: null,
      },
    ]);
  });

  // Why: the History rows show how long ago each step was made, and the
  // panel reads that time by the step itself; a row pointing at the wrong
  // step would show another edit's time.
  it("carries each row's own step, none for the view it starts from", () => {
    const past = [step("Moved A"), step("Named B")];
    const future = [step("Added C")];
    const rows = historyRows({ past, future, position: 2, savedAt: null });
    expect(rows.map((r) => r.step)).toEqual([
      future[0],
      past[1],
      past[0],
      null,
    ]);
    expect(rows[1]?.step).toBe(past[1]);
  });

  it("names the oldest kept view when older steps were dropped", () => {
    const rows = historyRows({
      past: [step("Moved A")],
      future: [],
      position: 40,
      savedAt: "elsewhere",
    });
    expect(rows.at(-1)?.what).toBe("Earlier steps");
    expect(rows.some((r) => r.saved)).toBe(false);
  });

  // Why: a click on a row takes exactly its `steps` (undo when negative)
  // and lands on that row's view: the rows' positions are distinct and
  // the current one is the only one at 0.
  it("gives each row a distinct step count, one of them 0 (property)", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 30 }),
        fc.nat({ max: 30 }),
        fc.nat({ max: 200 }),
        (past, future, extra) => {
          const rows = historyRows({
            past: Array.from({ length: past }, (_, i) => step(String(i))),
            future: Array.from({ length: future }, (_, i) => step(String(i))),
            position: past + extra,
            savedAt: null,
          });
          expect(rows).toHaveLength(past + future + 1);
          const steps = rows.map((r) => r.steps);
          expect(new Set(steps).size).toBe(steps.length);
          expect(rows.filter((r) => r.state === "current")).toHaveLength(1);
          expect(rows.find((r) => r.state === "current")?.steps).toBe(0);
          expect(steps).toEqual([...steps].sort((a, b) => b - a));
        },
      ),
    );
  });
});

describe("withNewFrames", () => {
  // Why: the chart is fed five times a second from the view's last 60
  // intervals; taking them all each time would draw every frame many
  // times over, and a view that drew more than 60 frames between looks
  // must not be asked for intervals it no longer has.
  it("takes only the intervals timed since the last look", () => {
    expect(withNewFrames([1, 2], [3, 4, 5], 10, 8)).toEqual([1, 2, 4, 5]);
    expect(withNewFrames([1], [3, 4], 10, 10)).toEqual([1]);
    expect(withNewFrames([], [3, 4], 100, 0)).toEqual([3, 4]);
    expect(withNewFrames([1, 2, 3], [4, 5], 2, 0, 3)).toEqual([3, 4, 5]);
  });
});

describe("minutesAgo", () => {
  // Why: the History rows say how long ago a step was made, as the chosen
  // layout does: under a minute is "just now", then whole minutes, never a
  // negative age from a clock that stepped back.
  it("says just now under a minute, then whole minutes", () => {
    expect(minutesAgo(0)).toBe("just now");
    expect(minutesAgo(59_999)).toBe("just now");
    expect(minutesAgo(60_000)).toBe("1 min ago");
    expect(minutesAgo(5 * 60_000 + 59_000)).toBe("5 min ago");
    expect(minutesAgo(-5_000)).toBe("just now");
    expect(minutesAgo(Number.NaN)).toBe("just now");
  });
});
