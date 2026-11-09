import { describe, expect, it } from "vitest";

import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import type { showItemCard, ItemCardHost } from "../item-card.js";
import {
  createSilentAudio,
  freeTour,
  kindAssets,
  kindNameOf,
  readItemKind,
  showWith,
  storyStation,
  type ItemKind,
} from "./item-lab-kind.js";

const RECORD = { kind: "stamp", image: "pic" };
const SAMPLE = {
  name: "A stamp",
  words: "Stamped",
  records: {
    normal: RECORD,
    longest: { ...RECORD, name: "A very long stamp name" },
    missing: { kind: "stamp" },
  },
  assets: [{ id: "pic", kind: "image", file: "pic.png", width: 2, height: 2 }],
};
/** The least a kind's module holds. */
const MODULE = { card: () => undefined, assets: () => ["pic"] };

function kind(over: Partial<ItemKind> = {}): ItemKind {
  return { ...readItemKind("a-1", MODULE, SAMPLE), ...over };
}

function host(): ItemCardHost {
  return {
    slots: {
      text: { textContent: "" },
      speaker: { textContent: "", hidden: true },
      image: { src: "", alt: "", hidden: true },
      video: {} as ItemCardHost["slots"]["video"],
    },
    checkPicture: () => Promise.resolve(null),
    asset: () => undefined,
    url: () => "",
    sound: () => undefined,
    clip: () => ({
      started: () => undefined,
      ended: () => undefined,
      lost: () => undefined,
    }),
    showing: () => true,
    notice: () => undefined,
    debugLine: () => undefined,
  };
}

/** The story's first step: the block the kind stands in for. */
function carrierOf(item: ItemKind): Parameters<typeof showItemCard>[0] {
  const story = storyStation(item).children[0] as unknown as {
    children: Parameters<typeof showItemCard>[0][];
  };
  return story.children[0]!;
}

describe("the kind named in the page's address", () => {
  // Why: the name becomes a path the page imports a module from, so what a
  // link says must never reach outside the kinds' folder.
  it("takes a folder name and refuses anything that could leave the folder", () => {
    expect(kindNameOf("?kind=lantern-1")).toBe("lantern-1");
    expect(kindNameOf("")).toBe("stamp-1");
    for (const bad of ["..%2Fx", "a/b", "https://x.test/k", "A", "-a", ""]) {
      expect(kindNameOf(`?kind=${bad}`)).toBeNull();
    }
  });
});

describe("reading a kind's folder", () => {
  // Why: a session's half-made kind must fail with a line naming what is
  // missing, not as a blank page or a TypeError deep inside a host.
  it("says what is missing from the module or the sample", () => {
    const module = MODULE;
    expect(() => readItemKind("a", {}, SAMPLE)).toThrow(/card/);
    expect(() => readItemKind("a", { card: () => undefined }, SAMPLE)).toThrow(
      /assets/,
    );
    expect(() => readItemKind("a", module, null)).toThrow(/sample/);
    expect(() => readItemKind("a", module, { ...SAMPLE, words: "" })).toThrow(
      /words/,
    );
    expect(() =>
      readItemKind("a", module, { ...SAMPLE, records: undefined }),
    ).toThrow(/records/);
    // A sample holds the three records the prototype rule names.
    for (const name of ["normal", "longest", "missing"]) {
      const records: Record<string, unknown> = { ...SAMPLE.records };
      delete records[name];
      expect(
        () => readItemKind("a", module, { ...SAMPLE, records }),
        name,
      ).toThrow(new RegExp(`records\\.${name}`));
    }
    // The optional halves are functions when they are there.
    for (const part of ["world", "read", "fields"]) {
      expect(
        () => readItemKind("a", { ...module, [part]: 1 }, SAMPLE),
        part,
      ).toThrow(new RegExp(`${part}\\(`));
    }
    expect(() => readItemKind("a", module, { ...SAMPLE, assets: {} })).toThrow(
      /assets/,
    );
    expect(() =>
      readItemKind("a", module, { ...SAMPLE, assets: [{ id: "x" }] }),
    ).toThrow(/assets/);
  });

  // Why: the lab's first kind was written to an older contract, and a
  // session copying such a kind must be told the new name, not only that a
  // name is missing.
  it("names the new contract to a kind written to the old one", () => {
    expect(() =>
      readItemKind("a", { show: () => undefined, assets: () => [] }, SAMPLE),
    ).toThrow(/show\(block, host\) is card\(block, host\) now/);
    const { records: _records, ...old } = SAMPLE;
    expect(() => readItemKind("a", MODULE, { ...old, block: RECORD })).toThrow(
      /"block" in sample\.json is "records"\.normal now/,
    );
  });

  // Why: the kind's own `read` is its schema. Every host is handed the
  // record as read, never the raw one, and what the read had to fix is
  // kept for the page to show.
  it("reads each record through the kind's own read, keeping its problems", () => {
    const read = (raw: Record<string, unknown>) => ({
      block: { ...raw, name: raw["name"] ?? "Untitled" },
      problems: raw["name"] === undefined ? ["no name"] : [],
    });
    const item = readItemKind("a", { ...MODULE, read }, SAMPLE);
    expect(item.block).toEqual({ ...RECORD, name: "Untitled" });
    expect(item.recordOf("missing")).toEqual({
      block: { kind: "stamp", name: "Untitled" },
      problems: ["no name"],
    });
    // Without a read the record is the block.
    expect(readItemKind("a", MODULE, SAMPLE).recordOf("longest")).toEqual({
      block: SAMPLE.records.longest,
      problems: [],
    });
  });

  it("refuses a read that gives no block, naming the record", () => {
    for (const read of [() => ({ problems: [] }), () => null]) {
      expect(() => readItemKind("a", { ...MODULE, read }, SAMPLE)).toThrow(
        /read\(records\.normal\) gave no \{ block \}/,
      );
    }
  });

  it("keeps a plainly marked gap of the free host", () => {
    const read = readItemKind("a", MODULE, { ...SAMPLE, freeKnown: "no look" });
    expect(read.sample.freeKnown).toBe("no look");
  });

  // Why: the free host stands a kind as a figure drawn from its image. A
  // kind with no image and no note would stand a figure with no picture and
  // fail deep inside the host instead of saying what it lacks.
  it("refuses a kind with no image unless it says why it cannot stand free", () => {
    const sound = {
      ...SAMPLE,
      assets: [{ id: "s", kind: "audio", file: "s.mp3" }],
    };
    expect(() => readItemKind("a", MODULE, sound)).toThrow(
      /needs an "image" in its assets or a "freeKnown" note/,
    );
    const noted = readItemKind("a", MODULE, {
      ...sound,
      freeKnown: "a sound has no figure",
    });
    expect(noted.sample.freeKnown).toBe("a sound has no figure");
    // A note is words: JSON's null, an empty string or a number is none,
    // with an image or without (the contract test reads it as the note).
    for (const freeKnown of [null, "", 3]) {
      for (const sample of [sound, SAMPLE]) {
        expect(
          () => readItemKind("a", MODULE, { ...sample, freeKnown }),
          JSON.stringify(freeKnown),
        ).toThrow(/"freeKnown" in sample\.json must be a note/);
      }
    }
  });

  it("lists its files as the tour's assets, by their file names", () => {
    expect(kindAssets(kind()).get("pic")).toMatchObject({
      path: "pic.png",
      kind: "image",
    });
  });
});

describe("the two contexts around a kind", () => {
  // Why: the format has no such kind, so the real hosts see a valid block in
  // its place. Only that one block may reach the kind: the story's other
  // step must still go through the real card.
  it("hands the kind its own block in a story and the real card the next step", () => {
    const shown: unknown[] = [];
    const item = kind({
      card(block) {
        shown.push(block);
      },
    });
    const show = showWith(item);
    const story = storyStation(item).children[0] as unknown as {
      children: Parameters<typeof showItemCard>[0][];
    };
    const [first, second] = story.children;
    const seen = host();
    show(first!, seen);
    expect(shown).toEqual([RECORD]);
    show(second!, seen);
    expect(shown).toHaveLength(1);
    expect(seen.slots.text.textContent).toContain("step");
  });

  // Why: the lab switches the record the kind shows while the hosts keep
  // the `showItem` they were built with, so it must read the record shown
  // at the moment.
  it("hands the kind the record the page shows at the moment", () => {
    const shown: unknown[] = [];
    const item = kind({
      card(block) {
        shown.push(block);
      },
    });
    let now: unknown = RECORD;
    const show = showWith(item, () => now);
    show(carrierOf(item), host());
    now = SAMPLE.records.missing;
    show(carrierOf(item), host());
    expect(shown).toEqual([RECORD, SAMPLE.records.missing]);
  });

  // Why: the free host stands only characters, so the block it finds must
  // be one, or the kind never reaches it.
  it("stands in the free host's station as a character block", () => {
    const station = freeTour(kind()).stations[0]!;
    expect(tourFreeBlocks(station).map((b) => b.kind)).toEqual(["character"]);
  });
});

describe("the silent sound element", () => {
  // Why: the real voice player runs over it, so its clock and its `ended`
  // must behave as an element's do, without a browser's autoplay rule.
  it("plays, pauses and ends as an element does", async () => {
    const audio = createSilentAudio();
    const events: string[] = [];
    audio.addEventListener("ended", () => events.push("ended"));
    expect(audio.paused).toBe(true);
    await audio.play();
    expect(audio.paused).toBe(false);
    audio.finish();
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(audio.duration);
    expect(events).toEqual(["ended"]);
  });
});
