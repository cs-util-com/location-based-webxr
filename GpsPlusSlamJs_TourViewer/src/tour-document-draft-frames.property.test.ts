/**
 * Why these tests matter: a draft keeps an edited or a copied station as
 * its whole frame, and a reload reads that frame as the format reads a
 * station. A frame that does not read is lost without a word, so a reader
 * given less of the tour than a station may name (a declared character, an
 * asset) throws away the creator's edit, or the whole copy, on the next
 * open. These pin the round trip over EVERY field a frame can hold.
 *
 * The generators are typed by `everyField`: a field added to a station, a
 * story, a block, a choice, a quiz or an answer and not generated here
 * fails `typecheck:tests`, so a new field cannot slip past this round trip.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourAudioBlock,
  type TourBlock,
  type TourBlockKind,
  type TourCharacter,
  type TourCharacterBlock,
  type TourChoice,
  type TourChoiceOption,
  type TourLocalPose,
  type TourLongTextBlock,
  type TourManifest,
  type TourModelAnimation,
  type TourModelBlock,
  type TourModelNote,
  type TourModelSection,
  type TourModelVector,
  type TourNarration,
  type TourPictureBlock,
  type TourQuizAnswer,
  type TourQuizEntry,
  type TourQuizOption,
  type TourShortTextBlock,
  type TourStepAdvance,
  type TourStory,
  type TourStoryBlock,
  type TourStoryChild,
  type TourVideoBlock,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  documentFrames,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type StationFrame,
  type TourDocumentState,
} from "./tour-document.js";
import {
  parseSettingsRecord,
  settingsRecord,
  settingsRecordText,
} from "./tour-document-draft.js";
import "./test-support/tour-of.js";

const GUIDE: TourCharacter = {
  id: "guide",
  name: "The Guide",
  image: "guide-png",
  frames: "guide-sheet",
};

/** A tour declaring a character, with an asset of every kind. */
const TOUR: TourManifest = parseTourManifest({
  version: 5,
  order: "fixed",
  assets: [
    { id: "guide-png", path: "content/guide-png.png" },
    { id: "guide-sheet", path: "content/guide-sheet.png" },
    { id: "photo", path: "content/photo.png" },
    { id: "clip", path: "content/clip.mp4" },
    { id: "song", path: "content/song.mp3" },
    { id: "arch", path: "content/arch.glb" },
  ],
  characters: [GUIDE],
  stations: [],
});

const GEO: StationFrame["geo"] = {
  lat: 48.52,
  lon: 9.05,
  alt: 400,
  rotation: [0, 0, 0, 1],
};

/** A station whose story has the declared character speak. */
const WITH_CHARACTER = {
  id: "story",
  geo: GEO,
  activateRadiusM: 50,
  foundRadiusM: 25,
  hint: "arrow",
  children: [
    {
      id: "tale",
      kind: "folder",
      role: "story",
      title: "The tale",
      children: [
        {
          id: "says",
          kind: "character",
          view: "bubble",
          name: GUIDE.name,
          image: GUIDE.image,
          character: GUIDE.id,
          caption: "Follow me.",
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
          advance: { mode: "lineEnd" },
        },
      ],
    },
  ],
};

const OPENED: TourManifest = parseTourManifest(
  JSON.parse(
    serializeTourManifest(
      parseTourManifest({ ...TOUR, stations: [WITH_CHARACTER] }),
    ),
  ),
);

function open(): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest: OPENED }));
}

/** The document a reload rebuilds from what the draft stored. */
function reloaded(state: TourDocumentState): TourDocumentState {
  const text = settingsRecordText(settingsRecord(state));
  const record = parseSettingsRecord(text, OPENED);
  if (record === undefined) throw new Error("the record did not read");
  return reduce(
    open(),
    act.restored({
      objects: [],
      deleted: [],
      ...(record.createdStations === undefined
        ? {}
        : { createdStations: record.createdStations }),
      ...(record.frames === undefined ? {} : { frames: record.frames }),
      what: "restore",
    }),
  );
}

describe("a draft of a tour that declares a character", () => {
  it("brings back a rename of the station the character speaks in", () => {
    const state = reduce(
      open(),
      act.stationEdited({
        stationId: "story",
        edit: { title: "Renamed" },
        what: "rename",
      }),
    );
    const restored = reloaded(state);
    expect(documentFrames(restored)).toEqual(documentFrames(state));
    expect(manifestToWrite(restored)).toEqual(manifestToWrite(state));
  });

  it("brings back a copy of that station", () => {
    const state = reduce(
      open(),
      act.stationDuplicated({
        stationId: "story",
        newStationId: "copy",
        newItemIds: { tale: "tale2", says: "says2" },
        createdAtIso: "2026-11-06T00:00:00.000Z",
        what: "copy",
      }),
    );
    const restored = reloaded(state);
    expect(documentFrames(restored).map((f) => f.id)).toEqual([
      "story",
      "copy",
    ]);
    expect(documentFrames(restored)).toEqual(documentFrames(state));
  });

  it("loses a frame naming a character the tour read against lacks, and only it", () => {
    // Why: a file changed elsewhere may no longer declare him. The frame
    // cannot stand then, and must not cost the rest of the record.
    const copy = OPENED.stations[0]!;
    const text = settingsRecordText({
      needsNoGps: true,
      frames: [copy, { ...copy, id: "plain", children: [] }],
    });
    const { characters: _gone, ...without } = OPENED;
    const record = parseSettingsRecord(text, without);
    expect(record?.needsNoGps).toBe(true);
    expect(record?.frames?.map((f) => f.id)).toEqual(["plain"]);
  });
});

/** A generator of each of `T`'s fields, optional ones included: the type
 *  makes leaving a field out a compile error. */
function everyField<T>(fields: {
  readonly [K in keyof T]-?: fc.Arbitrary<T[K]>;
}): fc.Arbitrary<T> {
  return fc.record(fields);
}

const maybe = <T>(value: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> =>
  fc.option(value, { nil: undefined });

/** Text as a reader keeps it: not blank, nothing a read would change. */
const words = fc.stringMatching(/^[A-Za-z0-9](?: ?[A-Za-z0-9]){0,11}$/);

/** Finite, and the same after JSON (no -0). */
const number = fc.integer({ min: -4000, max: 4000 }).map((n) => (n || 1) / 8);
const positive = fc.integer({ min: 1, max: 4000 }).map((n) => n / 8);
const vector: fc.Arbitrary<TourModelVector> = fc.tuple(number, number, number);
const direction: fc.Arbitrary<TourModelVector> = fc.tuple(
  positive,
  number,
  number,
);

const pose = everyField<TourLocalPose>({
  position: fc.tuple(number, number, number),
  rotation: fc.constant<[number, number, number, number]>([0, 0, 0, 1]),
});

/** The fields every block has, for a block of `id`. */
const envelope = <V>(id: string, views: readonly V[]) => ({
  id: fc.constant(id),
  view: fc.constantFrom(...views),
  pose,
  createdAtIso: maybe(fc.constant("2026-11-06T00:00:00.000Z")),
});

const note = everyField<TourModelNote>({
  position: vector,
  normal: direction,
  title: words,
  text: maybe(words),
});

const section = everyField<TourModelSection>({
  name: words,
  position: vector,
  normal: direction,
});

const animation = everyField<TourModelAnimation>({
  name: words,
  autoplay: fc.boolean(),
});

/** A model's size follows its view: required in the world, optional on a
 *  card. */
const modelSize = (view: TourModelBlock["view"]) => {
  const size = fc.integer({ min: 1, max: 400 });
  return view === "card" ? maybe(size) : size;
};

const narration = (id: string) =>
  everyField<TourNarration>({
    audio: fc.constant("song"),
    timing: maybe(fc.constant(`timing/${id}.json`)),
    voiceCredit: maybe(words),
    synthetic: fc.boolean(),
    durationMs: maybe(fc.integer({ min: 1, max: 14_400_000 })),
  });

/** A block of every kind; `Record` makes a new kind a compile error. */
const BLOCKS: Record<TourBlockKind, (id: string) => fc.Arbitrary<TourBlock>> = {
  shortText: (id) =>
    everyField<TourShortTextBlock>({
      ...envelope(id, ["pin", "card"] as const),
      kind: fc.constant("shortText"),
      caption: words,
      description: maybe(words),
    }),
  longText: (id) =>
    everyField<TourLongTextBlock>({
      ...envelope(id, ["lectern", "reading", "card"] as const),
      kind: fc.constant("longText"),
      title: words,
      body: words,
      narration: maybe(narration(id)),
    }),
  picture: (id) =>
    everyField<TourPictureBlock>({
      ...envelope(id, [
        "plane",
        "framed",
        "cutout",
        "thenNow",
        "sharpen",
        "finder",
        "window",
        "viewer",
        "card",
      ] as const),
      kind: fc.constant("picture"),
      image: fc.constantFrom("photo", "guide-png"),
      title: maybe(words),
      caption: maybe(words),
      alt: maybe(words),
      credit: maybe(words),
      year: maybe(fc.constantFrom("1890", "about 1880s")),
      widthM: fc.integer({ min: 1, max: 50 }),
      showTag: maybe(fc.boolean()),
      viewpoint: maybe(
        fc.constant({
          position: [0, 0, 0] as const,
          rotation: [0, 0, 0, 1] as const,
          hfovDeg: 60,
          distanceM: 12,
        }),
      ),
    }),
  video: (id) =>
    everyField<TourVideoBlock>({
      ...envelope(id, ["card"] as const),
      kind: fc.constant("video"),
      video: fc.constant("clip"),
      transcript: words,
      title: maybe(words),
      poster: maybe(fc.constant("photo")),
    }),
  audio: (id) =>
    everyField<TourAudioBlock>({
      ...envelope(id, ["card"] as const),
      kind: fc.constant("audio"),
      audio: fc.constant("song"),
      transcript: words,
      title: maybe(words),
      // A card keeps its world fields, still checked, for a view switch.
      radiusM: maybe(fc.integer({ min: 1, max: 50 })),
      maxM: maybe(fc.integer({ min: 2, max: 200 })),
      minM: fc.constant(undefined),
      volume: maybe(fc.constantFrom(0, 0.5, 1)),
    }),
  model: (id) =>
    fc
      .constantFrom<TourModelBlock["view"]>(
        "placed",
        "ghost",
        "hotspots",
        "cutaway",
        "toy",
        "card",
      )
      .chain((view) =>
        everyField<TourModelBlock>({
          ...envelope(id, [view]),
          kind: fc.constant("model"),
          asset: fc.constant("arch"),
          sizeM: modelSize(view),
          title: maybe(words),
          animation: maybe(animation),
          annotations: maybe(fc.array(note, { minLength: 1, maxLength: 3 })),
          sections: maybe(fc.array(section, { minLength: 1, maxLength: 3 })),
        }),
      ),
  character: (id) =>
    maybe(fc.constant(GUIDE)).chain((declared) =>
      everyField<TourCharacterBlock>({
        ...envelope(id, [
          "bubble",
          "speak",
          "two-stations",
          "portrait",
          "popup",
          "card",
        ] as const),
        kind: fc.constant("character"),
        // A block naming a declaration reads his name and image from it.
        name: declared === undefined ? words : fc.constant(declared.name),
        image: fc.constant(declared?.image ?? "photo"),
        character: fc.constant(declared?.id),
        caption: words,
        voice: maybe(fc.constant("song")),
      }),
    ),
};

const KINDS = Object.keys(BLOCKS) as TourBlockKind[];

const advance = fc.oneof(
  fc.constant<TourStepAdvance>({ mode: "tap" }),
  fc.constant<TourStepAdvance>({ mode: "lineEnd" }),
  everyField<Extract<TourStepAdvance, { mode: "auto" }>>({
    mode: fc.constant("auto"),
    afterS: positive,
  }),
);

/** Two to three distinct option ids. */
const optionIds = fc.subarray(["a", "b", "c"], { minLength: 2 });

const quizOption = (id: string) =>
  everyField<TourQuizOption>({ id: fc.constant(id), label: words });

const quizOptions = (ids: readonly string[]) =>
  fc.tuple(...ids.map(quizOption));

const hashed = (type: "text" | "code") =>
  everyField<Extract<TourQuizAnswer, { type: "text" | "code" }>>({
    type: fc.constant(type),
    salt: words,
    sha256: fc.array(fc.stringMatching(/^[0-9a-f]{64}$/), {
      minLength: 1,
      maxLength: 2,
    }),
  });

/** An answer of every type; `Record` makes a new type a compile error. */
const ANSWERS: Record<TourQuizAnswer["type"], fc.Arbitrary<TourQuizAnswer>> = {
  single: optionIds.chain((ids) =>
    everyField<Extract<TourQuizAnswer, { type: "single" }>>({
      type: fc.constant("single"),
      options: quizOptions(ids),
      correct: fc.constantFrom(...ids),
    }),
  ),
  multiple: optionIds.chain((ids) =>
    everyField<Extract<TourQuizAnswer, { type: "multiple" }>>({
      type: fc.constant("multiple"),
      options: quizOptions(ids),
      correct: fc.subarray(ids, { minLength: 1 }),
    }),
  ),
  text: hashed("text"),
  code: hashed("code"),
  number: everyField<Extract<TourQuizAnswer, { type: "number" }>>({
    type: fc.constant("number"),
    value: number,
    tolerance: positive,
    unit: maybe(words),
  }),
};

/** A choice or a quiz; `Record` makes a new kind of child a compile error. */
const WAITS = (
  id: string,
  childIds: readonly string[],
): Record<
  Exclude<TourStoryChild["kind"], TourBlockKind>,
  fc.Arbitrary<TourStoryChild>
> => ({
  choice: optionIds.chain((ids) =>
    everyField<TourChoice>({
      id: fc.constant(id),
      kind: fc.constant("choice"),
      prompt: words,
      options: fc.tuple(
        ...ids.map((option) =>
          everyField<TourChoiceOption>({
            id: fc.constant(option),
            label: words,
            goto: maybe(fc.constantFrom(...childIds)),
          }),
        ),
      ),
    }),
  ),
  quiz: everyField<TourQuizEntry>({
    id: fc.constant(id),
    kind: fc.constant("quiz"),
    question: words,
    points: fc.nat({ max: 100 }),
    answer: fc.oneof(...Object.values(ANSWERS)),
  }),
});

/** A block of a story: any block, and how it moves on. */
const storyBlock = (kind: TourBlockKind, id: string) =>
  fc
    .tuple(
      BLOCKS[kind](id),
      everyField<Omit<TourStoryBlock, keyof TourBlock>>({ advance }),
    )
    .map(([block, own]): TourStoryBlock => ({ ...block, ...own }));

/** A story of `id`: its blocks, choices and quizzes in any order (the
 *  file's order is the story's), or none: a story may be empty. */
const story = (id: string): fc.Arbitrary<TourStory> =>
  fc
    .record({
      kinds: fc.array(fc.constantFrom(...KINDS), { maxLength: 7 }),
      others: fc.integer({ min: 0, max: 3 }),
    })
    .chain(({ kinds, others }) => {
      const blockIds = kinds.map((_, i) => `${id}-b${String(i)}`);
      const rest = Array.from(
        { length: others },
        (_, i) => `${id}-w${String(i)}`,
      );
      const childIds = [...blockIds, ...rest];
      return everyField<TourStory>({
        id: fc.constant(id),
        kind: fc.constant("folder"),
        role: fc.constant("story"),
        title: words,
        children: fc
          .tuple(
            ...kinds.map((kind, i) => storyBlock(kind, blockIds[i] as string)),
            ...rest.map((wait) =>
              fc.oneof(...Object.values(WAITS(wait, childIds))),
            ),
          )
          .chain((children) =>
            fc.shuffledSubarray<TourStoryChild>(children, {
              minLength: children.length,
            }),
          ),
      });
    });

const frame: fc.Arbitrary<StationFrame> = fc
  .record({
    stories: fc
      .subarray(["one", "two", "three"])
      .chain((ids) => fc.tuple(...ids.map(story))),
    rest: everyField<Omit<StationFrame, "children">>({
      id: fc.constant("station"),
      title: maybe(words),
      description: maybe(words),
      // A photo of the station no asset lists yet, as a copy's own is.
      image: maybe(fc.constantFrom("photo", "its-own-photo")),
      geo: fc.constant(GEO),
      activateRadiusM: fc.constant(50),
      foundRadiusM: fc.constant(25),
      hint: fc.constant("arrow"),
    }),
  })
  .map(({ stories, rest }) => ({ ...rest, children: stories }));

describe("a stored frame reads back whole", () => {
  it("every field of a station, its stories and their children survives the record", () => {
    fc.assert(
      fc.property(frame, (stored) => {
        const text = settingsRecordText({
          needsNoGps: false,
          createdStations: [stored],
          frames: [stored],
        });
        const read = parseSettingsRecord(text, TOUR);
        // JSON leaves out what the generator left undefined, as a page's
        // own frames do.
        const expected = JSON.parse(JSON.stringify(stored)) as StationFrame;
        expect(read?.frames).toEqual([expected]);
        expect(read?.createdStations).toEqual([expected]);
      }),
      { numRuns: 300 },
    );
    // Well under a second alone; a machine shared with other gates ran it
    // past the default 5 s.
  }, 120_000);
});
