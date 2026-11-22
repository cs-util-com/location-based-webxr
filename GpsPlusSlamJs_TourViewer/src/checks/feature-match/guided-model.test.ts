import { describe, expect, it } from "vitest";

import {
  featureMatchActions as A,
  featureMatchReducer,
  initialFeatureMatchState,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import { endView, pairRows, planPairOf, runView } from "./guided-model";
import type { SavedFrame } from "./bench-export";
import type { PhotoMeta } from "./run-plan";

const run = (
  actions: readonly FeatureMatchAction[],
  s: FeatureMatchState = initialFeatureMatchState({ session: "s1" }),
): FeatureMatchState => actions.reduce(featureMatchReducer, s);

const photo = (id: string, greyMean = 120): PhotoMeta => ({
  id,
  width: 640,
  height: 480,
  source: { width: 1280, height: 720 },
  greyMean,
});
const shot = (slot: string, which: "a" | "b", mean = 120): FeatureMatchAction =>
  A.planPhotoTaken({ slot, which, photo: photo(`${slot}-${which}`, mean) });

// Why this test matters: the guided view renders only what this model says,
// so every rule of the run screen (which photo is due, what the big button
// does, which step is lit) is pinned here without a DOM.
describe("runView", () => {
  it("starts at photo A of the first pair, with the countdown on the button", () => {
    const v = runView(run([]));
    expect(v.pos).toBe("Pair 1 of 14");
    expect(v.done).toBe(0);
    expect(v.total).toBe(14);
    expect(v.key).toBe("1a");
    expect(v.place).toBe("place 1");
    expect(v.chip).toEqual({ shot: "a", text: "Shot A" });
    expect(v.seq).toEqual({ a: "now", change: "todo", b: "todo" });
    expect(v.primary).toMatchObject({
      mode: "capture",
      label: "Capture A",
      sub: "then 3 s hands off",
      disabled: false,
    });
    expect(v.slots.a).toEqual({
      filled: false,
      retaking: false,
      disabled: true,
      sub: "empty",
    });
    expect(v.reviewing).toBe(false);
    expect(v.ghost).toBe(false);
  });

  it("lights the change and photo B after photo A, and offers the ghost", () => {
    const v = runView(run([shot("1a-s1", "a")]));
    expect(v.chip).toEqual({ shot: "b", text: "Shot B" });
    expect(v.seq).toEqual({ a: "past", change: "now", b: "now" });
    expect(v.primary.label).toBe("Capture B");
    expect(v.slots.a).toMatchObject({
      filled: true,
      disabled: false,
      sub: "retake",
    });
    expect(v.ghost).toBe(true);
  });

  it("says shoots at once with no countdown, and Cancel while one runs", () => {
    const s = run([A.planSettingsChanged({ countdown: 0 })]);
    expect(runView(s).primary.sub).toBe("shoots at once");
    const counting = run([
      A.planSettingsChanged({ countdown: 5 }),
      A.guidedCountSet({ shot: "a", left: 4 }),
    ]);
    const v = runView(counting);
    expect(v.primary).toMatchObject({
      mode: "cancel",
      label: "Cancel",
      sub: "shooting A in 4 s",
    });
    expect(v.slots.a.disabled).toBe(true);
  });

  it("reviews a complete pair and moves on to the next open pair", () => {
    const v = runView(run([shot("1a-s1", "a"), shot("1a-s1", "b")]));
    expect(v.reviewing).toBe(true);
    expect(v.chip).toEqual({ shot: "done", text: "Check" });
    expect(v.note).toEqual({ warn: false, text: "Light check: ok." });
    expect(v.seq).toEqual({ a: "past", change: "past", b: "past" });
    expect(v.primary).toMatchObject({
      mode: "next",
      label: "Next pair",
      sub: "1b: Weaker light",
      index: 1,
    });
    expect(v.done).toBe(1);
  });

  // Why: a failed light check is the one case where the next pair waits:
  // the button still moves on, but its line says to retake first.
  it("warns after a failed light check and points at the retake", () => {
    const s = run([
      A.planMoved(1),
      shot("1b-s1", "a", 120),
      shot("1b-s1", "b", 119),
    ]);
    const v = runView(s);
    expect(v.note.warn).toBe(true);
    expect(v.note.text).toMatch(/not darker/);
    expect(v.primary.sub).toBe("or tap A or B to retake first");
  });

  it("retakes the chosen photo with its own labels", () => {
    const v = runView(
      run([shot("1a-s1", "a"), shot("1a-s1", "b"), A.guidedRetakeToggled("a")]),
    );
    expect(v.chip).toEqual({ shot: "a", text: "Retake A" });
    expect(v.primary.label).toBe("Retake A");
    expect(v.slots.a).toMatchObject({ retaking: true, sub: "retaking" });
    expect(v.seq).toEqual({ a: "now", change: "todo", b: "todo" });
    expect(v.reviewing).toBe(false);
  });

  it("goes to the end after the last pair, or back to a missing one", () => {
    const last = run([A.planMoved(13), shot("4d-s1", "a"), shot("4d-s1", "b")]);
    expect(runView(last).primary).toMatchObject({
      mode: "missing",
      label: "Next missing pair",
      index: 0,
    });
    const keys = [
      "1a",
      "1b",
      "1c",
      "2a",
      "2b",
      "2c",
      "2d",
      "3a",
      "3b",
      "3c",
      "4a",
      "4b",
      "4c",
      "4d",
    ];
    const all = run(
      keys.flatMap((k, i) => [
        A.planMoved(i),
        shot(`${k}-s1`, "a", 120),
        shot(`${k}-s1`, "b", k === "1b" || k === "1c" ? 40 : 120),
      ]),
    );
    expect(runView(all).primary).toMatchObject({
      mode: "finish",
      label: "Finish",
      sub: "all pairs done: download",
    });
  });

  it("disables the button while a run or save goes", () => {
    const s = run([shot("1a-s1", "a"), A.runStarted("speed")]);
    expect(runView(s).primary.disabled).toBe(true);
    expect(runView(s).slots.a.disabled).toBe(true);
  });

  it("names the place only for the light pairs", () => {
    const s = run([A.planSized({ spots: 2, extra: 0 }), A.planMoved(4)]);
    expect(runView(s).key).toBe("1b");
    expect(runView(s).place).toBe("place 2");
    expect(runView(run([A.planMoved(5)])).place).toBe("");
  });
});

describe("pairRows", () => {
  // Why: the pairs sheet is the way to jump to, repeat or skip a pair; each
  // row says the pair, its title and its state in words.
  it("lists every slot with its state and marks the current one", () => {
    const rows = pairRows(run([shot("1a-s1", "a"), A.planMoved(2)]));
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({
      index: 0,
      label: "1a place 1",
      sub: "Same light twice - A only",
      status: "half",
      current: false,
    });
    expect(rows[2]!.current).toBe(true);
    expect(rows[3]!.label).toBe("2a");
    expect(rows[3]!.sub).toBe("Upright twice - missing");
  });
});

describe("endView", () => {
  it("asks for the rest while pairs are missing, and thanks once all are done", () => {
    const some = endView(run([shot("1a-s1", "a"), shot("1a-s1", "b")]));
    expect(some).toMatchObject({
      all: false,
      kicker: "1 of 14 pairs captured",
      title: "You can send what you have.",
      canDownload: true,
    });
    expect(endView(run([])).canDownload).toBe(false);
  });
});

const saved = (name: "A" | "B"): SavedFrame => ({
  name,
  frame: { width: 2, height: 1, rgba: new Uint8ClampedArray(8) },
  source: { width: 2, height: 1 },
});

// Why this test matters: a plan run measures the current pair's two frames
// from the side table; it must refuse a half pair or a frame the side table
// lost (a failed restore), never measure stale pixels.
describe("planPairOf", () => {
  it("returns the current pair's frames once both are in the side table", () => {
    const s = run([shot("1a-s1", "a"), shot("1a-s1", "b")]);
    const frames = new Map([
      ["1a-s1-a", saved("A")],
      ["1a-s1-b", saved("B")],
    ]);
    const p = planPairOf(s, frames);
    expect(p?.slot.key).toBe("1a");
    expect(p?.a.name).toBe("A");
    expect(p?.b.name).toBe("B");
    expect(p?.seq).toBe(s.plan.slots["1a-s1"]!.seq);
  });

  it("is null for a half pair or a frame missing from the side table", () => {
    const half = run([shot("1a-s1", "a")]);
    expect(planPairOf(half, new Map([["1a-s1-a", saved("A")]]))).toBeNull();
    const full = run([shot("1a-s1", "a"), shot("1a-s1", "b")]);
    expect(planPairOf(full, new Map([["1a-s1-a", saved("A")]]))).toBeNull();
  });
});
