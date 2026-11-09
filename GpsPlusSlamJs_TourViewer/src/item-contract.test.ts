import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { Object3D } from "three";
import type {
  TourAsset,
  TourBlock,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import type { TourStoryChild } from "gps-plus-slam-app-framework/ar/tour-story";

import { itemAssets, showItemCard, type ItemCardHost } from "./item-card";
import {
  createSilentAudio,
  freeCarrier,
  kindAssets,
  readItemKind,
  showWith,
  storyCarrier,
  type ItemKind,
  type SilentAudio,
} from "./checks/item-lab-kind";
import { createFreeItems } from "./free-items";
import { createNarrationPlayer } from "./narration-player";
import { createSceneView, type SceneViewDeps } from "./scene-view";
import { createVoiceFocus } from "./voice-focus";
import { TOUR_BLOCK_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";
import { tourBlockAssetIds } from "gps-plus-slam-app-framework/ar/tour-kinds";

/**
 * Why these tests matter: what every kind of item owes whoever shows it. A
 * kind must keep its words on screen, read nothing it did not declare (a
 * read past the list is a file a write prunes), leave nothing behind when
 * it stops, survive a lost file, and report its end once. The table runs
 * through the real story panel and the real free host, so it describes what
 * a visitor gets rather than a stub's idea of it, and a kind the format gains
 * fails here until it has a row. Every folder of
 * `public/prototypes/item-kinds/` is a row too, so a session's new kind is
 * held to the same contract without touching this file.
 *
 * A gap of the free host is a row marked `known`: the line says what is
 * missing, the row asserts the free host stands nothing for it, and it goes
 * red the day the host stands it.
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
 *  a `lineEnd` step waits for. `free`: the block as it stands free; `known`:
 *  why the free host cannot run it yet. */
interface ItemRow {
  readonly name: string;
  readonly words: string;
  readonly fields: Record<string, unknown>;
  readonly ends?: "sound" | "clip";
  readonly free: Record<string, unknown>;
  readonly known?: string;
}

/** The world views' free blocks are drawn with the station, not by the host. */
const PLACED =
  "it is drawn with its station by renderTourStation, so its tap, stop and voice are not the free host's";
/** A free video or sound has a seam and no look. */
const NO_LOOK = "it draws nothing: no look exists yet";

const ITEMS: readonly ItemRow[] = [
  {
    name: "shortText",
    words: "A short line",
    fields: { kind: "shortText", view: "card", caption: "A short line" },
    free: { kind: "shortText", view: "pin", caption: "A short line" },
    known: PLACED,
  },
  {
    name: "longText",
    words: "A long read",
    fields: { kind: "longText", view: "card", title: "T", body: "A long read" },
    free: {
      kind: "longText",
      view: "lectern",
      title: "T",
      body: "A long read",
    },
    known: PLACED,
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
    free: {
      kind: "picture",
      view: "plane",
      image: "knight",
      caption: "The gate",
    },
    known: PLACED,
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
    // A free character takes one of his world views, never the plain stage.
    free: {
      kind: "character",
      view: "speak",
      name: "Sir",
      image: "knight",
      caption: "Hail",
      voice: "bell",
    },
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
    free: {
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
    free: {
      kind: "audio",
      view: "card",
      audio: "bell",
      transcript: "A bell rings",
    },
    known: NO_LOOK,
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
    free: {
      kind: "video",
      view: "card",
      video: "clip",
      poster: "still",
      transcript: "The walk",
    },
    known: NO_LOOK,
  },
  {
    name: "model",
    words: "The arch",
    fields: { kind: "model", view: "stage", asset: "arch", title: "The arch" },
    free: { kind: "model", view: "placed", asset: "arch", title: "The arch" },
    known: PLACED,
  },
];

const KINDS_DIR = new URL("../public/prototypes/item-kinds/", import.meta.url);

/** Every kind folder of the gallery, read as the lab reads one. */
const KINDS: readonly ItemKind[] = await Promise.all(
  readdirSync(KINDS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(async ({ name }) => {
      const folder = new URL(`${name}/`, KINDS_DIR);
      const module: unknown = await import(
        /* @vite-ignore */ new URL("kind.js", folder).href
      );
      const sample: unknown = JSON.parse(
        readFileSync(new URL("sample.json", folder), "utf8"),
      );
      return readItemKind(name, module, sample);
    }),
);
const kindOfRow = new Map<ItemRow, ItemKind>();
const KIND_ROWS: readonly ItemRow[] = KINDS.map((kind) => {
  const { words, freeKnown } = kind.sample;
  const row: ItemRow = {
    name: `the kind ${kind.name}`,
    words,
    fields: storyCarrier(kind),
    free: freeCarrier(kind) as unknown as Record<string, unknown>,
    ...(freeKnown === undefined ? {} : { known: freeKnown }),
  };
  kindOfRow.set(row, kind);
  return row;
});
const ROWS: readonly ItemRow[] = [...ITEMS, ...KIND_ROWS];

for (const kind of KINDS) {
  for (const [id, asset] of kindAssets(kind)) assets.set(id, asset);
}

const showOf = (row: ItemRow) => {
  const kind = kindOfRow.get(row);
  return kind === undefined ? undefined : showWith(kind);
};

/** The sheet is the character declaration's, which a write keeps as such. */
const OWN_ASSETS_ONLY = (id: string): boolean => id !== "sheet";

function block(fields: Record<string, unknown>): TourBlock {
  return { id: "item", ...fields, pose: POSE } as unknown as TourBlock;
}

/** What the row reads, by its own list. */
function declaredOf(row: ItemRow): readonly string[] {
  const kind = kindOfRow.get(row);
  return kind === undefined
    ? itemAssets(block(row.fields), characters)
    : kind.assets(kind.block);
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
        kind: "folder",
        role: "story",
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

/** The card's own element: what an item put in it, until the host empties it. */
function fakeSurface() {
  const surface = {
    held: [] as unknown[],
    append(...nodes: unknown[]) {
      surface.held.push(...nodes);
    },
    replaceChildren(...nodes: unknown[]) {
      surface.held = nodes;
    },
  };
  return surface as typeof surface & HTMLElement;
}

function panel(
  loadAsset: (path: string) => Promise<Blob> = (path) =>
    Promise.resolve(new Blob([path])),
  checkPicture: () => Promise<string | null> = () => Promise.resolve(null),
  showItem?: (block: TourBlock, host: ItemCardHost) => void,
) {
  const reads: string[] = [];
  const urls = { live: new Set<string>(), made: 0 };
  const onStoryEnd = vi.fn();
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
    surface: fakeSurface(),
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
    checkPicture,
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
    onStoryEnd,
    ...(showItem === undefined ? {} : { showItem }),
  });
  return {
    view,
    dom,
    audio,
    stage,
    reads,
    urls,
    timers,
    voiceEnds,
    onStoryEnd,
  };
}

/** The real free host, with silent sounds and stages that record. */
function freeSide(
  row: ItemRow,
  loadAsset: (path: string) => Promise<Blob> = (path) =>
    Promise.resolve(new Blob([path])),
) {
  const focus = createVoiceFocus();
  const reads: string[] = [];
  const failures: string[] = [];
  const live = new Set<string>();
  const sounds: SilentAudio[] = [];
  const lines: string[] = [];
  const stages: { setVoice: ReturnType<typeof vi.fn> }[] = [];
  let tapTargets: Object3D[] = [];
  const station = { id: "s", children: [block(row.free)] };
  const tour = { stations: [station] } as never;
  const showItem = showOf(row);
  const free = createFreeItems({
    tour: () => tour,
    characters: () => characters,
    assets: () => assets,
    loadAsset: (path) => {
      reads.push(idOf(path));
      return loadAsset(path);
    },
    makeStage: () => {
      const stage = {
        showCharacter: vi.fn(
          (_id: string, _blob: Blob, _wait?: () => void, look?: unknown) => {
            lines.push((look as { line?: string } | undefined)?.line ?? "");
            tapTargets = [new Object3D()];
            return Promise.resolve();
          },
        ),
        setVoice: vi.fn(),
        release: vi.fn(),
        clear: vi.fn(),
        characterTapTargets: () => tapTargets,
        toggleBubble: vi.fn(),
        faceVisitor: vi.fn(),
        follow: vi.fn(),
      };
      stages.push(stage);
      return stage;
    },
    focus,
    checkPicture: () => Promise.resolve(null),
    pick: (targets) => [...targets.keys()][0] ?? null,
    sayFailure: (text) => failures.push(text),
    makePlayer: (deps) =>
      createNarrationPlayer({
        ...deps,
        audio: () => {
          const sound = createSilentAudio();
          sounds.push(sound);
          return sound;
        },
        createUrl: () => {
          const url = `blob:voice-${String(live.size)}`;
          live.add(url);
          return url;
        },
        revokeUrl: (url) => live.delete(url),
      }),
    ...(showItem === undefined ? {} : { showItem }),
  });
  return {
    free,
    reads,
    failures,
    live,
    sounds,
    lines,
    stages,
    arrive() {
      free.follow((id) => id === "s");
    },
    tap: () => free.tapped(null),
  };
}

describe("the table of kinds", () => {
  // Why this test matters: the rows in play-kinds.ts stop a new kind at
  // the compiler, but the contract below only binds a kind with a row. A
  // kind the format gains must not pass this file by being absent from it.
  it("has a row for every kind the format knows", () => {
    expect(new Set(ITEMS.map((i) => i.fields.kind))).toEqual(
      new Set(Object.keys(TOUR_BLOCK_VIEWS)),
    );
  });
});

/** A kind measures a picture only when its sample has one. */
const hasPicture = (row: ItemRow): boolean => {
  const kind = kindOfRow.get(row);
  return kind === undefined
    ? /picture|sheet/.test(row.name)
    : [...kindAssets(kind).values()].some((asset) => asset.kind === "image");
};

/** It speaks: one of its files is a sound. */
const voiced = (row: ItemRow): boolean =>
  declaredOf(row).some((id) => assets.get(id)?.kind === "audio");

describe.each(ROWS.filter(hasPicture))(
  "the item contract, a picture being measured: $name",
  (item) => {
    // Why this test matters: measuring is a second wait after the read, so
    // a guard on the read alone would show a stopped item's picture, over
    // whatever the visitor moved on to.
    it("shows no picture when it stopped while the picture was measured", async () => {
      const measured: (() => void)[] = [];
      const { view, dom, urls } = panel(
        undefined,
        () => {
          return new Promise((resolve) => {
            measured.push(() => {
              resolve(null);
            });
          });
        },
        showOf(item),
      );
      view.offer(stationOf(item.fields));
      await flush();
      expect(measured.length).toBeGreaterThan(0);
      view.stopAll();
      for (const done of measured) done();
      await flush();
      expect(urls.made).toBe(0);
      expect(dom.image.src).toBe("");
      expect(dom.portrait.src).toBe("");
      expect(dom.image.hidden).toBe(true);
      expect(dom.portrait.hidden).toBe(true);
    });
  },
);

describe.each(ROWS)("the item contract: $name", (item) => {
  it("shows its words at once, before any file is read", () => {
    const { view, dom } = panel(
      () => new Promise(() => undefined),
      undefined,
      showOf(item),
    );
    view.offer(stationOf(item.fields));
    expect(dom.text.textContent).toContain(item.words);
  });

  it("reads only what it declares, and every file it reads is kept by a write", async () => {
    const { view, reads } = panel(undefined, undefined, showOf(item));
    view.offer(stationOf(item.fields));
    await flush();
    view.characterTapped();
    await flush();
    const declared = declaredOf(item);
    expect(declared).toEqual(expect.arrayContaining(reads));
    // A prototype has no format half yet: nothing writes it.
    if (kindOfRow.has(item)) return;
    const stored = tourBlockAssetIds(block(item.fields));
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
      undefined,
      showOf(item),
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
    const { view, dom, audio, urls } = panel(
      undefined,
      undefined,
      showOf(item),
    );
    view.offer(stationOf(item.fields));
    await flush();
    view.characterTapped();
    await flush();
    audio.stop.mockClear();
    view.stopAll();
    expect(audio.stop).toHaveBeenCalled();
    expect([...urls.live]).toEqual([]);
    expect(dom.video.src).toBe("");
  });

  it("moves its step on once when its media ended, however often it says so", async () => {
    const run = panel(undefined, undefined, showOf(item));
    run.view.offer(stationOf(item.fields));
    await flush();
    if (kindOfRow.has(item)) {
      run.view.characterTapped();
      await flush();
    }
    if (item.ends === "sound" || kindOfRow.has(item)) {
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

describe.each(
  ROWS.filter(
    (i) =>
      !["shortText", "longText"].includes(i.name) && declaredOf(i).length > 0,
  ),
)("the item contract, with files: $name", (item) => {
  it("keeps its words and says so on the status line when its files are lost", async () => {
    const { view, dom } = panel(
      () => Promise.reject(new Error("the file is gone")),
      undefined,
      showOf(item),
    );
    view.offer(stationOf(item.fields));
    await flush();
    expect(dom.text.textContent).toContain(item.words);
    expect(dom.status.textContent).toContain("could not be loaded");
  });
});

const STANDS = ROWS.filter((row) => row.known === undefined);

describe("the free host's table", () => {
  // Why this test matters: with every row marked known the free half of this
  // file would test nothing and still pass.
  it("runs at least the character and the sample kind", () => {
    expect(STANDS.map((row) => row.name)).toEqual(
      expect.arrayContaining(["character", "the kind stamp-1"]),
    );
  });

  // Why this test matters: a kind's own look must run in the free host, not
  // the carrier that stands in for it; only the kind's look knows this sound.
  it("runs the kind itself, whose tap plays the kind's sound", async () => {
    const stamp = KIND_ROWS.find((row) => row.name === "the kind stamp-1");
    const side = freeSide(stamp as ItemRow);
    side.arrive();
    await flush();
    side.tap();
    await flush();
    expect(side.reads).toContain("stamp-sound");
  });

  // Why this test matters: a kind that imported the app would need the app's
  // build, which is what a folder of the gallery does not have; and a second
  // copy of three (a CDN link, an addon) would not be the renderer's. So a
  // kind imports three by name and nothing else, with no import() at all.
  it.each(KINDS)("$name imports three only", ({ name }) => {
    const path = fileURLToPath(new URL(`${name}/kind.js`, KINDS_DIR));
    const source = readFileSync(path, "utf8");
    expect(source).not.toMatch(/\bimport\(/);
    const from = [
      ...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gm),
    ];
    expect(from.map((m) => m[1])).toEqual(
      from.length === 0 ? [] : from.map(() => "three"),
    );
    // A bare side-effect import names no binding and slips past the above.
    expect(source).not.toMatch(/^\s*import\s+"/m);
  });
});

describe.each(ROWS.filter((row) => row.known !== undefined))(
  "the free host, a known gap: $name",
  (row) => {
    // Why this test matters: the gap is stated, not skipped. The day the free
    // host stands this row the test goes red: take the mark off the row.
    it(`stands nothing: ${row.known ?? ""}`, async () => {
      const side = freeSide(row);
      side.arrive();
      await flush();
      expect(side.stages).toEqual([]);
    });
  },
);

describe.each(STANDS)("the item contract, in the free host: $name", (item) => {
  it("shows its words where it stands", async () => {
    const side = freeSide(item);
    side.arrive();
    await flush();
    expect(side.lines.join(" ")).toContain(item.words);
  });

  it("reads only what it declares, through a tap as well", async () => {
    const side = freeSide(item);
    side.arrive();
    await flush();
    side.tap();
    await flush();
    expect(declaredOf(item)).toEqual(expect.arrayContaining(side.reads));
  });

  it("leaves no sound and no live object URL when it stops", async () => {
    const side = freeSide(item);
    side.arrive();
    await flush();
    side.tap();
    await flush();
    expect(side.sounds.length > 0).toBe(voiced(item));
    side.free.stop();
    expect(side.sounds.every((sound) => sound.paused)).toBe(true);
    expect([...side.live]).toEqual([]);
  });

  it("does nothing when a file lands after it stopped", async () => {
    const landings: (() => void)[] = [];
    const side = freeSide(
      item,
      (path) =>
        new Promise((resolve) => {
          landings.push(() => {
            resolve(new Blob([path]));
          });
        }),
    );
    side.arrive();
    side.free.stop();
    for (const land of landings) land();
    await flush();
    expect(side.lines).toEqual([]);
  });

  it("says so when its files are lost", async () => {
    const side = freeSide(item, () =>
      Promise.reject(new Error("the file is gone")),
    );
    side.arrive();
    await flush();
    expect(side.failures.length).toBeGreaterThan(0);
  });

  // Why this test matters: a free item's words live in its look, so a lost
  // figure takes them along and the visitor is told only that it failed. No
  // sheet exists to hold them; the day one does this row goes red.
  // The gap is pinned as it is, not by `it.fails`, which a crash anywhere
  // in the row would pass as well.
  it("loses its words with its files: known, there is no free sheet yet", async () => {
    const side = freeSide(item, () =>
      Promise.reject(new Error("the file is gone")),
    );
    side.arrive();
    await flush();
    expect(side.failures.length).toBeGreaterThan(0);
    expect([...side.lines, ...side.failures].join(" ")).not.toContain(
      item.words,
    );
  });

  it("reports its voice's end once however often it ends", async () => {
    const side = freeSide(item);
    side.arrive();
    await flush();
    side.tap();
    await flush();
    for (const sound of [...side.sounds, ...side.sounds]) sound.finish();
    await flush();
    const spoken = side.stages
      .flatMap((stage) => stage.setVoice.mock.calls)
      .filter(([voice]) => voice === "spoken");
    expect(spoken).toHaveLength(voiced(item) ? 1 : 0);
  });
});

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

describe("the card's surface", () => {
  // Why this test matters: a kind fills the surface with elements of its
  // own, so the host must hand it over and take it back at the step's end,
  // or the next step shows the last item's leftovers.
  it("is offered to the item and emptied when the step changes", async () => {
    const offered: unknown[] = [];
    const { view, dom } = panel(undefined, undefined, (shown, host) => {
      offered.push(host.surface);
      host.surface?.append("its own");
      showItemCard(shown, host);
    });
    view.offer(stationOf(ITEMS[0]?.fields ?? {}));
    await flush();
    expect(offered[0]).toBe(dom.surface);
    expect(dom.surface.held).toEqual(["its own"]);
    view.continueTapped();
    expect(dom.surface.held).toEqual(["its own"]);
    expect(offered).toHaveLength(2);
    view.stopAll();
    expect(dom.surface.held).toEqual([]);
  });
});

describe("the stage's world doors", () => {
  // Why this test matters: an item draws in the world through the doors
  // it is handed and nothing else; the panel's own stage controls (clear,
  // release, the voice, the bubble) are the host's, and a kind from the
  // item lab is untyped code that could otherwise call them.
  it("hands an item only the figure's and the model's doors", async () => {
    const seen: string[][] = [];
    const { view, stage } = panel(undefined, undefined, (_shown, host) => {
      void host.stage?.stand("probe", async (world, place) => {
        seen.push(Object.keys(world).sort());
        await world.showModel?.(place.stationId, new Blob(["m"]));
      });
    });
    view.offer(stationOf(ITEMS[0]?.fields ?? {}));
    await flush();
    expect(seen).toEqual([["showCharacter", "showModel"]]);
    expect(stage.showModel).toHaveBeenCalledTimes(1);
  });

  // Why this test matters: a stage wired without the model's door would
  // stand nothing for a model and say nothing; it must not compile.
  it("refuses a stage without the model's door at compile time", () => {
    // @ts-expect-error a stage needs both doors
    const noModel: SceneViewDeps["stage"] = {
      showCharacter: () => Promise.resolve(),
      clear: () => undefined,
    };
    expect(noModel).toBeDefined();
  });
});
