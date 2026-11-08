/**
 * Why these tests matter: a move takes an item out of one list and puts it
 * into another, and every list has its own rule. An item outside a story
 * stands in the world and needs a view that can; an item inside one moves
 * on by a tap; an answer that jumped to a moved item would jump into
 * another story, which the format refuses. Each rule is pinned here at its
 * boundary, the refusals included, so a move can never write a tour the
 * next open refuses.
 */
import { describe, expect, it } from "vitest";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type {
  TourStationChild,
  TourStory,
  TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import {
  FREE_LIST,
  STORIES_LIST,
  childDropTo,
  childMayGo,
  childStepTo,
  movedChild,
  storyList,
} from "./station-children-moves.js";

const POSE = { position: [1, 0, 2], rotation: [0, 0, 0, 1] } as const;
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
  kind: "story",
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

function station(children: TourStationChild[]) {
  return { id: "s", children };
}

const ids = (children: readonly { id: string }[]) => children.map((c) => c.id);

function storyOf(
  holder: { children: readonly TourStationChild[] },
  id: string,
) {
  const found = holder.children.find(
    (c): c is TourStory => c.kind === "story" && c.id === id,
  );
  if (found === undefined) throw new Error(`no story ${id}`);
  return found;
}

describe("movedChild", () => {
  it("moves a free pin into a story at a place, moving on by a tap", () => {
    const out = movedChild(
      station([story("a", [line("a1"), line("a2")]), pin("p")]),
      "p",
      { place: "story", story: "a", index: 1 },
    );
    if (!("station" in out)) throw new Error(out.refused);
    expect(ids(storyOf(out.station, "a").children)).toEqual(["a1", "p", "a2"]);
    expect(storyOf(out.station, "a").children[1]).toMatchObject({
      view: "pin",
      advance: TAP,
      pose: POSE,
    });
    expect(ids(out.station.children)).toEqual(["a"]);
  });

  it("moves a story block out: it stands free, without its advance", () => {
    const out = movedChild(station([story("a", [line("a1", "pin")])]), "a1", {
      place: "free",
    });
    if (!("station" in out)) throw new Error(out.refused);
    const free = out.station.children[1] as unknown as Record<string, unknown>;
    expect(free).toMatchObject({ id: "a1", view: "pin" });
    expect(Object.hasOwn(free, "advance")).toBe(false);
    expect(out.floored).toBe(false);
  });

  // Why: a story card cannot stand in the world; leaving the story it
  // takes its kind's world floor by the format's own rule.
  it("gives a story card its kind's free view when it leaves", () => {
    const out = movedChild(station([story("a", [line("a1")])]), "a1", {
      place: "free",
    });
    if (!("station" in out)) throw new Error(out.refused);
    expect(out.station.children[1]).toMatchObject({ view: "pin" });
    expect(out.floored).toBe(true);
  });

  it("refuses a model without a size out of a story", () => {
    const model = {
      id: "m",
      kind: "model",
      view: "stage",
      model: "arch",
      pose: POSE,
      advance: TAP,
    } as unknown as TourStoryChild;
    const out = movedChild(station([story("a", [model])]), "m", {
      place: "free",
    });
    expect(out).toEqual({ refused: "cannotStandFree" });
  });

  it("moves a block between two stories, keeping its advance", () => {
    const auto = { ...line("a1"), advance: { mode: "auto", afterS: 3 } };
    const out = movedChild(
      station([story("a", [auto as TourStoryChild]), story("b", [line("b1")])]),
      "a1",
      { place: "story", story: "b", index: 0 },
    );
    if (!("station" in out)) throw new Error(out.refused);
    expect(ids(storyOf(out.station, "a").children)).toEqual([]);
    expect(storyOf(out.station, "b").children[0]).toMatchObject({
      id: "a1",
      advance: { mode: "auto", afterS: 3 },
    });
  });

  it("reorders inside a story by the slot before the move, gotos kept", () => {
    const out = movedChild(
      station([story("a", [choice("c", "a2"), line("a1"), line("a2")])]),
      "a2",
      { place: "story", story: "a", index: 1 },
    );
    if (!("station" in out)) throw new Error(out.refused);
    expect(ids(storyOf(out.station, "a").children)).toEqual(["c", "a2", "a1"]);
    expect(out.answers).toBe(0);
  });

  it("drops the answers that jumped to a block leaving its story", () => {
    const out = movedChild(
      station([story("a", [choice("c", "a1"), line("a1")]), story("b", [])]),
      "a1",
      { place: "story", story: "b", index: 0 },
    );
    if (!("station" in out)) throw new Error(out.refused);
    expect(out.answers).toBe(1);
    const left = storyOf(out.station, "a").children[0];
    expect(left).toMatchObject({ kind: "choice" });
    expect(
      (left as unknown as { options: { goto?: string }[] }).options.some(
        (o) => o.goto !== undefined,
      ),
    ).toBe(false);
  });

  it("keeps a choice inside its own story", () => {
    const out = movedChild(
      station([story("a", [choice("c", "a1"), line("a1")]), story("b", [])]),
      "c",
      { place: "story", story: "b", index: 0 },
    );
    expect(out).toEqual({ refused: "ownStory" });
    expect(
      movedChild(station([story("a", [choice("c", "a1")])]), "c", {
        place: "free",
      }),
    ).toEqual({ refused: "ownStory" });
  });

  it("reorders the stories among themselves, free items after them", () => {
    const out = movedChild(
      station([story("a", []), story("b", []), pin("p")]),
      "b",
      { place: "stories", index: 0 },
    );
    if (!("station" in out)) throw new Error(out.refused);
    expect(ids(out.station.children)).toEqual(["b", "a", "p"]);
  });

  it("refuses a story into a story and a free item among the stories", () => {
    const holder = station([story("a", []), story("b", []), pin("p")]);
    expect(
      movedChild(holder, "a", { place: "story", story: "b", index: 0 }),
    ).toEqual({ refused: "noNesting" });
    expect(movedChild(holder, "a", { place: "free" })).toEqual({
      refused: "noNesting",
    });
    expect(movedChild(holder, "p", { place: "stories", index: 0 })).toEqual({
      refused: "noNesting",
    });
  });

  it("answers unchanged for a move that leaves an item where it is", () => {
    const holder = station([story("a", [line("a1"), line("a2")]), pin("p")]);
    expect(
      movedChild(holder, "a1", { place: "story", story: "a", index: 1 }),
    ).toEqual({ refused: "unchanged" });
    expect(movedChild(holder, "p", { place: "free" })).toEqual({
      refused: "unchanged",
    });
  });

  it("refuses an unknown item, story or place", () => {
    const holder = station([story("a", [line("a1")]), pin("p")]);
    expect(movedChild(holder, "x", { place: "free" })).toEqual({
      refused: "missing",
    });
    expect(
      movedChild(holder, "p", { place: "story", story: "x", index: 0 }),
    ).toEqual({ refused: "missing" });
    expect(
      movedChild(holder, "p", { place: "story", story: "a", index: 5 }),
    ).toEqual({ refused: "missing" });
  });
});

describe("the tree's lists of a station", () => {
  const holder = station([
    story("a", [line("a1"), choice("c", "a1"), line("a2")]),
    story("b", []),
    pin("p"),
  ]);

  // Why: the drag offers a list only when the move would be taken there;
  // a list it lit up and then refused would read as a broken drop.
  it("lets a story go only among the stories, a choice only in its story, a block anywhere in its station", () => {
    expect(childMayGo(holder, "a", STORIES_LIST)).toBe(true);
    expect(childMayGo(holder, "a", FREE_LIST)).toBe(false);
    expect(childMayGo(holder, "a", storyList("b"))).toBe(false);
    expect(childMayGo(holder, "c", storyList("a"))).toBe(true);
    expect(childMayGo(holder, "c", storyList("b"))).toBe(false);
    expect(childMayGo(holder, "c", FREE_LIST)).toBe(false);
    for (const id of ["a1", "p"]) {
      expect(childMayGo(holder, id, FREE_LIST)).toBe(true);
      expect(childMayGo(holder, id, storyList("a"))).toBe(true);
      expect(childMayGo(holder, id, storyList("b"))).toBe(true);
      expect(childMayGo(holder, id, STORIES_LIST)).toBe(false);
    }
    expect(childMayGo(holder, "p", storyList("gone"))).toBe(false);
    expect(childMayGo(holder, "gone", FREE_LIST)).toBe(false);
  });

  // Why: a drop names a list and a slot or "into"; this is the move it
  // asks for, so a drop into a folder lands at the story's end.
  it("turns a drop into the move it asks for", () => {
    expect(childDropTo(holder, FREE_LIST, { slot: 0 })).toEqual({
      place: "free",
    });
    expect(childDropTo(holder, STORIES_LIST, { slot: 2 })).toEqual({
      place: "stories",
      index: 2,
    });
    expect(childDropTo(holder, STORIES_LIST, { into: true })).toBeNull();
    expect(childDropTo(holder, storyList("a"), { slot: 1 })).toEqual({
      place: "story",
      story: "a",
      index: 1,
    });
    expect(childDropTo(holder, storyList("a"), { into: true })).toEqual({
      place: "story",
      story: "a",
      index: 3,
    });
    expect(childDropTo(holder, storyList("gone"), { into: true })).toBeNull();
    expect(childDropTo(holder, "nonsense", { slot: 0 })).toBeNull();
  });

  // Why: Earlier and Later are the keyboard's way to move; at an end of a
  // list, and for a free item (the free items have no order), there is no
  // step, and its button must say so by being off.
  it("steps an entry or a story one place, and nothing at an end or for a free item", () => {
    expect(childStepTo(holder, "a1", "later")).toEqual({
      place: "story",
      story: "a",
      index: 2,
    });
    expect(childStepTo(holder, "a2", "earlier")).toEqual({
      place: "story",
      story: "a",
      index: 1,
    });
    expect(childStepTo(holder, "a1", "earlier")).toBeNull();
    expect(childStepTo(holder, "a2", "later")).toBeNull();
    expect(childStepTo(holder, "a", "later")).toEqual({
      place: "stories",
      index: 2,
    });
    expect(childStepTo(holder, "b", "later")).toBeNull();
    expect(childStepTo(holder, "p", "earlier")).toBeNull();
    expect(childStepTo(holder, "gone", "later")).toBeNull();
    // Each step is one the move rule takes.
    const step = childStepTo(holder, "a1", "later");
    expect(
      step === null ? null : "station" in movedChild(holder, "a1", step),
    ).toBe(true);
  });
});
