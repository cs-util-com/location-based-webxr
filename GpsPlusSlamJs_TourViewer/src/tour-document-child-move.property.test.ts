/**
 * Why this test matters: moves chain. A creator drags an item into a
 * story, then on to another, then out, then undoes half of it; every one
 * of those touches both the station's frame and the world's objects. This
 * drives random stations through random moves, and after each one the
 * tour must still be one the format reads (every id once, every answer's
 * jump inside its own story, every free item in a view that stands in the
 * world), no item may be lost or doubled, and undoing every move must give
 * back exactly the tour it started from.
 */
import fc from "fast-check";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  isStory,
  tourStationChildIds,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { stationContent, storyOf } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;
const AT = { lat: 48.52, lon: 9.05, alt: 400 };

/** A station's stories (each a list of entry views; a choice first when
 *  `choice`) and its free pins, with ids from their places. */
const stationShape = fc.record({
  stories: fc.array(
    fc.record({
      views: fc.array(fc.constantFrom("card", "pin"), { maxLength: 3 }),
      choice: fc.boolean(),
    }),
    { maxLength: 3 },
  ),
  pins: fc.integer({ min: 0, max: 2 }),
});

type Shape = typeof stationShape extends fc.Arbitrary<infer T> ? T : never;

function tourFrom(shape: Shape): TourManifest {
  const stories = shape.stories.map((s, si) => {
    const blocks = s.views.map((view, bi) => ({
      id: `s${String(si)}b${String(bi)}`,
      kind: "shortText" as const,
      view,
      caption: "A line",
      pose: POSE,
    }));
    const first = blocks[0];
    const choice =
      s.choice && first !== undefined
        ? [
            {
              id: `s${String(si)}c`,
              kind: "choice" as const,
              prompt: "On?",
              options: [
                { id: "yes", label: "Yes", goto: first.id },
                { id: "no", label: "No" },
              ],
            },
          ]
        : [];
    return storyOf(
      `s${String(si)}`,
      [...choice, ...blocks],
      `Story ${String(si)}`,
    );
  });
  const pins = Array.from({ length: shape.pins }, (_, i) => ({
    id: `p${String(i)}`,
    kind: "shortText" as const,
    view: "pin" as const,
    caption: "A pin",
    pose: POSE,
  }));
  return parseTourManifest(
    JSON.parse(
      serializeTourManifest(
        tourOf([], {
          stations: [
            {
              id: "st",
              geo: { ...AT, rotation: [0, 0, 0, 1] },
              activateRadiusM: 50,
              foundRadiusM: 25,
              hint: "arrow",
              ...stationContent([...stories, ...pins]),
            },
          ],
        }),
      ),
    ),
  );
}

/** A move by numbers: which item (by its place among every id), where to
 *  (free, a story, or among the stories) and the slot. */
const moveShape = fc.record({
  item: fc.nat(),
  place: fc.constantFrom("free", "story", "stories"),
  story: fc.nat(),
  index: fc.nat({ max: 5 }),
});

function written(state: TourDocumentState): TourManifest {
  const manifest = manifestToWrite(state);
  if (manifest === null) throw new Error("nothing open");
  return parseTourManifest(JSON.parse(serializeTourManifest(manifest)));
}

describe("station item moves, property", () => {
  it("keep the tour readable, lose and double nothing, and undo exactly", () => {
    fc.assert(
      fc.property(
        stationShape,
        fc.array(moveShape, { maxLength: 8 }),
        (shape, moves) => {
          const opened = tourFrom(shape);
          const start = reduce(
            initialTourDocumentState,
            act.opened({ manifest: opened }),
          );
          const everyId = (s: TourDocumentState) =>
            tourStationChildIds(written(s).stations[0]!).sort();
          const ids = everyId(start);
          let state = start;
          let steps = 0;
          for (const m of moves) {
            const station = written(state).stations[0]!;
            const all = tourStationChildIds(station);
            const stories = station.children.filter((c) => isStory(c));
            const id = all[m.item % Math.max(1, all.length)];
            const story = stories[m.story % Math.max(1, stories.length)];
            if (id === undefined) continue;
            const to =
              m.place === "free"
                ? ({ place: "free" } as const)
                : m.place === "stories"
                  ? ({ place: "stories", index: m.index } as const)
                  : ({
                      place: "story",
                      story: story?.id ?? "none",
                      index: m.index,
                    } as const);
            const next = reduce(state, act.childMoved({ id, to, what: "m" }));
            if (next !== state) steps += 1;
            state = next;
            // `written` reads the tour back through the format's reader.
            expect(everyId(state)).toEqual(ids);
          }
          for (let i = 0; i < steps; i += 1)
            state = reduce(state, act.undone());
          expect(manifestToWrite(state)).toEqual(manifestToWrite(start));
        },
      ),
      { numRuns: 150 },
    );
  });
});
