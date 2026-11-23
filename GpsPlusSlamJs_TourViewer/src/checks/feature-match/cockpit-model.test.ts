import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  downloadLabel,
  handsOffResult,
  instrView,
  meterFill,
  nightOn,
  progressText,
  readoutView,
  retakeView,
  runStatusText,
  sameDrawing,
  segClasses,
  shutterView,
  statusView,
  tileView,
} from "./cockpit-model";
import {
  featureMatchActions as A,
  featureMatchReducer,
  HANDS_OFF_TEXT,
  initialFeatureMatchState,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import { LIGHT_NOTE, SCENE_SETUP, SHOT_WORDS } from "./guided-texts";
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
const camOn = A.cameraChanged(true);
const L1 = "light-s1/L1";
const L2 = "light-s1/L2";
const L3 = "light-s1/L3";

/** Every shot of the default plan taken, the light checks passing. */
const allTaken = (): FeatureMatchAction[] => {
  const list = planShots(run([]).plan);
  const mean = (id: string): number =>
    id === "light-s1/L4" ? 30 : id === L3 ? 40 : 120;
  return list.flatMap((x, i) => [A.planMoved(i), shot(x.id, mean(x.id))]);
};

/** L1, L2 taken and L3 as bright as L1: its light check fails. */
const warnedL3 = (): FeatureMatchState =>
  run([camOn, shot(L1, 120), shot(L2, 120), shot(L3, 120)]);

// Why these tests matter: the cockpit view only copies what this model
// says into its fixed dock, so every rule of the big button, the side
// buttons, the two tiles and the status line is pinned without a DOM.
describe("shutterView", () => {
  it("starts the camera first, with its starting and failed states", () => {
    expect(shutterView(run([]))).toMatchObject({
      mode: "start",
      text: "Start",
      disabled: false,
    });
    expect(shutterView(run([A.cameraStartSet("starting")]))).toMatchObject({
      mode: "start",
      text: "Starting",
      disabled: true,
    });
    expect(shutterView(run([A.cameraStartSet("failed")]))).toMatchObject({
      mode: "start",
      text: "Retry camera",
      disabled: false,
    });
  });

  it("names the shot due and the countdown, then offers to stop the count", () => {
    expect(shutterView(run([camOn]))).toMatchObject({
      mode: "capture",
      text: "L1 in 3 s",
      tone: "",
    });
    expect(
      shutterView(run([camOn, A.planSettingsChanged({ countdown: 0 })])),
    ).toMatchObject({ mode: "capture", text: "Take L1" });
    // The run moves on to L2 by itself; tap mode, so no hands-off wait.
    expect(
      shutterView(
        run([camOn, A.planSettingsChanged({ capture: "tap" }), shot(L1)]),
      ),
    ).toMatchObject({ text: "L2 in 3 s" });
    expect(
      shutterView(run([camOn, A.guidedCountSet({ shot: L1, left: 2 })])),
    ).toMatchObject({ mode: "cancel", text: "Tap to stop", tone: "armed" });
  });

  it("is busy while a run measures or the zip is packed", () => {
    expect(shutterView(run([camOn, A.runStarted("synthetic")]))).toMatchObject({
      mode: "busy",
      text: "Measuring",
      tone: "busy",
      disabled: true,
    });
    const pair = run([camOn, shot(L1), shot(L2)]);
    expect(shutterView(run([A.runZipStarted()], pair))).toMatchObject({
      mode: "busy",
      text: "Saving",
      disabled: true,
    });
  });

  it("offers the retake a failed light check asks for, else the next shot", () => {
    expect(shutterView(warnedL3())).toMatchObject({
      mode: "retake",
      text: "Retake L3",
    });
    const back = run([camOn, shot(L1), shot(L2), A.planMoved(0)]);
    expect(shutterView(back)).toMatchObject({
      mode: "next",
      text: "Next shot",
      index: 2,
    });
  });

  it("says all done at the end, once every shot is taken", () => {
    expect(shutterView(run([camOn, ...allTaken()]))).toMatchObject({
      mode: "save",
      text: "All done",
      tone: "save",
    });
  });
});

describe("retakeView", () => {
  // Why: on an empty shot the side button goes back to the scene's
  // previous shot; on a taken one it takes it again.
  it("goes back to the previous shot, or retakes a taken one", () => {
    const s = run([camOn, A.planSettingsChanged({ capture: "tap" }), shot(L1)]);
    expect(retakeView(s)).toEqual({
      label: "Back to L1",
      disabled: false,
      action: { kind: "back", index: 0 },
    });
    expect(retakeView(run([A.planMoved(0)], s))).toEqual({
      label: "Retake L1",
      disabled: false,
      action: { kind: "shoot" },
    });
  });

  it("is off on a first shot, while busy and while counting", () => {
    const off = { label: "Retake", disabled: true, action: null };
    expect(retakeView(run([camOn]))).toEqual(off);
    const s = run([camOn, shot(L1), shot(L2), A.planMoved(0)]);
    expect(retakeView(run([A.runStarted("speed")], s))).toEqual(off);
    expect(
      retakeView(run([A.guidedCountSet({ shot: L1, left: 3 })], s)),
    ).toEqual(off);
  });
});

describe("tileView", () => {
  it("shows the previous shot and arms the current one", () => {
    const s = run([camOn, A.planSettingsChanged({ capture: "tap" }), shot(L1)]);
    expect(tileView(s)).toEqual({
      a: { state: "taken", text: "L1", disabled: false },
      b: { state: "armed", text: "now", disabled: true },
    });
    const c = run([A.guidedCountSet({ shot: L2, left: 2 })], s);
    expect(tileView(c).b.text).toBe("2 s");
    expect(tileView(c).a.disabled).toBe(true);
    expect(tileView(run([shot(L2), A.planMoved(1)], s)).b).toEqual({
      state: "taken",
      text: "taken",
      disabled: true,
    });
  });

  // Why this test matters: before Start the tile must not read "now", as
  // in the prototype: nothing can be taken until the camera is on.
  it("arms no tile while the camera is off, and has no previous on L1", () => {
    const t = tileView(run([]));
    expect(t.a).toEqual({ state: "", text: "-", disabled: true });
    expect(t.b).toEqual({ state: "", text: "-", disabled: true });
  });
});

describe("instrView", () => {
  it("asks for the camera, then the setup, then the change", () => {
    expect(instrView(run([])).label).toBeNull();
    expect(instrView(run([])).text).toContain("tap Start");
    const first = instrView(run([camOn]));
    expect(first.label).toBe("L1");
    // A scene's first shot says where the scene is set up.
    expect(first.text).toBe(`${SCENE_SETUP.light} ${SHOT_WORDS.L1.capture}`);
    const second = instrView(run([camOn, shot(L1)]));
    expect(second.label).toBe("L2");
    expect(second.text).toBe(
      `${SHOT_WORDS.L2.change} ${SHOT_WORDS.L2.capture}`,
    );
  });

  it("says what a failed light check asks for, and when everything is done", () => {
    expect(instrView(warnedL3()).text).toBe(LIGHT_NOTE["not-darker"]);
    expect(instrView(run([camOn, A.runStarted("synthetic")])).text).toContain(
      "Measuring",
    );
    expect(instrView(run([camOn, ...allTaken()])).text).toMatch(/Download all/);
  });

  // Why: as in the prototype, the instruction marks the word to tap.
  it("marks Start bold while the camera is off", () => {
    const v = instrView(run([]));
    expect(v.bold).toBe("Start");
    expect(v.text).toContain("tap Start");
    expect(instrView(run([camOn])).bold).toBeUndefined();
  });
});

describe("dock lines", () => {
  it("counts good shots, segments and the pairs Download all saves", () => {
    const s = run([camOn, shot(L1), shot(L2)]);
    expect(progressText(s)).toBe("2 / 13");
    expect(downloadLabel(s)).toBe("Download all (1)");
    expect(downloadLabel(run([]))).toBe("Download all");
    expect(segClasses(s).slice(0, 3)).toEqual(["kept", "kept", "cur"]);
    const w = run([shot(L3, 120), A.planMoved(0)], s);
    expect(segClasses(w).slice(0, 3)).toEqual(["cur", "kept", "warn"]);
    // A shot whose light check failed is not counted as done.
    expect(progressText(w)).toBe("2 / 13");
  });

  it("dims the dock only before a dimmed shot is taken", () => {
    expect(nightOn(run([camOn]))).toBe(false);
    expect(nightOn(run([camOn, A.planMoved(2)]))).toBe(true);
    expect(nightOn(run([camOn, A.planMoved(3)]))).toBe(true);
    expect(
      nightOn(run([camOn, A.planMoved(2), shot(L3), A.planMoved(2)])),
    ).toBe(false);
  });

  it("reads stillness, light and the capture mode", () => {
    const s = run([camOn, shot(L1, 99.6), A.planMoved(0)]);
    expect(readoutView(s, { seen: false, moving: false })).toEqual({
      still: { text: "still: -", tone: "" },
      light: { text: "light L1 100", tone: "" },
      mode: { text: "tap, 3 s", tone: "" },
    });
    expect(readoutView(s, { seen: true, moving: true }).still).toEqual({
      text: "moving",
      tone: "wait",
    });
    expect(readoutView(s, { seen: true, moving: false }).still.tone).toBe(
      "good",
    );
    expect(
      readoutView(warnedL3(), { seen: true, moving: false }).light,
    ).toEqual({ text: "light not-darker", tone: "wait" });
  });

  it("puts the newest workflow line in the status, with its tone", () => {
    expect(statusView(run([A.cameraStartSet("failed")]))).toEqual({
      text: "Camera unavailable: tap Retry camera.",
      tone: "bad",
    });
    expect(
      statusView(run([camOn, A.guidedCountSet({ shot: L1, left: 2 })])).text,
    ).toBe("Countdown: L1 in 2 s.");
    expect(statusView(run([camOn])).text).toBe("");
  });
});

describe("cockpit model: status order and the run's own line", () => {
  // Why: the dock's line follows the run that is going, so the speed test
  // never shows the synthetic pair's status.
  it("reads the running kind's own status", () => {
    const syn = run([camOn, A.runStarted("synthetic"), A.runProgressed("s1")]);
    expect(runStatusText(syn)).toBe("running: s1");
    const done = run([A.runFinished({ text: "done: 1" })], syn);
    expect(runStatusText(done)).toBe("");
    const speed = run(
      [A.runStarted("speed"), A.runProgressed("speed 1")],
      done,
    );
    expect(statusView(speed).text).toBe("running: speed 1");
  });

  // Why: the newest line wins in a fixed order, each with its tone; a
  // camera that failed outranks a zip line, a failing photo store all.
  it("orders the status lines and their tones", () => {
    const pair = run([camOn, shot(L1), shot(L2)]);
    const saved = run(
      [A.runZipStarted(), A.runZipEnded({ phase: "saved", text: "Saved z" })],
      pair,
    );
    expect(statusView(saved)).toEqual({ text: "Saved z", tone: "ok" });
    const failed = run(
      [A.runZipStarted(), A.runZipEnded({ phase: "failed", text: "no" })],
      pair,
    );
    expect(statusView(failed)).toEqual({ text: "no", tone: "bad" });
    expect(statusView(run([A.photoStoreChanged(true)], saved)).tone).toBe(
      "bad",
    );
    expect(
      statusView(
        run([A.guidedCountSet({ shot: "light-s1/L3", left: 2 })], saved),
      ).text,
    ).toBe("Countdown: L3 in 2 s.");
    expect(statusView(run([A.cameraStartSet("failed")], pair)).text).toBe(
      "Camera unavailable: tap Retry camera.",
    );
  });

  // Why: the hands-off photo's outcome is what the status line reports;
  // a capture with no picture yet is refused, one that throws failed.
  it("maps a hands-off capture to taken, refused or failed", () => {
    expect(handsOffResult(() => true)).toBe("taken");
    expect(handsOffResult(() => false)).toBe("refused");
    const seen: unknown[] = [];
    expect(
      handsOffResult(
        () => {
          throw new Error("no canvas");
        },
        (e) => seen.push(e),
      ),
    ).toBe("failed");
    expect(seen).toHaveLength(1);
  });
});

describe("cockpit model: the hands-off shot", () => {
  const rest = { alpha: 0.2, beta: -0.1, gamma: 0.3 };
  const samples = (t0: number, ms: number): FeatureMatchAction[] => {
    const out: FeatureMatchAction[] = [];
    for (let t = t0; t <= t0 + ms; t += 20) {
      out.push(A.handsOffSample({ t, rate: rest }));
    }
    return out;
  };
  // L1 taken: the run is on L2, a shot that takes itself once still.
  const armed = run([
    A.planSettingsChanged({ countdown: 0 }),
    camOn,
    shot(L1),
    A.handsOffArmed(0),
  ]);
  const waiting = run(samples(0, 500), armed);
  const taking = run(samples(520, 1200), waiting);

  // Why: every hands-off state shows itself on the big button, and while
  // it waits the button still takes the shot at a tap: the way out.
  it("shows the wait on the big button, which still takes the shot at a tap", () => {
    expect(shutterView(armed)).toMatchObject({
      mode: "capture",
      text: "Waiting",
      tone: "armed",
      disabled: false,
    });
    expect(shutterView(waiting)).toMatchObject({
      mode: "capture",
      text: "Hold still",
    });
    expect(shutterView(taking)).toMatchObject({
      mode: "busy",
      text: "Taking L2",
      disabled: true,
    });
    for (const r of ["refused", "failed"] as const) {
      expect(shutterView(run([A.handsOffShot(r)], taking))).toMatchObject({
        mode: "capture",
        text: "Take L2",
        disabled: false,
      });
    }
  });

  // Why: the status line says what the wait is doing and, after a refusal
  // or a lost sensor, that a tap takes the shot instead.
  it("says on the status line what the wait does", () => {
    expect(statusView(armed).text).toBe(HANDS_OFF_TEXT.still);
    expect(statusView(waiting).text).toBe(HANDS_OFF_TEXT.waiting);
    expect(statusView(run([A.handsOffShot("refused")], taking))).toEqual({
      text: HANDS_OFF_TEXT.refused,
      tone: "bad",
    });
    expect(statusView(run([A.handsOffShot("taken")], taking)).tone).toBe("ok");
    const lost = run(
      [A.handsOffSample({ t: 5000, rate: null })],
      run(samples(0, 100), armed),
    );
    expect(statusView(lost).text).toBe(HANDS_OFF_TEXT.lost);
  });

  // Why: the meter ring fills with the dwell while the phone rests, and
  // with the countdown otherwise; it never leaves 0..1.
  it("fills the meter with the dwell or the countdown", () => {
    expect(meterFill(armed)).toBe(0);
    const half = meterFill(waiting);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.5);
    const count = run([camOn, A.guidedCountSet({ shot: L1, left: 3 })]);
    expect(meterFill(count)).toBeCloseTo(1 / 4);
    expect(meterFill(run([camOn]))).toBe(0);
  });

  // Why: a reading at 60 Hz writes the store each time; the page redraws
  // only when what it shows changes (the phase, or the meter by 1/50).
  it("redraws a run of still readings only when the meter moves", () => {
    let drawn = waiting;
    let draws = 0;
    let s = waiting;
    for (const a of samples(520, 1200)) {
      s = featureMatchReducer(s, a);
      if (!sameDrawing(drawn, s)) {
        drawn = s;
        draws += 1;
      }
    }
    expect(draws).toBeGreaterThan(10);
    expect(draws).toBeLessThanOrEqual(52);
    expect(sameDrawing(waiting, waiting)).toBe(true);
    expect(sameDrawing(waiting, run([A.cameraChanged(false)], waiting))).toBe(
      false,
    );
  });

  // Why: the mode readout says "auto" only while the shot is really
  // waiting to take itself, so a tester never waits for a photo that will
  // not come.
  it("reads auto while the shot waits to take itself", () => {
    const motion = { seen: true, moving: false };
    expect(readoutView(armed, motion).mode.text).toBe("auto");
    expect(
      readoutView(run([A.handsOffShot("failed")], taking), motion).mode.text,
    ).toBe("tap");
  });
});

// Why this property matters: the dock never resizes, so whatever the state,
// every box gets a text it can show and the big button keeps one mode.
describe("cockpit model property", () => {
  const SHOTS = [L1, L2, L3, "flat-s1/F1", "flat-s1/F2"];
  const actionArb: fc.Arbitrary<FeatureMatchAction> = fc.oneof(
    fc.constant(camOn),
    fc.constant(A.cameraChanged(false)),
    fc.integer({ min: 0, max: 15 }).map((i) => A.planMoved(i)),
    fc
      .tuple(fc.constantFrom(...SHOTS), fc.integer({ min: 0, max: 255 }))
      .map(([id, m]) => shot(id, m)),
    fc.constantFrom(...SHOTS).map((id) => A.planShotLost(id)),
    fc
      .constantFrom(...SHOTS)
      .map((id) => A.guidedCountSet({ shot: id, left: 2 })),
    fc.constant(A.guidedCountSet(null)),
    fc.constant(A.runStarted("synthetic")),
    fc.constant(A.runFinished({ text: "done" })),
    fc.constant(A.runZipStarted()),
    fc.constant(A.runZipEnded({ phase: "saved", text: "ok" })),
    fc.integer({ min: 0, max: 5000 }).map((t) => A.handsOffArmed(t)),
    fc
      .tuple(fc.integer({ min: 0, max: 8000 }), fc.integer({ min: 0, max: 90 }))
      .map(([t, r]) =>
        A.handsOffSample({ t, rate: { alpha: r, beta: 0, gamma: 0 } }),
      ),
    fc
      .constantFrom<"taken" | "refused" | "failed">(
        "taken",
        "refused",
        "failed",
      )
      .map((r) => A.handsOffShot(r)),
    fc.constant(A.handsOffPaused()),
  );
  it("always yields a shutter text, one segment per shot and a meter in 0..1", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const s = run(actions);
        expect(shutterView(s).text.length).toBeGreaterThan(0);
        expect(segClasses(s)).toHaveLength(planShots(s.plan).length);
        expect(segClasses(s).filter((c) => c === "cur")).toHaveLength(1);
        const rv = retakeView(s);
        expect(rv.label.length).toBeGreaterThan(0);
        expect(rv.disabled).toBe(rv.action === null);
        expect(downloadLabel(s)).toMatch(/^Download all( \(\d+\))?$/);
        const fill = meterFill(s);
        expect(fill).toBeGreaterThanOrEqual(0);
        expect(fill).toBeLessThanOrEqual(1);
      }),
    );
  });
});
