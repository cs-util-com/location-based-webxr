import { describe, expect, it } from "vitest";

import {
  featureMatchActions as A,
  featureMatchReducer,
  initialFeatureMatchState,
  type FeatureMatchAction,
  type FeatureMatchState,
} from "./feature-match-slice";
import {
  endView,
  etaText,
  runMode,
  runView,
  sceneProgress,
  stripView,
} from "./guided-scene-model";
import { LIGHT_NOTE, SCENE_INTRO } from "./guided-texts";
import { planShots, type PhotoMeta } from "./run-plan";

const run = (
  actions: readonly FeatureMatchAction[],
  s: FeatureMatchState = initialFeatureMatchState({ session: "s" }),
): FeatureMatchState => actions.reduce(featureMatchReducer, s);

const photo = (id: string, greyMean = 120): PhotoMeta => ({
  id,
  width: 640,
  height: 480,
  source: { width: 1280, height: 960 },
  greyMean,
});
const GREY: Readonly<Record<string, number>> = {
  "light-s1/L3": 60,
  "light-s1/L4": 20,
};
const take = (shot: string, id = shot): FeatureMatchAction =>
  A.planShotTaken({ shot, photo: photo(id, GREY[shot] ?? 120) });
const LIGHT = ["light-s1/L1", "light-s1/L2", "light-s1/L3", "light-s1/L4"];
const ALL = planShots(initialFeatureMatchState({ session: "s" }).plan).map(
  (x) => x.id,
);
const restore = A.restoreFinished({ stored: [], results: {}, log: [] });
const cam = A.cameraChanged(true);

describe("the run screen", () => {
  // Why: the first screen of a run names the scene, its rule and the
  // first shot, with "Skip scene" since nothing of it is taken yet.
  it("starts on the light scene's L1 with a new-scene banner", () => {
    const v = runView(run([cam]));
    expect(v.mode).toBe("capture");
    expect(v.kicker).toBe("Scene 1 of 3");
    expect(v.sceneName).toBe("Light");
    expect(v.rule).toBe("still");
    expect(v.card.code).toBe("L1");
    expect(v.card.count).toBe("photo 1 of 4");
    expect(v.card.banner).toMatchObject({
      kind: "still",
      title: "New scene: Light",
      text: SCENE_INTRO.light,
    });
    expect(v.card.note).toMatch(
      /^The base photo: 3 pairs compare against it\./,
    );
    expect(v.primary).toMatchObject({
      label: "Capture L1",
      sub: "then 3 s hands off",
      disabled: false,
    });
    expect(v.secondary).toMatchObject({
      label: "Skip scene",
      act: "skip-scene",
    });
    expect(v.finder.still).toBe(true);
  });

  // Why: after the base photo the card names the change, the secondary
  // skips only this photo and the base can be laid over the finder.
  it("moves on to L2 with Skip photo and the ghost of L1", () => {
    const v = runView(run([cam, take(LIGHT[0]!, "p1")]));
    expect(v.card.code).toBe("L2");
    expect(v.card.banner).toBeNull();
    expect(v.secondary).toMatchObject({
      label: "Skip photo",
      act: "skip-photo",
    });
    expect(v.finder.ghost).toEqual({ label: "Show L1", photo: "p1" });
  });

  // Why: the button must not offer a capture the camera cannot take, and
  // a failed camera start says how to retry.
  it("waits for the camera, and says so when it failed", () => {
    const starting = runView(run([A.cameraStartSet("starting")]));
    expect(starting.primary.disabled).toBe(true);
    expect(starting.primary.sub).toBe("waiting for the camera");
    expect(starting.finder.camera).toBe("Starting the camera...");
    const failed = runView(run([A.cameraStartSet("failed")]));
    expect(failed.primary.disabled).toBe(false);
    expect(failed.primary.sub).toBe("camera unavailable: tap to retry");
  });

  // Why: a count running turns the primary into Cancel and the
  // secondary off, so a tap cannot skip the shot being taken.
  it("shows Cancel while the countdown runs", () => {
    const v = runView(
      run([cam, A.guidedCountSet({ shot: LIGHT[0]!, left: 2 })]),
    );
    expect(v.mode).toBe("counting");
    expect(v.primary).toMatchObject({ label: "Cancel", look: "counting" });
    expect(v.primary.sub).toBe("shooting L1 in 2 s");
    expect(v.secondary.disabled).toBe(true);
  });

  // Why: a taken shot tapped in the strip is a retake: the banner says
  // what it redoes, the secondary goes back to the next open shot.
  it("names what a retake of F1 redoes and goes back after", () => {
    const s = run([
      cam,
      ...LIGHT.map((id) => take(id)),
      take("flat-s1/F1"),
      A.planMoved(4),
    ]);
    const v = runView(s);
    expect(v.mode).toBe("retake");
    expect(v.card.banner?.title).toBe("Retake F1, the base photo");
    expect(v.card.banner?.text).toBe(
      "7 pairs use it, the computed turns included; they are measured again. The other photos stay.",
    );
    expect(v.primary.label).toBe("Retake F1");
    expect(v.secondary).toMatchObject({ label: "Back to F2", act: "back" });
  });

  // Why: a failed light check stays on the shot with the check's words
  // and offers to keep it anyway.
  it("warns after a failed light check and offers to keep it", () => {
    const s = run([
      cam,
      take(LIGHT[0]!),
      A.planShotTaken({ shot: LIGHT[1]!, photo: photo("x", 40) }),
    ]);
    const v = runView(s);
    expect(v.mode).toBe("warn");
    expect(v.card.banner).toMatchObject({
      kind: "warn",
      text: LIGHT_NOTE.changed,
    });
    expect(v.primary.label).toBe("Retake L2");
    expect(v.secondary).toMatchObject({ label: "Keep it, go on", act: "keep" });
  });

  // Why: with every shot taken the card says so and the primary opens
  // the end view; a chosen retake turns it back into a retake.
  it("says all done once every shot is taken", () => {
    const s = run([cam, ...ALL.map((id) => take(id))]);
    expect(runMode(s)).toBe("allDone");
    const v = runView(s);
    expect(v.card.title).toBe("Every photo is taken");
    expect(v.primary.label).toBe("See the measuring");
    expect(v.secondary.act).toBe("none");
    const r = run([A.planMoved(0), A.retakeChosen(true)], s);
    expect(runMode(r)).toBe("retake");
    expect(runView(r).secondary.label).toBe("Cancel");
  });

  // Why: the light scene's next shots get the previous check's verdict
  // as a quiet note, never a banner.
  it("notes the previous light check when it passed", () => {
    const v = runView(run([cam, take(LIGHT[0]!), take(LIGHT[1]!)]));
    expect(v.card.code).toBe("L3");
    expect(v.card.note).toMatch(/^L2: light check ok\./);
  });

  // Why: a second scene's banner names the first one still measuring,
  // so the tester knows to carry on.
  it("says the previous scene measures in the background", () => {
    const s = run([cam, restore, ...LIGHT.map((id) => take(id))]);
    const v = runView(s);
    expect(v.kicker).toBe("Scene 2 of 3");
    expect(v.rule).toBe("hand");
    expect(v.card.banner?.title).toBe("New scene: Flat surface");
    expect(v.card.banner?.extra).toBe(
      " Light is being measured in the background - carry on.",
    );
  });
});

describe("the strip", () => {
  // Why: the strip is the overview: a tab per scene with its badge and
  // the browsed scene's shots with their state.
  it("lists the scenes and the browsed scene's shots", () => {
    const s = run([cam, take(LIGHT[0]!, "p1"), A.planSkipped([LIGHT[1]!])]);
    const v = stripView(s, null);
    expect(v.segs.map((x) => x.name)).toEqual(["Light", "Flat", "Deep"]);
    expect(v.segs[0]).toMatchObject({ selected: true, now: true });
    expect(v.segs[0]!.badge).toMatchObject({ b: "waiting", text: "2 of 4" });
    expect(v.thumbs.map((t) => [t.key, t.state, t.mark])).toEqual([
      ["L1", "taken", null],
      ["L2", "skipped", null],
      ["L3", "open", "step"],
      ["L4", "open", null],
    ]);
    expect(v.thumbs[0]!.photo).toBe("p1");
    expect(v.hint).toBe("Tap a photo to retake it");
    const flat = stripView(s, "flat-s1");
    expect(flat.thumbs).toHaveLength(6);
    expect(flat.hint).toBe("");
    expect(stripView(s, "nope").segs[0]!.selected).toBe(true);
  });

  // Why: several places name the light tabs apart.
  it("numbers the light places", () => {
    const s = run([A.planSized({ spots: 2, extra: 0 })]);
    expect(stripView(s, null).segs.map((x) => x.name)).toEqual([
      "Light 1",
      "Light 2",
      "Flat",
      "Deep",
    ]);
    expect(runView(s).sceneName).toBe("Light, place 1");
  });
});

describe("scene progress", () => {
  const k = (b: string, pa: string, pb: string) => `light-s1/${b}@${pa}+${pb}`;
  const four = (): FeatureMatchState =>
    run([restore, ...LIGHT.map((id, i) => take(id, `p${String(i + 1)}`))]);

  // Why: the badge moves from waiting to measuring to done as the queue
  // works, and a failure shows as failed, not done.
  it("follows the queue from waiting to done or failed", () => {
    const k12 = k("L1-L2", "p1", "p2");
    expect(sceneProgress(four(), "light-s1").b).toBe("waiting");
    const s = run([A.queueStarted(k12)], four());
    expect(sceneProgress(s, "light-s1").b).toBe("measuring");
    const k13 = k("L1-L3", "p1", "p3");
    const k14 = k("L1-L4", "p1", "p4");
    const ok = (key: string) =>
      A.resultStored({ key, text: "ok", measureMs: 1000 });
    const one = run([ok(k12), A.queueStarted(k13)], s);
    const p = sceneProgress(one, "light-s1");
    expect(p).toMatchObject({ b: "measuring", text: "measuring 33%" });
    expect(p.leftMs).toBe(2000);
    const all = run([ok(k13), ok(k14)], one);
    expect(sceneProgress(all, "light-s1")).toMatchObject({
      b: "done",
      frac: 1,
    });
    const bad = run(
      [ok(k13), A.resultFailed({ key: k14, text: "x", persisted: true })],
      one,
    );
    expect(sceneProgress(bad, "light-s1")).toMatchObject({
      b: "failed",
      text: "1 failed",
    });
  });

  // Why: a scene whose photos were all skipped has nothing to measure.
  it("says nothing to measure for a skipped scene", () => {
    const s = run([A.planSkipped(LIGHT)]);
    expect(sceneProgress(s, "light-s1")).toMatchObject({
      b: "none",
      complete: true,
    });
  });
});

describe("the end view", () => {
  // Why: while pairs wait, the choice is offered; "Wait" turns the zip
  // button into the progress bar and makes it wait.
  it("offers good enough or wait while pairs are measured", () => {
    const s = run([
      restore,
      ...LIGHT.map((id) => take(id)),
      A.queueStarted(`light-s1/L1-L2@${LIGHT[0]!}+${LIGHT[1]!}`),
      A.guidedShown("end"),
    ]);
    const v = endView(s);
    expect(v.title).toBe("Measuring the last pairs");
    expect(v.kicker).toBe("4 of 13 photos taken");
    expect(v.choice.shown).toBe(true);
    expect(v.choice.now).toBe(
      "0 of 3 results go in now. The rest is measured on the PC later.",
    );
    expect(v.eta.text).toBe("loading the models");
    expect(v.download).toMatchObject({
      label: "Make the zip now",
      disabled: false,
    });
    const w = endView(run([A.endChoiceSet("wait")], s));
    expect(w.download).toMatchObject({
      label: "Waiting for the rest",
      disabled: true,
      waiting: 0,
    });
    expect(v.missing.map((m) => m.label)).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      "F6",
      "D1",
      "D2",
      "D3",
    ]);
    expect(v.rows[0]).toMatchObject({
      name: "Light",
      pairs: "3 pairs",
      bar: 0,
    });
    expect(v.rows[1]!.note).toBe("F1, F2, F3, F4, F5, F6 are not taken yet.");
  });

  // Why: the zip button's states follow the async rule: packing, saved,
  // and failed in red with a retry label.
  it("labels the zip by its phase, red after a failure", () => {
    const s = run([...LIGHT.map((id) => take(id))]);
    const packing = run([A.runZipStarted()], s);
    expect(endView(packing).download).toMatchObject({
      label: "Packing the zip...",
      disabled: true,
    });
    const failed = run(
      [A.runZipEnded({ phase: "failed", text: "Could not" })],
      packing,
    );
    expect(endView(failed).download).toMatchObject({
      label: "Download failed - try again",
      tone: "err",
      disabled: false,
    });
    expect(endView(failed).state).toEqual({ text: "Could not", tone: "err" });
    const saved = run(
      [A.runZipEnded({ phase: "saved", text: "Saved" })],
      packing,
    );
    expect(endView(saved).download).toMatchObject({
      label: "Download again",
      tone: "ok",
    });
    expect(endView(run([])).download).toMatchObject({
      disabled: true,
      sub: "Needs two photos of one scene first",
    });
  });

  // Why: after two crashes the queue stops; the view says so, drops the
  // choice and offers "Retry failed".
  it("says measuring stopped and offers Retry failed", () => {
    const k12 = "light-s1/L1-L2@a+b";
    const k13 = "light-s1/L1-L3@a+c";
    const s = run([
      restore,
      take(LIGHT[0]!, "a"),
      take(LIGHT[1]!, "b"),
      take(LIGHT[2]!, "c"),
      A.queueStarted(k12),
      A.workerCrashed({ key: k12, text: "crashed" }),
      A.queueStarted(k13),
      A.workerCrashed({ key: k13, text: "crashed" }),
      take(LIGHT[3]!, "d"),
    ]);
    const v = endView(s);
    expect(v.title).toBe("Measuring stopped");
    expect(v.choice.shown).toBe(false);
    expect(v.retry).toEqual({
      shown: true,
      text: "2 pairs failed on this phone (a crash or a model that did not load).",
    });
    expect(endView(run([A.failedRetried()], s)).retry.shown).toBe(false);
  });

  // Why: with everything measured the end view says so and the trust
  // line counts only what is durably stored.
  it("says everything is measured and counts the stored photos", () => {
    const s = run([
      restore,
      take(LIGHT[0]!, "a"),
      take(LIGHT[1]!, "b"),
      A.photoStored("a"),
      A.resultStored({ key: "light-s1/L1-L2@a+b", text: "ok", measureMs: 5 }),
    ]);
    const v = endView(s);
    expect(v.title).toBe("Everything is measured");
    expect(v.eta).toEqual({ text: "all done", done: true });
    expect(v.trust.text).toMatch(
      /^Saved on this phone: 1 photo, the log and 1 result\./,
    );
  });
});

describe("etaText", () => {
  // Why: short waits read in 5 s steps, long ones in minutes; nothing
  // known reads empty.
  it("rounds to 5 s under 50 s and to minutes above", () => {
    expect(etaText(null)).toBe("");
    expect(etaText(0)).toBe("");
    expect(etaText(1200)).toBe("about 5 s");
    expect(etaText(21_000)).toBe("about 25 s");
    expect(etaText(50_000)).toBe("about 1 min");
    expect(etaText(61_000)).toBe("about 2 min");
  });
});
