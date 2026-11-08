import { Object3D } from "three";
import { describe, expect, it } from "vitest";
import {
  tourBlockKinds,
  type TourBlockKind,
  type TourBlockOfKind,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { itemAssets, showItemCard, type ItemCardHost } from "./item-card";
import { PLAY_KINDS, playKindOf, worldPartOf } from "./play-kinds";
import { worldEnv, type WorldPart } from "./world-part";

/**
 * Why these tests matter: the visitor's card is one row per kind, so a kind
 * the format gains is a compile error at its row and nowhere else. These
 * hold the other half: the list has exactly the format's kinds, every row
 * fills a card through the dispatch, and a block of a kind this viewer has
 * no row for is refused with words rather than shown blank.
 */

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

/** One block per kind, with the words its card must show. */
const SAMPLES: {
  readonly [K in TourBlockKind]: readonly [TourBlockOfKind[K], string];
} = {
  shortText: [
    { id: "a", kind: "shortText", view: "card", caption: "Hi", pose: POSE },
    "Hi",
  ],
  longText: [
    {
      id: "b",
      kind: "longText",
      view: "card",
      title: "T",
      body: "A long read",
      pose: POSE,
    },
    "A long read",
  ],
  picture: [
    {
      id: "c",
      kind: "picture",
      view: "card",
      image: "pic",
      caption: "The gate",
      pose: POSE,
    },
    "The gate",
  ],
  video: [
    {
      id: "d",
      kind: "video",
      view: "card",
      video: "clip",
      transcript: "The walk",
      pose: POSE,
    },
    "The walk",
  ],
  audio: [
    {
      id: "e",
      kind: "audio",
      view: "card",
      audio: "bell",
      transcript: "A bell",
      pose: POSE,
    },
    "A bell",
  ],
  model: [
    {
      id: "f",
      kind: "model",
      view: "card",
      asset: "arch",
      title: "The arch",
      pose: POSE,
    },
    "The arch",
  ],
  character: [
    {
      id: "g",
      kind: "character",
      view: "card",
      name: "Sir",
      image: "knight",
      caption: "Hail",
      pose: POSE,
    },
    "Hail",
  ],
} as unknown as {
  readonly [K in TourBlockKind]: readonly [TourBlockOfKind[K], string];
};

function host() {
  const notices = new Map<string, string>();
  const debug: string[] = [];
  const read: string[] = [];
  const shown: ItemCardHost = {
    slots: {
      text: { textContent: "" },
      speaker: { textContent: "", hidden: true },
      image: { src: "", alt: "", hidden: true },
      video: {} as ItemCardHost["slots"]["video"],
    },
    checkPicture: () => Promise.resolve(null),
    asset: (id) => {
      read.push(id);
    },
    url: () => "blob:1",
    sound: (id) => {
      read.push(id);
    },
    clip: () => ({
      started: () => undefined,
      ended: () => undefined,
      lost: () => undefined,
    }),
    showing: () => true,
    notice: (what, text) => {
      if (text === null) notices.delete(what);
      else notices.set(what, text);
    },
    debugLine: (text) => {
      debug.push(text);
    },
  };
  return { shown, notices, debug, read };
}

describe("the visitor's rows of kinds", () => {
  it("has exactly one row per kind of the format, in its order", () => {
    expect(Object.keys(PLAY_KINDS)).toEqual(tourBlockKinds());
  });

  it.each(tourBlockKinds())("fills the card of %s through its row", (kind) => {
    const [block, words] = SAMPLES[kind];
    const { shown, notices, read } = host();
    showItemCard(block, shown);
    expect(shown.slots.text.textContent).toContain(words);
    expect(notices.size).toBe(0);
    expect(itemAssets(block, new Map())).toEqual(expect.arrayContaining(read));
  });
});

describe("a block of a kind with no row", () => {
  // A newer tour, or a draft of a kind this viewer does not know yet, can
  // reach a host: it must say so rather than show a blank card.
  it.each(["stamp", "toString", "__proto__"])(
    "refuses the kind %s with words and reads nothing",
    (kind) => {
      const block = { id: "x", kind, view: "card", pose: POSE };
      const { shown, notices, debug, read } = host();
      showItemCard(block as unknown as TourBlock, shown);
      expect(notices.get("item")).toBe("This item cannot be shown here.");
      expect(debug.join(" ")).toContain(`"${kind}"`);
      expect(read).toEqual([]);
      expect(itemAssets(block as unknown as TourBlock, new Map())).toEqual([]);
      expect(playKindOf(kind)).toBeUndefined();
    },
  );
});

describe("the world door", () => {
  const env = worldEnv("play", [], () => Promise.reject(new Error("none")));

  // Why: the renderer asks this door for every block it has no drawing
  // for; a row with no world part yet must give none, so nothing stands
  // that nobody chose (the stands, signs and models are the renderer's own
  // drawings, a free character the free host's).
  it.each(tourBlockKinds())(
    "gives no part for %s while its row has none",
    (kind) => {
      expect(worldPartOf(SAMPLES[kind][0], env)).toBeNull();
    },
  );

  it("gives no part for a kind with no row", () => {
    const block = { id: "x", kind: "stamp", view: "card", pose: POSE };
    expect(worldPartOf(block as unknown as TourBlock, env)).toBeNull();
  });

  // Why: a kind gets its look in the world by its row alone. A row is
  // given a world part here for the length of the test (no row has one
  // yet), to prove the door hands it the block and the environment.
  it("hands a row with a world part the block and the environment", () => {
    const row = PLAY_KINDS.audio as { world?: unknown };
    const part: WorldPart = { object: new Object3D(), dispose() {} };
    const seen: unknown[] = [];
    row.world = (block: unknown, given: unknown) => {
      seen.push(block, given);
      return part;
    };
    try {
      const [block] = SAMPLES.audio;
      expect(worldPartOf(block, env)).toBe(part);
      expect(seen).toEqual([block, env]);
    } finally {
      delete row.world;
    }
  });
});
