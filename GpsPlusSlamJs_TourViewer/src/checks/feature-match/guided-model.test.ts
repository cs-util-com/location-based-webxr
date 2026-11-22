import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  featureMatchActions as A,
  featureMatchReducer,
  initialFeatureMatchState,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import {
  deviceSummary,
  introCountdownText,
  endView,
  isMoving,
  measureText,
  motionStep,
  pairRows,
  planPairOf,
  runPairs,
  runView,
  STEADY_THRESHOLD,
} from "./guided-model";
import type { DeviceInfo } from "./bench-report";
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

  // Why: the download button and its line say what the zip did, so a
  // tester knows whether the file reached the phone.
  it("labels the download by the zip's phase", () => {
    const pair = run([shot("1a-s1", "a"), shot("1a-s1", "b")]);
    expect(endView(pair).download).toEqual({
      label: "Download all",
      text: "One zip with 1 pair, saved to this phone only.",
      tone: "",
    });
    const going = run([A.runZipStarted()], pair);
    expect(endView(going).download).toEqual({
      label: "Preparing the zip...",
      text: "Packing the photos. Keep this page open.",
      tone: "",
    });
    expect(endView(going).canDownload).toBe(false);
    const saved = run(
      [
        A.runZipEnded({ phase: "saved", text: "Saved z" }),
        A.planRunDownloaded(),
      ],
      going,
    );
    expect(endView(saved).download).toEqual({
      label: "Download again",
      text: "Saved z",
      tone: "ok",
    });
    const failed = run([A.runZipEnded({ phase: "failed", text: "no" })], going);
    expect(endView(failed).download).toEqual({
      label: "Download all",
      text: "no",
      tone: "err",
    });
    const closed = run(
      [A.runZipEnded({ phase: "idle", text: "closed" })],
      going,
    );
    expect(endView(closed).download.text).toBe("closed");
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

// Why this test matters: Download all packs every complete pair under its
// own file names; a pair whose frame is gone must stop the zip rather than
// send a pair with one photo or none.
describe("runPairs", () => {
  const framesOf = (ids: readonly string[]): Map<string, SavedFrame> =>
    new Map(ids.map((id) => [id, saved(id.endsWith("a") ? "A" : "B")]));

  it("lists every complete pair in run order with its file names", () => {
    const s = run([
      shot("2a-s1", "a"),
      shot("2a-s1", "b"),
      shot("1a-s1", "a"),
      shot("1a-s1", "b"),
      shot("1b-s1", "a"),
    ]);
    const frames = framesOf([
      "2a-s1-a",
      "2a-s1-b",
      "1a-s1-a",
      "1a-s1-b",
      "1b-s1-a",
    ]);
    const pairs = runPairs(s, frames);
    expect(pairs.map((p) => p.slot.id)).toEqual(["1a-s1", "2a-s1"]);
    const first = pairs[0]!;
    expect(first.tag).toMatchObject({ pair: "1a", spot: 1, sequence: 2 });
    expect(first.names.A).toBe(
      "feature-match-02-1a-s1-light-control-same-light-frame-a.png",
    );
    expect(first.light).toBe(s.plan.slots["1a-s1"]!.light);
  });

  it("names the other pairs apart and throws on a missing frame", () => {
    const s = run([
      A.planSized({ spots: 1, extra: 2 }),
      shot("x1-s1", "a"),
      shot("x1-s1", "b"),
      shot("x2-s1", "a"),
      shot("x2-s1", "b"),
    ]);
    const all = framesOf(["x1-s1-a", "x1-s1-b", "x2-s1-a", "x2-s1-b"]);
    const names = runPairs(s, all).flatMap((p) => Object.values(p.names));
    expect(new Set(names).size).toBe(names.length);
    all.delete("x2-s1-b");
    expect(() => runPairs(s, all)).toThrow("photo B of x2-s1 is not loaded");
  });
});

// Why this test matters: the summary's phone line is pasted into a chat;
// it names the model, the OS version and the cores, and nothing else.
describe("deviceSummary", () => {
  const d: DeviceInfo = {
    userAgent: "UA",
    model: "Pixel 9",
    platformVersion: "16.0.0",
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    crossOriginIsolated: false,
    jspi: true,
    screen: "412x915",
    webgpu: "none",
  };
  it("names model, OS version and cores, with dashes for the unknown", () => {
    expect(deviceSummary(d)).toBe("Pixel 9, OS 16.0.0, 8 cores");
    expect(
      deviceSummary({
        ...d,
        model: null,
        platformVersion: null,
        hardwareConcurrency: null,
      }),
    ).toBe("unknown model, OS -, - cores");
  });
});

// Why this test matters: the steady chip tells the tester to keep still
// before a photo. Its level is a smoothed rotation rate (degrees per
// second, ~60 readings a second). The profiles below are assumptions, not
// recordings: a phone on a table (0.3 deg/s of sensor noise), held still
// in the hand (2-3 deg/s), the shake of a tap (a 40 deg/s spike that dies
// out over about a third of a second) and a slow pan (15 deg/s).
describe("the steady hint", () => {
  const level = (rates: readonly number[]): number[] => {
    const out: number[] = [];
    let l = 0;
    for (const r of rates) {
      l = motionStep(l, { alpha: r, beta: 0, gamma: 0 });
      out.push(l);
    }
    return out;
  };
  const table = Array.from({ length: 120 }, (_, i) => 0.3 * Math.sin(i));
  const hand = Array.from({ length: 120 }, (_, i) => 2 + Math.sin(i / 3));
  const pan = Array.from({ length: 120 }, () => 15);
  const tap = [
    ...Array.from({ length: 20 }, (_, i) => 40 * Math.exp(-i / 6)),
    ...hand,
  ];
  const settledAfter = (threshold: number): number =>
    level(tap).findIndex((l, i) => i > 0 && l <= threshold);

  it("ignores a reading without a rotation rate", () => {
    expect(motionStep(5, null)).toBe(5);
    expect(motionStep(5, { alpha: null, beta: null, gamma: null })).toBe(5);
  });

  // Why: one NaN reading would latch the smoothed level to NaN for good
  // (NaN > threshold is false), pinning the chip to "steady" and hiding
  // the "phone moved during countdown" note. A value that is not a finite
  // number counts as missing.
  it("ignores rotation rates that are not finite numbers", () => {
    expect(
      motionStep(5, { alpha: Number.NaN, beta: Infinity, gamma: -Infinity }),
    ).toBe(5);
    expect(motionStep(5, { alpha: Number.NaN, beta: 10, gamma: null })).toBe(6);
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            alpha: fc.oneof(fc.double(), fc.constant(null)),
            beta: fc.oneof(fc.double(), fc.constant(null)),
            gamma: fc.oneof(fc.double(), fc.constant(null)),
          }),
          { maxLength: 30 },
        ),
        (readings) => {
          let l = 0;
          for (const r of readings) l = motionStep(l, r);
          return Number.isFinite(l) || l === 0;
        },
      ),
    );
  });

  // The sweep: every threshold from 3 to 12 calls the table and the hand
  // steady and the pan moving (the hand peaks at about 2.6); the threshold
  // only moves how long a tap reads moving: 28 readings at 3, 17 at 6, 11
  // at 12. 6 sits at twice the hand peak, short of the pan by half.
  it("keeps the verdicts across thresholds 3 to 12, and 6 has margin", () => {
    for (let t = 3; t <= 12; t++) {
      expect(level(table).every((l) => l <= t)).toBe(true);
      expect(
        level(hand)
          .slice(30)
          .every((l) => l <= t),
      ).toBe(true);
      expect(
        level(pan)
          .slice(30)
          .every((l) => l > t),
      ).toBe(true);
    }
    expect(STEADY_THRESHOLD).toBe(6);
    expect(isMoving(6.01)).toBe(true);
    expect(isMoving(6)).toBe(false);
    // About 0.3 s to settle at 6, slower at a lower threshold.
    expect(settledAfter(6)).toBeGreaterThan(10);
    expect(settledAfter(6)).toBeLessThan(30);
    expect(settledAfter(4)).toBeGreaterThan(settledAfter(6));
    expect(settledAfter(12)).toBeLessThan(settledAfter(6));
  });
});

// Why this test matters: a finished plan run stays in the state after a
// move, so the measure sheet of another pair must not show its "done" line.
describe("measureText", () => {
  it("shows a run's status only on the pair it measured", () => {
    const done = run([
      shot("1a-s1", "a"),
      shot("1a-s1", "b"),
      A.runStarted("plan"),
      A.runFinished({ text: "done: 1 methods", resultsId: "r1" }),
    ]);
    expect(measureText(done, null)).toBe("done: 1 methods");
    const moved = run([A.planMoved(1)], done);
    expect(measureText(moved, null)).toBe(
      "the current pair has no two photos yet",
    );
    expect(measureText(run([A.planMoved(0)], moved), null)).toBe(
      "done: 1 methods",
    );
    expect(measureText(run([]), null)).toBe(
      "the current pair has no two photos yet",
    );
  });
});

// Why this test matters: the intro's "Keep the phone still" fact named a
// fixed 3 s countdown with beeps; with the countdown at 5 s, off, or the
// sound off it told the tester something the page then did not do.
describe("introCountdownText", () => {
  it("follows the countdown and sound settings", () => {
    expect(introCountdownText({ countdown: 3, sound: true })).toBe(
      "A tap shakes the phone, so each photo is taken 3 seconds after your tap, with a beep per second. Hands off until the click.",
    );
    expect(introCountdownText({ countdown: 5, sound: false })).toBe(
      "A tap shakes the phone, so each photo is taken 5 seconds after your tap. Hands off until the click.",
    );
    const off = introCountdownText({ countdown: 0, sound: true });
    expect(off).toContain("the countdown is off");
    expect(off).not.toMatch(/\d seconds/);
  });
});
