import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  EMPTY_PLAN,
  handsOffKind,
  keptState,
  maxSequence,
  parsePlan,
  planAfterReload,
  planReducer,
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

/** Applies the actions from the empty plan, returning plan and number. */
function run(actions: readonly PlanAction[], start = EMPTY_PLAN, seq = 0) {
  let state = { plan: start, sequence: seq };
  for (const a of actions) {
    state = planReducer(state.plan, state.sequence, a);
  }
  return state;
}

const shoot = (
  slot: string,
  which: "a" | "b",
  id: string,
  grey = 120,
): PlanAction => ({ type: "photo", slot, which, photo: photo(id, grey) });

describe("the run plan's photos", () => {
  // Why: the running number names every saved file; the first photo of a
  // slot takes the next one, and a retake before any download keeps it.
  it("numbers a slot at its first photo and keeps the number on a retake", () => {
    const { plan, sequence } = run([
      shoot("1a-s1", "a", "p1"),
      shoot("1a-s1", "b", "p2"),
      shoot("1a-s1", "a", "p3"),
      shoot("2a-s1", "a", "p4"),
    ]);
    expect(sequence).toBe(2);
    expect(plan.slots["1a-s1"]).toMatchObject({ seq: 1 });
    expect(plan.slots["2a-s1"]).toMatchObject({ seq: 2 });
    expect(plan.shots).toBe(4);
  });

  // Why: the guided view lets the tester retake A after B; B stays, and
  // the light check is redone with the new A.
  it("keeps B when A is retaken and redoes the light check", () => {
    const { plan } = run([
      shoot("1b-s1", "a", "p1", 120),
      shoot("1b-s1", "b", "p2", 60),
    ]);
    expect(plan.slots["1b-s1"]?.light).toBe("ok");
    const after = planReducer(plan, 1, shoot("1b-s1", "a", "p3", 50)).plan;
    expect(after.slots["1b-s1"]).toMatchObject({
      a: { id: "p3" },
      b: { id: "p2" },
      light: "not-darker",
    });
  });

  // Why: after a download the files of a slot exist on the phone under
  // its number; a new photo must never reuse that name. A new B keeps A
  // (the cockpit's "retake B"), a new A starts the pair over.
  it("starts a new take with a new number after the slot was downloaded", () => {
    const first = run([
      shoot("1a-s1", "a", "p1"),
      shoot("1a-s1", "b", "p2"),
      { type: "run-downloaded" },
      shoot("1a-s1", "b", "p3"),
    ]);
    expect(first.sequence).toBe(2);
    expect(first.plan.slots["1a-s1"]).toMatchObject({
      seq: 2,
      a: { id: "p1" },
      b: { id: "p3" },
      downloaded: false,
    });
    const again = run(
      [{ type: "run-downloaded" }, shoot("1a-s1", "a", "p4")],
      first.plan,
      first.sequence,
    );
    expect(again.plan.slots["1a-s1"]).toMatchObject({
      seq: 3,
      a: { id: "p4" },
      b: null,
    });
  });

  // Why: a photo for a slot the plan does not list, B before A, or a bad
  // size would put a pair in the zip that no protocol step asked for.
  it("refuses unknown slots, B without A and bad photos", () => {
    const start = EMPTY_PLAN;
    const bad: unknown[] = [
      shoot("9z-s1", "a", "p1"),
      shoot("1a-s2", "a", "p1"),
      shoot("1a-s1", "b", "p1"),
      { ...shoot("1a-s1", "a", "p1"), photo: { ...photo("p1"), width: 0 } },
      {
        ...shoot("1a-s1", "a", "p1"),
        photo: { ...photo("p1"), greyMean: 300 },
      },
      { ...shoot("1a-s1", "a", "p1"), photo: { ...photo("p1"), id: "" } },
      { ...shoot("1a-s1", "a", "p1"), which: "c" },
    ];
    for (const a of bad) {
      expect(planReducer(start, 0, a as PlanAction).plan).toBe(start);
    }
  });

  // Why: a photo the browser lost while the page was away is said, not
  // shown as taken; the slot asks for it again.
  it("forgets a lost photo and its light check", () => {
    const { plan } = run([
      shoot("1b-s1", "a", "p1", 120),
      shoot("1b-s1", "b", "p2", 60),
      { type: "lost", slot: "1b-s1", which: "b" },
    ]);
    expect(plan.slots["1b-s1"]).toMatchObject({ b: null, light: null });
    expect(
      planReducer(plan, 1, { type: "lost", slot: "1b-s1", which: "b" }).plan,
    ).toBe(plan);
  });
});

describe("the run plan's size and position", () => {
  // Why: lowering the places or extras must never throw photos away.
  it("resizes, but refuses a size that would drop a slot holding a photo", () => {
    const grown = run([{ type: "size", spots: 2, extra: 1 }]).plan;
    expect([grown.spots, grown.extra]).toEqual([2, 1]);
    const shot = planReducer(grown, 0, shoot("1a-s2", "a", "p1")).plan;
    expect(
      planReducer(shot, 1, { type: "size", spots: 1, extra: 1 }).plan,
    ).toBe(shot);
    expect(
      planReducer(shot, 1, { type: "size", spots: 2, extra: 0 }).plan,
    ).toMatchObject({ spots: 2, extra: 0 });
    expect(
      planReducer(grown, 0, { type: "size", spots: 9, extra: -1 }).plan,
    ).toMatchObject({ spots: 3, extra: 0 });
  });

  // Why: a shorter list must not leave the current slot past its end.
  it("moves to a listed slot only, and stays in the list when it shrinks", () => {
    const p = run([{ type: "move", index: 5 }]).plan;
    expect(p.current).toBe(5);
    expect(planReducer(p, 0, { type: "move", index: 99 }).plan).toBe(p);
    expect(planReducer(p, 0, { type: "move", index: -1 }).plan).toBe(p);
    expect(planReducer(p, 0, { type: "move", index: 5 }).plan).toBe(p);
    const last = run([
      { type: "size", spots: 1, extra: 2 },
      { type: "move", index: 15 },
      { type: "size", spots: 1, extra: 0 },
    ]).plan;
    expect(last.current).toBe(13);
  });
});

describe("the run plan's kept files", () => {
  const pair = [shoot("1a-s1", "a", "p1"), shoot("1a-s1", "b", "p2")];

  // Why: the cockpit's "end" save mode keeps each pair's zip until
  // Download all; its pair list reads saved, kept or warn from this.
  it("keeps a complete pair's file and marks it and its slot downloaded", () => {
    const { plan, sequence } = run([
      ...pair,
      { type: "keep", id: "k1", name: "pair-1.zip", slot: "1a-s1" },
    ]);
    expect(plan.kept).toEqual([
      {
        id: "k1",
        name: "pair-1.zip",
        slot: "1a-s1",
        seq: 1,
        downloaded: false,
      },
    ]);
    expect(keptState(plan, "1a-s1")).toBe("kept");
    const done = planReducer(plan, sequence, {
      type: "downloaded",
      ids: ["k1"],
    }).plan;
    expect(done.kept[0]?.downloaded).toBe(true);
    expect(done.slots["1a-s1"]?.downloaded).toBe(true);
    // A single file is not the run zip: `downloads` counts zips only, so
    // the end screen still offers "Download all" and the summary still
    // says the zip was not downloaded yet.
    expect(done.downloads).toBe(0);
    expect(keptState(done, "1a-s1")).toBe("saved");
    expect(
      planReducer(done, sequence, { type: "downloaded", ids: ["k1"] }).plan,
    ).toBe(done);
    const dropped = planReducer(done, sequence, {
      type: "drop-downloaded",
    }).plan;
    expect(dropped.kept).toEqual([]);
    expect(keptState(dropped, "1a-s1")).toBe("saved");
  });

  // Why: a file for a half pair or under a reused id would name a zip that
  // does not hold what it says.
  it("refuses a file for an incomplete pair, a reused id or no name", () => {
    const half = run([pair[0]!]).plan;
    expect(
      planReducer(half, 1, {
        type: "keep",
        id: "k1",
        name: "x.zip",
        slot: "1a-s1",
      }).plan,
    ).toBe(half);
    const kept = run([
      ...pair,
      { type: "keep", id: "k1", name: "x.zip", slot: "1a-s1" },
    ]).plan;
    expect(
      planReducer(kept, 1, {
        type: "keep",
        id: "k1",
        name: "y.zip",
        slot: "1a-s1",
      }).plan,
    ).toBe(kept);
    expect(
      planReducer(kept, 1, { type: "keep", id: "k2", name: "", slot: "1a-s1" })
        .plan,
    ).toBe(kept);
  });

  // Why: a failed light check shows as a warning in the pair list, ahead
  // of saved or kept.
  it("reads warn for a pair whose light check failed", () => {
    const p = run([
      shoot("1b-s1", "a", "p1", 100),
      shoot("1b-s1", "b", "p2", 100),
    ]).plan;
    expect(keptState(p, "1b-s1")).toBe("warn");
    expect(keptState(p, "2a-s1")).toBe("missing");
  });
});

describe("the run plan's downloads, settings and reset", () => {
  // Why: the guided view's one zip holds every complete pair; after it
  // they are all downloaded, and it can be downloaded again.
  it("marks every complete pair downloaded, and refuses with none", () => {
    expect(planReducer(EMPTY_PLAN, 0, { type: "run-downloaded" }).plan).toBe(
      EMPTY_PLAN,
    );
    const { plan } = run([
      shoot("1a-s1", "a", "p1"),
      shoot("1a-s1", "b", "p2"),
      shoot("1b-s1", "a", "p3"),
      { type: "run-downloaded" },
      { type: "run-downloaded" },
    ]);
    expect(plan.slots["1a-s1"]?.downloaded).toBe(true);
    expect(plan.slots["1b-s1"]?.downloaded).toBe(false);
    expect(plan.downloads).toBe(2);
  });

  // Why: settings come from buttons and stored text; only known values pass.
  it("takes known settings only", () => {
    const p = run([
      {
        type: "settings",
        settings: { save: "each", countdown: 5, sound: false, capture: "tap" },
      },
    ]).plan;
    expect(p.settings).toEqual({
      save: "each",
      countdown: 5,
      sound: false,
      capture: "tap",
    });
    expect(
      planReducer(p, 0, {
        type: "settings",
        settings: { countdown: 4, save: "x" },
      }).plan,
    ).toBe(p);
    expect(
      planReducer(p, 0, { type: "settings", settings: { countdown: 5 } }).plan,
    ).toBe(p);
  });

  // Why: Start over forgets every photo but keeps how the tester likes it.
  it("resets everything but the settings", () => {
    const { plan } = run([
      { type: "settings", settings: { countdown: 0 } },
      { type: "size", spots: 2, extra: 2 },
      shoot("1a-s1", "a", "p1"),
      { type: "reset" },
    ]);
    expect(plan).toEqual({
      ...EMPTY_PLAN,
      settings: { ...DEFAULT_SETTINGS, countdown: 0 },
    });
  });
});

describe("the run plan across reloads", () => {
  // Why: the plan is the tester's run; it must come back as it was, and a
  // damaged or foreign text must never break the page.
  it("reads back what it wrote, and nothing from bad text", () => {
    const { plan } = run([
      { type: "size", spots: 2, extra: 1 },
      shoot("1b-s2", "a", "p1", 120),
      shoot("1b-s2", "b", "p2", 60),
      { type: "keep", id: "k1", name: "a.zip", slot: "1b-s2" },
      { type: "settings", settings: { save: "each" } },
      { type: "move", index: 4 },
    ]);
    expect(parsePlan(planText(plan))).toEqual(plan);
    for (const bad of [null, "", "{", "[]", '{"v":2}', "null"]) {
      expect(parsePlan(bad)).toBeUndefined();
    }
  });

  // Why: one bad record must not lose the rest of the run.
  it("drops a bad slot record or kept file and keeps the others", () => {
    const { plan } = run([
      shoot("1a-s1", "a", "p1"),
      shoot("1b-s1", "a", "p2"),
    ]);
    const raw = JSON.parse(planText(plan)) as {
      slots: Record<string, unknown>;
      kept: unknown[];
      current: number;
      settings: Record<string, unknown>;
    };
    raw.slots["1b-s1"] = { seq: "x" };
    raw.slots["7q-s9"] = raw.slots["1a-s1"];
    raw.kept = [{ id: 3 }];
    raw.current = 999;
    raw.settings = { save: "sometimes", sound: false };
    const back = parsePlan(JSON.stringify(raw));
    expect(Object.keys(back?.slots ?? {})).toEqual(["1a-s1"]);
    expect(back?.kept).toEqual([]);
    expect(back?.current).toBe(0);
    expect(back?.settings).toEqual({ ...DEFAULT_SETTINGS, sound: false });
  });

  // Why: kept zips live in memory only; after a reload they are gone, and
  // the slots' photos (kept in the browser's database) are what remains.
  it("forgets kept files after a reload and knows the highest number", () => {
    const { plan } = run([
      shoot("1a-s1", "a", "p1"),
      shoot("1a-s1", "b", "p2"),
      { type: "keep", id: "k1", name: "a.zip", slot: "1a-s1" },
      shoot("2a-s1", "a", "p3"),
    ]);
    expect(planAfterReload(plan).kept).toEqual([]);
    expect(maxSequence(plan)).toBe(2);
    expect(maxSequence(EMPTY_PLAN)).toBe(0);
  });
});

describe("which pairs take photo B by themselves", () => {
  // Why: B right after A is only right where nothing changes; a pair that
  // moves the phone needs the move first, and a light change or the
  // tester's own pair cannot be seen by the motion sensor at all.
  it("sorts every pair into still, move or by tap", () => {
    for (const k of ["1a", "2a", "3a", "4a", "4c"]) {
      expect(handsOffKind(k), k).toBe("still");
    }
    for (const k of ["2b", "2c", "2d", "3b", "3c", "4b", "4d"]) {
      expect(handsOffKind(k), k).toBe("move");
    }
    for (const k of ["1b", "1c", "x", "", "9z"]) {
      expect(handsOffKind(k), k).toBeNull();
    }
  });
});
