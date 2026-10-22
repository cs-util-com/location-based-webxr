/**
 * Why these tests matter: the tree's folds live in `editorView`, not in
 * the tree's DOM, so the 3D view can be closed and opened again, and the
 * map page can read the same copy. That only holds if the fold state
 * round-trips: whatever station list the tour has and whatever clicks
 * and folds came before, the tree drawn from the store shows exactly the
 * folds the store holds, a fresh store given back what the tree shows
 * draws the same tree, and the order of the stations changes which cards
 * are drawn where but never which are unfolded.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  editorViewActions as act,
  editorViewReducer as reduce,
  initialEditorViewState,
  type EditorViewState,
} from "../editor-view.js";
import {
  treeClick,
  treeClickPlan,
  type TreeClickMemory,
} from "./tree-click.js";
import { buildTree, treeFoldOf, type TreeInput } from "./tree-model.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

/** Up to 12 stations with distinct ids, each with up to 3 pins. */
const stationList = fc
  .uniqueArray(fc.stringMatching(/^[a-z0-9]{1,4}$/), { maxLength: 12 })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id) =>
        fc.integer({ min: 0, max: 3 }).map(
          (n) =>
            ({
              id,
              geo: { lat: 48, lon: 11, alt: 500, headingDeg: 0 },
              activateRadiusM: 50,
              foundRadiusM: 25,
              hint: "arrow",
              steps: [],
              items: Array.from({ length: n }, (_, i) => ({
                id: `${id}-pin${String(i)}`,
                kind: "pin",
                label: "A pin",
                createdAtIso: "2026-10-22T10:00:00Z",
                pose: POSE,
              })),
            }) as unknown as TourStation,
        ),
      ),
    ),
  );

/** One step a creator takes in the tree: a fold, a section, a click. */
type Step =
  | { kind: "fold"; at: number; open: boolean }
  | { kind: "stray"; open: boolean }
  | { kind: "section"; section: "stations" | "codes" | "layers"; open: boolean }
  | { kind: "click"; at: number; item: boolean; gap: number; detail: number };

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant("fold" as const),
    at: fc.nat(),
    open: fc.boolean(),
  }),
  fc.record({ kind: fc.constant("stray" as const), open: fc.boolean() }),
  fc.record({
    kind: fc.constant("section" as const),
    section: fc.constantFrom(
      "stations" as const,
      "codes" as const,
      "layers" as const,
    ),
    open: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("click" as const),
    at: fc.nat(),
    item: fc.boolean(),
    gap: fc.integer({ min: 0, max: 1000 }),
    detail: fc.integer({ min: 1, max: 2 }),
  }),
);

function tree(stations: readonly TourStation[], view: EditorViewState) {
  const input: TreeInput = {
    stations,
    assets: [],
    codes: [],
    view,
    layers: ["codes", "names"],
  };
  return buildTree(input);
}

/** The view after `steps` on `stations`, clicks going through the tree's
 *  own click rule and plan. */
function run(stations: readonly TourStation[], steps: readonly Step[]) {
  let view = initialEditorViewState;
  let last: TreeClickMemory = { id: null, at: Number.NEGATIVE_INFINITY };
  let clock = 0;
  for (const s of steps) {
    if (s.kind === "section") {
      view = reduce(
        view,
        act.sectionFolded({ section: s.section, open: s.open }),
      );
      continue;
    }
    if (s.kind === "stray") {
      view = reduce(view, act.stationFolded({ id: "no-such", open: s.open }));
      continue;
    }
    const target = stations[s.at % Math.max(1, stations.length)];
    if (target === undefined) continue;
    if (s.kind === "fold") {
      view = reduce(view, act.stationFolded({ id: target.id, open: s.open }));
      continue;
    }
    clock += s.gap;
    const item = s.item ? target.items[0] : undefined;
    const id = item?.id ?? `station:${target.id}`;
    const click = treeClick({
      id,
      at: clock,
      detail: s.detail,
      selected: view.selected,
      last,
    });
    last = click.memory;
    const plan = treeClickPlan(click.outcome, id, stations);
    if (plan === null) continue;
    view = reduce(view, act.selected({ id: plan.select }));
    if (plan.unfold !== null) {
      view = reduce(view, act.stationFolded({ id: plan.unfold, open: true }));
    }
    if (plan.fold !== null) {
      view = reduce(view, act.stationFolded({ id: plan.fold, open: false }));
    }
    if (plan.openCodes) {
      view = reduce(view, act.sectionFolded({ section: "codes", open: true }));
    }
  }
  return view;
}

describe("the tree's fold state, for any station list and any run of steps", () => {
  it("is drawn exactly as editorView holds it", () => {
    fc.assert(
      fc.property(
        stationList,
        fc.array(step, { maxLength: 40 }),
        (s, steps) => {
          const view = run(s, steps);
          const fold = treeFoldOf(tree(s, view));
          expect(fold.openStations).toEqual(
            s.map((x) => x.id).filter((id) => view.openStations.includes(id)),
          );
          expect(fold.openSections).toEqual(view.openSections);
        },
      ),
    );
  });

  it("round-trips: a fresh view given the drawn folds draws the same tree", () => {
    fc.assert(
      fc.property(
        stationList,
        fc.array(step, { maxLength: 40 }),
        (s, steps) => {
          const view = run(s, steps);
          const drawn = tree(s, view);
          const fold = treeFoldOf(drawn);
          let fresh = reduce(
            initialEditorViewState,
            act.selected({ id: view.selected }),
          );
          for (const id of fold.openStations) {
            fresh = reduce(fresh, act.stationFolded({ id, open: true }));
          }
          for (const [section, open] of Object.entries(fold.openSections)) {
            fresh = reduce(
              fresh,
              act.sectionFolded({
                section: section as "stations" | "codes" | "layers",
                open,
              }),
            );
          }
          expect(tree(s, fresh)).toEqual(drawn);
        },
      ),
    );
  });

  it("keeps the same stations unfolded when the list is reordered", () => {
    fc.assert(
      fc.property(
        stationList,
        fc.array(step, { maxLength: 40 }),
        fc.nat(),
        (s, steps, seed) => {
          const view = run(s, steps);
          const shuffled = [...s].sort(
            (x, y) =>
              ((x.id.charCodeAt(0) * 31 + seed) % 17) -
              ((y.id.charCodeAt(0) * 31 + seed) % 17),
          );
          const open = (list: readonly TourStation[]) =>
            new Set(treeFoldOf(tree(list, view)).openStations);
          expect(open(shuffled)).toEqual(open(s));
        },
      ),
    );
  });
});
