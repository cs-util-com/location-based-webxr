/**
 * Why this property matters: the tree's drag lights up
 * the lists `childMayGo` names, and the drop then asks `movedChild` for the
 * move. Where the two disagree the drag offers a list and the drop refuses
 * it (a model without a size dragged out of its story was one), which reads
 * as a broken drop. So over any station - stories with blocks, choices and
 * models with and without a size, free items - every item and every list
 * must agree: a list is offered exactly when some drop into it is taken
 * (or keeps the item where it is, as a drop on its own place does).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  TourStationChild,
  TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import {
  FREE_LIST,
  STORIES_LIST,
  childDropTo,
  childMayGo,
  movedChild,
  storyList,
} from "./station-children-moves.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;
const TAP = { mode: "tap" } as const;

type Make = "line" | "choice" | "sizedModel" | "unsizedModel";

/** A story entry of the kind `make`; a choice's answer jumps to `to`. */
function entry(id: string, make: Make, to: string): TourStoryChild {
  switch (make) {
    case "line":
      return {
        id,
        kind: "shortText",
        view: "card",
        caption: id,
        pose: POSE,
        advance: TAP,
      };
    case "choice":
      return {
        id,
        kind: "choice",
        prompt: "On?",
        options: [
          { id: "yes", label: "Yes", goto: to },
          { id: "no", label: "No" },
        ],
      };
    case "sizedModel":
      return {
        id,
        kind: "model",
        view: "placed",
        asset: "m",
        sizeM: 2,
        pose: POSE,
        advance: TAP,
      };
    case "unsizedModel":
      return {
        id,
        kind: "model",
        view: "stage",
        asset: "m",
        pose: POSE,
        advance: TAP,
      };
  }
}

const make = fc.constantFrom<Make>(
  "line",
  "choice",
  "sizedModel",
  "unsizedModel",
);

/** A station: up to three stories of up to four entries, up to two free
 *  pins. A choice jumps to its story's first entry. */
const holder = fc
  .record({
    stories: fc.array(fc.array(make, { maxLength: 4 }), { maxLength: 3 }),
    free: fc.nat({ max: 2 }),
  })
  .map(({ stories, free }) => {
    const children: TourStationChild[] = stories.map((makes, s) => {
      const first = `s${String(s)}e0`;
      return {
        id: `s${String(s)}`,
        kind: "story",
        title: `Story ${String(s)}`,
        children: makes.map((m, e) =>
          entry(`s${String(s)}e${String(e)}`, m, first),
        ),
      };
    });
    for (let i = 0; i < free; i++) {
      children.push({
        id: `f${String(i)}`,
        kind: "shortText",
        view: "pin",
        caption: "free",
        pose: POSE,
      });
    }
    return { id: "st", children };
  });

describe("the drag's lists and the move rule", () => {
  it("offer a list exactly when some drop into it is taken (property)", () => {
    fc.assert(
      fc.property(holder, (station) => {
        const stories = station.children.filter((c) => c.kind === "story");
        const itemIds = station.children.flatMap((c) =>
          c.kind === "story" ? [c.id, ...c.children.map((e) => e.id)] : [c.id],
        );
        const lists = [
          FREE_LIST,
          STORIES_LIST,
          ...stories.map((s) => storyList(s.id)),
          storyList("gone"),
        ];
        const slotsOf = (list: string): number => {
          if (list === STORIES_LIST) return stories.length;
          const story = stories.find((s) => storyList(s.id) === list);
          return story === undefined ? 0 : story.children.length;
        };
        for (const id of [...itemIds, "gone"]) {
          for (const list of lists) {
            const drops = [
              { into: true } as const,
              ...Array.from({ length: slotsOf(list) + 1 }, (_, slot) => ({
                slot,
              })),
            ];
            const taken = drops.some((drop) => {
              const to = childDropTo(station, list, drop);
              if (to === null) return false;
              const out = movedChild(station, id, to);
              return !("refused" in out) || out.refused === "unchanged";
            });
            expect(childMayGo(station, id, list), `${id} -> ${list}`).toBe(
              taken,
            );
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
