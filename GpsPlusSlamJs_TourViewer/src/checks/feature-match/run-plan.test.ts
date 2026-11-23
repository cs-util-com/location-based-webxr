import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  EMPTY_PLAN,
  isOldPlan,
  parsePlan,
  planPhotoIds,
  planReducer,
  planRetakes,
  planText,
  type PhotoMeta,
  type PlanAction,
} from "./run-plan";

const photo = (id: string, greyMean = 120): PhotoMeta => ({
  id,
  width: 640,
  height: 480,
  source: { width: 1280, height: 960 },
  greyMean,
});

const run = (actions: readonly PlanAction[], start = EMPTY_PLAN) =>
  actions.reduce(planReducer, start);

const shoot = (shot: string, id: string, grey = 120): PlanAction => ({
  type: "photo",
  shot,
  photo: photo(id, grey),
});

describe("the run plan by shots", () => {
  // Why: a photo of the current shot moves the run on to the next open
  // shot, so the tester never has to press "next".
  it("stores a photo as take 1 and moves on to the next open shot", () => {
    const p = run([shoot("light-s1/L1", "p1")]);
    expect(p.shots["light-s1/L1"]).toEqual({ photo: photo("p1"), take: 1 });
    expect(p.current).toBe(1);
    expect(planRetakes(p)).toBe(0);
  });

  // Why: a retake raises the take (it names the file, never reused) and
  // replaces the photo; the old one is gone from the plan.
  it("raises the take on a retake", () => {
    const p = run([
      shoot("light-s1/L1", "p1"),
      { type: "move", index: 0 },
      shoot("light-s1/L1", "p2"),
    ]);
    expect(p.shots["light-s1/L1"]?.take).toBe(2);
    expect(planPhotoIds(p)).toEqual(["p2"]);
    expect(planRetakes(p)).toBe(1);
  });

  // Why: the summary's retake count must not count a photo the browser
  // lost (after a reload) as a retake: the tester did not retake it.
  it("counts retakes as the takes past the first, never a lost photo", () => {
    const p = run([
      shoot("light-s1/L1", "p1"),
      { type: "lost", shot: "light-s1/L1" },
      { type: "move", index: 0 },
      shoot("light-s1/L1", "p2"),
      shoot("light-s1/L2", "p3"),
      { type: "move", index: 1 },
      shoot("light-s1/L2", "p4"),
      { type: "move", index: 1 },
      shoot("light-s1/L2", "p5"),
    ]);
    expect(p.shots["light-s1/L1"]?.take).toBe(1);
    expect(p.shots["light-s1/L2"]?.take).toBe(3);
    expect(planRetakes(p)).toBe(2);
  });

  // Why: a failed light check keeps the shot current so the tester
  // retakes it at once; a passing retake then moves on.
  it("stays on a shot whose light check fails", () => {
    const p = run([
      shoot("light-s1/L1", "p1", 100),
      shoot("light-s1/L2", "p2", 40),
    ]);
    expect(p.current).toBe(1);
    expect(run([shoot("light-s1/L2", "p3", 100)], p).current).toBe(2);
  });

  // Why: a photo of another shot (a retake picked from the list) must not
  // move the run away from where the tester is.
  it("does not move when the photo is not the current shot", () => {
    const p = run([{ type: "move", index: 5 }, shoot("light-s1/L1", "p1")]);
    expect(p.current).toBe(5);
  });

  // Why: the run wraps to an earlier open shot, and with every shot taken
  // it stays where it is (the end).
  it("wraps to an earlier open shot and stays once all are taken", () => {
    const p = run([{ type: "move", index: 12 }, shoot("deep-s1/D3", "p1")]);
    expect(p.current).toBe(0);
    const rest = [
      "light-s1/L1",
      "light-s1/L2",
      "light-s1/L3",
      "light-s1/L4",
      "flat-s1/F1",
      "flat-s1/F2",
      "flat-s1/F3",
      "flat-s1/F4",
      "flat-s1/F5",
      "flat-s1/F6",
      "deep-s1/D1",
      "deep-s1/D2",
    ];
    // Light checks pass with equal means except L3/L4, kept darker.
    const grey = (s: string) =>
      s.endsWith("L3") ? 60 : s.endsWith("L4") ? 30 : 120;
    const all = run(
      rest.map((s, i) => shoot(s, `q${String(i)}`, grey(s))),
      p,
    );
    expect(Object.keys(all.shots)).toHaveLength(13);
    expect(all.current).toBe(11);
  });

  // Why: a shot outside the list or a broken photo must never be stored.
  it("refuses an unknown shot and a bad photo", () => {
    for (const a of [
      shoot("light-s2/L1", "p1"),
      shoot("nope/F1", "p1"),
      shoot("flat-s1/F1", ""),
      {
        type: "photo",
        shot: "flat-s1/F1",
        photo: { ...photo("p"), greyMean: 300 },
      },
      { type: "photo", shot: "flat-s1/F1", photo: { ...photo("p"), width: 0 } },
    ] as PlanAction[]) {
      expect(planReducer(EMPTY_PLAN, a)).toBe(EMPTY_PLAN);
    }
  });

  // Why: a photo whose pixels the database lost is removed from the plan.
  it("forgets a lost photo, and refuses one it does not hold", () => {
    const p = run([shoot("flat-s1/F1", "p1")]);
    expect(run([{ type: "lost", shot: "flat-s1/F1" }], p).shots).toEqual({});
    expect(planReducer(p, { type: "lost", shot: "flat-s1/F2" })).toBe(p);
  });

  // Why: places and own scenes grow the list; shrinking it must never drop
  // a scene that holds a photo.
  it("sizes the run and refuses to drop a scene with a photo", () => {
    const p = run([
      { type: "size", spots: 2, extra: 1 },
      shoot("own-1/X1", "p1"),
    ]);
    expect([p.spots, p.extra]).toEqual([2, 1]);
    expect(planReducer(p, { type: "size", spots: 2, extra: 0 })).toBe(p);
    expect(run([{ type: "size", spots: 1, extra: 1 }], p).spots).toBe(1);
    expect(planReducer(p, { type: "size", spots: 9, extra: 99 }).spots).toBe(3);
  });

  // Why: the shot index comes from a tap; outside the list it is refused.
  it("moves inside the list only", () => {
    expect(run([{ type: "move", index: 12 }]).current).toBe(12);
    for (const index of [-1, 13, 1.5, Number.NaN]) {
      expect(planReducer(EMPTY_PLAN, { type: "move", index })).toBe(EMPTY_PLAN);
    }
  });

  // Why: the settings come from form controls; an unknown key or value is
  // refused whole, and the save mode is gone.
  it("changes known settings only", () => {
    expect(
      run([{ type: "settings", settings: { countdown: 5 } }]).settings,
    ).toEqual({
      ...DEFAULT_SETTINGS,
      countdown: 5,
    });
    for (const s of [{ countdown: 4 }, { save: "end" }, { capture: "x" }]) {
      expect(planReducer(EMPTY_PLAN, { type: "settings", settings: s })).toBe(
        EMPTY_PLAN,
      );
    }
  });

  // Why: a new run keeps how the tester likes to shoot.
  it("resets to an empty run with the settings kept", () => {
    const p = run([
      { type: "settings", settings: { countdown: 0 } },
      { type: "size", spots: 2, extra: 2 },
      shoot("light-s1/L1", "p1"),
      { type: "reset" },
    ]);
    expect(p).toEqual({
      ...EMPTY_PLAN,
      settings: { ...DEFAULT_SETTINGS, countdown: 0 },
    });
  });
});

describe("the run plan across reloads", () => {
  // Why: the plan is the tester's run; it must come back as it was, and a
  // damaged or foreign text must never break the page.
  it("reads back what it wrote, and nothing from bad text", () => {
    const p = run([
      { type: "size", spots: 2, extra: 1 },
      shoot("light-s2/L3", "p1", 60),
      { type: "settings", settings: { capture: "tap" } },
      { type: "move", index: 4 },
    ]);
    expect(parsePlan(planText(p))).toEqual(p);
    for (const bad of [null, "", "{", "[]", '{"v":3}', "null"]) {
      expect(parsePlan(bad)).toBeUndefined();
    }
  });

  // Why: a stored pair-slot plan is not migrated; the store discards it
  // with one log line, so it must be told apart from no plan at all.
  it("reads no old version-1 plan and recognises one", () => {
    const old = JSON.stringify({
      v: 1,
      spots: 1,
      extra: 0,
      slots: {},
      kept: [],
    });
    expect(parsePlan(old)).toBeUndefined();
    expect(isOldPlan(old)).toBe(true);
    for (const t of [null, "{", planText(EMPTY_PLAN)]) {
      expect(isOldPlan(t)).toBe(false);
    }
  });

  // Why: one bad record must not lose the rest of the run.
  it("drops a bad record or setting and keeps the others", () => {
    const p = run([shoot("light-s1/L1", "p1"), shoot("light-s1/L2", "p2")]);
    const raw = JSON.parse(planText(p)) as {
      shots: Record<string, unknown>;
      current: number;
      settings: Record<string, unknown>;
    };
    raw.shots["light-s1/L2"] = { photo: photo("p2"), take: 0 };
    raw.shots["light-s3/L1"] = raw.shots["light-s1/L1"];
    raw.current = 999;
    raw.settings = { save: "each", sound: false };
    const back = parsePlan(JSON.stringify(raw));
    expect(Object.keys(back?.shots ?? {})).toEqual(["light-s1/L1"]);
    expect(back?.current).toBe(0);
    expect(back?.settings).toEqual({ ...DEFAULT_SETTINGS, sound: false });
  });
});
