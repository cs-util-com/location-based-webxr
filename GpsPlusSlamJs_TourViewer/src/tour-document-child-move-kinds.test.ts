/**
 * Why these tests matter: a story's entry moved out of its story must
 * stand in the world, and every kind has its own world views (a model
 * also needs a size there). The rule is one line per kind in the format's
 * list, so a test of one kind says nothing about the others: a check
 * narrowed to the wrong kind, or a view a kind cannot stand free in, would
 * write a tour the next open refuses. This walks EVERY kind and EVERY view
 * its story entry may hold (read from the format's own table, so a kind or
 * a view it gains is covered without an edit here), moves it out through
 * the document, and reads the written tour back with `parseTourManifest`.
 *
 * The second part pins the one refusal the document adds to the move
 * rule: a free item whose file the tour a reload opens does not hold yet.
 * That tour is the one written in place once such a write arrived, and the
 * opened one otherwise (a download leaves the opened file where it was).
 */
import {
  TOUR_BLOCK_VIEWS,
  TOUR_FREE_BLOCK_VIEWS,
  tourFloorView,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import { tourBlockKinds } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { stationContent, storyOf } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  childMoveChange,
  documentObjects,
  freeItemUnsaved,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

const AT = { lat: 48.52, lon: 9.05, alt: 400 };
const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

const ASSETS = [
  { id: "img", path: "content/img.png", kind: "image", width: 4, height: 3 },
  { id: "clip", path: "content/clip.mp4", kind: "video" },
  { id: "snd", path: "content/snd.mp3", kind: "audio" },
  { id: "mdl", path: "content/mdl.glb", kind: "model" },
] as const;

/** Each kind's own fields, naming the files above. */
const FIELDS: Record<string, Record<string, unknown>> = {
  shortText: { caption: "A line" },
  longText: { title: "The wall", body: "It stood for a while." },
  picture: { image: "img", widthM: 1 },
  video: { video: "clip" },
  audio: { audio: "snd" },
  model: { asset: "mdl" },
  character: { name: "The guide", image: "img" },
};

const MODEL_WORLD = new Set(TOUR_FREE_BLOCK_VIEWS.model as readonly string[]);

interface Case {
  readonly name: string;
  readonly block: Record<string, unknown>;
  /** It can stand in the world (a model only with a size). */
  readonly free: boolean;
}

/** Every kind in every view a story entry may hold; a model with a size
 *  and without one wherever the format takes that. */
const CASES: Case[] = tourBlockKinds().flatMap((kind) =>
  (TOUR_BLOCK_VIEWS[kind] as readonly string[]).flatMap((view): Case[] => {
    const block = { id: "it", kind, view, pose: POSE, ...FIELDS[kind] };
    if (kind !== "model")
      return [{ name: `${kind} ${view}`, block, free: true }];
    const sized = { ...block, sizeM: 2 };
    return [
      // A staged model is shown at its file's own size: it takes none.
      ...(view === "stage"
        ? []
        : [{ name: `model ${view} with a size`, block: sized, free: true }]),
      // A model in the world needs a size even inside a story.
      ...(MODEL_WORLD.has(view)
        ? []
        : [{ name: `model ${view} without a size`, block, free: false }]),
    ];
  }),
);

function tourWith(child: Record<string, unknown>): TourManifest {
  return parseTourManifest(
    JSON.parse(
      serializeTourManifest(
        tourOf([], {
          assets: [...ASSETS],
          stations: [
            {
              id: "well",
              title: "The well",
              geo: { ...AT, rotation: [0, 0, 0, 1] },
              activateRadiusM: 50,
              foundRadiusM: 25,
              hint: "arrow",
              ...stationContent([
                storyOf("tale", [
                  child as never,
                  {
                    id: "after",
                    kind: "shortText",
                    view: "card",
                    caption: "After",
                    pose: POSE,
                  },
                ]),
              ]),
            },
          ],
        }),
      ),
    ),
  );
}

function open(manifest: TourManifest): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest }));
}

/** What the next write carries, read back by the format's strict reader. */
function written(state: TourDocumentState): TourManifest {
  const manifest = manifestToWrite(state);
  if (manifest === null) throw new Error("nothing open");
  return parseTourManifest(JSON.parse(serializeTourManifest(manifest)));
}

describe("every kind moved out of a story", () => {
  // The table must not be empty or one kind short: it is the point.
  it("covers every kind of the format", () => {
    expect(new Set(CASES.map((c) => c.block["kind"]))).toEqual(
      new Set(tourBlockKinds()),
    );
    expect(CASES.some((c) => !c.free)).toBe(true);
  });

  // A model without a size cannot stand in the world: refused, unchanged.
  it.each(CASES.filter((c) => !c.free))("$name", ({ block }) => {
    const before = open(tourWith(block));
    expect(childMoveChange(before, "it", { place: "free" })).toEqual({
      kind: "refused",
      reason: "cannotStandFree",
    });
    expect(
      reduce(
        before,
        act.childMoved({ id: "it", to: { place: "free" }, what: "out" }),
      ),
    ).toBe(before);
  });

  it.each(CASES.filter((c) => c.free))("$name", ({ block }) => {
    const before = open(tourWith(block));
    const kind = block["kind"];
    const view = block["view"] as string;
    const change = childMoveChange(before, "it", { place: "free" });
    const after = reduce(
      before,
      act.childMoved({ id: "it", to: { place: "free" }, what: "out" }),
    );
    const views = TOUR_FREE_BLOCK_VIEWS[
      kind as keyof typeof TOUR_FREE_BLOCK_VIEWS
    ] as readonly string[];
    const stands = views.includes(view);
    expect(change).toMatchObject({ kind: "moved", floored: !stands });
    const station = written(after).stations[0]!;
    expect(tourStories(station)[0]?.children.map((c) => c.id)).toEqual([
      "after",
    ]);
    const out = tourFreeBlocks(station).find((b) => b.id === "it");
    const { advance: _advance, ...fields } = block;
    expect(out).toEqual({
      ...fields,
      view: stands
        ? view
        : tourFloorView(kind as Parameters<typeof tourFloorView>[0]),
    });
    expect(reduce(after, act.undone())).toMatchObject({
      stations: before.stations,
      placed: before.placed,
      deleted: before.deleted,
    });
  });
});

describe("a free item whose file the tour a reload opens lacks", () => {
  const PICTURE = {
    id: "snap",
    kind: "picture",
    view: "plane",
    image: "img",
    widthM: 1,
    pose: POSE,
  };
  const INTO = { place: "story", story: "tale", index: 0 } as const;

  /** The tour with the picture free beside the story. */
  function withPicture(): TourManifest {
    const base = tourWith({
      id: "line",
      kind: "shortText",
      view: "card",
      caption: "A line",
      pose: POSE,
    });
    const station = base.stations[0]!;
    return parseTourManifest(
      JSON.parse(
        serializeTourManifest({
          ...base,
          stations: [
            { ...station, children: [...station.children, PICTURE as never] },
          ],
        }),
      ),
    );
  }

  const without = (m: TourManifest): TourManifest => ({
    ...m,
    assets: m.assets.filter((a) => a.id !== "img"),
  });

  /** The document over `opened` and `written`, the last write in place
   *  (arrived) or not. */
  function state(
    opened: TourManifest,
    written: TourManifest,
    inPlace: boolean,
  ): TourDocumentState {
    const start = open(withPicture());
    return {
      ...start,
      opened,
      written,
      save: { ...start.save, inPlaceAt: inPlace ? 1 : null },
    };
  }

  it("moves it once the tour as opened holds the file", () => {
    const tour = withPicture();
    expect(childMoveChange(state(tour, tour, false), "snap", INTO)).toEqual(
      expect.objectContaining({ kind: "moved" }),
    );
    expect(freeItemUnsaved(state(tour, tour, false), "snap")).toBe(false);
  });

  // Why: the tree's drag and the inspector ask this to
  // offer no story the move would refuse; it must say exactly what the
  // refusal says, and nothing for an item that is no free item.
  it("tells the tree which free item keeps out of the stories", () => {
    const tour = withPicture();
    const downloaded = state(without(tour), tour, false);
    expect(freeItemUnsaved(downloaded, "snap")).toBe(true);
    expect(freeItemUnsaved(state(without(tour), tour, true), "snap")).toBe(
      false,
    );
    expect(freeItemUnsaved(downloaded, "line")).toBe(false);
    expect(freeItemUnsaved(downloaded, "gone")).toBe(false);
  });

  // Why: a save written in place puts the file on the
  // disk a reload opens; the refusal must not outlive it.
  it("moves it once a write in place holds the file", () => {
    const tour = withPicture();
    expect(
      childMoveChange(state(without(tour), tour, true), "snap", INTO),
    ).toEqual(expect.objectContaining({ kind: "moved" }));
  });

  // Why: a download leaves the opened file where it was, and a reload
  // opens that one - the story's frame would name a file it lacks.
  it("refuses it while only a download holds the file", () => {
    const tour = withPicture();
    expect(
      childMoveChange(state(without(tour), tour, false), "snap", INTO),
    ).toEqual({ kind: "refused", reason: "unsaved" });
  });

  // Why: a write in place that left the file out (deleted, saved, then the
  // delete undone) is what a reload opens, whatever the opened file held.
  it("refuses it when the write in place lacks the file", () => {
    const tour = withPicture();
    const object = documentObjects(open(tour)).find(
      (o) => o.object.id === "snap",
    )?.object;
    if (object === undefined) throw new Error("no picture object");
    const station = tour.stations[0]!;
    const writtenWithout: TourManifest = {
      ...without(tour),
      stations: [
        {
          ...station,
          children: station.children.filter((c) => c.id !== "snap"),
        },
      ],
    };
    const pending: TourDocumentState = {
      ...state(tour, writtenWithout, true),
      placed: [{ object }],
      addedAssets: tour.assets.filter((a) => a.id === "img"),
    };
    expect(childMoveChange(pending, "snap", INTO)).toEqual({
      kind: "refused",
      reason: "unsaved",
    });
  });
});
