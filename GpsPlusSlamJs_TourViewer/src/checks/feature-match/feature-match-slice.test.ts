import { describe, expect, it } from "vitest";

import {
  anyPairReady,
  currentShot,
  featureMatchActions as A,
  featureMatchReducer,
  flatPhase,
  HANDS_OFF_TEXT,
  handsOffDue,
  initialFeatureMatchState,
  logText,
  measureProgress,
  nextMeasureKey,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import { POSES, SURFACE_CLASSES } from "./flat-target";
import { planShots, type PhotoMeta } from "./run-plan";
import { STILL_CONFIG } from "./still-detector";

const start = (): FeatureMatchState =>
  initialFeatureMatchState({ session: "s1" });

const run = (
  actions: readonly FeatureMatchAction[],
  s: FeatureMatchState = start(),
): FeatureMatchState => actions.reduce(featureMatchReducer, s);

const photo = (id: string, greyMean = 120): PhotoMeta => ({
  id,
  width: 640,
  height: 480,
  source: { width: 1920, height: 1080 },
  greyMean,
});

const shot = (id: string, p = id): FeatureMatchAction =>
  A.planShotTaken({ shot: id, photo: photo(p) });

/** The index of a shot id in the default plan's list. */
const indexOf = (s: FeatureMatchState, id: string): number =>
  planShots(s.plan).findIndex((x) => x.id === id);

describe("one run or save at a time", () => {
  // Why: two runs at once would time each other.
  it("refuses a second run, and a zip, while one runs", () => {
    const s = run([A.runStarted("speed")]);
    expect(s.busy).toBe("running");
    expect(featureMatchReducer(s, A.runStarted("synthetic"))).toBe(s);
    expect(featureMatchReducer(s, A.runZipStarted())).toBe(s);
  });

  // Why: a speed test's progress lines go to its own status line.
  it("shows a run's progress on its own status line", () => {
    const s = run([A.runStarted("speed"), A.runProgressed("arm 1")]);
    expect(s.status.speed).toBe("running: arm 1");
    expect(run([A.runProgressed("x")])).toEqual(start());
    const done = run([A.runFinished({ text: "done" })], s);
    expect(done.busy).toBe("idle");
    expect(done.status.speed).toBe("done");
  });
});

describe("log and errors", () => {
  it("keeps errors for the report until cleared, and logs them", () => {
    const s = run([
      A.logged("[1.0s] ready"),
      A.failed({ line: "x: y", stamped: "[2.0s] ERROR x: y" }),
    ]);
    expect(s.errors).toEqual(["x: y"]);
    expect(logText(s)).toBe("[1.0s] ready\n[2.0s] ERROR x: y\n");
    expect(featureMatchReducer(s, A.errorsCleared()).errors).toEqual([]);
  });
});

const CLS = SURFACE_CLASSES[0].id;
const TAPS = [
  { x: 10, y: 10 },
  { x: 300, y: 12 },
  { x: 298, y: 200 },
  { x: 12, y: 198 },
];

/** A surface with its reference accepted, the poses on screen. */
const withReference = (): FeatureMatchAction[] => [
  A.flatOpened(),
  A.flatSurfaceAdded({ cls: CLS, original: false }),
  A.flatReferenceTaken({ id: "f1", width: 320, height: 240 }),
  ...TAPS.map((p) => A.flatTapped(p)),
  A.flatPreviewMade({ id: "f2", width: 200, height: 150 }),
  A.flatReferenceAccepted(),
];

describe("the flat target capture", () => {
  // Why: the steps of a surface follow from the state alone.
  it("walks reference, corners, check and poses", () => {
    const steps = withReference();
    const phases = steps.map((_, i) =>
      flatPhase(run(steps.slice(0, i + 1)).flat),
    );
    expect(phases).toEqual([
      "overview",
      "ref-live",
      "corners",
      "corners",
      "corners",
      "corners",
      "corners",
      "check",
      "poses",
    ]);
    const s = run(steps).flat;
    expect(s.progress.surfaces[0]?.reference?.corners).toEqual(TAPS);
    expect(s.still).toBeNull();
    expect(s.status).toBe("reference kept: now the poses");
  });

  // Why: a fifth tap or a tap outside the corner step is a stray tap.
  it("takes four corner taps at most, and only on the corner step", () => {
    const four = run(withReference().slice(0, 7));
    expect(featureMatchReducer(four, A.flatTapped({ x: 1, y: 1 }))).toBe(four);
    const live = run(withReference().slice(0, 2));
    expect(featureMatchReducer(live, A.flatTapped({ x: 1, y: 1 }))).toBe(live);
    const bad = run(withReference().slice(0, 3));
    expect(
      featureMatchReducer(bad, A.flatTapped({ x: Number.NaN, y: 1 })),
    ).toBe(bad);
  });

  // Why: a prepared zip describes one surface's shots; a shot added later
  // makes it stale, and its Save link must go.
  it("drops a prepared zip once the shots change", () => {
    const prepared = run([
      ...withReference(),
      A.flatShotTaken(200),
      A.flatSavingStarted(),
      A.flatSavingEnded({
        prepared: {
          surface: 1,
          shots: 1,
          urlId: "u1",
          name: "s1.zip",
          text: "1 photos",
        },
        status: "ready",
      }),
    ]);
    expect(prepared.flat.prepared?.urlId).toBe("u1");
    expect(prepared.flat.saving).toBe(false);
    expect(
      featureMatchReducer(prepared, A.flatShotTaken(200)).flat.prepared,
    ).toBeNull();
    expect(
      featureMatchReducer(prepared, A.flatOverview()).flat.prepared,
    ).toBeNull();
  });

  // Why: only the tap on Save proves the photos reached the device.
  it("marks the surface downloaded on Save", () => {
    const s = run([
      ...withReference(),
      A.flatShotTaken(200),
      A.flatSavingStarted(),
      A.flatSavingEnded({
        prepared: {
          surface: 1,
          shots: 1,
          urlId: "u1",
          name: "s1.zip",
          text: "1 photos",
        },
        status: "ready",
      }),
      A.flatSaved(),
    ]);
    expect(s.flat.progress.surfaces[0]?.shots.every((x) => x.saved)).toBe(true);
    expect(s.flat.status).toBe("downloaded s1.zip: 1 photos");
  });

  // Why: the countdown and a half-marked reference belong to one surface.
  it("clears the countdown and the marking on the overview", () => {
    const s = run([
      ...withReference().slice(0, 4),
      A.flatCountdown(2),
      A.flatOverview(),
    ]).flat;
    expect(s).toMatchObject({
      countdown: null,
      still: null,
      taps: [],
      preview: null,
    });
    expect(s.progress.current).toBeNull();
  });

  // Why: an unknown pose id would select no pose at all.
  it("ignores an unknown pose", () => {
    const s = run(withReference());
    expect(featureMatchReducer(s, A.flatPoseChosen("zz" as never))).toBe(s);
    expect(
      featureMatchReducer(s, A.flatPoseChosen(POSES[1]!.id)).flat.pose,
    ).toBe(POSES[1]!.id);
  });
});

describe("rules a one-line deletion would lose", () => {
  // Why: the views tell "I started it" from "it was refused" by the state's
  // identity (`accepted` in the store); a refused reducer must return the
  // very same object.
  it("returns the same state for a refused run, zip or flat save", () => {
    const running = run([A.runStarted("speed")]);
    expect(featureMatchReducer(running, A.runStarted("speed"))).toBe(running);
    expect(featureMatchReducer(running, A.runZipStarted())).toBe(running);
    const idle = start();
    expect(featureMatchReducer(idle, A.flatSavingStarted())).toBe(idle);
  });

  // Why: one zip at a time, and only once a reference exists to put in it.
  it("refuses a flat zip while one is made or without a reference", () => {
    const noRef = run([
      A.flatOpened(),
      A.flatSurfaceAdded({ cls: CLS, original: false }),
    ]);
    expect(featureMatchReducer(noRef, A.flatSavingStarted())).toBe(noRef);
    const saving = run([...withReference(), A.flatSavingStarted()]);
    expect(saving.flat.saving).toBe(true);
    expect(featureMatchReducer(saving, A.flatSavingStarted())).toBe(saving);
  });

  // Why: the measuring block runs the synthetic pair and the speed test
  // only; a plan run is gone, and its status line with it.
  it("knows only the synthetic, speed and copy status lines", () => {
    expect(Object.keys(start().status).sort()).toEqual([
      "copy",
      "speed",
      "synthetic",
    ]);
  });
});

describe("the run plan inside the page state", () => {
  // Why: a shot photo or Start over during a run would change the photos
  // the speed test reads; a move is harmless and allowed.
  it("refuses a shot photo and a reset while a run goes, with the same state", () => {
    const busy = run([shot("light-s1/L1", "p1"), A.runStarted("speed")]);
    expect(featureMatchReducer(busy, shot("light-s1/L2", "p2"))).toBe(busy);
    expect(featureMatchReducer(busy, A.planReset())).toBe(busy);
    expect(featureMatchReducer(busy, A.planMoved(3)).plan.current).toBe(3);
  });

  // Why: the store's `accepted` reads a refused plan action from the
  // state's identity.
  it("returns the same state for a refused plan action", () => {
    const s = start();
    expect(featureMatchReducer(s, A.planMoved(0))).toBe(s);
    expect(featureMatchReducer(s, A.planSettingsChanged({ save: "x" }))).toBe(
      s,
    );
    expect(featureMatchReducer(s, A.planShotLost("light-s1/L1"))).toBe(s);
  });

  // Why: the reducer walks the run by itself: a shot that passes moves the
  // page to the next open shot, so the tester never has to tap Next.
  it("moves on to the next open shot after a photo of the current one", () => {
    const s = run([shot("light-s1/L1")]);
    expect(currentShot(s.plan)?.id).toBe("light-s1/L2");
  });

  // Why: the stored plan is the one the page starts with.
  it("starts from the stored plan", () => {
    const plan = run([shot("light-s1/L1")]).plan;
    const s = initialFeatureMatchState({ session: "s", plan });
    expect(s.plan).toBe(plan);
  });

  // Why: Download all needs a pair whose two shots are taken; one shot
  // alone makes no pair.
  it("has a ready pair only once both shots of one are taken", () => {
    expect(anyPairReady(run([shot("light-s1/L1")]).plan)).toBe(false);
    expect(
      anyPairReady(run([shot("light-s1/L1"), shot("light-s1/L2")]).plan),
    ).toBe(true);
  });
});

describe("the countdown", () => {
  // Why: the countdown may only run for the current shot, never during a
  // run, and only with a whole number of seconds; a retake is a countdown
  // on a shot that already has a photo.
  it("starts only for the current shot, never while busy", () => {
    const s = start();
    expect(
      featureMatchReducer(
        s,
        A.guidedCountSet({ shot: "light-s1/L2", left: 3 }),
      ),
    ).toBe(s);
    for (const left of [0, 1.5, -1]) {
      expect(
        featureMatchReducer(s, A.guidedCountSet({ shot: "light-s1/L1", left })),
      ).toBe(s);
    }
    const counting = run([A.guidedCountSet({ shot: "light-s1/L1", left: 3 })]);
    expect(counting.guided.count).toEqual({ shot: "light-s1/L1", left: 3 });
    expect(run([A.guidedCountSet(null)], counting).guided.count).toBeNull();
    const busy = run([A.runStarted("speed")]);
    expect(
      featureMatchReducer(
        busy,
        A.guidedCountSet({ shot: "light-s1/L1", left: 3 }),
      ),
    ).toBe(busy);
    // A retake: the shot has its photo and is current again.
    const back = run([shot("light-s1/L1"), A.planMoved(0)]);
    expect(
      run([A.guidedCountSet({ shot: "light-s1/L1", left: 3 })], back).guided
        .count,
    ).toEqual({ shot: "light-s1/L1", left: 3 });
  });

  // Why: a count that ran on into a run or a zip would end in a photo the
  // busy page refuses; the shot would be lost without a word.
  it("drops the countdown when a run or the zip starts", () => {
    const counting = run([
      shot("light-s1/L1"),
      shot("light-s1/L2"),
      A.guidedCountSet({ shot: "light-s1/L3", left: 3 }),
    ]);
    expect(counting.guided.count).not.toBeNull();
    for (const a of [A.runStarted("speed"), A.runZipStarted()]) {
      const s = run([a], counting);
      expect(s.busy, a.type).not.toBe("idle");
      expect(s.guided.count, a.type).toBeNull();
    }
  });

  // Why: a new photo, another shot or Start over make a running countdown
  // point at the wrong shot.
  it("drops the countdown on a photo, a move and a reset", () => {
    const counting = run([A.guidedCountSet({ shot: "light-s1/L1", left: 3 })]);
    for (const a of [shot("light-s1/L1"), A.planMoved(4), A.planReset()]) {
      expect(run([a], counting).guided.count, a.type).toBeNull();
    }
    // A refused move keeps it.
    expect(run([A.planMoved(99)], counting).guided).toEqual(counting.guided);
  });
});

describe("Download all", () => {
  const withPair = (): FeatureMatchState =>
    run([shot("light-s1/L1", "p1"), shot("light-s1/L2", "p2")]);

  // Why: the zip packs every ready pair; it needs one, and it holds the
  // page busy so no photo or run changes the plan while it is packed.
  it("starts only with a ready pair and while idle", () => {
    const one = run([shot("light-s1/L1")]);
    expect(featureMatchReducer(one, A.runZipStarted())).toBe(one);
    const going = run([A.runZipStarted()], withPair());
    expect(going.busy).toBe("saving");
    expect(going.runZip).toEqual({
      phase: "preparing",
      text: "Packing the photos. Keep this page open.",
    });
    expect(featureMatchReducer(going, A.runZipStarted())).toBe(going);
    expect(featureMatchReducer(going, A.planReset())).toBe(going);
    const busy = run([A.runStarted("speed")], withPair());
    expect(featureMatchReducer(busy, A.runZipStarted())).toBe(busy);
    // A tab refused the run would pack a plan the other tab has moved on.
    const other = run([A.otherTabFound()], withPair());
    expect(featureMatchReducer(other, A.runZipStarted())).toBe(other);
  });

  // Why: the stored log is the run's log; after a reset a new run's zip
  // must not carry every earlier run's lines.
  it("starts the log afresh on a reset", () => {
    const s = run([A.logged("old run"), A.planReset()], withPair());
    expect(s.log).toEqual([]);
    expect(run([A.logged("new run")], s).log).toEqual(["new run"]);
  });

  // Why: the end screen says what happened to the zip: saved, refused by
  // the save dialog (nothing lost, no failure) or failed (retry).
  it("ends saved, closed or failed, and only a zip in preparation", () => {
    const idle = withPair();
    expect(
      featureMatchReducer(idle, A.runZipEnded({ phase: "saved", text: "x" })),
    ).toBe(idle);
    const going = run([A.runZipStarted()], withPair());
    for (const phase of ["saved", "idle", "failed"] as const) {
      const done = run([A.runZipEnded({ phase, text: `t-${phase}` })], going);
      expect(done.busy).toBe("idle");
      expect(done.runZip).toEqual({ phase, text: `t-${phase}` });
    }
  });

  // Why: a new photo after a saved zip makes the zip on the phone stale;
  // the end screen must not keep saying it was saved.
  it("forgets a saved zip once a photo changes the plan", () => {
    const saved = run(
      [A.runZipStarted(), A.runZipEnded({ phase: "saved", text: "Saved" })],
      withPair(),
    );
    expect(run([shot("light-s1/L3")], saved).runZip).toEqual({
      phase: "idle",
      text: "",
    });
    expect(run([A.planMoved(3)], saved).runZip.phase).toBe("saved");
  });
});

describe("camera start and photo storage", () => {
  // Why: "starting" and "failed" are what the finder chip says; a photo, a
  // move or a reset must not wipe them, and nothing else may be stored.
  it("keeps the camera start status through plan changes", () => {
    const s = run([A.cameraStartSet("starting")]);
    expect(s.cameraStart).toBe("starting");
    expect(run([A.planMoved(3), A.planReset()], s).cameraStart).toBe(
      "starting",
    );
    expect(run([A.cameraStartSet("failed")], s).cameraStart).toBe("failed");
    const bad = featureMatchReducer(
      s,
      A.cameraStartSet("on" as unknown as "idle"),
    );
    expect(bad).toBe(s);
  });

  // Why: a photo the browser's database refused is lost at a reload; the
  // page must be able to say so until a later write succeeds.
  it("records whether the photo database is failing", () => {
    const s = run([A.photoStoreChanged(true)]);
    expect(s.photoStoreFailing).toBe(true);
    expect(run([A.photoStoreChanged(false)], s).photoStoreFailing).toBe(false);
  });
});

describe("the hands-off shot", () => {
  const still = { alpha: 0.2, beta: -0.1, gamma: 0.3 };
  const fast = { alpha: 60, beta: 60, gamma: 60 };
  /** Readings every 20 ms from `t0` for `ms`. */
  const readings = (t0: number, ms: number, rate = still) => {
    const out: FeatureMatchAction[] = [];
    for (let t = t0; t <= t0 + ms; t += 20) {
      out.push(A.handsOffSample({ t, rate }));
    }
    return out;
  };
  /** The camera on and the shot before `target` taken; `target` current. */
  const before = (target = "light-s1/L2"): FeatureMatchState => {
    const s = run([A.cameraChanged(true)]);
    const i = indexOf(s, target);
    const prev = planShots(s.plan)[i - 1]!;
    return run([A.planMoved(i - 1), shot(prev.id, "pa"), A.planMoved(i)], s);
  };
  const armed = (target?: string): FeatureMatchState =>
    run([A.handsOffArmed(0)], before(target));

  // Why: a shot takes itself only where it can: the setting on, the camera
  // on, a shot the sensor can judge, the scene's previous shot taken and
  // this one not, no countdown, nothing busy, and once per previous photo.
  it("is due only after the previous shot of a shot it can judge", () => {
    expect(handsOffDue(before())).toBe(true);
    expect(handsOffDue(start())).toBe(false);
    expect(handsOffDue(run([A.cameraChanged(false)], before()))).toBe(false);
    expect(
      handsOffDue(run([A.planSettingsChanged({ capture: "tap" })], before())),
    ).toBe(false);
    expect(
      handsOffDue(
        run([A.guidedCountSet({ shot: "light-s1/L2", left: 3 })], before()),
      ),
    ).toBe(false);
    expect(handsOffDue(run([A.runStarted("speed")], before()))).toBe(false);
    // L3 dims the light: a tap, never by itself.
    expect(handsOffDue(before("light-s1/L3"))).toBe(false);
    expect(handsOffDue(before("flat-s1/F3"))).toBe(true);
    expect(handsOffDue(armed())).toBe(false);
    // A shot with its photo is not due again.
    expect(
      handsOffDue(run([shot("light-s1/L2"), A.planMoved(1)], before())),
    ).toBe(false);
  });

  // Why: arming is refused unless due, so a render that arms on every
  // change cannot loop, and a bad time never starts the detector.
  it("arms once, and refuses when not due or with a bad time", () => {
    const s = armed();
    expect(s.handsOff.phase).toBe("armed");
    expect(s.handsOff.shot).toBe("light-s1/L2");
    expect(s.handsOff.prev).toBe("pa");
    expect(featureMatchReducer(s, A.handsOffArmed(5))).toBe(s);
    expect(featureMatchReducer(start(), A.handsOffArmed(0))).toEqual(start());
    const b = before();
    expect(featureMatchReducer(b, A.handsOffArmed(Number.NaN))).toBe(b);
  });

  // Why: the flow itself - readings arrive (waiting), the phone stays
  // still for the dwell, and only then is the photo due (taking).
  it("waits for the still phone, then takes the shot", () => {
    const s = armed();
    const w = run(readings(20, 500), s);
    expect(w.handsOff.phase).toBe("waiting");
    const t = run(readings(540, STILL_CONFIG.dwellMs), w);
    expect(t.handsOff.phase).toBe("taking");
    expect(run([A.handsOffShot("taken")], t).handsOff.phase).toBe("taken");
    expect(run([A.handsOffShot("refused")], t).handsOff.phase).toBe("refused");
    expect(run([A.handsOffShot("failed")], t).handsOff.phase).toBe("failed");
    expect(featureMatchReducer(w, A.handsOffShot("taken"))).toBe(w);
  });

  // Why: on a shot that moves the phone (the tilt), it waits for the move.
  it("stays armed on a move shot until the phone moved", () => {
    const s = run(readings(20, 3000), armed("flat-s1/F3"));
    expect(s.handsOff.phase).toBe("armed");
    const moved = run(readings(3040, 400, fast), s);
    const t = run(readings(3460, 3000), moved);
    expect(t.handsOff.phase).toBe("taking");
  });

  // Why: a sensor that never reports, or stops, ends the wait with a
  // reason, and that shot is not armed again: the tap is the way out.
  it("fails when the readings stop, and offers the tap", () => {
    const s = run(
      [A.handsOffSample({ t: STILL_CONFIG.lostMs + 1, rate: null })],
      armed(),
    );
    expect(s.handsOff.phase).toBe("failed");
    expect(s.handsOff.text).toMatch(/tap/i);
    expect(handsOffDue(s)).toBe(false);
    const c = run([A.guidedCountSet({ shot: "light-s1/L2", left: 3 })], s);
    expect(c.guided.count).toEqual({ shot: "light-s1/L2", left: 3 });
  });

  // Why: a tap on the big button during the wait takes the shot by
  // countdown; the wait ends and does not come back for the same photo.
  it("ends on a countdown or a run, and stays off for that previous photo", () => {
    const w = run(readings(20, 200), armed());
    for (const act of [
      A.guidedCountSet({ shot: "light-s1/L2", left: 3 }),
      A.runStarted("speed"),
    ]) {
      const s = run([act], w);
      expect(s.handsOff.phase, act.type).toBe("off");
      expect(s.handsOff.shot).toBe("light-s1/L2");
    }
    const off = run([A.guidedCountSet({ shot: "light-s1/L2", left: 3 })], w);
    expect(handsOffDue(run([A.guidedCountSet(null)], off))).toBe(false);
  });

  // Why: the drawer pauses the wait; closing it arms again. Another shot,
  // Start over or the camera off clear it as well; a new previous photo
  // (a retake of L1) makes the shot due again.
  it("clears on a pause, a move, a reset and the camera off", () => {
    const w = run(readings(20, 200), armed());
    const paused = run([A.handsOffPaused()], w);
    expect(paused.handsOff.phase).toBe("off");
    expect(handsOffDue(paused)).toBe(true);
    for (const act of [A.planMoved(4), A.planReset(), A.cameraChanged(false)]) {
      expect(run([act], w).handsOff.phase, act.type).toBe("off");
      expect(run([act], w).handsOff.shot, act.type).toBeNull();
    }
    const retaken = run(
      [A.planMoved(0), shot("light-s1/L1", "pa2")],
      run([A.guidedCountSet({ shot: "light-s1/L2", left: 3 })], w),
    );
    expect(currentShot(retaken.plan)?.id).toBe("light-s1/L2");
    expect(handsOffDue(retaken)).toBe(true);
  });

  // Why: the previous photo lost (its frame did not come back) ends the
  // wait at once: the shot must not take itself against a gone photo.
  it("ends the wait when the previous photo is lost", () => {
    const w = run(readings(20, 200), armed());
    const lost = run([A.planShotLost("light-s1/L1")], w);
    expect(lost.handsOff.phase).toBe("off");
    expect(lost.handsOff.shot).toBeNull();
  });

  // Why: a reading from far in the future would set the detector's clock
  // ahead, after which every real reading looks backwards and the wait
  // freezes; it fails the wait instead, and the tap takes the shot.
  it("fails the wait on a reading that jumps far ahead", () => {
    const w = run(readings(20, 200), armed());
    const jumped = run([A.handsOffSample({ t: 1e12, rate: still })], w);
    expect(jumped.handsOff.phase).toBe("failed");
    expect(jumped.handsOff.text).toBe(HANDS_OFF_TEXT.lost);
  });

  // Why: readings are only taken while waiting; a bad one changes nothing.
  it("ignores readings when not waiting, and bad readings", () => {
    const b = before();
    expect(
      featureMatchReducer(b, A.handsOffSample({ t: 5, rate: still })),
    ).toBe(b);
    const s = armed();
    expect(
      featureMatchReducer(s, A.handsOffSample({ t: Number.NaN, rate: still })),
    ).toBe(s);
    const w = run(readings(20, 100), s);
    expect(
      featureMatchReducer(
        w,
        A.handsOffSample({
          t: 200,
          rate: { alpha: Number.NaN, beta: null, gamma: Infinity },
        }),
      ),
    ).toBe(w);
  });
});

describe("what storage holds", () => {
  const L1 = "light-s1/L1";
  const L2 = "light-s1/L2";
  const key = "light-s1/L1-L2@p1+p2";
  const pair = (): FeatureMatchState => run([shot(L1, "p1"), shot(L2, "p2")]);

  // Why: a view may say "stored" only once the write succeeded, and an id
  // the plan no longer names is stored for nothing.
  it("marks a named photo stored, and forgets it once retaken", () => {
    const s = run([A.photoStored("p1"), A.photoStored("nope")], pair());
    expect(s.storedIds).toEqual(["p1"]);
    expect(featureMatchReducer(s, A.photoStored("p1"))).toBe(s);
    const again = run([shot(L1, "p3")], s);
    expect(again.storedIds).toEqual([]);
  });

  // Why: a result belongs to the two photos it was measured on; a retake
  // of either makes it stale, and a key no ready pair has is refused.
  it("keeps a result only for a ready pair's current photos", () => {
    const s = run(
      [
        A.resultStored({ key, text: "ok" }),
        A.resultFailed({
          key: "light-s1/L1-L3@p1+p9",
          text: "e",
          persisted: true,
        }),
      ],
      pair(),
    );
    expect(s.results).toEqual({
      [key]: { status: "done", text: "ok", persisted: true },
    });
    expect(run([shot(L2, "p4")], s).results).toEqual({});
  });

  // Why: only a failure the method itself reported is kept in storage; a
  // crash is measured again after a reload.
  it("records whether a failure is kept in storage", () => {
    const s = run(
      [A.resultFailed({ key, text: "worker crashed", persisted: false })],
      pair(),
    );
    expect(s.results[key]).toEqual({
      status: "failed",
      text: "worker crashed",
      persisted: false,
    });
  });

  // Why: a reload brings back what storage held, but only what the plan
  // still names, and the log continues the old one with a reload mark.
  it("takes the restored photos, results and log once", () => {
    const s = run([A.logged("this load")], pair());
    expect(s.restored).toBe(false);
    const r = featureMatchReducer(
      s,
      A.restoreFinished({
        stored: ["p1", "gone"],
        results: {
          [key]: { status: "done", text: "ok", persisted: true },
          "x@a+b": { status: "done", text: "old", persisted: true },
        },
        log: ["old 1", "old 2"],
      }),
    );
    expect(r.restored).toBe(true);
    expect(r.storedIds).toEqual(["p1"]);
    expect(Object.keys(r.results)).toEqual([key]);
    expect(r.log).toEqual(["old 1", "old 2", "page reloaded", "this load"]);
    expect(
      featureMatchReducer(
        r,
        A.restoreFinished({ stored: [], results: {}, log: ["x"] }),
      ),
    ).toBe(r);
    const fresh = featureMatchReducer(
      s,
      A.restoreFinished({ stored: [], results: {}, log: [] }),
    );
    expect(fresh.log).toEqual(["this load"]);
  });

  // Why: "Start over" right after a load clears the log; a restore that
  // lands after it must not bring back the run the tester just dropped,
  // or the next log write would store the old lines again.
  it("drops the stored log when the run was reset during the restore", () => {
    const s = run(
      [A.logged("old run"), A.planReset(), A.logged("new run")],
      pair(),
    );
    expect(s.log).toEqual(["new run"]);
    const r = featureMatchReducer(
      s,
      A.restoreFinished({ stored: [], results: {}, log: ["stored 1"] }),
    );
    expect(r.restored).toBe(true);
    expect(r.log).toEqual(["new run"]);
    // A refused reset (another tab holds the run) does not count as one.
    const refused = run([A.otherTabFound(), A.planReset()], pair());
    expect(
      featureMatchReducer(
        refused,
        A.restoreFinished({ stored: [], results: {}, log: ["stored 1"] }),
      ).log,
    ).toEqual(["stored 1", "page reloaded"]);
  });

  // Why: two tabs would write the same plan and database; the second one
  // takes no photo and changes nothing of the run.
  it("refuses every plan action once another tab holds the run", () => {
    const s = run([A.otherTabFound()], pair());
    expect(s.otherTab).toBe(true);
    for (const a of [
      shot("light-s1/L3", "p5"),
      A.planReset(),
      A.planMoved(0),
      A.planSized({ spots: 2, extra: 0 }),
    ]) {
      expect(featureMatchReducer(s, a)).toBe(s);
    }
  });
});

describe("the measuring queue", () => {
  const L1 = "light-s1/L1";
  const L2 = "light-s1/L2";
  const L3 = "light-s1/L3";
  const k12 = "light-s1/L1-L2@p1+p2";
  const k13 = "light-s1/L1-L3@p1+p3";
  const restore = A.restoreFinished({ stored: [], results: {}, log: [] });
  const three = (): FeatureMatchState =>
    run([shot(L1, "p1"), shot(L2, "p2"), shot(L3, "p3")]);
  const done = (key: string, measureMs = 100): FeatureMatchAction =>
    A.resultStored({
      key,
      text: "ok",
      measureMs,
      context: "beside-camera",
      hidden: false,
    });

  // Why: right after a load a stored result may still be on its way back;
  // measuring before the restore would measure that pair twice.
  it("starts nothing before the restore", () => {
    expect(nextMeasureKey(three())).toBeNull();
    expect(nextMeasureKey(run([restore], three()))).toBe(k12);
  });

  // Why: one pair at a time, in run order, each result key once; a refused
  // start must not mark a pair as running.
  it("measures the ready pairs one at a time in run order", () => {
    const s = run([restore], three());
    expect(featureMatchReducer(s, A.queueStarted(k13))).toBe(s);
    const r = run([A.queueStarted(k12)], s);
    expect(r.queue.running).toBe(k12);
    expect(nextMeasureKey(r)).toBeNull();
    const after = run([done(k12)], r);
    expect(after.queue.running).toBeNull();
    expect(nextMeasureKey(after)).toBe(k13);
  });

  // Why: a retake during a measurement makes its key stale; the answer
  // must still free the queue, while its result is dropped.
  it("frees the queue for a stale answer and drops its result", () => {
    const s = run([restore, A.queueStarted(k12), shot(L2, "p9")], three());
    expect(s.queue.running).toBe(k12);
    const r = run([done(k12)], s);
    expect(r.queue.running).toBeNull();
    expect(r.results).toEqual({});
    expect(nextMeasureKey(r)).toBe("light-s1/L1-L2@p1+p9");
  });

  // Why: a speed test or synthetic run times the device; the queue waits
  // for it, and neither may start while a pair is being measured.
  it("pauses for a run, and refuses a run while a pair is measured", () => {
    const s = run([restore, A.runStarted("speed")], three());
    expect(nextMeasureKey(s)).toBeNull();
    const m = run([restore, A.queueStarted(k12)], three());
    expect(featureMatchReducer(m, A.runStarted("speed"))).toBe(m);
  });

  // Why: a phone that cannot hold the models crashes the worker each time;
  // after two crashes in a row the queue stops instead of downloading again
  // and again, and the crash is not kept in storage.
  it("stops after two worker crashes in a row", () => {
    const s = run(
      [restore, A.queueStarted(k12), A.workerCrashed({ key: k12, text: "c" })],
      three(),
    );
    expect(s.queue.crashes).toBe(1);
    expect(s.results[k12]).toMatchObject({
      status: "failed",
      persisted: false,
    });
    expect(nextMeasureKey(s)).toBe(k13);
    const t = run(
      [A.queueStarted(k13), A.workerCrashed({ key: k13, text: "c" })],
      s,
    );
    expect(t.queue.crashes).toBe(2);
    expect(nextMeasureKey(t)).toBeNull();
    expect(measureProgress(t).stopped).toBe(true);
    // A crash answer for a pair not running changes nothing.
    expect(
      featureMatchReducer(t, A.workerCrashed({ key: k13, text: "c" })),
    ).toBe(t);
  });

  // Why: "crashes in a row": a measured pair between two crashes resets
  // the count.
  it("counts only crashes in a row", () => {
    const s = run(
      [
        restore,
        A.queueStarted(k12),
        A.workerCrashed({ key: k12, text: "c" }),
        A.queueStarted(k13),
        done(k13),
      ],
      three(),
    );
    expect(s.queue.crashes).toBe(0);
  });

  // Why: only a pair the worker measured shows the worker is healthy
  // again; a photo that could not be read never reached the worker, so
  // it must not wipe the count of crashes in a row.
  it("keeps the crash count when a pair fails without the worker", () => {
    const s = run(
      [
        restore,
        A.queueStarted(k12),
        A.workerCrashed({ key: k12, text: "c" }),
        A.queueStarted(k13),
        A.resultFailed({ key: k13, text: "unreadable", persisted: false }),
      ],
      three(),
    );
    expect(s.queue).toEqual({ running: null, crashes: 1 });
  });

  // Why: nothing ticked that the worker can run means nothing to measure;
  // the queue must not start a pair it would only fail.
  it("starts nothing when no method the worker runs is ticked", () => {
    const s = run([restore], three());
    const none = run(
      [
        A.optionsChanged({
          ...s.options,
          methods: {
            sift: false,
            xfeat: true,
            aliked: false,
            siftLightGlue: false,
          },
        }),
      ],
      s,
    );
    expect(nextMeasureKey(none)).toBeNull();
    const noSize = run([A.optionsChanged({ ...s.options, sizes: [] })], s);
    expect(nextMeasureKey(noSize)).toBeNull();
  });

  // Why: the end screen shows how far the phone got and an estimate from
  // the measuring time alone (downloads and model loads happen once).
  it("reports progress and an estimate from the median measuring time", () => {
    const s = run([restore], three());
    expect(measureProgress(s)).toMatchObject({
      total: 2,
      done: 0,
      waiting: 2,
      running: null,
      estimateMs: null,
    });
    const r = run(
      [A.queueStarted(k12), done(k12, 3000), A.queueStarted(k13)],
      s,
    );
    expect(measureProgress(r)).toMatchObject({
      total: 2,
      done: 1,
      waiting: 0,
      running: "light-s1/L1-L3",
      estimateMs: 3000,
    });
  });
});
