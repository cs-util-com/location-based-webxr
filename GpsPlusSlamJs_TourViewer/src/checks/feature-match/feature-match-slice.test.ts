import { describe, expect, it } from "vitest";

import { PAIRS } from "./bench-export";
import {
  canSave,
  featureMatchActions as A,
  featureMatchReducer,
  flatPhase,
  initialFeatureMatchState,
  logText,
  NOTHING_MEASURED,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import { POSES, SURFACE_CLASSES } from "./flat-target";
import type { PhotoMeta } from "./run-plan";

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

const OFFERED = [{ id: "u1", file: "x.zip", text: "Download all (zip), 1 kB" }];

/** Photo A and B of one pair, its camera run done and its files offered. */
const savedPair = (meanB = 120): FeatureMatchAction[] => [
  A.photoTaken({ which: "a", photo: photo("a1") }),
  A.photoTaken({ which: "b", photo: photo("b1", meanB) }),
  A.runStarted("camera"),
  A.runFinished({ text: "done", resultsId: "r1" }),
  A.saveStarted(),
  A.saveFinished(OFFERED),
];

describe("the photo pair flow", () => {
  // Why: photo A is what fixes a pair; its running number names every file.
  it("starts a new pair at photo A, with the selector's pair and spot", () => {
    const s = run([
      A.selectorChanged({ pair: "1b", spot: 2 }),
      A.photoTaken({ which: "a", photo: photo("a1") }),
    ]);
    expect(s.progress.sequence).toBe(1);
    expect(s.pairInProgress).toMatchObject({
      pair: "1b",
      spot: 2,
      sequence: 1,
    });
    expect(s.pairNote).toEqual({ kind: "now", tag: s.pairInProgress });
    expect(s.photos).toEqual({ a: photo("a1"), b: null });
    expect(s.status.a).toBe("taken, 640x480");
    expect(s.status.run).toBe("waiting for photo B");
  });

  // Why: photo B alone has no pair to belong to.
  it("refuses photo B before photo A", () => {
    const s = run([A.photoTaken({ which: "b", photo: photo("b1") })]);
    expect(s).toEqual(start());
  });

  // Why: a photo must not replace the frames a run or a save is reading.
  it("refuses photos while a run or a save is going", () => {
    const busy = run([
      A.photoTaken({ which: "a", photo: photo("a1") }),
      A.runStarted("synthetic"),
    ]);
    expect(
      featureMatchReducer(
        busy,
        A.photoTaken({ which: "a", photo: photo("a2") }),
      ),
    ).toBe(busy);
  });

  // Why: a NaN size or an out-of-range grey mean is a broken capture.
  it("refuses a photo with a bad size or grey mean", () => {
    for (const p of [
      { ...photo("a1"), width: 0 },
      { ...photo("a1"), height: Number.NaN },
      { ...photo("a1"), greyMean: 300 },
    ]) {
      expect(run([A.photoTaken({ which: "a", photo: p })])).toEqual(start());
    }
  });

  // Why: the retake rule - files once downloaded keep their names, so a
  // photo B taken again after a download is a new take with a new number.
  it("gives photo B a new running number only after the pair was downloaded", () => {
    const before = run([
      A.photoTaken({ which: "a", photo: photo("a1") }),
      A.photoTaken({ which: "b", photo: photo("b1") }),
      A.photoTaken({ which: "b", photo: photo("b2") }),
    ]);
    expect(before.pairInProgress?.sequence).toBe(1);
    const after = run([
      ...savedPair(),
      A.filesDownloaded(),
      A.photoTaken({ which: "b", photo: photo("b2") }),
    ]);
    expect(after.pairInProgress?.sequence).toBe(2);
    expect(after.progress.sequence).toBe(2);
    expect(after.pairNote?.kind).toBe("now");
  });

  // Why: the light check is what tells a dimmed pair that was not dimmed.
  it("checks the light at photo B and withdraws the run and its files", () => {
    const s = run([
      A.selectorChanged({ pair: "1b", spot: 1 }),
      ...savedPair(200),
    ]);
    expect(s.light).toBe("not-darker");
    const again = featureMatchReducer(
      s,
      A.photoTaken({ which: "b", photo: photo("b2", 60) }),
    );
    expect(again.light).toBe("ok");
    expect(again.cameraRun).toBe("none");
    expect(again.resultsId).toBeNull();
    expect(again.offered).toEqual([]);
    expect(again.saved).toBe(false);
  });
});

describe("the download advance", () => {
  // Why: the selector walks the protocol; it must move once per pair.
  it("moves the selector to the next pair once per pair", () => {
    const s = run([...savedPair(), A.filesDownloaded()]);
    expect(s.progress.pair).toBe(PAIRS[1].key);
    expect(s.progress.advancedFor).toBe(1);
    expect(s.pairNote).toMatchObject({ kind: "next", next: { key: "1b" } });
    expect(featureMatchReducer(s, A.filesDownloaded())).toBe(s);
  });

  // Why: a pair whose light check failed must be taken again, not skipped.
  it("keeps a pair whose light check failed", () => {
    const s = run([
      A.selectorChanged({ pair: "1b", spot: 1 }),
      ...savedPair(200),
      A.filesDownloaded(),
    ]);
    expect(s.progress.pair).toBe("1b");
    expect(s.progress.advancedFor).toBe(1);
    expect(s.pairNote?.kind).toBe("kept");
  });

  // Why: with nothing offered there is nothing that was downloaded.
  it("does nothing without offered files", () => {
    const s = run([
      A.photoTaken({ which: "a", photo: photo("a1") }),
      A.photoTaken({ which: "b", photo: photo("b1") }),
    ]);
    expect(featureMatchReducer(s, A.filesDownloaded())).toBe(s);
  });
});

describe("one run or save at a time", () => {
  // Why: two runs at once would time each other.
  it("refuses a second run, and a save, while one runs", () => {
    const s = run([
      A.photoTaken({ which: "a", photo: photo("a1") }),
      A.photoTaken({ which: "b", photo: photo("b1") }),
      A.runStarted("speed"),
    ]);
    expect(s.busy).toBe("running");
    expect(featureMatchReducer(s, A.runStarted("camera"))).toBe(s);
    expect(featureMatchReducer(s, A.saveStarted())).toBe(s);
    expect(canSave(s)).toBe(false);
  });

  // Why: the camera run measures the pair; without both photos it has none.
  it("refuses a camera run without both photos", () => {
    expect(run([A.runStarted("camera")])).toEqual(start());
  });

  // Why: Save describes the run; it is offered once the run ended, whatever
  // it came to, and says when nothing was measured.
  it("ends a camera run done with results, failed without", () => {
    const pair = [
      A.photoTaken({ which: "a", photo: photo("a1") }),
      A.photoTaken({ which: "b", photo: photo("b1") }),
      A.runStarted("camera"),
    ];
    const done = run([...pair, A.runFinished({ text: "ok", resultsId: "r1" })]);
    expect(done).toMatchObject({
      busy: "idle",
      running: null,
      cameraRun: "done",
    });
    expect(done.resultsId).toBe("r1");
    expect(done.status.run).toBe("ok");
    expect(canSave(done)).toBe(true);
    const failed = run([
      ...pair,
      A.runFinished({ text: "x", resultsId: null }),
    ]);
    expect(failed.cameraRun).toBe("failed");
    expect(failed.status.save).toBe(NOTHING_MEASURED);
    expect(canSave(failed)).toBe(true);
  });

  // Why: a speed test's progress lines go to its own status line.
  it("shows a run's progress on its own status line", () => {
    const s = run([A.runStarted("speed"), A.runProgressed("arm 1")]);
    expect(s.status.speed).toBe("running: arm 1");
    expect(run([A.runProgressed("x")])).toEqual(start());
  });

  // Why: a synthetic run replaces the results on screen; Save must not
  // describe results that are gone.
  it("withdraws a finished camera run and its files", () => {
    const s = run([...savedPair(), A.cameraRunWithdrawn()]);
    expect(s.cameraRun).toBe("none");
    expect(s.offered).toEqual([]);
    expect(s.status.run).toContain("replaced");
    const none = start();
    expect(featureMatchReducer(none, A.cameraRunWithdrawn())).toBe(none);
  });

  it("saves, and a failed save offers nothing", () => {
    const ready = run(savedPair().slice(0, 5));
    expect(ready.busy).toBe("saving");
    expect(ready.status.save).toBe("preparing...");
    const failed = featureMatchReducer(ready, A.saveFailed());
    expect(failed).toMatchObject({ busy: "idle", saved: false, offered: [] });
    const saved = run(savedPair());
    expect(saved).toMatchObject({
      busy: "idle",
      saved: true,
      offered: OFFERED,
    });
  });
});

describe("selector, log and errors", () => {
  // Why: the selector's value comes from the DOM; an unknown one is ignored.
  it("ignores an unknown pair or spot", () => {
    expect(run([A.selectorChanged({ pair: "9z", spot: 1 })])).toEqual(start());
    expect(run([A.selectorChanged({ pair: "1a", spot: 0 })])).toEqual(start());
  });

  // Why: Exit of the flat mode returns to the pair picked before it.
  it("returns to the pair picked before the flat mode", () => {
    const s = run([
      A.selectorChanged({ pair: "2b", spot: 1 }),
      A.selectorChanged({ pair: "flat", spot: 1 }),
      A.flatExited(),
    ]);
    expect(s.progress.pair).toBe("2b");
  });

  // Why: a reload on the flat mode must still have a pair to exit to.
  it("starts from stored progress, exiting a stored flat mode to the first pair", () => {
    const s = initialFeatureMatchState({
      session: "s",
      progress: { sequence: 7, pair: "flat", spot: 2 },
    });
    expect(s.progress).toMatchObject({ sequence: 7, advancedFor: 7 });
    expect(s.progress.lastPair).toBe(PAIRS[0].key);
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
  // Why: in the flat mode the pair photos are not on screen; a photo there
  // would start a pair nobody sees.
  it("refuses a pair photo in the flat mode", () => {
    const s = run([A.selectorChanged({ pair: "flat", spot: 1 })]);
    expect(
      featureMatchReducer(s, A.photoTaken({ which: "a", photo: photo("a1") })),
    ).toBe(s);
  });

  // Why: after an advance Exit of a later flat mode returns to the pair the
  // protocol moved to, not to the one picked before the advance.
  it("moves the pair Exit returns to along with the advance", () => {
    const s = run([
      ...savedPair(),
      A.filesDownloaded(),
      A.selectorChanged({ pair: "flat", spot: 1 }),
      A.flatExited(),
    ]);
    expect(s.progress.pair).toBe(PAIRS[1].key);
  });

  // Why: a synthetic run must not mark the camera pair as measured.
  it("leaves the camera run alone when another run finishes", () => {
    const s = run([
      A.photoTaken({ which: "a", photo: photo("a1") }),
      A.photoTaken({ which: "b", photo: photo("b1") }),
      A.runStarted("synthetic"),
      A.runFinished({ text: "done", resultsId: "r1" }),
    ]);
    expect(s.cameraRun).toBe("none");
    expect(s.resultsId).toBeNull();
    expect(s.status.synthetic).toBe("done");
  });

  // Why: the views tell "I started it" from "it was refused" by the state's
  // identity (`accepted` in the store); a refused reducer must return the
  // very same object.
  it("returns the same state for a refused run, save or zip", () => {
    const running = run([A.runStarted("speed")]);
    expect(featureMatchReducer(running, A.runStarted("speed"))).toBe(running);
    expect(featureMatchReducer(running, A.saveStarted())).toBe(running);
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
  // Why: the plan views and the pair selector share one running number,
  // so no two takes of either ever get the same file names.
  it("raises the page's running number at a plan photo's new take", () => {
    const s = run([
      A.photoTaken({ which: "a", photo: photo("a1") }),
      A.planPhotoTaken({ slot: "1a-s1", which: "a", photo: photo("p1") }),
    ]);
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
      progress: { sequence: 1, pair: "1a", spot: 1 },
      plan,
    });
    expect(s.progress.sequence).toBe(2);
    expect(s.progress.advancedFor).toBe(2);
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
    expect(done.cameraRun).toBe("none");
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
    // A camera save that ends does not end the zip.
    expect(featureMatchReducer(going, A.saveFinished([])).runZip.phase).toBe(
      "preparing",
    );
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
