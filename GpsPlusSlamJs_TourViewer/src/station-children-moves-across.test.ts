/**
 * Why these tests matter: an item dragged onto ANOTHER station leaves one
 * station's lists and joins the other's, where it must stand at the new
 * station's centre (its old offset meant a place near the old station, so
 * it would stand anywhere). The rules of a move within a station still
 * hold across: a choice or a quiz never leaves its story, a model without
 * a size never stands free, an answer that jumped to a block leaving its
 * story is dropped. A story moves whole, its entries keeping their places
 * around the station's centre. Each rule is pinned at its boundary.
 */
import { describe, expect, it } from "vitest";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type {
  TourStationChild,
  TourStory,
  TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { movedChild, movedToStation } from "./station-children-moves.js";

const POSE = { position: [1, 0.5, 2], rotation: [0, 0.6, 0, 0.8] } as const;
const CENTRE = { position: [0, 0, 0], rotation: [0, 0.6, 0, 0.8] } as const;
const TAP = { mode: "tap" } as const;

const pin = (id: string): TourBlock => ({
  id,
  kind: "shortText",
  view: "pin",
  caption: id,
  pose: POSE,
});

const line = (id: string, view = "card"): TourStoryChild =>
  ({
    id,
    kind: "shortText",
    view,
    caption: id,
    pose: POSE,
    advance: TAP,
  }) as TourStoryChild;

const story = (id: string, children: TourStoryChild[]): TourStory => ({
  id,
  kind: "folder",
  role: "story",
  title: id,
  children,
});

const choice = (id: string, goto: string): TourStoryChild => ({
  id,
  kind: "choice",
  prompt: "Go on?",
  options: [
    { id: "yes", label: "Yes", goto },
    { id: "no", label: "No" },
  ],
});

const station = (id: string, children: TourStationChild[]) => ({
  id,
  children,
});

const ids = (children: readonly { id: string }[]) => children.map((c) => c.id);

describe("movedToStation", () => {
  it("moves a free item to the other station's free items, at its centre", () => {
    const from = station("s", [story("a", [line("a1")]), pin("p")]);
    const to = station("t", [story("b", []), pin("q")]);
    const out = movedToStation(from, to, "p");
    if ("refused" in out) throw new Error(out.refused);
    expect(ids(out.from.children)).toEqual(["a"]);
    expect(ids(out.to.children)).toEqual(["b", "q", "p"]);
    expect(out.to.children[2]).toEqual({ ...pin("p"), pose: CENTRE });
    expect(out).toMatchObject({ answers: 0, floored: false });
  });

  // Why: a story's entries carry poses in their station's frame; moved
  // whole they keep their arrangement around the new centre, and the
  // story goes after the other station's stories, ahead of its free items.
  it("moves a story whole, after the other's stories, its entries' places kept", () => {
    const from = station("s", [story("a", [line("a1"), line("a2")])]);
    const to = station("t", [story("b", []), pin("q")]);
    const out = movedToStation(from, to, "a");
    if ("refused" in out) throw new Error(out.refused);
    expect(out.from.children).toEqual([]);
    expect(ids(out.to.children)).toEqual(["b", "a", "q"]);
    expect(out.to.children[1]).toEqual(from.children[0]);
  });

  it("moves a story's entry out to stand free at the other centre, its answers dropped", () => {
    const from = station("s", [
      story("a", [choice("c", "a2"), line("a1"), line("a2")]),
    ]);
    const to = station("t", []);
    const out = movedToStation(from, to, "a2");
    if ("refused" in out) throw new Error(out.refused);
    expect(out.answers).toBe(1);
    // A card cannot stand free: it takes its kind's world view.
    expect(out.floored).toBe(true);
    const moved = out.to.children[0] as TourBlock;
    expect(moved).toMatchObject({ id: "a2", pose: CENTRE, view: "pin" });
    expect("advance" in moved).toBe(false);
    expect(ids((out.from.children[0] as TourStory).children)).toEqual([
      "c",
      "a1",
    ]);
  });

  it("refuses what a move within a station refuses", () => {
    const model = {
      id: "m",
      kind: "model",
      view: "card",
      asset: "x",
      pose: POSE,
      advance: TAP,
    } as unknown as TourStoryChild;
    const from = station("s", [
      story("a", [choice("c", "a1"), line("a1"), model]),
    ]);
    const to = station("t", []);
    expect(movedToStation(from, to, "c")).toEqual({ refused: "ownStory" });
    expect(movedToStation(from, to, "m")).toEqual({
      refused: "cannotStandFree",
    });
    expect(movedToStation(from, to, "nothing")).toEqual({ refused: "missing" });
    expect(movedToStation(from, from, "a1")).toEqual({ refused: "unchanged" });
  });

  it("never changes its inputs, and a move within a station refuses a station target", () => {
    const from = station("s", [pin("p")]);
    const to = station("t", []);
    const copy = structuredClone([from, to]);
    movedToStation(from, to, "p");
    expect([from, to]).toEqual(copy);
    expect(movedChild(from, "p", { place: "station", station: "t" })).toEqual({
      refused: "missing",
    });
  });
});
