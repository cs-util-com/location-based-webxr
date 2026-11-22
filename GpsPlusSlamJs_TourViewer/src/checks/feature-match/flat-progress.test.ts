import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  afterReload,
  classSummary,
  EMPTY_PROGRESS,
  flatReducer,
  parseFlatProgress,
  poseSummary,
  flatProgressText,
  SURFACES_PER_CLASS,
  surfaceSummary,
  unsavedCount,
  type FlatAction,
  type FlatProgress,
} from "./flat-progress";
import { POSES, SURFACE_CLASSES } from "./flat-target";

const REF = {
  corners: [
    { x: 10, y: 10 },
    { x: 200, y: 12 },
    { x: 198, y: 150 },
    { x: 12, y: 148 },
  ],
  width: 1024,
  height: 768,
  rectified: { width: 190, height: 140 },
};

const run = (actions: FlatAction[], from: FlatProgress = EMPTY_PROGRESS) =>
  actions.reduce(flatReducer, from);

describe("flatReducer", () => {
  // Why: surfaces are numbered from 1 in the order they are started; the
  // number is in every file name, so it must never repeat.
  it("numbers new surfaces from 1 and selects the new one", () => {
    const s = run([
      { type: "add-surface", cls: "busy", original: false },
      { type: "add-surface", cls: "low", original: true },
    ]);
    expect(s.surfaces.map((x) => [x.id, x.cls, x.original])).toEqual([
      [1, "busy", false],
      [2, "low", true],
    ]);
    expect(s.current).toBe(2);
  });

  // Why: the first photo of a pose is its full-light shot, the reference
  // every later photo's luma ratio and bin are measured against.
  it("makes a pose's first shot the full-light one and bins the rest", () => {
    const s = run([
      { type: "add-surface", cls: "busy", original: false },
      { type: "set-reference", id: 1, reference: REF },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 100 },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 70 },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 20 },
      { type: "add-shot", id: 1, pose: "w20-t0", greyMean: 50 },
    ]);
    const shots = s.surfaces[0]!.shots;
    expect(shots.map((x) => [x.pose, x.q, x.fullLight, x.bin])).toEqual([
      ["w40-t0", 1, true, "b1"],
      ["w40-t0", 2, false, "b2"],
      ["w40-t0", 3, false, "b4"],
      ["w20-t0", 1, true, "b1"],
    ]);
    expect(shots[1]!.lumaRatio).toBeCloseTo(0.7);
  });

  // Why: a black full-light shot cannot be measured against; it is not
  // recorded, so the pose waits for a usable one.
  it("ignores a full-light shot too dark to compare against", () => {
    const s = run([
      { type: "add-surface", cls: "busy", original: false },
      { type: "set-reference", id: 1, reference: REF },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 2 },
    ]);
    expect(s.surfaces[0]!.shots).toEqual([]);
  });

  it("ignores shots before the reference and actions on unknown surfaces", () => {
    const base = run([{ type: "add-surface", cls: "busy", original: false }]);
    expect(
      run([{ type: "add-shot", id: 1, pose: "w40-t0", greyMean: 90 }], base),
    ).toBe(base);
    expect(run([{ type: "saved", id: 9 }], base)).toBe(base);
  });

  // Why: a retake may only drop a photo that was never downloaded, so a
  // file name on the device is never given to a second photo.
  it("removes a pose's last shot only while it is not saved", () => {
    const s = run([
      { type: "add-surface", cls: "text", original: false },
      { type: "set-reference", id: 1, reference: REF },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 100 },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 50 },
      { type: "remove-last-shot", id: 1, pose: "w40-t0" },
    ]);
    expect(s.surfaces[0]!.shots).toHaveLength(1);
    const saved = run(
      [
        { type: "saved", id: 1 },
        { type: "remove-last-shot", id: 1, pose: "w40-t0" },
      ],
      s,
    );
    expect(saved.surfaces[0]!.shots).toHaveLength(1);
  });

  // Why: a new reference changes the surface's rectified frame, so the
  // poses measured against the old one would not match it.
  it("refuses a new reference once the surface has shots", () => {
    const s = run([
      { type: "add-surface", cls: "text", original: false },
      { type: "set-reference", id: 1, reference: REF },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 100 },
    ]);
    const again = run(
      [{ type: "set-reference", id: 1, reference: { ...REF, width: 640 } }],
      s,
    );
    expect(again).toBe(s);
  });
});

describe("afterReload", () => {
  // Why: the photos live in memory only; after a reload only what was
  // downloaded still exists, and the progress must not claim more.
  it("keeps only what was saved", () => {
    const s = run([
      { type: "add-surface", cls: "busy", original: false },
      { type: "set-reference", id: 1, reference: REF },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 100 },
      { type: "saved", id: 1 },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 60 },
      { type: "add-surface", cls: "low", original: false },
      { type: "set-reference", id: 2, reference: REF },
    ]);
    const r = afterReload(s);
    expect(r.surfaces[0]!.shots).toHaveLength(1);
    expect(r.surfaces[0]!.reference).not.toBeNull();
    expect(r.surfaces[1]!.reference).toBeNull();
    expect(r.surfaces).toHaveLength(2);
  });
});

describe("summaries", () => {
  it("counts a pose complete with its full shot and two darker bins", () => {
    const s = run([
      { type: "add-surface", cls: "busy", original: false },
      { type: "set-reference", id: 1, reference: REF },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 100 },
      { type: "add-shot", id: 1, pose: "w40-t0", greyMean: 70 },
    ]);
    const surface = s.surfaces[0]!;
    expect(poseSummary(surface, "w40-t0")).toMatchObject({
      full: true,
      complete: false,
      bins: { b1: 1, b2: 1, b3: 0, b4: 0 },
    });
    const done = run(
      [{ type: "add-shot", id: 1, pose: "w40-t0", greyMean: 40 }],
      s,
    ).surfaces[0]!;
    expect(poseSummary(done, "w40-t0").complete).toBe(true);
    expect(surfaceSummary(done)).toMatchObject({
      posesComplete: 1,
      poses: 6,
      shots: 3,
      // Three shots and the reference, none downloaded yet.
      unsaved: 4,
      complete: false,
    });
  });

  it("reports per class how many surfaces are complete of the plan", () => {
    expect(SURFACES_PER_CLASS).toBe(5);
    const c = classSummary(
      run([{ type: "add-surface", cls: "text", original: false }]),
    );
    expect(c.map((x) => [x.cls, x.started, x.complete, x.target])).toEqual([
      ["busy", 0, 0, 5],
      ["text", 1, 0, 5],
      ["low", 0, 0, 5],
    ]);
  });
});

const action: fc.Arbitrary<FlatAction> = fc.oneof(
  fc.record({
    type: fc.constant("add-surface" as const),
    cls: fc.constantFrom(...SURFACE_CLASSES.map((c) => c.id)),
    original: fc.boolean(),
  }),
  fc.record({
    type: fc.constant("set-reference" as const),
    id: fc.integer({ min: 1, max: 4 }),
    reference: fc.constant(REF),
  }),
  fc.record({
    type: fc.constant("add-shot" as const),
    id: fc.integer({ min: 1, max: 4 }),
    pose: fc.constantFrom(...POSES.map((p) => p.id)),
    greyMean: fc.double({ min: 0, max: 255, noNaN: true }),
  }),
  fc.record({
    type: fc.constant("remove-last-shot" as const),
    id: fc.integer({ min: 1, max: 4 }),
    pose: fc.constantFrom(...POSES.map((p) => p.id)),
  }),
  fc.record({
    type: fc.constant("saved" as const),
    id: fc.integer({ min: 1, max: 4 }),
  }),
  fc.record({
    type: fc.constant("select" as const),
    id: fc.option(fc.integer({ min: 1, max: 4 }), { nil: null }),
  }),
);

describe("unsavedCount", () => {
  // Why: an attached original exists only in the page until a zip of its
  // surface was saved; a surface with an original but no reference yet
  // must not count as having nothing to lose (its memory would be freed
  // and leaving the page would not warn).
  it("counts an attached original until its surface's zip was saved", () => {
    const fresh = flatReducer(EMPTY_PROGRESS, {
      type: "add-surface",
      cls: "busy",
      original: true,
    });
    const s = fresh.surfaces[0]!;
    expect(unsavedCount(s, false)).toBe(0);
    expect(unsavedCount(s, true)).toBe(1);
    const saved = flatReducer(
      flatReducer(fresh, { type: "set-reference", id: 1, reference: REF }),
      { type: "saved", id: 1 },
    ).surfaces[0]!;
    expect(unsavedCount(saved, true)).toBe(0);
  });
});

describe("progress properties", () => {
  // Why: whatever the person taps, the stored progress reads back the same,
  // ids stay unique and ordered, each pose starts with its full-light shot,
  // and shot numbers within a pose never repeat.
  it("keeps its invariants and survives a store round trip", () => {
    fc.assert(
      fc.property(fc.array(action, { maxLength: 60 }), (actions) => {
        const s = run(actions);
        expect(parseFlatProgress(flatProgressText(s))).toEqual(s);
        expect(s.surfaces.map((x) => x.id)).toEqual(
          s.surfaces.map((_, i) => i + 1),
        );
        for (const surface of s.surfaces) {
          for (const p of POSES) {
            const shots = surface.shots.filter((x) => x.pose === p.id);
            expect(shots.map((x) => x.fullLight)).toEqual(
              shots.map((_, i) => i === 0),
            );
            const qs = shots.map((x) => x.q);
            expect(new Set(qs).size).toBe(qs.length);
          }
          // No photo of a pose before the reference exists.
          expect(surface.reference !== null || surface.shots.length === 0).toBe(
            true,
          );
        }
        const r = afterReload(s);
        expect(afterReload(r)).toEqual(r);
        expect(
          r.surfaces.every((x) => x.shots.every((shot) => shot.saved)),
        ).toBe(true);
      }),
    );
  });

  // Why: stored text can be cut off or edited; it must never break the
  // page, only start the progress over.
  it("reads damaged stored text as empty progress", () => {
    for (const t of [
      null,
      "",
      "{",
      "[]",
      '{"surfaces":5}',
      '{"surfaces":[{"id":"x"}]}',
    ]) {
      expect(parseFlatProgress(t)).toEqual(EMPTY_PROGRESS);
    }
  });
});
