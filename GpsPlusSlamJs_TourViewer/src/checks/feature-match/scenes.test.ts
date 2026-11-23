import { describe, expect, it } from "vitest";

import { lightCheck } from "./bench-export";
import {
  derivedPairs,
  lightOf,
  MAX_EXTRA,
  nextOpen,
  pairFolderTag,
  pairsUsing,
  previousInScene,
  readyPairs,
  resultKey,
  runZipName,
  sceneList,
  shotList,
  summaryText,
  type ShotPhotos,
} from "./scenes";

const photos = (ids: Record<string, number>): ShotPhotos =>
  Object.fromEntries(
    Object.entries(ids).map(([shot, greyMean]) => [
      shot,
      { id: `p-${shot}`, greyMean },
    ]),
  );

describe("the run's scenes and shots", () => {
  // Why: the shot ids name the files and the stored records; a change here
  // renames every download and loses every stored plan.
  it("lists light per place, then flat, deep and the own scenes", () => {
    expect(sceneList(2, 1).map((s) => s.id)).toEqual([
      "light-s1",
      "light-s2",
      "flat-s1",
      "deep-s1",
      "own-1",
    ]);
    expect(shotList(1, 0).map((s) => s.id)).toEqual([
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
      "deep-s1/D3",
    ]);
  });

  // Why: one place is 13 shots and the largest plan 37 (the plan's
  // numbers), and the counts come from buttons that could send anything.
  it("has 13 shots for one place and 37 at most, clamped", () => {
    expect(shotList(1, 0)).toHaveLength(13);
    expect(shotList(3, MAX_EXTRA)).toHaveLength(37);
    expect(shotList(0, -2)).toEqual(shotList(1, 0));
    expect(shotList(Number.NaN, Number.NaN)).toEqual(shotList(1, 0));
    expect(shotList(9, 99)).toEqual(shotList(3, MAX_EXTRA));
  });

  // Why: the gyroscope sees a turn and rest, not a step or a light
  // change; only the "again" shots and the tilt may take themselves.
  it("lets only the repeat shots and the tilt take themselves", () => {
    const auto = shotList(1, 1)
      .filter((s) => s.handsOff !== null)
      .map((s) => `${s.key}:${String(s.handsOff)}`);
    expect(auto).toEqual(["L2:still", "F2:still", "F3:move", "D2:still"]);
  });

  // Why: places repeat the light scene only; flat and deep stay at place 1.
  it("puts the light scenes at their place and the rest at place 1", () => {
    const spots = shotList(3, 0).map((s) => `${s.scene}:${String(s.spot)}`);
    expect(new Set(spots)).toEqual(
      new Set([
        "light-s1:1",
        "light-s2:2",
        "light-s3:3",
        "flat-s1:1",
        "deep-s1:1",
      ]),
    );
  });
});

describe("the previous shot in a scene", () => {
  // Why: the thumb, the ghost and the hands-off wait compare a shot with
  // the one before it in its scene; across a scene boundary there is none.
  it("is the shot before, except on a scene's first shot", () => {
    const list = shotList(2, 1);
    list.forEach((s, i) => {
      const prev = previousInScene(list, i);
      if (s.step === 0) {
        expect(prev, s.id).toBeUndefined();
      } else {
        expect(prev?.id, s.id).toBe(list[i - 1]!.id);
        expect(prev?.scene, s.id).toBe(s.scene);
      }
    });
    expect(previousInScene(list, -1)).toBeUndefined();
    expect(previousInScene(list, list.length)).toBeUndefined();
  });
});

describe("the derived pairs", () => {
  // Why: the PC keeps one vocabulary across old and new zips through the
  // legacy keys; the table of the plan is pinned here row by row.
  it("derives the plan's table with its legacy keys", () => {
    const rows = derivedPairs(1, 1).map(
      (p) => `${p.id} ${p.a}+${p.b} ${p.kind} ${p.legacy ?? "-"}`,
    );
    expect(rows).toEqual([
      "light-s1/L1-L2 light-s1/L1+light-s1/L2 real 1a",
      "light-s1/L1-L3 light-s1/L1+light-s1/L3 real 1b",
      "light-s1/L1-L4 light-s1/L1+light-s1/L4 real 1c",
      "flat-s1/F1-F2 flat-s1/F1+flat-s1/F2 real 2a",
      "flat-s1/F1-T0 flat-s1/F1+flat-s1/F2 turn0 -",
      "flat-s1/F1-T90 flat-s1/F1+flat-s1/F2 turn90 2b",
      "flat-s1/F1-T180 flat-s1/F1+flat-s1/F2 turn180 2c",
      "flat-s1/F1-F3 flat-s1/F1+flat-s1/F3 real 2d",
      "flat-s1/F1-F4 flat-s1/F1+flat-s1/F4 real 3b",
      "flat-s1/F5-F4 flat-s1/F5+flat-s1/F4 real 3c",
      "flat-s1/F1-F6 flat-s1/F1+flat-s1/F6 real 4b",
      "deep-s1/D1-D2 deep-s1/D1+deep-s1/D2 real 4c",
      "deep-s1/D1-D3 deep-s1/D1+deep-s1/D3 real 4d",
      "own-1/X1-X2 own-1/X1+own-1/X2 real x",
    ]);
  });

  // Why: the controls the PC compares each axis with are named in the
  // table's "Axis control for" column.
  it("marks the axis controls", () => {
    const controls = derivedPairs(1, 0)
      .filter((p) => p.controlFor.length > 0)
      .map((p) => `${p.name}:${p.controlFor.join(",")}`);
    expect(controls).toEqual([
      "L1-L2:light",
      "F1-F2:scale,side-flat,oblique",
      "F1-T0:rot",
      "D1-D2:side-deep",
    ]);
  });

  // Why: the retake text names how many measurements a retake redoes.
  it("counts the pairs each shot is in", () => {
    const pairs = derivedPairs(1, 0);
    const n = (shot: string) => pairsUsing(pairs, shot).length;
    expect(n("flat-s1/F1")).toBe(7);
    expect(n("flat-s1/F2")).toBe(4);
    expect(n("flat-s1/F4")).toBe(2);
    expect(n("light-s1/L1")).toBe(3);
    expect(n("light-s1/L3")).toBe(1);
    expect(n("deep-s1/D3")).toBe(1);
  });

  // Why: a pair is ready exactly when both shots have a photo.
  it("is ready when both shots have a photo", () => {
    const pairs = derivedPairs(1, 0);
    const ready = readyPairs(
      pairs,
      photos({ "flat-s1/F1": 100, "flat-s1/F2": 100, "flat-s1/F4": 90 }),
    );
    expect(ready.map((p) => p.name)).toEqual([
      "F1-F2",
      "F1-T0",
      "F1-T90",
      "F1-T180",
      "F1-F4",
    ]);
  });

  // Why: a result is stored under its photos' ids, so a retake leaves
  // no stale result behind.
  it("keys a result by the pair and both photo ids", () => {
    const [p] = derivedPairs(1, 0);
    expect(resultKey(p!, "a1", "b2")).toBe("light-s1/L1-L2@a1+b2");
  });
});

describe("the zip folder of a pair", () => {
  // Why: the PC side finds a pair by its old key in the folder name; the
  // rotation control has no old key and must still get a unique folder.
  it("uses the legacy key, else the pair's own name, and the run number", () => {
    const pairs = derivedPairs(2, 1);
    for (const [i, p] of pairs.entries()) {
      const t = pairFolderTag(p, i + 1);
      expect(t.sequence).toBe(i + 1);
      expect(t.spot).toBe(p.spot);
      expect(t.pair).toBe(p.legacy ?? p.name.toLowerCase());
    }
    const control = pairs.find((p) => p.legacy === null)!;
    expect(pairFolderTag(control, 3).pair).toBe("f1-t0");
    for (const n of [0, 1.5, Number.NaN]) {
      expect(() => pairFolderTag(control, n)).toThrow(/sequence/);
      expect(() => pairFolderTag(pairs[0]!, n)).toThrow();
    }
  });
});

describe("the light check per shot", () => {
  // Why: the light checks keep their old rules: L2 like the control pair,
  // L3 and L4 like the dimmed pairs, all against L1.
  it("checks L2, L3 and L4 against L1 with the old rules", () => {
    const ph = photos({
      "light-s1/L1": 100,
      "light-s1/L2": 70,
      "light-s1/L3": 90,
      "light-s1/L4": 40,
    });
    expect(lightOf("light-s1/L2", ph)).toBe(lightCheck("1a", 100, 70));
    expect(lightOf("light-s1/L3", ph)).toBe(lightCheck("1b", 100, 90));
    expect(lightOf("light-s1/L4", ph)).toBe("ok");
    expect(lightOf("light-s1/L1", ph)).toBeNull();
    expect(lightOf("flat-s1/F1", ph)).toBeNull();
    expect(lightOf("light-s2/L2", ph)).toBeNull();
  });

  // Why: the new ordering rule: the very dark shot must not be brighter
  // than the dimmed one, with no tolerance.
  it("warns when L4 is not darker than L3", () => {
    const ph = photos({
      "light-s1/L1": 100,
      "light-s1/L3": 40,
      "light-s1/L4": 41,
    });
    expect(lightOf("light-s1/L4", ph)).toBe("not-darker-than-dimmed");
    expect(
      lightOf("light-s1/L4", {
        ...ph,
        "light-s1/L4": { id: "x", greyMean: 40 },
      }),
    ).toBe("ok");
  });
});

describe("the next open shot", () => {
  // Why: after a photo the run moves on to the first open shot after it,
  // then wraps to an earlier one; with none left the run is complete.
  it("finds the next shot without a photo, wrapping, or none", () => {
    const list = shotList(1, 0);
    const ph = photos({ "light-s1/L1": 100, "light-s1/L3": 80 });
    expect(nextOpen(list, ph, 0)).toBe(1);
    expect(nextOpen(list, ph, 1)).toBe(3);
    expect(nextOpen(list, ph, 12)).toBe(1);
    const all = photos(Object.fromEntries(list.map((s) => [s.id, 100])));
    expect(nextOpen(list, all, 4)).toBeNull();
  });
});

describe("the run summary", () => {
  // Why: the tester pastes this back; it must say what is missing and
  // name no place or time.
  it("lists shots taken, missing, pairs ready and light checks", () => {
    const text = summaryText({
      session: "abcd1234",
      spots: 1,
      extra: 0,
      photos: photos({ "light-s1/L1": 100, "light-s1/L2": 40 }),
      shotsTaken: 3,
      device: "Pixel test",
    });
    expect(text).toContain("Session: abcd1234");
    expect(text).toContain("Shots taken: 2 of 13 (light at 1 place)");
    expect(text).toContain("Missing: light-s1/L3, light-s1/L4, flat-s1/F1");
    expect(text).toContain("Pairs ready: 1 of 13");
    expect(text).toContain("Light checks: light-s1/L2 changed");
    expect(text).toContain("Retakes: 1");
    expect(text).toContain(`File: ${runZipName("abcd1234")}`);
    expect(text).toContain("Measured: none on the phone, measure on the PC");
  });
});
