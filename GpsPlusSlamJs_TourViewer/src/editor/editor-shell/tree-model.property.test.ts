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
import { STATION_PREFIX, STORY_PREFIX } from "../editor-model.js";
import {
  treeClick,
  treeClickPlan,
  type TreeClickMemory,
} from "gps-plus-slam-editor-kit/chrome";
import {
  buildTree,
  stationGroups,
  treeFoldOf,
  type TreeInput,
} from "./tree-model.js";
import { stationContent, storyOf } from "../../test-support/station-content.js";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

/** A pin of id `id`. */
const pin = (id: string) =>
  ({
    id,
    kind: "shortText",
    view: "pin",
    caption: "A pin",
    createdAtIso: "2026-10-22T10:00:00Z",
    pose: POSE,
  }) as const;

/** Up to 12 stations with distinct ids, each with up to 3 pins and up to
 *  2 stories of up to 2 pins: a story is a folder inside its station, so
 *  the tree's nested folds are reached too. */
const stationList = fc
  .uniqueArray(fc.stringMatching(/^[a-z0-9]{1,4}$/), { maxLength: 12 })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id) =>
        fc
          .tuple(
            fc.integer({ min: 0, max: 3 }),
            fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 2 }),
          )
          .map(
            ([n, stories]) =>
              ({
                id,
                geo: { lat: 48, lon: 11, alt: 500, headingDeg: 0 },
                activateRadiusM: 50,
                foundRadiusM: 25,
                hint: "arrow",
                ...stationContent([
                  ...Array.from({ length: n }, (_, i) =>
                    pin(`${id}-pin${String(i)}`),
                  ),
                  ...stories.map((size, j) => {
                    const tale = `${id}-tale${String(j)}`;
                    return storyOf(
                      tale,
                      Array.from({ length: size }, (_, c) =>
                        pin(`${tale}-${String(c)}`),
                      ),
                    );
                  }),
                ]),
              }) as unknown as TourStation,
          ),
      ),
    ),
  );

/** What a click on `station` may land on: the station, a free item, a
 *  story, or a story's child. */
function clickable(station: TourStation): string[] {
  return [
    `${STATION_PREFIX}${station.id}`,
    ...tourFreeBlocks(station).map((b) => b.id),
    ...tourStories(station).flatMap((story) => [
      `${STORY_PREFIX}${story.id}`,
      ...story.children.map((c) => c.id),
    ]),
  ];
}

/** The station's stories' ids, in the tree's order. */
const storiesOf = (stations: readonly TourStation[]): string[] =>
  stations.flatMap((s) => tourStories(s).map((story) => story.id));

/** One step a creator takes in the tree: a fold, a section, a click. */
type Step =
  | { kind: "fold"; at: number; open: boolean }
  | { kind: "storyFold"; at: number; story: number; open: boolean }
  | { kind: "stray"; open: boolean }
  | { kind: "section"; section: "stations" | "codes" | "layers"; open: boolean }
  | { kind: "click"; at: number; pick: number; gap: number; detail: number };

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant("fold" as const),
    at: fc.nat(),
    open: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("storyFold" as const),
    at: fc.nat(),
    story: fc.nat(),
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
    pick: fc.nat(),
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
    if (s.kind === "storyFold") {
      const stories = tourStories(target);
      const story = stories[s.story % Math.max(1, stories.length)];
      if (story !== undefined) {
        view = reduce(view, act.storyFolded({ id: story.id, open: s.open }));
      }
      continue;
    }
    clock += s.gap;
    const ids = clickable(target);
    const id = ids[s.pick % ids.length] ?? `${STATION_PREFIX}${target.id}`;
    const click = treeClick({
      id,
      at: clock,
      detail: s.detail,
      selected: view.selected,
      last,
    });
    last = click.memory;
    const plan = treeClickPlan(click.outcome, id, stationGroups(stations), {
      groupPrefix: STATION_PREFIX,
    });
    if (plan === null) continue;
    view = reduce(view, act.selected({ id: plan.select }));
    plan.unfold.forEach((unfold, depth) => {
      view = reduce(
        view,
        depth === 0
          ? act.stationFolded({ id: unfold, open: true })
          : act.storyFolded({ id: unfold, open: true }),
      );
    });
    if (plan.toggle !== null) {
      const open = view.openStories.includes(plan.toggle);
      view = reduce(view, act.storyFolded({ id: plan.toggle, open: !open }));
    }
    if (plan.fold !== null) {
      view = reduce(view, act.stationFolded({ id: plan.fold, open: false }));
    }
    if (plan.ungrouped) {
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
          expect(fold.openStories).toEqual(
            storiesOf(s).filter((id) => view.openStories.includes(id)),
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
          for (const id of fold.openStories) {
            fresh = reduce(fresh, act.storyFolded({ id, open: true }));
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
