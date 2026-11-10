/**
 * The tour's declared characters in the tour document: declared and
 * removed as one step each, refused in words where the format would refuse
 * the file, written with their pictures, undone and redone, and carried
 * through a draft's settings record.
 *
 * Why these tests matter: a declaration the document took but the format
 * refuses would make every later save of the tour fail; a character an
 * undo or a reload loses is work the author did not see go.
 */
import { describe, expect, it } from "vitest";
import type {
  TourAsset,
  TourObject,
  TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";

import { tourOf } from "./test-support/tour-of.js";
import {
  changeCount,
  characterRefusal,
  characterRemoveRefusal,
  manifestToWrite,
  initialTourDocumentState,
  tourDocumentActions as A,
  tourDocumentReducer,
  type TourDocumentState,
} from "./tour-document.js";
import { parseSettingsRecord, settingsRecord } from "./tour-document-draft.js";
import {
  characterChanges,
  MAX_TOUR_CHARACTERS,
  parseRecordedCharacters,
  restoredCharacters,
  withCharacters,
} from "./declared-characters.js";

const pin: TourPin = {
  id: "a",
  kind: "shortText",
  view: "pin",
  caption: "pin a",
  createdAtIso: "2026-11-10T00:00:00.000Z",
  geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
};

function image(id: string): TourAsset {
  return { id, path: `content/${id}.png`, kind: "image", width: 4, height: 2 };
}

const rita: TourCharacter = {
  id: "c1abc",
  name: "Ranger Rita",
  image: "rita1",
  frames: "rita4",
};

function opened(): TourDocumentState {
  const s = tourDocumentReducer(
    initialTourDocumentState,
    A.opened({ manifest: tourOf([pin]), newTourId: "t".repeat(32) }),
  );
  return tourDocumentReducer(
    s,
    A.assetsAdded({ assets: [image("rita1"), image("rita4")] }),
  );
}

const declare = (
  s: TourDocumentState,
  c: TourCharacter = rita,
): TourDocumentState =>
  tourDocumentReducer(s, A.characterDeclared({ character: c, what: "adding" }));

describe("characterDeclared", () => {
  it("declares the character as one change, and the write carries him with his pictures", () => {
    const s = declare(opened());
    expect(s.characters).toEqual([rita]);
    expect(changeCount(s)).toBe(1);
    const written = manifestToWrite(s);
    expect(written?.characters).toEqual([rita]);
    expect(written?.assets.map((a) => a.id)).toEqual(
      expect.arrayContaining(["rita1", "rita4"]),
    );
  });

  it("is undone and redone like any edit", () => {
    const undone = tourDocumentReducer(declare(opened()), A.undone());
    expect(undone.characters).toEqual([]);
    expect(changeCount(undone)).toBe(0);
    expect(manifestToWrite(undone)?.characters).toBeUndefined();
    expect(tourDocumentReducer(undone, A.redone()).characters).toEqual([rita]);
  });

  // Each refusal leaves the document as it was, and says why in words.
  // A second character without four poses of his own, so only the
  // refusal named is in his way.
  const bare: TourCharacter = { id: "c2", name: rita.name, image: rita.image };
  const refusals: readonly [string, TourCharacter, RegExp][] = [
    ["the same id twice", rita, /already/],
    // The tour mints each character's id, so the same character added
    // again from the library comes with a new id: his four poses tell.
    ["the same four poses under another id", { ...rita, id: "c2" }, /already/],
    ["a picture the tour lacks", { ...bare, image: "nope" }, /picture/],
    [
      "four poses the tour lacks",
      { ...rita, id: "c2", frames: "nope" },
      /four poses/,
    ],
    [
      "the poses as his own picture",
      { ...rita, id: "c2", frames: "rita1" },
      /of their own/,
    ],
    ["an empty name", { ...bare, name: "" }, /name/],
    ["a name over 80 characters", { ...bare, name: "x".repeat(81) }, /name/],
    ["an id a tour cannot carry", { ...rita, id: "a b" }, /id/],
  ];
  for (const [what, character, words] of refusals) {
    it(`refuses ${what}`, () => {
      const s = declare(opened());
      expect(characterRefusal(s, character)).toMatch(words);
      expect(declare(s, character)).toBe(s);
    });
  }

  it(`refuses a character beyond ${String(MAX_TOUR_CHARACTERS)}`, () => {
    let s = opened();
    for (let i = 0; i < MAX_TOUR_CHARACTERS; i++) {
      const frames = `f${String(i)}`;
      s = tourDocumentReducer(s, A.assetsAdded({ assets: [image(frames)] }));
      s = declare(s, { ...rita, id: `c${String(i)}`, frames });
    }
    expect(s.characters).toHaveLength(MAX_TOUR_CHARACTERS);
    const more = { ...rita, id: "cmore", frames: "rita4" };
    expect(characterRefusal(s, more)).toMatch(/at most 32/);
    expect(declare(s, more)).toBe(s);
  });

  it("declares nothing before a tour is open", () => {
    expect(characterRefusal(initialTourDocumentState, rita)).toMatch(/open/);
    expect(declare(initialTourDocumentState)).toBe(initialTourDocumentState);
  });
});

describe("characterRemoved", () => {
  it("removes a declared character as one step, undone like any edit", () => {
    const gone = tourDocumentReducer(
      declare(opened()),
      A.characterRemoved({ id: rita.id, what: "removing" }),
    );
    expect(gone.characters).toEqual([]);
    expect(tourDocumentReducer(gone, A.undone()).characters).toEqual([rita]);
  });

  it("refuses an id the tour does not declare", () => {
    const s = opened();
    expect(characterRemoveRefusal(s, "c9")).toMatch(/no longer/);
    expect(
      tourDocumentReducer(s, A.characterRemoved({ id: "c9", what: "" })),
    ).toBe(s);
  });
});

describe("the draft's settings record", () => {
  it("carries the characters once one was declared, and reads them back", () => {
    expect(settingsRecord(opened()).characters).toBeUndefined();
    const record = settingsRecord(declare(opened()));
    expect(record.characters).toEqual([rita]);
    expect(parseSettingsRecord(JSON.stringify(record))?.characters).toEqual([
      rita,
    ]);
  });

  it("a restore brings the characters back, leaving out one whose files the tour lacks", () => {
    const lost = { ...rita, id: "c2", image: "gone1", frames: "gone4" };
    const s = tourDocumentReducer(
      opened(),
      A.restored({
        objects: [],
        deleted: [],
        characters: [rita, lost],
        what: "",
      }),
    );
    expect(s.characters).toEqual([rita]);
    expect(s.charactersRecorded).toBe(true);
  });

  // Why: the draft keeps the small picture before the large sheet, so a
  // draft that ran out of room holds the picture alone. Dropping the whole
  // declaration then would leave every item naming him dangling, and a
  // strict read refuses such a tour; the format takes a character without
  // his four poses.
  it("a restore keeps a character whose four poses alone are missing, without them", () => {
    const sheetLost = { ...rita, frames: "lost4" };
    const s = tourDocumentReducer(
      opened(),
      A.restored({
        objects: [],
        deleted: [],
        characters: [sheetLost],
        what: "",
      }),
    );
    const withoutFrames = { id: rita.id, name: rita.name, image: rita.image };
    expect(s.characters).toEqual([withoutFrames]);
    expect(restoredCharacters([sheetLost], new Set(["rita1"]))).toEqual([
      withoutFrames,
    ]);
    expect(restoredCharacters([sheetLost], new Set(["lost4"]))).toEqual([]);
  });

  it("an entry that does not read is left out, the others kept", () => {
    expect(
      parseRecordedCharacters([
        rita,
        { id: "c2", name: "", image: "x" },
        { id: "c3", name: "Ok", image: "bad id" },
        "nonsense",
        { id: "c4", name: "Max", image: "m1" },
      ]),
    ).toEqual([rita, { id: "c4", name: "Max", image: "m1" }]);
    expect(parseRecordedCharacters("nope")).toBeUndefined();
  });
});

describe("the pure rules", () => {
  it("counts each added, gone and changed declaration once", () => {
    const max = { id: "c4", name: "Max", image: "m1" };
    expect(characterChanges([], [])).toBe(0);
    expect(characterChanges([rita], [rita])).toBe(0);
    expect(characterChanges([rita], [max])).toBe(2);
    expect(characterChanges([rita], [{ ...rita, name: "Rita" }])).toBe(1);
  });

  it("writes no field for no characters, and keeps the manifest when they agree", () => {
    const m = tourOf([pin]);
    expect(withCharacters(m, [])).toBe(m);
    const withRita = withCharacters(m, [rita]);
    expect(withRita.characters).toEqual([rita]);
    expect(withCharacters(withRita, [rita])).toBe(withRita);
    expect("characters" in withCharacters(withRita, [])).toBe(false);
  });
});

// Why: removing a character an item still names would leave a reference
// the format refuses on a strict read, so the saved tour would no longer
// open. The count of naming items is the whole rule: a count of 0 must
// never pass while a free character or a story block names him.
describe("removing a character an item still names", () => {
  const free: TourObject = {
    id: "f1",
    kind: "character",
    view: "speak",
    name: "Ranger Rita",
    image: "rita1",
    character: "c1abc",
    createdAtIso: "2026-11-10T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
  };

  function standing(objects: readonly TourObject[]): TourDocumentState {
    const m = tourOf([pin, ...objects]);
    return tourDocumentReducer(
      initialTourDocumentState,
      A.opened({
        manifest: {
          ...m,
          characters: [rita],
          assets: [...m.assets, image("rita1"), image("rita4")],
        },
        newTourId: "t".repeat(32),
      }),
    );
  }

  it("refuses while a free character names him, and the reducer keeps him", () => {
    const s = standing([free]);
    expect(characterRemoveRefusal(s, rita.id)).toBe(
      "Ranger Rita still speaks in one item. Remove that item first.",
    );
    expect(
      tourDocumentReducer(s, A.characterRemoved({ id: rita.id, what: "" })),
    ).toBe(s);
  });

  it("counts every item naming him", () => {
    const s = standing([free, { ...free, id: "f2" }]);
    expect(characterRemoveRefusal(s, rita.id)).toMatch(/in 2 items/);
  });

  it("removes him once nothing names him", () => {
    expect(characterRemoveRefusal(standing([]), rita.id)).toBeNull();
  });
});
