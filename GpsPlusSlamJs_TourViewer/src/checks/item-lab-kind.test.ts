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

const SAMPLE = {
  name: "A stamp",
  words: "Stamped",
  block: { kind: "stamp", image: "pic" },
  assets: [{ id: "pic", kind: "image", file: "pic.png", width: 2, height: 2 }],
};

function kind(over: Partial<ItemKind> = {}): ItemKind {
  return {
    ...readItemKind(
      "a-1",
      { show: () => undefined, assets: () => ["pic"] },
      SAMPLE,
    ),
    ...over,
  };
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
    const module = { show: () => undefined, assets: () => [] };
    expect(() => readItemKind("a", {}, SAMPLE)).toThrow(/show/);
    expect(() => readItemKind("a", { show: () => undefined }, SAMPLE)).toThrow(
      /assets/,
    );
    expect(() => readItemKind("a", module, null)).toThrow(/sample/);
    expect(() => readItemKind("a", module, { ...SAMPLE, words: "" })).toThrow(
      /words/,
    );
    expect(() => readItemKind("a", module, { ...SAMPLE, block: 1 })).toThrow(
      /block/,
    );
    expect(() => readItemKind("a", module, { ...SAMPLE, assets: {} })).toThrow(
      /assets/,
    );
    expect(() =>
      readItemKind("a", module, { ...SAMPLE, assets: [{ id: "x" }] }),
    ).toThrow(/assets/);
  });

  it("keeps a plainly marked gap of the free host", () => {
    const module = { show: () => undefined, assets: () => [] };
    const read = readItemKind("a", module, { ...SAMPLE, freeKnown: "no look" });
    expect(read.sample.freeKnown).toBe("no look");
  });

  // Why: the free host stands a kind as a figure drawn from its image. A
  // kind with no image and no note would stand a figure with no picture and
  // fail deep inside the host instead of saying what it lacks.
  it("refuses a kind with no image unless it says why it cannot stand free", () => {
    const module = { show: () => undefined, assets: () => [] };
    const sound = {
      ...SAMPLE,
      assets: [{ id: "s", kind: "audio", file: "s.mp3" }],
    };
    expect(() => readItemKind("a", module, sound)).toThrow(
      /needs an "image" in its assets or a "freeKnown" note/,
    );
    const noted = readItemKind("a", module, {
      ...sound,
      freeKnown: "a sound has no figure",
    });
    expect(noted.sample.freeKnown).toBe("a sound has no figure");
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
      show(block) {
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
    expect(shown).toEqual([SAMPLE.block]);
    show(second!, seen);
    expect(shown).toHaveLength(1);
    expect(seen.slots.text.textContent).toContain("step");
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
