import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  featureMatchActions as A,
  featureMatchReducer,
  initialFeatureMatchState,
  MAX_CRASHES,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import {
  deviceSummary,
  endView,
  hasRate,
  measureText,
  introCountdownText,
  isMoving,
  motionStep,
  readyCount,
  runView,
  shotContext,
  shotCounts,
  shotRows,
  STEADY_THRESHOLD,
} from "./guided-model";
import { LIGHT_NOTE, SHOT_WORDS } from "./guided-texts";
import type { DeviceInfo } from "./bench-report";
import { planShots, type PhotoMeta } from "./run-plan";

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
/** A photo of shot `id`, named after it. */
const shot = (id: string, mean = 120): FeatureMatchAction =>
  A.planShotTaken({ shot: id, photo: photo(`p-${id}`, mean) });

const at = (s: FeatureMatchState, id: string): number =>
  planShots(s.plan).findIndex((x) => x.id === id);

// Why this test matters: the guided view renders only what this model says,
// so every rule of the run screen (which shot is due, what the big button
// does, which step is lit) is pinned here without a DOM.
describe("runView", () => {
  it("starts at L1 of the first place, with the countdown on the button", () => {
    const v = runView(run([]));
    expect(v.pos).toBe("Shot 1 of 13");
    expect(v.done).toBe(0);
    expect(v.total).toBe(13);
    expect(v.key).toBe("L1");
    expect(v.title).toBe(SHOT_WORDS.L1.title);
    expect(v.place).toBe("place 1");
    expect(v.chip).toEqual({ shot: "a", text: "Shot L1" });
    expect(v.seq).toEqual({ a: "now", change: "todo", b: "todo" });
    expect(v.steps.change).toBe("This is the scene's first shot.");
    expect(v.primary).toMatchObject({
      mode: "capture",
      label: "Capture L1",
      sub: "then 3 s hands off",
      disabled: false,
    });
    // The first shot has no shot before it.
    expect(v.slots.a).toEqual({ filled: false, disabled: true, sub: "-" });
    expect(v.slots.b).toEqual({ filled: false, disabled: true, sub: "empty" });
    expect(v.reviewing).toBe(false);
    expect(v.ghost).toBe(false);
  });

  // Why: after L1 the run moves to L2 by itself; L1 is the thumb on the
  // left and its photo can be laid over the finder.
  it("moves on to L2 after L1, lights the change and offers the ghost", () => {
    const v = runView(run([shot("light-s1/L1")]));
    expect(v.key).toBe("L2");
    expect(v.chip).toEqual({ shot: "b", text: "Shot L2" });
    expect(v.seq).toEqual({ a: "past", change: "now", b: "now" });
    expect(v.steps.change).toBe(SHOT_WORDS.L2.change);
    expect(v.primary.label).toBe("Capture L2");
    expect(v.slots.a).toEqual({ filled: true, disabled: false, sub: "L1" });
    expect(v.photos).toEqual({ a: "p-light-s1/L1", b: null });
    expect(v.ghost).toBe(true);
  });

  it("says shoots at once with no countdown, and Cancel while one runs", () => {
    const s = run([A.planSettingsChanged({ countdown: 0 })]);
    expect(runView(s).primary.sub).toBe("shoots at once");
    const counting = run([
      A.planSettingsChanged({ countdown: 5 }),
      A.guidedCountSet({ shot: "light-s1/L1", left: 4 }),
    ]);
    const v = runView(counting);
    expect(v.primary).toMatchObject({
      mode: "cancel",
      label: "Cancel",
      sub: "shooting L1 in 4 s",
    });
    expect(v.slots.a.disabled).toBe(true);
  });

  // Why: back on a taken shot the finder shows its photo, the note says
  // what a retake costs, and the button moves on to the next open shot.
  it("reviews a taken shot and names what a retake redoes", () => {
    const s = run([shot("light-s1/L1"), shot("light-s1/L2"), A.planMoved(0)]);
    const v = runView(s);
    expect(v.reviewing).toBe(true);
    expect(v.chip).toEqual({ shot: "done", text: "Check" });
    expect(v.seq).toEqual({ a: "past", change: "past", b: "past" });
    expect(v.slots.b).toEqual({ filled: true, disabled: false, sub: "retake" });
    const redoes = shotContext(s).redoes;
    expect(redoes).toBeGreaterThan(0);
    expect(v.note).toEqual({
      warn: false,
      text: `Photo taken. Check it is sharp. Retaking L1 redoes ${String(redoes)} measurements.`,
    });
    expect(v.primary).toMatchObject({
      mode: "next",
      label: "Next shot",
      sub: `L3: ${SHOT_WORDS.L3.title}`,
      index: 2,
    });
  });

  // Why: a retake of F1 redoes every flat pair: the tester must see the
  // cost before tapping.
  it("says a retake of F1 redoes 7 measurements", () => {
    const s0 = run([]);
    const f1 = at(s0, "flat-s1/F1");
    const v = runView(
      run([A.planMoved(f1), shot("flat-s1/F1"), A.planMoved(f1)]),
    );
    expect(v.key).toBe("F1");
    expect(v.note.text).toContain("Retaking F1 redoes 7 measurements.");
  });

  // Why: a failed light check is the one case where the run does not move
  // on: the shot stays current, the note says why, the button retakes.
  it("stays on a shot whose light check failed and asks for a retake", () => {
    const s = run([shot("light-s1/L1", 120), shot("light-s1/L2", 120)]);
    const v = runView(run([shot("light-s1/L3", 119)], s));
    expect(v.key).toBe("L3");
    expect(v.note.warn).toBe(true);
    expect(v.note.text).toContain(LIGHT_NOTE["not-darker"]);
    expect(v.primary).toMatchObject({ mode: "capture", label: "Retake L3" });
    // A passing light shot says so.
    expect(runView(run([A.planMoved(1)], s)).note).toEqual({
      warn: false,
      text: `${LIGHT_NOTE.ok} Retaking L2 redoes 1 measurement.`,
    });
  });

  // Why: an almost black L1 fails L3's check and no retake of L3 can fix
  // it; the big button leads back to L1, where the fix is.
  it("leads back to L1 when L1 is too dark to dim from", () => {
    const s = run([
      shot("light-s1/L1", 5),
      shot("light-s1/L2", 5),
      shot("light-s1/L3", 2),
    ]);
    const v = runView(s);
    expect(v.key).toBe("L3");
    expect(v.note.text).toContain(LIGHT_NOTE["too-dark-a"]);
    expect(v.primary).toMatchObject({
      mode: "next",
      label: "Back to L1",
      index: 0,
    });
  });

  it("goes back to a missing shot after the last, and finishes once all are taken", () => {
    const s0 = run([]);
    const list = planShots(s0.plan);
    // The run moves to the first open shot by itself; back on the last one
    // the button points there.
    const n = list.length - 1;
    const last = run([A.planMoved(n), shot(list.at(-1)!.id), A.planMoved(n)]);
    expect(runView(last).primary).toMatchObject({
      mode: "missing",
      label: "Next missing shot",
      index: 0,
    });
    const dim = new Set(["light-s1/L3", "light-s1/L4"]);
    const all = run(
      list.flatMap((x, i) => [
        A.planMoved(i),
        shot(x.id, x.id === "light-s1/L4" ? 30 : dim.has(x.id) ? 40 : 120),
      ]),
    );
    expect(runView(all).primary).toMatchObject({
      mode: "finish",
      label: "Finish",
      sub: "all shots done",
    });
  });

  it("disables the button while a run or save goes", () => {
    const s = run([shot("light-s1/L1"), A.runStarted("speed")]);
    expect(runView(s).primary.disabled).toBe(true);
    expect(runView(s).slots.a.disabled).toBe(true);
  });

  it("names the place only for the light shots", () => {
    const s = run([A.planSized({ spots: 2, extra: 0 }), A.planMoved(4)]);
    expect(runView(s).key).toBe("L1");
    expect(runView(s).place).toBe("place 2");
    expect(runView(run([A.planMoved(5)])).place).toBe("");
  });
});

describe("shotRows", () => {
  // Why: the shots sheet is the way to jump to or repeat a shot; each row
  // says the shot, its title and its state in words.
  it("lists every shot with its state and marks the current one", () => {
    const s = run([
      shot("light-s1/L1", 120),
      shot("light-s1/L2", 120),
      shot("light-s1/L3", 119),
    ]);
    const rows = shotRows(s);
    expect(rows).toHaveLength(13);
    expect(rows[0]).toEqual({
      index: 0,
      label: "L1 place 1",
      sub: `${SHOT_WORDS.L1.title} - done`,
      status: "done",
      current: false,
    });
    expect(rows[2]).toMatchObject({ status: "retake", current: true });
    expect(rows[2]!.sub).toBe(`${SHOT_WORDS.L3.title} - retake suggested`);
    expect(rows[4]!.label).toBe("F1");
    expect(rows[4]!.status).toBe("missing");
  });
});

describe("shotCounts and readyCount", () => {
  // Why: the header's "Shots n/13" and the zip's pair count read these.
  it("counts shots with a photo and pairs with both", () => {
    const s = run([
      shot("light-s1/L1"),
      shot("light-s1/L2"),
      shot("flat-s1/F1"),
    ]);
    expect(shotCounts(s)).toEqual({ done: 3, total: 13 });
    expect(readyCount(s)).toBe(1);
    expect(readyCount(run([]))).toBe(0);
  });
});

// Why: the end screen is where the tester decides to send now or wait;
// it must say how far the phone got, about how long the rest takes, and
// that what is not measured goes to the PC (no new element: the lede).
describe("measureText", () => {
  const p = {
    total: 4,
    done: 1,
    failed: 0,
    waiting: 2,
    running: "light-s1/L1-L3",
    stopped: false,
    crashes: 0,
    estimateMs: 150_000,
  };
  it("says the progress, the estimate and that the rest goes to the PC", () => {
    expect(measureText(p)).toBe(
      "Measuring on this phone: 1 of 4 pairs, about 3 min left. You can download now: pairs not measured yet go to the PC.",
    );
    expect(measureText({ ...p, estimateMs: null })).toBe(
      "Measuring on this phone: 1 of 4 pairs. You can download now: pairs not measured yet go to the PC.",
    );
    expect(measureText({ ...p, estimateMs: 20_000 })).toContain(
      "under a minute left",
    );
  });

  it("says when it is finished, stopped, or waits for nothing", () => {
    expect(
      measureText({
        ...p,
        done: 3,
        failed: 1,
        waiting: 0,
        running: null,
        estimateMs: 0,
      }),
    ).toBe(
      "Measured on this phone: 3 of 4 pairs, 1 failed (the PC measures it).",
    );
    expect(
      measureText({
        ...p,
        running: null,
        stopped: true,
        crashes: MAX_CRASHES,
      }),
    ).toBe(
      // Why: the count comes from MAX_CRASHES, so the text cannot drift
      // from the rule that stops the queue.
      `Measuring stopped: the worker crashed ${String(MAX_CRASHES)} times in a row. 1 of 4 pairs measured; the rest go to the PC.`,
    );
    expect(measureText({ ...p, running: null })).toBe(
      "1 of 4 pairs measured on this phone; the rest go to the PC.",
    );
    expect(
      measureText({ ...p, total: 0, done: 0, waiting: 0, running: null }),
    ).toBe("");
  });
});

describe("endView", () => {
  // Why: no new element: the measuring line goes into the lede.
  it("adds the measuring line to the lede when given the progress", () => {
    const pair = run([shot("light-s1/L1"), shot("light-s1/L2")]);
    const p = {
      total: 1,
      done: 1,
      failed: 0,
      waiting: 0,
      running: null,
      stopped: false,
      crashes: 0,
      estimateMs: 0,
    };
    expect(endView(pair).lede).not.toContain("Measured");
    expect(endView(pair, p).lede).toMatch(
      / Measured on this phone: 1 of 1 pairs.$/,
    );
  });

  it("asks for the rest while shots are missing", () => {
    const some = endView(run([shot("light-s1/L1"), shot("light-s1/L2")]));
    expect(some).toMatchObject({
      all: false,
      kicker: "2 of 13 shots taken",
      title: "You can send what you have.",
      canDownload: true,
    });
    expect(endView(run([])).canDownload).toBe(false);
  });

  // Why: the download button and its line say what the zip did, so a
  // tester knows whether the file reached the phone.
  it("labels the download by the zip's phase", () => {
    const pair = run([shot("light-s1/L1"), shot("light-s1/L2")]);
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
      [A.runZipEnded({ phase: "saved", text: "Saved z" })],
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

  // Why this test matters: the views' devicemotion listeners mark motion
  // as seen on a usable reading only; an all-NaN reading tested against
  // null alone made the readout claim "steady" without any measurement.
  it("counts only a finite rate as a reading", () => {
    expect(hasRate(null)).toBe(false);
    expect(hasRate({ alpha: null, beta: null, gamma: null })).toBe(false);
    expect(
      hasRate({ alpha: Number.NaN, beta: Infinity, gamma: -Infinity }),
    ).toBe(false);
    expect(hasRate({ alpha: Number.NaN, beta: 0, gamma: null })).toBe(true);
  });

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
