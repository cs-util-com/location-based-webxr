/**
 * Why these tests matter: a creator copies a story to make a variant of
 * it (another language, a shorter walk). The copy must be a story of its
 * own: new ids for it and everything it holds (ids are one namespace
 * across the tour, so a shared one is a tour the format refuses on the
 * next save), its choices jumping within the copy and never back into the
 * original, beside its original where the creator looks for it, and one
 * undo step. A refused copy must change nothing.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  tourStories,
  type TourChoice,
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

const AT = { lat: 48.52, lon: 9.05, alt: 400 };
const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

function line(id: string, caption: string) {
  return { id, kind: "shortText", view: "card", caption, pose: POSE } as const;
}

const ASK: TourChoice = {
  id: "ask",
  kind: "choice",
  prompt: "Again?",
  options: [
    { id: "yes", label: "Yes", goto: "m1" },
    { id: "no", label: "No" },
  ],
};

const FREE_PIN = {
  id: "well-sign",
  kind: "shortText",
  view: "pin",
  caption: "The well",
  createdAtIso: "2026-11-06T00:00:00.000Z",
  pose: POSE,
} as const;

function opened(millerTitle = "The miller"): TourManifest {
  return parseTourManifest(
    JSON.parse(
      serializeTourManifest(
        tourOf([], {
          stations: [
            {
              id: "well",
              title: "The well",
              geo: { ...AT, rotation: [0, 0, 0, 1] },
              activateRadiusM: 50,
              foundRadiusM: 25,
              hint: "arrow",
              ...stationContent([
                storyOf(
                  "miller",
                  [line("m1", "The miller"), line("m2", "His mill"), ASK],
                  millerTitle,
                ),
                storyOf("baker", [line("b1", "The baker")], "The baker"),
                FREE_PIN,
              ]),
            },
          ],
        }),
      ),
    ),
  );
}

function open(millerTitle?: string): TourDocumentState {
  return reduce(
    initialTourDocumentState,
    act.opened({ manifest: opened(millerTitle) }),
  );
}

const NEW_IDS = { miller: "copy", m1: "c1", m2: "c2", ask: "cask" };

function duplicated(state: TourDocumentState, newIds = NEW_IDS) {
  return reduce(
    state,
    act.storyDuplicated({ story: "miller", newIds, what: "the copy" }),
  );
}

function written(state: TourDocumentState): TourManifest {
  const manifest = manifestToWrite(state);
  if (manifest === null) throw new Error("nothing open");
  return parseTourManifest(JSON.parse(serializeTourManifest(manifest)));
}

describe("a story duplicated", () => {
  it("stands right after its original, before the next story and the free items", () => {
    const station = written(duplicated(open())).stations[0]!;
    expect(station.children.map((c) => c.id)).toEqual([
      "miller",
      "copy",
      "baker",
      "well-sign",
    ]);
  });

  it("is titled as a copy and holds every child under its new id, in order", () => {
    const after = written(duplicated(open())).stations[0]!;
    const [original, copy] = tourStories(after);
    expect(copy?.title).toBe("The miller copy");
    expect(copy?.children.map((c) => c.id)).toEqual(["c1", "c2", "cask"]);
    // The children are the original's in all but their ids.
    expect(
      copy?.children.map((c) => ({ ...c, id: undefined, options: undefined })),
    ).toEqual(
      original?.children.map((c) => ({
        ...c,
        id: undefined,
        options: undefined,
      })),
    );
  });

  it("jumps within the copy: a choice's goto names the copied child", () => {
    const copy = tourStories(written(duplicated(open())).stations[0]!)[1]!;
    const choice = copy.children.find((c) => c.kind === "choice");
    expect(choice?.kind === "choice" ? choice.options : []).toEqual([
      { id: "yes", label: "Yes", goto: "c1" },
      { id: "no", label: "No" },
    ]);
  });

  it("leaves the original untouched", () => {
    const before = written(open()).stations[0]!;
    const after = written(duplicated(open())).stations[0]!;
    expect(tourStories(after)[0]).toEqual(tourStories(before)[0]);
    expect(tourStories(after)[2]).toEqual(tourStories(before)[1]);
  });

  it("is one step: one undo gives the tour back as it was", () => {
    const state = open();
    const after = duplicated(state);
    expect(manifestToWrite(reduce(after, act.undone()))).toEqual(
      manifestToWrite(state),
    );
  });

  // The title's bound is the story's (80 code points): a long title is
  // shortened to make room for the mark, never refused. Swept at the
  // bound, one under it and one over the room the mark leaves.
  it.each([
    ["x".repeat(80), `${"x".repeat(75)} copy`],
    ["x".repeat(79), `${"x".repeat(75)} copy`],
    ["x".repeat(75), `${"x".repeat(75)} copy`],
    ["x".repeat(74), `${"x".repeat(74)} copy`],
  ])("titles a copy of %s within the story's bound", (title, copyTitle) => {
    const copy = tourStories(written(duplicated(open(title))).stations[0]!)[1];
    expect(copy?.title).toBe(copyTitle);
    expect([...(copy?.title ?? "")].length).toBeLessThanOrEqual(80);
  });

  // Why: each refusal must leave the state as it was (the page says why);
  // a half-made copy would share ids or jump into the original.
  it.each([
    ["an unknown story", { story: "nobody", newIds: NEW_IDS }],
    [
      "a child without a new id",
      { story: "miller", newIds: { miller: "copy", m1: "c1", m2: "c2" } },
    ],
    [
      "a new id another child holds",
      { story: "miller", newIds: { ...NEW_IDS, m2: "b1" } },
    ],
    [
      "a new id a free item holds",
      { story: "miller", newIds: { ...NEW_IDS, miller: "well-sign" } },
    ],
    [
      "two children under one new id",
      { story: "miller", newIds: { ...NEW_IDS, m2: "c1" } },
    ],
  ])("changes nothing for %s", (_name, payload) => {
    const state = open();
    expect(
      reduce(state, act.storyDuplicated({ ...payload, what: "the copy" })),
    ).toBe(state);
  });
});
