/**
 * Why these tests matter: every item of a tour must be findable in the
 * editor's lists, whatever its kind, its view or where it sits. A list
 * that filters by kind or view drops a whole kind silently (a free
 * character once had no row in the object list), and nothing on screen
 * says an item is missing. So a document holding every (kind, view) of
 * the format, free, in nested plain folders and in a story, is held to
 * both lists: the tree lists every item exactly once, and the object
 * list gives every free item exactly one row.
 */
import { describe, expect, it } from "vitest";

import {
  TOUR_KINDS,
  type TourBlockKind,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import type {
  TourBlock,
  TourManifest,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { initialEditorViewState } from "../editor/editor-view.js";
import { buildTree } from "../editor/editor-shell/tree-model.js";
import { objectListModel } from "../object-list.js";
import { storyOf } from "../test-support/station-content.js";

// The geodesy behind the list's distances is licence-gated; the store's
// construction activates it.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const POSE = { position: [1, 0, 2], rotation: [0, 0, 0, 1] } as const;

const ASSETS: TourManifest["assets"] = [
  { id: "pic", path: "content/pic.jpg", kind: "image" },
  { id: "snd", path: "content/snd.mp3", kind: "audio" },
  { id: "glb", path: "content/glb.glb", kind: "model" },
  { id: "knight", path: "content/knight.png", kind: "image" },
];

/** A block's own fields per kind. */
const FIELDS: Readonly<Record<TourBlockKind, object>> = {
  shortText: { caption: "Gate" },
  longText: { title: "The siege", body: "In 1632 the town was besieged." },
  picture: { image: "pic", widthM: 1 },
  video: { video: "vid" },
  audio: { audio: "snd" },
  model: { asset: "glb", sizeM: 1 },
  character: { name: "Herald", image: "knight", caption: "Hear ye!" },
};

/** One block of every (kind, view) of the format, ids prefixed `at`. */
function everyKind(at: string): TourBlock[] {
  return (Object.keys(TOUR_KINDS) as TourBlockKind[]).flatMap((kind) =>
    TOUR_KINDS[kind].views.map(
      (view) =>
        ({
          id: `${at}-${kind}-${view}`,
          kind,
          view,
          pose: POSE,
          ...FIELDS[kind],
        }) as unknown as TourBlock,
    ),
  );
}

const FREE = everyKind("free");
const OUTER = everyKind("outer");
const INNER = everyKind("inner");
const STORY = everyKind("story");

const STATION = {
  id: "s",
  geo: { lat: 48.137, lon: 11.575, alt: 560, headingDeg: 0 },
  activateRadiusM: 50,
  foundRadiusM: 25,
  hint: "arrow",
  children: [
    storyOf("tale", STORY),
    {
      id: "outer",
      kind: "folder",
      title: "Gate",
      scale: 2,
      children: [
        ...OUTER,
        { id: "inner", kind: "folder", pose: POSE, children: INNER },
      ],
    },
    ...FREE,
  ],
} as unknown as TourStation;

/** How often each id appears in `ids`. */
function counts(ids: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
}

describe("every item of the document has a list row", () => {
  it("the tree lists every item exactly once, free, in folders and in a story", () => {
    const tree = buildTree({
      stations: [STATION],
      assets: ASSETS,
      codes: [],
      view: initialEditorViewState,
      layers: ["codes", "names"],
    });
    const card = tree.cards[0];
    expect(card).toBeDefined();
    const ids = [
      ...(card?.children ?? []),
      ...(card?.groups ?? []).flatMap((g) => g.children),
      ...(card?.folders ?? []).flatMap((f) => f.children),
    ].map((row) => row.id);
    const seen = counts(ids);
    for (const block of [...FREE, ...OUTER, ...INNER, ...STORY]) {
      expect(seen.get(block.id), block.id).toBe(1);
    }
  });

  it("the object list gives every free item exactly one row, a character and a card too", () => {
    const objects = tourObjects({ stations: [STATION], assets: ASSETS });
    const model = objectListModel({
      entries: objects.map((object) => ({
        object,
        hosted: true,
        changed: false,
      })),
      codes: [],
      inAr: false,
      selectedId: null,
      busy: new Map(),
      locked: false,
      note: "",
      undo: false,
    });
    const seen = counts(model.rows.map((row) => row.id));
    for (const block of [...FREE, ...OUTER, ...INNER]) {
      expect(seen.get(block.id), block.id).toBe(1);
    }
    expect(model.heading).toBe(
      `Objects in this tour (${String(FREE.length + OUTER.length + INNER.length)})`,
    );
  });
});
