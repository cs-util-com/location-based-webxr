import { describe, expect, it } from "vitest";

import {
  doneCount,
  MAX_EXTRA,
  nextStep,
  runZipName,
  shotDue,
  slotList,
  slotStatus,
  summaryText,
  type PairLike,
} from "./plan-slots";

const shot = { greyMean: 100 };
const pair = (
  a: boolean,
  b: boolean,
  light: PairLike["light"] = null,
): PairLike => ({ a: a ? shot : null, b: b ? shot : null, light });

describe("the run's slot list", () => {
  // Why: the light pairs are repeated per place before the rest, and the
  // ids name the files' folders; a change here renames every download.
  it("lists the light pairs per place, then the other pairs, then the extras", () => {
    const ids = slotList(2, 1).map((s) => s.id);
    expect(ids).toEqual([
      "1a-s1",
      "1b-s1",
      "1c-s1",
      "1a-s2",
      "1b-s2",
      "1c-s2",
      "2a-s1",
      "2b-s1",
      "2c-s1",
      "2d-s1",
      "3a-s1",
      "3b-s1",
      "3c-s1",
      "4a-s1",
      "4b-s1",
      "4c-s1",
      "4d-s1",
      "x1-s1",
    ]);
    expect(slotList(2, 1).at(-1)).toEqual({ id: "x1-s1", key: "x", spot: 1 });
    expect(slotList(1, 0)).toHaveLength(14);
  });

  // Why: the counts come from buttons and could be anything after a bug.
  it("clamps the places to 1-3 and the extras to 0 to the cap", () => {
    expect(slotList(0, -2)).toEqual(slotList(1, 0));
    expect(slotList(9, 0)).toEqual(slotList(3, 0));
    expect(slotList(Number.NaN, Number.NaN)).toEqual(slotList(1, 0));
    expect(slotList(1, MAX_EXTRA + 5)).toHaveLength(14 + MAX_EXTRA);
  });
});

describe("a slot's status and the shot due", () => {
  // Why: the pairs sheet's dots and the progress count read these.
  it("is missing, half, done or retake", () => {
    expect(slotStatus(undefined)).toBe("missing");
    expect(slotStatus(pair(false, false))).toBe("missing");
    expect(slotStatus(pair(true, false))).toBe("half");
    expect(slotStatus(pair(true, true))).toBe("done");
    expect(slotStatus(pair(true, true, "ok"))).toBe("done");
    expect(slotStatus(pair(true, true, "not-darker"))).toBe("retake");
  });

  // Why: the done count includes pairs whose light check asks for a retake:
  // they are complete, only not good.
  it("counts done and retake pairs as complete", () => {
    const list = slotList(1, 0);
    expect(
      doneCount(list, {
        "1a-s1": pair(true, true),
        "1b-s1": pair(true, true, "changed"),
        "1c-s1": pair(true, false),
        "9z-s1": pair(true, true),
      }),
    ).toBe(2);
  });

  // Why: A comes first, B after it, and a retake replaces either.
  it("asks for A, then B, then nothing; a retake asks for its photo", () => {
    expect(shotDue(undefined, null)).toBe("a");
    expect(shotDue(pair(true, false), null)).toBe("b");
    expect(shotDue(pair(true, true), null)).toBeNull();
    expect(shotDue(pair(true, true), "a")).toBe("a");
    expect(shotDue(pair(true, false), "a")).toBe("a");
  });
});

describe("the step after a complete pair", () => {
  const list = slotList(1, 0);

  // Why: the primary button walks the protocol in order.
  it("goes to the next pair not done after the current one", () => {
    expect(nextStep(list, { "1a-s1": pair(true, true) }, 0)).toEqual({
      kind: "next",
      index: 1,
    });
    expect(
      nextStep(
        list,
        { "1a-s1": pair(true, true), "1b-s1": pair(true, true) },
        0,
      ),
    ).toEqual({ kind: "next", index: 2 });
  });

  // Why: pairs skipped earlier are offered before the end.
  it("goes back to the first open pair once the last one is done", () => {
    const pairs = Object.fromEntries(
      list.slice(1).map((s) => [s.id, pair(true, true)]),
    );
    expect(nextStep(list, pairs, list.length - 1)).toEqual({
      kind: "missing",
      index: 0,
    });
  });

  // Why: a pair whose light check failed is where the walk stops, so the
  // tester sees the warning; it is complete, so it never blocks the end.
  it("stops at a retake on the way, and ends past one", () => {
    const pairs = Object.fromEntries(list.map((s) => [s.id, pair(true, true)]));
    const withRetake = { ...pairs, "1c-s1": pair(true, true, "changed") };
    expect(nextStep(list, withRetake, 0)).toEqual({ kind: "next", index: 2 });
    expect(nextStep(list, withRetake, list.length - 1)).toEqual({
      kind: "end",
    });
  });

  // Why: the current pair, still open, is not offered as "next missing".
  it("ends rather than pointing back at the current pair", () => {
    const pairs = Object.fromEntries(
      list.slice(1).map((s) => [s.id, pair(true, true)]),
    );
    expect(nextStep(list, pairs, 0)).toEqual({ kind: "end" });
  });

  // Why: with everything complete the run ends on the download screen.
  it("ends when every pair is complete", () => {
    const pairs = Object.fromEntries(list.map((s) => [s.id, pair(true, true)]));
    expect(nextStep(list, pairs, 3)).toEqual({ kind: "end" });
  });
});

describe("the summary to paste back", () => {
  // Why: this is what the tester sends; it must say what is missing and
  // hold no time, place or name.
  it("names the complete, missing and light-checked pairs and the file", () => {
    const list = slotList(1, 0);
    const pairs = Object.fromEntries(
      list
        .slice(0, 12)
        .map((s) => [s.id, pair(true, true, s.key === "1b" ? "ok" : null)]),
    );
    const text = summaryText({
      session: "ab12cd34",
      spots: 1,
      list,
      pairs: { ...pairs, "1a-s1": pair(true, true, "changed") },
      shots: 26,
      downloads: 0,
      device: "Android 15, Chrome 140, 8 cores",
    });
    expect(text.split("\n")).toEqual([
      "Feature matcher photo test - summary",
      "Session: ab12cd34",
      "Pairs complete: 12 of 14 (light tests at 1 place)",
      "Missing: 4c-s1, 4d-s1",
      "Light checks: 1a-s1 changed, 1b-s1 ok",
      "Extra shots (retakes): 2",
      "File: feature-match-run-ab12cd34.zip (not downloaded yet)",
      "Phone: Android 15, Chrome 140, 8 cores",
      "No location, no time and no names are included.",
    ]);
  });

  it("says places in the plural and drops the not-downloaded note", () => {
    const text = summaryText({
      session: "s",
      spots: 2,
      list: slotList(2, 0),
      pairs: {},
      shots: 0,
      downloads: 1,
      device: "d",
    });
    expect(text).toContain("Pairs complete: 0 of 17 (light tests at 2 places)");
    expect(text).toContain("Missing: 1a-s1, 1b-s1");
    expect(text).toContain("Light checks: -");
    expect(text).toContain("Extra shots (retakes): 0");
    expect(text).toContain("File: feature-match-run-s.zip\n");
  });

  // Why: the zip name carries the session token only, never a time.
  it("names the run's zip by the session", () => {
    expect(runZipName("ab12cd34")).toBe("feature-match-run-ab12cd34.zip");
  });
});
