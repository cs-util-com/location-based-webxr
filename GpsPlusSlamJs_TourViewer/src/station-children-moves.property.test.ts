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
import {
  isStory,
  isTourBlockChild,
  type TourStationChild,
  type TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import {
  FREE_LIST,
  STORIES_LIST,
  childDropTo,
  childMayGo,
  movedChild,
  movedToStation,
  storyList,
} from "./station-children-moves.js";

// Off the centre, so a move that stands an item at it is seen.
const POSE = { position: [1, 0, 2], rotation: [0, 0, 0, 1] } as const;
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
        view: "card",
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
        kind: "folder",
        role: "story",
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
        const stories = station.children.filter((c) => isStory(c));
        const itemIds = station.children.flatMap((c) =>
          isStory(c) ? [c.id, ...c.children.map((e) => e.id)] : [c.id],
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

/**
 * Why this property matters: a move onto another station takes an item out
 * of one station and puts it into the other. Lost or doubled on the way, an
 * id breaks the tour (the format refuses an id twice); a free item left at
 * its old offset would stand somewhere near the OLD station. So over any
 * two stations and every item: a move either refuses and changes nothing,
 * or keeps every id exactly once across the two, puts the item (a story
 * with all its entries) into the target, and stands a free item at the
 * target's centre.
 */
describe("a move onto another station", () => {
  it("keeps every id once, and a free item stands at the centre (property)", () => {
    const target = holder.map((h) => ({
      id: "other",
      children: h.children.map((c) => renamed(c)),
    }));
    fc.assert(
      fc.property(holder, target, (from, to) => {
        const all = (h: { children: readonly TourStationChild[] }) =>
          h.children.flatMap((c) =>
            isStory(c) ? [c.id, ...c.children.map((e) => e.id)] : [c.id],
          );
        const before = [...all(from), ...all(to)].sort();
        for (const id of all(from)) {
          const out = movedToStation(from, to, id);
          // The same refusals as a move out to the station's free items.
          const out2 = movedChild(from, id, { place: "free" });
          const within =
            "refused" in out2 &&
            out2.refused !== "unchanged" &&
            out2.refused !== "noNesting"
              ? out2.refused
              : null;
          expect("refused" in out ? out.refused : null).toBe(within);
          if ("refused" in out) continue;
          expect([...all(out.from), ...all(out.to)].sort()).toEqual(before);
          expect(all(out.from)).not.toContain(id);
          expect(all(out.to)).toContain(id);
          // An item standing free there stands at its centre (a story
          // keeps its entries' offsets and has no pose of its own).
          const free = out.to.children.find((c) => c.id === id);
          const centre =
            free !== undefined && isTourBlockChild(free)
              ? free.pose.position
              : [0, 0, 0];
          expect(centre).toEqual([0, 0, 0]);
        }
      }),
      { numRuns: 200 },
    );
  });
});

/** `child` with ids of its own (`x` before each), so two stations share
 *  none. */
function renamed(child: TourStationChild): TourStationChild {
  if (!isStory(child)) return { ...child, id: `x${child.id}` };
  const first = `x${child.children[0]?.id ?? ""}`;
  return {
    ...child,
    id: `x${child.id}`,
    children: child.children.map((e) =>
      e.kind === "choice"
        ? {
            ...e,
            id: `x${e.id}`,
            options: e.options.map((o) =>
              o.goto === undefined ? o : { ...o, goto: first },
            ),
          }
        : { ...e, id: `x${e.id}` },
    ),
  };
}
