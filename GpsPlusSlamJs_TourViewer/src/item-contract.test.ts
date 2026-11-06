import { describe, expect, it, vi } from "vitest";
import type {
  TourAsset,
  TourBlock,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import type { TourStoryChild } from "gps-plus-slam-app-framework/ar/tour-story";

import {
  itemAssets,
  itemStoredAssets,
  showItemCard,
  type ItemCardHost,
} from "./item-card";
import { createSceneView } from "./scene-view";

/**
 * Why these tests matter: what every kind of item owes whoever shows it. A
 * new kind added to the table must keep its words on screen, read nothing
 * it did not declare (a read past the list is a file a write prunes), leave
 * nothing behind when it stops, survive a lost file, and report its end
 * once. The table runs through the real story panel, so it describes what a
 * visitor gets rather than a stub's idea of it.
 */

const IMAGE = { kind: "image", width: 16, height: 9 } as const;
const assets = new Map<string, TourAsset>([
  ["knight", { id: "knight", path: "content/knight.png", ...IMAGE }],
  ["sheet", { id: "sheet", path: "content/sheet.webp", ...IMAGE }],
  ["still", { id: "still", path: "content/still.png", ...IMAGE }],
  ["bell", { id: "bell", path: "content/bell.mp3", kind: "audio" }],
  ["clip", { id: "clip", path: "content/clip.webm", kind: "video" }],
  ["arch", { id: "arch", path: "content/arch.glb", kind: "model" }],
]);
const idOf = (path: string): string =>
  [...assets.values()].find((a) => a.path === path)?.id ?? path;

const characters: ReadonlyMap<string, TourCharacter> = new Map([
  ["sir", { frames: "sheet" } as unknown as TourCharacter],
]);

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

/** One row per kind, plus the look that reads a frames sheet. `ends`: what
 *  a `lineEnd` step waits for. */
const ITEMS: readonly {
  readonly name: string;
  readonly words: string;
  readonly fields: Record<string, unknown>;
  readonly ends?: "sound" | "clip";
}[] = [
  {
    name: "shortText",
    words: "A short line",
    fields: { kind: "shortText", view: "card", caption: "A short line" },
  },
  {
    name: "longText",
    words: "A long read",
    fields: { kind: "longText", view: "card", title: "T", body: "A long read" },
  },
  {
    name: "picture",
    words: "The gate",
    fields: {
      kind: "picture",
      view: "card",
      image: "knight",
      caption: "The gate",
    },
  },
  {
    name: "character",
    words: "Hail",
    fields: {
      kind: "character",
      view: "stage",
      name: "Sir",
      image: "knight",
      caption: "Hail",
      voice: "bell",
    },
    ends: "sound",
  },
  {
    name: "character with a frames sheet",
    words: "Well met",
    fields: {
      kind: "character",
      view: "portrait",
      name: "Sir",
      character: "sir",
      image: "knight",
      caption: "Well met",
    },
  },
  {
    name: "audio",
    words: "A bell rings",
    fields: {
      kind: "audio",
      view: "card",
      audio: "bell",
      transcript: "A bell rings",
    },
    ends: "sound",
  },
  {
    name: "video",
    words: "The walk",
    fields: {
      kind: "video",
      view: "card",
      video: "clip",
      poster: "still",
      transcript: "The walk",
    },
    ends: "clip",
  },
  {
    name: "model",
    words: "The arch",
    fields: { kind: "model", view: "stage", asset: "arch", title: "The arch" },
  },
];

/** The sheet is the character declaration's, which a write keeps as such. */
const OWN_ASSETS_ONLY = (id: string): boolean => id !== "sheet";

function block(fields: Record<string, unknown>): TourBlock {
  return { ...fields, id: "item", pose: POSE } as unknown as TourBlock;
}

function stationOf(fields: Record<string, unknown>): TourStation {
  const steps = [
    { ...block(fields), advance: { mode: "lineEnd" } },
    {
      kind: "shortText",
      view: "card",
      caption: "The next step",
      id: "after",
      pose: POSE,
      advance: { mode: "tap" },
    },
  ];
  return {
    id: "s",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    children: [
      {
        id: "story",
        kind: "story",
        title: "A story",
        children: steps as unknown as TourStoryChild[],
      },
    ],
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

function panel(
  loadAsset: (path: string) => Promise<Blob> = (path) =>
    Promise.resolve(new Blob([path])),
) {
  const reads: string[] = [];
  const urls = { live: new Set<string>(), made: 0 };
  const timers: { fn: () => void; cancelled: boolean }[] = [];
  const voiceEnds: (() => void)[] = [];
  const audio = {
    play: vi.fn((_blob: Blob, onEnded: () => void) => {
      voiceEnds.push(onEnded);
      return Promise.resolve();
    }),
    stop: vi.fn(),
  };
  const stage = {
    showCharacter: vi.fn(() => Promise.resolve()),
    showModel: vi.fn(() => Promise.resolve()),
    clear: vi.fn(),
  };
  const video = {
    src: "",
    poster: "",
    hidden: true as boolean | "until-found",
    pause: () => undefined,
    removeAttribute(name: string) {
      if (name === "src" || name === "poster") video[name] = "";
    },
    load: () => undefined,
    onended: null as ((ev: Event) => void) | null,
    onplay: null as ((ev: Event) => void) | null,
    onerror: null as OnErrorEventHandler,
  };
  const dom = {
    panel: { hidden: true },
    title: { textContent: "" },
    description: { textContent: "", hidden: true },
    speaker: { textContent: "", hidden: true },
    portrait: { src: "", alt: "", hidden: true },
    text: { textContent: "" },
    status: { textContent: "" },
    image: { src: "", alt: "", hidden: true as boolean | "until-found" },
    stationImage: { src: "", alt: "", hidden: true },
    video,
    choices: { replaceChildren: () => undefined },
    continueButton: { hidden: false },
    playNext: { hidden: true, textContent: "" },
  };
  const view = createSceneView({
    dom,
    assets,
    characters,
    loadAsset: (path) => {
      reads.push(idOf(path));
      return loadAsset(path);
    },
    audio,
    stage,
    checkPicture: () => Promise.resolve(null),
    createChoiceButton: () => ({}) as unknown as Node,
    schedule: (fn) => {
      const timer = { fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    objectUrls: {
      create: () => {
        urls.made += 1;
        const url = `blob:${String(urls.made)}`;
        urls.live.add(url);
        return url;
      },
      revoke: (url) => {
        urls.live.delete(url);
      },
    },
    onStoryEnd: () => undefined,
  });
  return { view, dom, audio, stage, reads, urls, timers, voiceEnds };
}

describe.each(ITEMS)("the item contract: $name", (item) => {
  it("shows its words at once, before any file is read", () => {
    const { view, dom } = panel(() => new Promise(() => undefined));
    view.offer(stationOf(item.fields));
    expect(dom.text.textContent).toContain(item.words);
  });

  it("reads only what it declares, and every file it reads is kept by a write", async () => {
    const { view, reads } = panel();
    view.offer(stationOf(item.fields));
    await flush();
    const declared = itemAssets(block(item.fields), characters);
    const stored = itemStoredAssets(block(item.fields));
    expect(declared).toEqual(expect.arrayContaining(reads));
    expect(stored).toEqual(
      expect.arrayContaining(declared.filter(OWN_ASSETS_ONLY)),
    );
  });

  it("does nothing when a file lands after it stopped", async () => {
    const landings: (() => void)[] = [];
    const { view, dom, audio, stage, urls } = panel(
      (path) =>
        new Promise((resolve) => {
          landings.push(() => {
            resolve(new Blob([path]));
          });
        }),
    );
    view.offer(stationOf(item.fields));
    view.stopAll();
    for (const land of landings) land();
    await flush();
    expect(audio.play).not.toHaveBeenCalled();
    expect(stage.showCharacter).not.toHaveBeenCalled();
    expect(stage.showModel).not.toHaveBeenCalled();
    expect(urls.made).toBe(0);
    expect(dom.image.src).toBe("");
    expect(dom.video.src).toBe("");
  });

  it("leaves no sound and no live object URL when it stops", async () => {
    const { view, dom, audio, urls } = panel();
    view.offer(stationOf(item.fields));
    await flush();
    audio.stop.mockClear();
    view.stopAll();
    expect(audio.stop).toHaveBeenCalled();
    expect([...urls.live]).toEqual([]);
    expect(dom.video.src).toBe("");
  });

  it("moves its step on once when its media ended, however often it says so", async () => {
    const run = panel();
    run.view.offer(stationOf(item.fields));
    await flush();
    if (item.ends === "sound") {
      for (const end of [...run.voiceEnds, ...run.voiceEnds]) end();
    } else if (item.ends === "clip") {
      const ev = new Event("ended");
      run.dom.video.onplay?.(ev);
      run.dom.video.onended?.(ev);
      run.dom.video.onended?.(ev);
    }
    const armed = run.timers.filter((t) => !t.cancelled);
    expect(armed).toHaveLength(1);
    armed[0]?.fn();
    expect(run.dom.text.textContent).toBe("The next step");
  });
});

describe.each(ITEMS.filter((i) => !["shortText", "longText"].includes(i.name)))(
  "the item contract, with files: $name",
  (item) => {
    it("keeps its words and says so on the status line when its files are lost", async () => {
      const { view, dom } = panel(() =>
        Promise.reject(new Error("the file is gone")),
      );
      view.offer(stationOf(item.fields));
      await flush();
      expect(dom.text.textContent).toContain(item.words);
      expect(dom.status.textContent).toContain("could not be loaded");
    });
  },
);

describe("a host with no stage", () => {
  function host(): ItemCardHost & { assetsRead: string[] } {
    const assetsRead: string[] = [];
    return {
      assetsRead,
      slots: {
        text: { textContent: "" },
        speaker: { textContent: "", hidden: true },
        image: { src: "", alt: "", hidden: true },
        video: {} as ItemCardHost["slots"]["video"],
      },
      characters,
      checkPicture: () => Promise.resolve(null),
      asset: (id) => {
        assetsRead.push(id);
      },
      url: () => "blob:1",
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

  // Why this test matters: a place with nothing to stand in must still give
  // the visitor the item's words, and must not read a figure nobody draws.
  it.each(
    ITEMS.filter((i) => i.fields.kind === "character" || i.name === "model"),
  )("shows the words of $name and reads no figure", (item) => {
    const shown = host();
    showItemCard(block(item.fields), shown);
    expect(shown.slots.text.textContent).toBe(item.words);
    expect(shown.assetsRead.filter((id) => id !== "bell")).toEqual([]);
  });
});

describe("itemAssets", () => {
  // Why this test matters: the reads above catch a list that is too short;
  // only the list itself catches one that is too long, and the prefetch
  // would read those files for nothing.
  it("names what each view reads and no more", () => {
    const card = {
      kind: "character",
      view: "card",
      name: "Sir",
      image: "knight",
      caption: "Hi",
      voice: "bell",
    };
    expect(itemAssets(block(card), characters)).toEqual(["bell"]);
    expect(
      itemAssets(
        block({ kind: "model", view: "card", asset: "arch" }),
        characters,
      ),
    ).toEqual([]);
    expect(
      itemAssets(
        block({ ...card, view: "portrait", character: "sir" }),
        characters,
      ),
    ).toEqual(["knight", "sheet", "bell"]);
    expect(
      itemAssets(
        block({ kind: "video", video: "clip", poster: "still" }),
        characters,
      ),
    ).toEqual(["clip", "still"]);
  });
});
