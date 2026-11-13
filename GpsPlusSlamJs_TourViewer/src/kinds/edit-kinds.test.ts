/**
 * Why these tests matter: `KIND_EDIT` is the one place the editor and the
 * creator pages learn a kind, so a kind the format knows and the list does
 * not would be invisible or misnamed on every page at once. The compiler
 * holds the list's keys; these hold what a row says: that every kind of
 * the format has a row and no other, that its words are there to read,
 * that the tree finds a row by each of its search words (free and inside a
 * story), that the editor draws in the world exactly the rows that say so,
 * and that the add menu and the palette offer exactly the rows that say
 * they are addable, in the list's order.
 *
 * @vitest-environment jsdom
 */
import {
  tourBlockKinds,
  type TourBlockKind,
  type TourBlockOfKind,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { initialEditorViewState } from "../editor/editor-view.js";
import { PALETTE_KINDS } from "../editor/editor-shell/add-palette-model.js";
import { createTreeAddMenu } from "../editor/editor-shell/tree-add-menu.js";
import { buildTree } from "../editor/editor-shell/tree-model.js";
import { stationContent, storyOf } from "../test-support/station-content.js";

import {
  KIND_EDIT,
  kindNoun,
  kindWithArticle,
  type KindEditRow,
} from "./edit-kinds.js";

/** A row read as any row, so its optional parts can be asked for. */
const rowOf = (kind: TourBlockKind): KindEditRow => KIND_EDIT[kind];

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

/** One block of each kind, each named "Zz" so no search word is found in
 *  its name. Keyed by the format's kind type: a new kind needs one. */
const SAMPLE: { readonly [K in TourBlockKind]: TourBlockOfKind[K] } = {
  shortText: {
    id: "b-shortText",
    kind: "shortText",
    view: "pin",
    caption: "Zz",
    pose: POSE,
  },
  longText: {
    id: "b-longText",
    kind: "longText",
    view: "reading",
    title: "Zz",
    body: "Zz",
    pose: POSE,
  },
  picture: {
    id: "b-picture",
    kind: "picture",
    view: "plane",
    image: "img",
    title: "Zz",
    widthM: 1,
    pose: POSE,
  },
  video: {
    id: "b-video",
    kind: "video",
    view: "card",
    video: "clip",
    title: "Zz",
    pose: POSE,
  },
  audio: {
    id: "b-audio",
    kind: "audio",
    view: "card",
    audio: "sound",
    title: "Zz",
    pose: POSE,
  },
  model: {
    id: "b-model",
    kind: "model",
    view: "placed",
    asset: "mesh",
    title: "Zz",
    pose: POSE,
  },
  character: {
    id: "b-character",
    kind: "character",
    view: "speak",
    name: "Zz",
    image: "cut",
    pose: POSE,
  },
} as unknown as { readonly [K in TourBlockKind]: TourBlockOfKind[K] };

function stationOf(content: Parameters<typeof stationContent>[0]): TourStation {
  return {
    id: "gate",
    title: "Gate",
    geo: { lat: 48.137, lon: 11.575, alt: 560, headingDeg: 0 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    ...stationContent(content),
  };
}

function treeFor(station: TourStation, query: string) {
  return buildTree({
    stations: [station],
    assets: [],
    codes: [],
    view: initialEditorViewState,
    layers: [],
    query,
  });
}

describe("KIND_EDIT", () => {
  it("has a row for every kind the format knows, in its order, and no other", () => {
    expect(Object.keys(KIND_EDIT)).toEqual(tourBlockKinds());
  });

  it("gives every row its words", () => {
    for (const kind of tourBlockKinds()) {
      const row = rowOf(kind);
      expect(row.label.trim(), kind).not.toBe("");
      expect(row.thing.trim(), kind).not.toBe("");
      expect(row.look.trim(), kind).not.toBe("");
      expect(row.searchWords.trim(), kind).not.toBe("");
      expect(kindNoun(kind), kind).not.toBe("");
      expect(kindWithArticle(kind), kind).toMatch(/^an? \S/);
      for (const field of row.fields) {
        expect(field.name.trim(), kind).not.toBe("");
        expect(field.label.trim(), kind).not.toBe("");
      }
      for (const add of row.add === undefined ? [] : [row.add]) {
        expect(add.label.trim(), kind).not.toBe("");
        expect(add.hint.trim(), kind).not.toBe("");
        expect(add.words.trim(), kind).not.toBe("");
      }
    }
  });

  it("gives every kind a look of its own: the tree's row kind and icon", () => {
    const looks = tourBlockKinds().map((kind) => KIND_EDIT[kind].look);
    expect(new Set(looks).size).toBe(looks.length);
  });

  it("finds each row in the tree by every one of its search words, free and in a story", () => {
    for (const kind of tourBlockKinds()) {
      const block = SAMPLE[kind];
      const free = stationOf([block]);
      const told = stationOf([storyOf("s1", [block], "Zz")]);
      for (const word of KIND_EDIT[kind].searchWords.split(/\s+/)) {
        const freeRow = treeFor(free, word).cards[0]?.children[0];
        expect(freeRow, `${kind} by "${word}"`).toMatchObject({
          id: block.id,
          kind: KIND_EDIT[kind].look,
        });
        const entry = treeFor(told, word).cards[0]?.folders[0]?.children[0];
        expect(entry, `${kind} in a story by "${word}"`).toMatchObject({
          id: block.id,
          kind: KIND_EDIT[kind].look,
        });
      }
    }
  });

  it("offers in the add menu and the palette exactly the rows that say they are addable", () => {
    const listed = tourBlockKinds().filter((k) => rowOf(k).add !== undefined);
    const addable = listed.filter((k) => rowOf(k).add?.addable === true);
    // Every addable kind is on at a station as in a story: a video stands
    // free as a screen, a cutout or a porthole.
    const atStation = addable;
    document.body.replaceChildren();
    const menu = createTreeAddMenu({
      body: document.createElement("div"),
      host: document.body,
      choose: () => undefined,
      chooseForStory: () => undefined,
    });
    const all = () => [
      ...document.querySelectorAll<HTMLElement>(
        '#tree-add-menu [role="menuitem"]',
      ),
    ];
    // The menu's two entries that are no kind's add row: the story, and
    // the character, who is made in the character maker first. Named here
    // so a third one cannot slip past the rows unnoticed.
    const ownEntries = ["character", "story"];
    expect(
      all()
        .map((item) => item.dataset["kind"] ?? "")
        .filter((k) => ownEntries.includes(k)),
    ).toEqual(ownEntries);
    const items = () =>
      all().filter((item) => !ownEntries.includes(item.dataset["kind"] ?? ""));
    const on = () =>
      items()
        .filter((item) => item.getAttribute("aria-disabled") !== "true")
        .map((item) => item.dataset["kind"]);
    const plus = document.createElement("button");
    document.body.append(plus);
    expect(items().map((item) => item.dataset["kind"])).toEqual(listed);
    menu.openFor(plus, "s", "Station");
    expect(on()).toEqual(atStation);
    menu.close(false);
    menu.openForStory(plus, "t", "Story");
    expect(on()).toEqual(addable);
    menu.close(false);
    expect(
      PALETTE_KINDS.map((k) => k.kind).filter((k) => k !== "station"),
    ).toEqual(atStation);
    document.body.replaceChildren();
  });

  // Why: the add menu is the editor's whole reach; a kind dropped from it
  // or turned on by accident changes what a creator can make. A character
  // has no add row: the menu's own Character makes him in the maker first.
  it("lists every kind with a way to add it, the character through the menu's own entry", () => {
    const listed = tourBlockKinds().filter((k) => rowOf(k).add !== undefined);
    expect(listed).toEqual([
      "shortText",
      "longText",
      "picture",
      "video",
      "audio",
      "model",
    ]);
    expect(listed.filter((k) => rowOf(k).add?.addable === true)).toEqual([
      "shortText",
      "longText",
      "picture",
      "video",
      "audio",
      "model",
    ]);
    expect(listed.filter((k) => rowOf(k).add?.file !== undefined)).toEqual([
      "picture",
      "video",
      "audio",
      "model",
    ]);
  });
});
