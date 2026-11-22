import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  downloadCount,
  instrView,
  meterFill,
  nextAfterPair,
  nightOn,
  progressText,
  readoutView,
  retakeView,
  segClasses,
  shutterView,
  statusView,
  tileView,
  warnShot,
} from "./cockpit-model";
import {
  featureMatchActions as A,
  featureMatchReducer,
  initialFeatureMatchState,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
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
const camOn = A.cameraChanged(true);

// Why these tests matter: the cockpit view only copies what this model
// says into its fixed dock, so every rule of the big button, the side
// buttons, the A and B tiles and the status line is pinned without a DOM.
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

  it("names the photo due and the countdown, then offers to stop the count", () => {
    expect(shutterView(run([camOn]))).toMatchObject({
      mode: "capture",
      text: "A in 3 s",
      shot: "a",
      tone: "",
    });
    expect(
      shutterView(run([camOn, A.planSettingsChanged({ countdown: 0 })])),
    ).toMatchObject({ mode: "capture", text: "Take A" });
    expect(shutterView(run([camOn, shot("1a-s1", "a")]))).toMatchObject({
      text: "B in 3 s",
      shot: "b",
    });
    expect(
      shutterView(run([camOn, A.guidedCountSet({ shot: "a", left: 2 })])),
    ).toMatchObject({ mode: "cancel", text: "Tap to stop", tone: "armed" });
  });

  it("is busy while a run measures or a pair is saved", () => {
    expect(shutterView(run([camOn, A.runStarted("synthetic")]))).toMatchObject({
      mode: "busy",
      text: "Measuring",
      tone: "busy",
      disabled: true,
    });
    const done = run([camOn, shot("1a-s1", "a"), shot("1a-s1", "b")]);
    expect(shutterView(run([A.planFileSaveStarted()], done))).toMatchObject({
      mode: "busy",
      text: "Saving",
      disabled: true,
    });
  });

  it("offers the retake a failed light check asks for, else the next pair", () => {
    // 1b with B as bright as A: not darker, so B is taken again, dimmer.
    const warned = run([
      camOn,
      A.planMoved(1),
      shot("1b-s1", "a", 120),
      shot("1b-s1", "b", 120),
    ]);
    expect(shutterView(warned)).toMatchObject({
      mode: "retake",
      text: "Retake B",
      shot: "b",
    });
    const ok = run([camOn, shot("1a-s1", "a"), shot("1a-s1", "b")]);
    expect(shutterView(ok)).toMatchObject({
      mode: "next",
      text: "Next pair",
      index: 1,
    });
  });

  it("saves all at the end, once every pair is complete", () => {
    const list = ["1a", "1b", "1c", "2a", "2b", "2c", "2d"]
      .concat(["3a", "3b", "3c", "4a", "4b", "4c", "4d"])
      .map((k) => `${k}-s1`);
    const actions: FeatureMatchAction[] = [camOn];
    list.forEach((id, i) => {
      const dim = id.startsWith("1b") || id.startsWith("1c") ? 40 : 120;
      actions.push(A.planMoved(i), shot(id, "a"), shot(id, "b", dim));
    });
    expect(shutterView(run(actions))).toMatchObject({
      mode: "save",
      text: "All done",
      tone: "save",
    });
  });
});

describe("warnShot", () => {
  it("retakes A only for an almost black A, so a retake never loops", () => {
    expect(warnShot("not-darker")).toBe("b");
    expect(warnShot("too-dark-a")).toBe("a");
    expect(warnShot("too-dark-b")).toBe("b");
    expect(warnShot("changed")).toBe("b");
  });
});

describe("retakeView", () => {
  it("retakes A while B is due, and cancels a retake", () => {
    const s = run([camOn, shot("1a-s1", "a")]);
    expect(retakeView(s, null)).toEqual({
      label: "Retake A",
      disabled: false,
      action: { kind: "toggle", which: "a" },
    });
    const r = run([A.guidedRetakeToggled("a")], s);
    expect(retakeView(r, null)).toEqual({
      label: "Cancel retake",
      disabled: false,
      action: { kind: "toggle", which: "a" },
    });
  });

  it("goes back to the last pair's B after the automatic move", () => {
    const s = run([
      camOn,
      shot("1a-s1", "a"),
      shot("1a-s1", "b"),
      A.planMoved(1),
    ]);
    expect(retakeView(s, { index: 0, seq: 1 })).toEqual({
      label: "Retake B of 01",
      disabled: false,
      action: { kind: "back", index: 0 },
    });
    // Once photo A of the new pair exists, the side button is A's again.
    expect(
      retakeView(run([shot("1b-s1", "a")], s), { index: 0, seq: 1 }),
    ).toMatchObject({ label: "Retake A" });
  });

  it("retakes B on a reviewed pair and is off while busy or counting", () => {
    const s = run([camOn, shot("1a-s1", "a"), shot("1a-s1", "b")]);
    expect(retakeView(s, null).action).toEqual({ kind: "toggle", which: "b" });
    expect(
      retakeView(
        run([A.guidedCountSet({ shot: "a", left: 3 })], run([camOn])),
        {
          index: 0,
          seq: 1,
        },
      ).disabled,
    ).toBe(true);
    expect(retakeView(run([camOn]), null)).toEqual({
      label: "Retake",
      disabled: true,
      action: null,
    });
  });
});

describe("tileView", () => {
  it("marks the photo due, the taken one and a retake", () => {
    const s = run([camOn, shot("1a-s1", "a")]);
    expect(tileView(s)).toEqual({
      a: { state: "taken", text: "taken", disabled: false },
      b: { state: "armed", text: "now", disabled: true },
    });
    const c = run([A.guidedCountSet({ shot: "b", left: 2 })], s);
    expect(tileView(c).b.text).toBe("2 s");
    expect(tileView(c).a.disabled).toBe(true);
    const r = run([A.guidedRetakeToggled("a")], s);
    expect(tileView(r).a).toEqual({
      state: "retake",
      text: "retake",
      disabled: false,
    });
  });

  // Why this test matters: before Start the tile must not read "now", as
  // in the prototype: nothing can be taken until the camera is on.
  it("arms no tile while the camera is off", () => {
    expect(tileView(run([])).a).toEqual({
      state: "",
      text: "-",
      disabled: true,
    });
  });
});

describe("instrView", () => {
  it("asks for the camera, then A, then the change and B", () => {
    expect(instrView(run([])).label).toBeNull();
    expect(instrView(run([])).text).toContain("tap Start");
    expect(instrView(run([camOn])).label).toBe("A");
    const b = instrView(run([camOn, A.planMoved(1), shot("1b-s1", "a")]));
    expect(b.label).toBe("B");
    expect(b.text.length).toBeGreaterThan(0);
  });

  it("says what a failed light check asks for, and when everything is done", () => {
    const warned = run([
      camOn,
      A.planMoved(1),
      shot("1b-s1", "a", 120),
      shot("1b-s1", "b", 120),
    ]);
    expect(instrView(warned).text).toContain("not darker");
    expect(instrView(run([camOn, A.runStarted("synthetic")])).text).toContain(
      "Measuring",
    );
  });
});

describe("nextAfterPair", () => {
  it("moves on after a good pair, never after a failed light check", () => {
    const ok = run([camOn, shot("1a-s1", "a"), shot("1a-s1", "b")]);
    expect(nextAfterPair(ok)).toBe(1);
    const warned = run([
      camOn,
      A.planMoved(1),
      shot("1b-s1", "a", 120),
      shot("1b-s1", "b", 120),
    ]);
    expect(nextAfterPair(warned)).toBeNull();
    expect(nextAfterPair(run([camOn]))).toBeNull();
  });
});

describe("dock lines", () => {
  it("counts done pairs, kept segments and the takes Download all saves", () => {
    const s = run([camOn, shot("1a-s1", "a"), shot("1a-s1", "b")]);
    expect(progressText(s)).toBe("1 / 14");
    expect(downloadCount(s)).toBe(1);
    expect(segClasses(s).slice(0, 2)).toEqual(["cur", ""]);
    const moved = run([A.planMoved(1)], s);
    expect(segClasses(moved).slice(0, 2)).toEqual(["kept", "cur"]);
    const saved = run([A.planRunDownloaded()], moved);
    expect(segClasses(saved)[0]).toBe("saved");
    expect(downloadCount(saved)).toBe(0);
  });

  it("dims the dock only between photo A and B of the dimmed pairs", () => {
    expect(nightOn(run([camOn, A.planMoved(1)]))).toBe(false);
    expect(nightOn(run([camOn, A.planMoved(1), shot("1b-s1", "a")]))).toBe(
      true,
    );
    expect(nightOn(run([camOn, shot("1a-s1", "a")]))).toBe(false);
  });

  it("reads stillness, light and the capture mode", () => {
    const s = run([camOn, shot("1a-s1", "a", 99.6)]);
    expect(readoutView(s, { seen: false, moving: false })).toEqual({
      still: { text: "still: -", tone: "" },
      light: { text: "light A 100", tone: "" },
      mode: { text: "tap, 3 s", tone: "" },
    });
    expect(readoutView(s, { seen: true, moving: true }).still).toEqual({
      text: "moving",
      tone: "wait",
    });
    expect(readoutView(s, { seen: true, moving: false }).still.tone).toBe(
      "good",
    );
  });

  it("puts the newest workflow line in the status, with its tone", () => {
    expect(statusView(run([A.cameraStartSet("failed")]))).toEqual({
      text: "Camera unavailable: tap Retry camera.",
      tone: "bad",
    });
    expect(
      statusView(run([camOn, A.guidedCountSet({ shot: "a", left: 2 })])).text,
    ).toBe("Countdown: photo A in 2 s.");
    expect(statusView(run([camOn])).text).toBe("");
  });
});

describe("cockpit model: hands-off photo B", () => {
  const rest = { alpha: 0.2, beta: -0.1, gamma: 0.3 };
  const samples = (t0: number, ms: number): FeatureMatchAction[] => {
    const out: FeatureMatchAction[] = [];
    for (let t = t0; t <= t0 + ms; t += 20) {
      out.push(A.handsOffSample({ t, rate: rest }));
    }
    return out;
  };
  const armed = run([
    A.planSettingsChanged({ countdown: 0 }),
    camOn,
    shot("1a-s1", "a"),
    A.handsOffArmed(0),
  ]);
  const waiting = run(samples(0, 500), armed);
  const taking = run(samples(520, 1200), waiting);

  // Why: every hands-off state shows itself on the big button, and while
  // it waits the button still takes B at a tap: the way out of a wait.
  it("shows the wait on the big button, which still takes B at a tap", () => {
    expect(shutterView(armed)).toMatchObject({
      mode: "capture",
      shot: "b",
      text: "Waiting",
      tone: "armed",
      disabled: false,
    });
    expect(shutterView(waiting)).toMatchObject({
      mode: "capture",
      shot: "b",
      text: "Hold still",
    });
    expect(shutterView(taking)).toMatchObject({
      mode: "busy",
      text: "Taking B",
      disabled: true,
    });
    for (const r of ["refused", "failed"] as const) {
      expect(shutterView(run([A.handsOffShot(r)], taking))).toMatchObject({
        mode: "capture",
        shot: "b",
        text: "Take B",
        disabled: false,
      });
    }
  });

  // Why: the status line says what the wait is doing and, after a refusal
  // or a lost sensor, that a tap takes B instead.
  it("says on the status line what the wait does", () => {
    expect(statusView(armed).text).toMatch(/takes itself/);
    expect(statusView(waiting).text).toMatch(/Hold still/);
    expect(statusView(run([A.handsOffShot("refused")], taking))).toEqual({
      text: expect.stringMatching(/Tap to take it/),
      tone: "bad",
    });
    expect(statusView(run([A.handsOffShot("taken")], taking)).tone).toBe("ok");
    const lost = run(
      [A.handsOffSample({ t: 5000, rate: null })],
      run(samples(0, 100), armed),
    );
    expect(statusView(lost).text).toMatch(/No motion readings/);
  });

  // Why: the meter ring fills with the dwell while the phone rests, and
  // with the countdown otherwise; it never leaves 0..1.
  it("fills the meter with the dwell or the countdown", () => {
    expect(meterFill(armed)).toBe(0);
    const half = meterFill(waiting);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.5);
    const count = run([camOn, A.guidedCountSet({ shot: "a", left: 3 })]);
    expect(meterFill(count)).toBeCloseTo(1 / 4);
    expect(meterFill(run([camOn]))).toBe(0);
  });

  // Why: the mode readout says "auto" only while B is really waiting to
  // take itself, so a tester never waits for a photo that will not come.
  it("reads auto while photo B waits to take itself", () => {
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
  const actionArb: fc.Arbitrary<FeatureMatchAction> = fc.oneof(
    fc.constant(camOn),
    fc.constant(A.cameraChanged(false)),
    fc.integer({ min: 0, max: 15 }).map((i) => A.planMoved(i)),
    fc
      .tuple(
        fc.constantFrom("1a-s1", "1b-s1", "1c-s1", "2a-s1"),
        fc.constantFrom<"a" | "b">("a", "b"),
        fc.integer({ min: 0, max: 255 }),
      )
      .map(([slot, w, m]) => shot(slot, w, m)),
    fc.constantFrom<"a" | "b">("a", "b").map((w) => A.guidedRetakeToggled(w)),
    fc.constant(A.guidedCountSet({ shot: "a", left: 2 })),
    fc.constant(A.guidedCountSet(null)),
    fc.constant(A.runStarted("synthetic")),
    fc.constant(A.runFinished({ text: "done", resultsId: null })),
    fc.constant(A.planRunDownloaded()),
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
  it("always yields a shutter text and finite counts", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const s = run(actions);
        const sh = shutterView(s);
        expect(sh.text.length).toBeGreaterThan(0);
        expect(segClasses(s)).toHaveLength(14);
        expect(Number.isFinite(downloadCount(s))).toBe(true);
        const rv = retakeView(s, { index: 0, seq: 1 });
        expect(rv.label.length).toBeGreaterThan(0);
        expect(rv.disabled).toBe(rv.action === null);
        const fill = meterFill(s);
        expect(fill).toBeGreaterThanOrEqual(0);
        expect(fill).toBeLessThanOrEqual(1);
      }),
    );
  });
});
