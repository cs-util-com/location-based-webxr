import { describe, expect, it } from "vitest";

import {
  featureMatchActions as A,
  featureMatchReducer,
  flatPhase,
  handsOffDue,
  initialFeatureMatchState,
  logText,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import { POSES, SURFACE_CLASSES } from "./flat-target";
import { planSlots, type PhotoMeta } from "./run-plan";
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

describe("one run or save at a time", () => {
  // Why: two runs at once would time each other.
  it("refuses a second run, and a save, while one runs", () => {
    const s = run([A.runStarted("speed")]);
    expect(s.busy).toBe("running");
    expect(featureMatchReducer(s, A.runStarted("synthetic"))).toBe(s);
    expect(featureMatchReducer(s, A.planFileSaveStarted())).toBe(s);
  });

  // Why: a speed test's progress lines go to its own status line.
  it("shows a run's progress on its own status line", () => {
    const s = run([A.runStarted("speed"), A.runProgressed("arm 1")]);
    expect(s.status.speed).toBe("running: arm 1");
    expect(run([A.runProgressed("x")])).toEqual(start());
  });
});

describe("progress, log and errors", () => {
  // Why: the running number survives a reload, so no name is reused.
  it("starts from the stored running number", () => {
    const s = initialFeatureMatchState({
      session: "s",
      progress: { sequence: 7 },
    });
    expect(s.progress).toEqual({ sequence: 7 });
  });

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
  // Why: only a plan run's results belong to a pair; a synthetic run must
  // not attach its results to the plan's take.
  it("keeps no plan results after a synthetic run", () => {
    const s = run([
      A.runStarted("synthetic"),
      A.runFinished({ text: "done", resultsId: "r1" }),
    ]);
    expect(s.planRun).toBeNull();
    expect(s.status.synthetic).toBe("done");
  });

  // Why: the views tell "I started it" from "it was refused" by the state's
  // identity (`accepted` in the store); a refused reducer must return the
  // very same object.
  it("returns the same state for a refused run, save or zip", () => {
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
});

describe("the run plan inside the page state", () => {
  // Why: the page's running number is the one stored across reloads, so
  // a take after a reload never gets the file names of an earlier one.
  it("raises the page's running number at a plan photo's new take", () => {
    const s = run(
      [A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") })],
      initialFeatureMatchState({ session: "s1", progress: { sequence: 1 } }),
    );
    expect(s.progress.sequence).toBe(2);
    expect(s.plan.slots["1a-s1"]?.seq).toBe(2);
  });

  // Why: a plan photo or Start over during a run would change the pair
  // the run measures.
  it("refuses a plan photo and a reset while a run goes, with the same state", () => {
    const busy = run([
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
      A.runStarted("speed"),
    ]);
    expect(
      featureMatchReducer(
        busy,
        A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p2") }),
      ),
    ).toBe(busy);
    expect(featureMatchReducer(busy, A.planReset())).toBe(busy);
    expect(featureMatchReducer(busy, A.planMoved(3)).plan.current).toBe(3);
  });

  // Why: the store's `accepted` reads a refused plan action from the
  // state's identity.
  it("returns the same state for a refused plan action", () => {
    const s = start();
    expect(featureMatchReducer(s, A.planMoved(0))).toBe(s);
    expect(featureMatchReducer(s, A.planRunDownloaded())).toBe(s);
    expect(featureMatchReducer(s, A.planSettingsChanged({ save: "x" }))).toBe(
      s,
    );
  });

  // Why: a stored plan holding a higher number than the stored progress
  // (a write lost between the two) must not lead to a reused name.
  it("starts the running number above every number the stored plan holds", () => {
    const plan = run([
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
      A.planPhotoTaken({ slot: "2a-s1", which: "a", photo: photo("p2") }),
    ]).plan;
    const s = initialFeatureMatchState({
      session: "s",
      progress: { sequence: 1 },
      plan,
    });
    expect(s.progress.sequence).toBe(2);
    expect(s.plan).toBe(plan);
  });
});

describe("the guided view's capture state", () => {
  const withA = (): FeatureMatchState =>
    run([A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") })]);
  const withPair = (): FeatureMatchState =>
    run(
      [A.planPhotoTaken({ slot: "1a-s1", which: "b", photo: photo("p2") })],
      withA(),
    );

  // Why: the retake target decides which photo the camera button replaces;
  // it can only point at a photo the current pair has.
  it("toggles the retake target only onto a photo the current pair holds", () => {
    const s = start();
    expect(featureMatchReducer(s, A.guidedRetakeToggled("a"))).toBe(s);
    const a = run([A.guidedRetakeToggled("a")], withA());
    expect(a.guided.retake).toBe("a");
    expect(featureMatchReducer(withA(), A.guidedRetakeToggled("b"))).toEqual(
      withA(),
    );
    expect(run([A.guidedRetakeToggled("a")], a).guided.retake).toBeNull();
    const b = run(
      [A.guidedRetakeToggled("a"), A.guidedRetakeToggled("b")],
      withPair(),
    );
    expect(b.guided.retake).toBe("b");
  });

  // Why: a new photo, another pair or Start over make an old retake target
  // and a running countdown point at the wrong photo.
  it("drops retake and countdown on a photo, a move and a reset", () => {
    const armed = run(
      [A.guidedRetakeToggled("b"), A.guidedCountSet({ shot: "b", left: 3 })],
      withPair(),
    );
    expect(armed.guided).toEqual({
      retake: "b",
      count: { shot: "b", left: 3 },
    });
    const cleared = { retake: null, count: null };
    expect(
      run(
        [A.planPhotoTaken({ slot: "1a-s1", which: "b", photo: photo("p3") })],
        armed,
      ).guided,
    ).toEqual(cleared);
    expect(run([A.planMoved(4)], armed).guided).toEqual(cleared);
    expect(run([A.planReset()], armed).guided).toEqual(cleared);
    // A refused move keeps both.
    expect(run([A.planMoved(99)], armed).guided).toEqual(armed.guided);
  });

  // Why: the countdown may only run for the photo the button takes now,
  // never during a run, and a tap while it runs is what cancels it.
  it("starts a countdown only for the due photo, never while busy", () => {
    const s = withA();
    expect(
      featureMatchReducer(s, A.guidedCountSet({ shot: "a", left: 3 })),
    ).toBe(s);
    expect(
      featureMatchReducer(s, A.guidedCountSet({ shot: "b", left: 0 })),
    ).toBe(s);
    expect(
      featureMatchReducer(s, A.guidedCountSet({ shot: "b", left: 1.5 })),
    ).toBe(s);
    const counting = run([A.guidedCountSet({ shot: "b", left: 3 })], s);
    expect(counting.guided.count).toEqual({ shot: "b", left: 3 });
    expect(run([A.guidedCountSet(null)], counting).guided.count).toBeNull();
    // No retake toggle while counting.
    expect(featureMatchReducer(counting, A.guidedRetakeToggled("a"))).toBe(
      counting,
    );
    const busy = run([A.runStarted("speed")], s);
    expect(
      featureMatchReducer(busy, A.guidedCountSet({ shot: "b", left: 3 })),
    ).toBe(busy);
  });

  // Why: a run of the guided view measures the current pair's photos; it
  // needs both, and its results belong to that take only.
  it("runs on the current plan pair and drops its results at a new photo there", () => {
    expect(featureMatchReducer(withA(), A.runStarted("plan"))).toEqual(withA());
    const going = run([A.runStarted("plan")], withPair());
    expect(going.busy).toBe("running");
    expect(going.running).toBe("plan");
    expect(going.planRun).toEqual({ slot: "1a-s1", seq: 1, resultsId: null });
    expect(going.status.run).toBe("running");
    const done = run([A.runFinished({ text: "done", resultsId: "r9" })], going);
    expect(done.busy).toBe("idle");
    expect(done.planRun).toEqual({ slot: "1a-s1", seq: 1, resultsId: "r9" });
    expect(done.status.run).toBe("done");
    // A photo in another pair keeps them, a photo in this one drops them.
    const other = run(
      [A.planPhotoTaken({ slot: "1b-s1", which: "a", photo: photo("q1") })],
      done,
    );
    expect(other.planRun?.resultsId).toBe("r9");
    const again = run(
      [A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p4") })],
      done,
    );
    expect(again.planRun).toBeNull();
  });
});

describe("the guided view's run zip", () => {
  const withPair = (): FeatureMatchState =>
    run([
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
      A.planPhotoTaken({ slot: "1a-s1", which: "b", photo: photo("p2") }),
    ]);

  // Why: the zip packs every complete pair; it needs one, and it holds the
  // page busy so no photo or run changes the plan while it is packed.
  it("starts only with a complete pair and while idle", () => {
    const none = start();
    expect(featureMatchReducer(none, A.runZipStarted())).toBe(none);
    const going = run([A.runZipStarted()], withPair());
    expect(going.busy).toBe("saving");
    expect(going.runZip).toEqual({
      phase: "preparing",
      text: "Packing the photos. Keep this page open.",
    });
    expect(featureMatchReducer(going, A.runZipStarted())).toBe(going);
    const busy = run([A.runStarted("plan")], withPair());
    expect(featureMatchReducer(busy, A.runZipStarted())).toBe(busy);
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
    // A single-file save that ends does not end the zip.
    expect(featureMatchReducer(going, A.planFileSaveEnded("x"))).toBe(going);
  });

  // Why: a new photo after a saved zip makes the zip on the phone stale;
  // the end screen must not keep saying it was saved.
  it("forgets a saved zip once a photo changes the plan", () => {
    const saved = run(
      [A.runZipStarted(), A.runZipEnded({ phase: "saved", text: "Saved" })],
      withPair(),
    );
    const next = run(
      [A.planPhotoTaken({ slot: "1b-s1", which: "a", photo: photo("q1") })],
      saved,
    );
    expect(next.runZip).toEqual({ phase: "idle", text: "" });
    const moved = run([A.planMoved(3)], saved);
    expect(moved.runZip.phase).toBe("saved");
  });
});

describe("the guided view's single-file save and camera start", () => {
  const withPair = (): FeatureMatchState =>
    run([
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
      A.planPhotoTaken({ slot: "1a-s1", which: "b", photo: photo("p2") }),
    ]);

  // Why: a single file of the measure sheet is prepared asynchronously; it
  // must hold the page busy like Download all, or Download all, a plan run
  // or Start over could start under it.
  it("holds the page busy while one file is prepared", () => {
    const going = run([A.planFileSaveStarted()], withPair());
    expect(going.busy).toBe("saving");
    expect(going.fileSave).toEqual({ preparing: true, text: "preparing..." });
    expect(featureMatchReducer(going, A.planFileSaveStarted())).toBe(going);
    expect(featureMatchReducer(going, A.runZipStarted())).toBe(going);
    expect(featureMatchReducer(going, A.runStarted("plan"))).toBe(going);
    expect(featureMatchReducer(going, A.planReset())).toBe(going);
    const busy = run([A.runStarted("plan")], withPair());
    expect(featureMatchReducer(busy, A.planFileSaveStarted())).toBe(busy);
    const done = run([A.planFileSaveEnded("saved x")], going);
    expect(done.busy).toBe("idle");
    expect(done.fileSave).toEqual({ preparing: false, text: "saved x" });
    // Only a file save in preparation ends; a zip being packed stays.
    const zip = run([A.runZipStarted()], withPair());
    expect(featureMatchReducer(zip, A.planFileSaveEnded("x"))).toBe(zip);
    const idle = withPair();
    expect(featureMatchReducer(idle, A.planFileSaveEnded("x"))).toBe(idle);
  });

  // Why: the line beside the file buttons names one pair's file; after a
  // move, a new photo or a reset it would describe a pair no longer shown.
  it("clears the single-file line when the pair or its photos change", () => {
    const saved = run(
      [A.planFileSaveStarted(), A.planFileSaveEnded("saved x")],
      withPair(),
    );
    expect(saved.fileSave.text).toBe("saved x");
    for (const a of [
      A.planMoved(1),
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p3") }),
      A.planPhotoLost({ slot: "1a-s1", which: "b" }),
      A.planReset(),
    ]) {
      expect(run([a], saved).fileSave).toEqual({ preparing: false, text: "" });
    }
    // A change that keeps the pair keeps the line.
    expect(
      run([A.planSettingsChanged({ countdown: 5 })], saved).fileSave.text,
    ).toBe("saved x");
    // A file still being prepared keeps its own line.
    const going = run([A.planFileSaveStarted()], withPair());
    expect(run([A.planMoved(1)], going).fileSave).toEqual(going.fileSave);
  });

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

describe("hands-off photo B", () => {
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
  const withA = (slot = "1a-s1"): FeatureMatchState => {
    const s = run([A.cameraChanged(true)]);
    const index = planSlots(s.plan).findIndex((sl) => sl.id === slot);
    return run(
      [
        A.planMoved(index),
        A.planPhotoTaken({ slot, which: "a", photo: photo("pa") }),
      ],
      s,
    );
  };
  const armed = (slot?: string): FeatureMatchState =>
    run([A.handsOffArmed(0)], withA(slot));

  // Why: B takes itself only where it can: the setting on, the camera on,
  // a pair the sensor can judge, photo A taken and B due, no countdown,
  // nothing busy, and once per photo A.
  it("is due only after photo A of a pair it can judge", () => {
    expect(handsOffDue(withA())).toBe(true);
    expect(handsOffDue(start())).toBe(false);
    expect(handsOffDue(run([A.cameraChanged(false)], withA()))).toBe(false);
    expect(
      handsOffDue(run([A.planSettingsChanged({ capture: "tap" })], withA())),
    ).toBe(false);
    expect(
      handsOffDue(run([A.guidedCountSet({ shot: "b", left: 3 })], withA())),
    ).toBe(false);
    expect(handsOffDue(run([A.runStarted("speed")], withA()))).toBe(false);
    expect(handsOffDue(withA("1b-s1"))).toBe(false);
    expect(handsOffDue(withA("2b-s1"))).toBe(true);
    expect(handsOffDue(armed())).toBe(false);
  });

  // Why: arming is refused unless due, so a render that arms on every
  // change cannot loop, and a bad time never starts the detector.
  it("arms once, and refuses when not due or with a bad time", () => {
    const s = armed();
    expect(s.handsOff.phase).toBe("armed");
    expect(s.handsOff.slot).toBe("1a-s1");
    expect(featureMatchReducer(s, A.handsOffArmed(5))).toBe(s);
    expect(featureMatchReducer(start(), A.handsOffArmed(0))).toEqual(start());
    const a = withA();
    expect(featureMatchReducer(a, A.handsOffArmed(Number.NaN))).toBe(a);
  });

  // Why: the flow itself - readings arrive (waiting), the phone stays
  // still for the dwell, and only then is the photo due (taking).
  it("waits for the still phone, then takes B", () => {
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

  // Why: on a pair that moves the phone, B waits for the move.
  it("stays armed on a move pair until the phone moved", () => {
    const s = run(readings(20, 3000), armed("2b-s1"));
    expect(s.handsOff.phase).toBe("armed");
    const moved = run(readings(3040, 400, fast), s);
    const t = run(readings(3460, 3000), moved);
    expect(t.handsOff.phase).toBe("taking");
  });

  // Why: a sensor that never reports, or stops, ends the wait with a
  // reason, and that photo A is not armed again: the tap is the way out.
  it("fails when the readings stop, and offers the tap", () => {
    const s = run(
      [A.handsOffSample({ t: STILL_CONFIG.lostMs + 1, rate: null })],
      armed(),
    );
    expect(s.handsOff.phase).toBe("failed");
    expect(s.handsOff.text).toMatch(/tap/i);
    expect(handsOffDue(s)).toBe(false);
    const c = run([A.guidedCountSet({ shot: "b", left: 3 })], s);
    expect(c.guided.count).toEqual({ shot: "b", left: 3 });
  });

  // Why: a tap on the big button during the wait takes B by countdown;
  // the wait ends and does not come back for the same photo A.
  it("ends on a countdown, a retake or a run, and stays off for that A", () => {
    const w = run(readings(20, 200), armed());
    for (const act of [
      A.guidedCountSet({ shot: "b", left: 3 }),
      A.guidedRetakeToggled("a"),
      A.runStarted("speed"),
    ]) {
      const s = run([act], w);
      expect(s.handsOff.phase, act.type).toBe("off");
      expect(s.handsOff.slot).toBe("1a-s1");
    }
    const off = run([A.guidedCountSet({ shot: "b", left: 3 })], w);
    expect(handsOffDue(run([A.guidedCountSet(null)], off))).toBe(false);
  });

  // Why: the drawer pauses the wait; closing it arms again. A new photo
  // A, another pair, Start over or the camera off clear it as well.
  it("clears on a pause, a move, a reset and the camera off", () => {
    const w = run(readings(20, 200), armed());
    const paused = run([A.handsOffPaused()], w);
    expect(paused.handsOff.phase).toBe("off");
    expect(handsOffDue(paused)).toBe(true);
    for (const act of [A.planMoved(1), A.planReset(), A.cameraChanged(false)]) {
      expect(run([act], w).handsOff.phase, act.type).toBe("off");
      expect(run([act], w).handsOff.slot, act.type).toBeNull();
    }
    const retakenA = run(
      [
        A.guidedRetakeToggled("a"),
        A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("pa2") }),
      ],
      w,
    );
    expect(handsOffDue(retakenA)).toBe(true);
  });

  // Why: readings are only taken while waiting; a bad one changes nothing.
  it("ignores readings when not waiting, and bad readings", () => {
    const a = withA();
    expect(
      featureMatchReducer(a, A.handsOffSample({ t: 5, rate: still })),
    ).toBe(a);
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
