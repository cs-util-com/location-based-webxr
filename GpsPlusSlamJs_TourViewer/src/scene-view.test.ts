import { describe, expect, it, vi } from "vitest";
import type {
  TourAsset,
  TourBlock,
  TourStation,
  TourStep,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { createSceneView, type SceneViewDom } from "./scene-view";

/**
 * Why these tests matter: the story panel is what the visitor came for. It
 * must show every step with words (captions always), say when a picture or
 * sound is loading and when it failed, never let a late load paint over the
 * next step, advance on a tap or a timer, branch on a choice, and play ONE
 * story at a time - a second station found meanwhile waits behind a button,
 * and that button stops the first story rather than mixing two voices.
 */

function fakeDom() {
  const choices: { label: string; click: () => void }[][] = [];
  /** The card's player: what it was told, and whether it was stopped. */
  const video = {
    src: "",
    poster: "",
    hidden: true as boolean | "until-found",
    paused: false,
    loads: 0,
    pause() {
      video.paused = true;
    },
    removeAttribute(name: string) {
      if (name === "src" || name === "poster") video[name] = "";
    },
    load() {
      video.loads += 1;
    },
  };
  const dom: SceneViewDom & { video: typeof video } = {
    panel: { hidden: true },
    title: { textContent: "" },
    description: { textContent: "", hidden: true },
    speaker: { textContent: "", hidden: true },
    text: { textContent: "" },
    status: { textContent: "" },
    image: { src: "", alt: "", hidden: true },
    stationImage: { src: "", alt: "", hidden: true },
    video,
    choices: {
      replaceChildren: (...nodes: (Node | string)[]) => {
        choices.push(
          nodes as unknown as { label: string; click: () => void }[],
        );
      },
    },
    continueButton: { hidden: false },
    playNext: { hidden: true, textContent: "" },
  };
  return { dom, lastChoices: () => choices.at(-1) ?? [] };
}

/** A block's own fields: what a step of these tests shows. */
type BlockFields = TourBlock extends infer B
  ? B extends TourBlock
    ? Omit<B, "id" | "pose">
    : never
  : never;

/** Every block a step of these tests shows, by its id: `station` holds
 *  the ones its steps show. */
const shownBlocks = new Map<string, TourBlock>();

/** A tap step showing a new block of `fields`. */
function showing(id: string, fields: BlockFields): TourStep {
  const blockId = `${id}-${String(shownBlocks.size)}`;
  shownBlocks.set(blockId, {
    ...fields,
    id: blockId,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  });
  return {
    id,
    action: { kind: "show", block: blockId },
    advance: { mode: "tap" },
  };
}

/** A tap step showing a text in the scene card. */
const tap = (id: string, text: string): TourStep =>
  showing(id, { kind: "longText", view: "card", title: id, body: text });

function station(id: string, steps: TourStep[], title?: string): TourStation {
  const blocks = steps.flatMap((s) => {
    const block =
      s.action.kind === "show" ? shownBlocks.get(s.action.block) : undefined;
    return block === undefined ? [] : [block];
  });
  return {
    id,
    ...(title === undefined ? {} : { title }),
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    blocks,
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps,
  };
}

const assets = new Map<string, TourAsset>([
  [
    "knight",
    {
      id: "knight",
      path: "content/knight.png",
      kind: "image",
      width: 300,
      height: 600,
    },
  ],
  ["voice", { id: "voice", path: "content/voice.mp3", kind: "audio" }],
  ["arch", { id: "arch", path: "content/arch.glb", kind: "model" }],
  ["clip", { id: "clip", path: "content/clip.webm", kind: "video" }],
  [
    "still",
    {
      id: "still",
      path: "content/still.png",
      kind: "image",
      width: 16,
      height: 9,
    },
  ],
]);

function harness(
  overrides: {
    loadAsset?: (path: string) => Promise<Blob>;
    play?: () => Promise<void>;
    checkPicture?: (blob: Blob) => Promise<string | null>;
    showCharacter?: (
      stationId: string,
      image: Blob,
      onWaiting?: () => void,
    ) => Promise<void>;
    onBlockShown?: (stationId: string, blockId: string) => void;
  } = {},
) {
  const { dom, lastChoices } = fakeDom();
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const ended: string[] = [];
  const changes = { count: 0 };
  const urls = { created: [] as string[], revoked: [] as string[] };
  const audio = {
    play: vi.fn(overrides.play ?? (() => Promise.resolve())),
    stop: vi.fn(),
  };
  const stage = {
    showCharacter: vi.fn(
      overrides.showCharacter ??
        ((_id: string, _image: Blob, _onWaiting?: () => void) =>
          Promise.resolve()),
    ),
    showModel: vi.fn(() => Promise.resolve()),
    clear: vi.fn(),
  };
  const view = createSceneView({
    dom,
    assets,
    loadAsset:
      overrides.loadAsset ?? ((path) => Promise.resolve(new Blob([path]))),
    audio,
    stage,
    checkPicture: overrides.checkPicture ?? (() => Promise.resolve(null)),
    createChoiceButton: (label, click) => ({ label, click }) as unknown as Node,
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    objectUrls: {
      create: () => {
        const url = `blob:${String(urls.created.length)}`;
        urls.created.push(url);
        return url;
      },
      revoke: (url) => {
        urls.revoked.push(url);
      },
    },
    onStoryEnd: (id) => {
      ended.push(id);
    },
    onChange: () => {
      changes.count += 1;
    },
    ...(overrides.onBlockShown === undefined
      ? {}
      : { onBlockShown: overrides.onBlockShown }),
  });
  return { view, dom, timers, ended, urls, audio, stage, lastChoices, changes };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("createSceneView", () => {
  it("shows the steps in order on each tap, then closes and reports the station done", () => {
    const h = harness();
    h.view.offer(
      station(
        "gate",
        [tap("a", "Halt!"), tap("b", "Who goes there?")],
        "The gate",
      ),
    );
    expect(h.dom.panel.hidden).toBe(false);
    expect(h.dom.title.textContent).toBe("The gate");
    expect(h.dom.text.textContent).toBe("Halt!");
    h.view.continueTapped();
    expect(h.dom.text.textContent).toBe("Who goes there?");
    h.view.continueTapped();
    expect(h.dom.panel.hidden).toBe(true);
    expect(h.ended).toEqual(["gate"]);
    expect(h.view.playing()).toBeNull();
  });

  it("a character speaks with its name, its caption and its voice, and stands at the station", async () => {
    const h = harness();
    h.view.offer(
      station("gate", [
        showing("k", {
          kind: "character",
          view: "stage",
          name: "Sir Kay",
          image: "knight",
          caption: "Welcome, traveller.",
          voice: "voice",
        }),
      ]),
    );
    expect(h.dom.speaker).toEqual({ textContent: "Sir Kay", hidden: false });
    expect(h.dom.text.textContent).toBe("Welcome, traveller.");
    expect(h.dom.status.textContent).toMatch(/Loading/);
    await settle();
    // The figure is measured from its own header by the stage's decoder
    // (K4 review R2), never by the size the tour declares.
    expect(h.stage.showCharacter).toHaveBeenCalledWith(
      "gate",
      expect.any(Blob),
      expect.any(Function),
    );
    expect(h.audio.play).toHaveBeenCalledTimes(1);
    expect(h.dom.status.textContent).toBe("");
  });

  // Why (r881 re-review M-B): a station found before the alignment has a
  // heading plays its words and its voice at once, but its figure waits
  // for the heading (it would stand up to 180° off and then jump). The
  // panel said "Loading the figure…" all that time, for a file already
  // loaded: it now says what the figure waits for, and clears once it
  // stands.
  it("says the figure waits for the visitor's position while the stage holds it, and clears once it stands", async () => {
    let stand: () => void = () => undefined;
    const h = harness({
      showCharacter: (_id, _image, onWaiting) =>
        new Promise((resolve) => {
          onWaiting?.();
          stand = resolve;
        }),
    });
    h.view.offer(
      station("gate", [
        showing("k", {
          kind: "character",
          view: "stage",
          name: "Sir Kay",
          image: "knight",
          caption: "Welcome, traveller.",
        }),
      ]),
    );
    await settle();
    expect(h.dom.text.textContent).toBe("Welcome, traveller.");
    expect(h.dom.status.textContent).toBe(
      "Waiting for your position to place the figure…",
    );
    stand();
    await settle();
    expect(h.dom.status.textContent).toBe("");
  });

  /** A character step with a voice; its figure parks until `stand()`. */
  function parkedKnight(
    overrides: Parameters<typeof harness>[0] = {},
  ): ReturnType<typeof harness> & { stand: () => void } {
    let stand: () => void = () => undefined;
    const h = harness({
      ...overrides,
      showCharacter: (_id, _image, onWaiting) =>
        new Promise((resolve) => {
          onWaiting?.();
          stand = resolve;
        }),
    });
    h.view.offer(
      station("gate", [
        showing("k", {
          kind: "character",
          view: "stage",
          name: "Sir Kay",
          image: "knight",
          caption: "Welcome, traveller.",
          voice: "voice",
        }),
      ]),
    );
    return { ...h, stand: () => stand() };
  }

  // Why (r881 re-review M1): the figure and the voice share one status
  // line. The voice's success wrote "" over "Waiting for your position…"
  // while the figure was still parked, so the visitor lost the one line
  // that says why no figure stands there.
  it("a voice that plays while the figure is parked keeps the waiting line", async () => {
    let played: () => void = () => undefined;
    const h = parkedKnight({
      play: () => new Promise<void>((resolve) => (played = resolve)),
    });
    await settle();
    expect(h.dom.status.textContent).toBe(
      "Waiting for your position to place the figure…",
    );
    played();
    await settle();
    expect(h.dom.status.textContent).toBe(
      "Waiting for your position to place the figure…",
    );
    h.stand();
    await settle();
    expect(h.dom.status.textContent).toBe("");
  });

  // Why (r881 re-review M1): the reverse - the waiting line overwrote
  // "The sound did not play here", and the figure's later settle cleared
  // the line, so a refused voice went unexplained. Both are said; the
  // sound's failure outlives the wait, since it stays true for the step.
  it("a refused voice and a parked figure are both said, and the sound's failure outlives the wait", async () => {
    const h = parkedKnight({
      play: () => Promise.reject(new Error("NotAllowedError")),
    });
    await settle();
    expect(h.dom.status.textContent).toBe(
      "Waiting for your position to place the figure… The sound did not play here - the words are below.",
    );
    h.stand();
    await settle();
    expect(h.dom.status.textContent).toBe(
      "The sound did not play here - the words are below.",
    );
  });

  // Why (r881 re-review M1, the same shared line): a voice that played
  // while the figure was still loading blanked "Loading the figure…".
  it("a voice that plays while the figure still loads keeps the loading line", async () => {
    let figureLoaded: (b: Blob) => void = () => undefined;
    const h = harness({
      loadAsset: (path) =>
        path.includes("knight")
          ? new Promise<Blob>((resolve) => (figureLoaded = resolve))
          : Promise.resolve(new Blob([path])),
    });
    h.view.offer(
      station("gate", [
        showing("k", {
          kind: "character",
          view: "stage",
          name: "Sir Kay",
          image: "knight",
          caption: "Welcome, traveller.",
          voice: "voice",
        }),
      ]),
    );
    await settle();
    expect(h.audio.play).toHaveBeenCalledTimes(1);
    expect(h.dom.status.textContent).toBe("Loading the figure…");
    figureLoaded(new Blob(["png"]));
    await settle();
    expect(h.dom.status.textContent).toBe("");
  });

  // Why: a block shown in the scene card stays in the card. A character or
  // a model stands in the world only in its stage view; in the card its
  // words (and a character's voice) are all there is, so a card never
  // makes a figure appear at the station.
  it("stages a figure or a model only in its stage view; in the card it says the words and a character's voice still plays", async () => {
    const h = harness();
    h.view.offer(
      station("gate", [
        showing("k", {
          kind: "character",
          view: "card",
          name: "Sir Kay",
          image: "knight",
          caption: "Welcome, traveller.",
          voice: "voice",
        }),
        showing("m", {
          kind: "model",
          view: "card",
          asset: "arch",
          title: "The arch",
        }),
      ]),
    );
    expect(h.dom.speaker).toEqual({ textContent: "Sir Kay", hidden: false });
    expect(h.dom.text.textContent).toBe("Welcome, traveller.");
    await settle();
    expect(h.audio.play).toHaveBeenCalledTimes(1);
    expect(h.stage.showCharacter).not.toHaveBeenCalled();
    h.view.continueTapped();
    expect(h.dom.speaker.hidden).toBe(true);
    expect(h.dom.text.textContent).toBe("The arch");
    await settle();
    expect(h.stage.showModel).not.toHaveBeenCalled();
  });

  // Why (station blocks plan B2b step 3): the video card plays - its
  // clip in a video element with the browser's controls (a tap plays it,
  // a gesture, so its sound may play), its poster while it waits, its
  // transcript below as before. The clip and the poster are object URLs
  // of the step: the next step stops the clip and frees both, or a long
  // walk would hold every clip it ever played.
  it("plays a video card: its clip and poster in the video element, the transcript below, freed on the next step", async () => {
    const h = harness();
    h.view.offer(
      station("s", [
        showing("v", {
          kind: "video",
          view: "card",
          video: "clip",
          poster: "still",
          transcript: "The gate opens at dawn.",
        }),
        tap("next", "Next"),
      ]),
    );
    expect(h.dom.text.textContent).toBe("The gate opens at dawn.");
    await settle();
    expect(h.dom.video.hidden).toBe(false);
    // The still stood in for the player only until the clip was here.
    expect(h.dom.image.hidden).toBe(true);
    expect(h.urls.created).toHaveLength(2);
    expect([h.dom.video.src, h.dom.video.poster].sort()).toEqual(
      [...h.urls.created].sort(),
    );
    expect(h.dom.status.textContent).toBe("");
    h.view.continueTapped();
    expect(h.dom.video).toMatchObject({
      hidden: true,
      paused: true,
      src: "",
      poster: "",
    });
    expect([...h.urls.revoked].sort()).toEqual([...h.urls.created].sort());
  });

  // Why: a clip that cannot be read must say so and keep the words, like
  // every other medium (UI async-feedback rule) - never a blank player.
  it("says when a video cannot be read, keeps the words, and shows no player", async () => {
    const h = harness({
      loadAsset: () => Promise.reject(new Error("offline")),
    });
    h.view.offer(
      station("s", [
        showing("v", {
          kind: "video",
          view: "card",
          video: "clip",
          transcript: "The gate opens at dawn.",
        }),
      ]),
    );
    expect(h.dom.status.textContent).toBe("Loading the video…");
    await settle();
    expect(h.dom.status.textContent).toBe(
      "The video could not be loaded - the words are below.",
    );
    expect(h.dom.video.hidden).toBe(true);
    expect(h.dom.text.textContent).toBe("The gate opens at dawn.");
  });

  // Why: a poster that loads while its clip cannot be read used to show
  // the player with its play control, which then played nothing. Now the
  // player shows only with its clip; the poster stands as a still picture
  // until then, and stays one beside the line that the clip could not be
  // loaded.
  it("shows the poster as a still and no player when the clip cannot be read", async () => {
    const h = harness({
      loadAsset: (path) =>
        path.endsWith(".webm")
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(new Blob([path])),
    });
    h.view.offer(
      station("s", [
        showing("v", {
          kind: "video",
          view: "card",
          video: "clip",
          poster: "still",
          transcript: "The gate opens at dawn.",
        }),
      ]),
    );
    await settle();
    expect(h.dom.video.hidden).toBe(true);
    expect(h.dom.image).toMatchObject({
      src: h.urls.created[0],
      hidden: false,
    });
    expect(h.dom.status.textContent).toBe(
      "The video could not be loaded - the words are below.",
    );
  });

  // Why (station blocks plan B2b step 4): a long text's paragraphs are
  // the creator's, written as S0 markdown. The card shows its plain text
  // P - paragraphs apart by a blank line, a soft line break as a space,
  // no markup characters - instead of the raw body with its stars.
  it("shows a long text card as its paragraphs, without the markup", () => {
    const h = harness();
    h.view.offer(
      station("s", [
        showing("t", {
          kind: "longText",
          view: "card",
          title: "History",
          body: "Built in **1400**,\nrebuilt later.\n\nThe second part.",
        }),
      ]),
    );
    expect(h.dom.text.textContent).toBe(
      "Built in 1400, rebuilt later.\n\nThe second part.",
    );
  });

  it("says when a sound is refused or a file cannot be read, and keeps the words", async () => {
    const refused = harness({
      play: () => Promise.reject(new Error("NotAllowedError")),
    });
    refused.view.offer(
      station("s", [
        showing("a", {
          kind: "audio",
          view: "card",
          audio: "voice",
          transcript: "Listen.",
        }),
      ]),
    );
    await settle();
    expect(refused.dom.text.textContent).toBe("Listen.");
    expect(refused.dom.status.textContent).toMatch(/did not play/);

    const broken = harness({
      loadAsset: () => Promise.reject(new Error("hash mismatch")),
    });
    broken.view.offer(
      station("s", [
        showing("m", {
          kind: "model",
          view: "stage",
          asset: "arch",
          title: "The arch",
        }),
      ]),
    );
    await settle();
    expect(broken.dom.status.textContent).toMatch(/could not be loaded/);
    expect(broken.stage.showModel).not.toHaveBeenCalled();
  });

  it("drops a picture that arrives after the visitor moved on, and revokes every URL it made", async () => {
    let release: (b: Blob) => void = () => undefined;
    const h = harness({ loadAsset: () => new Promise((r) => (release = r)) });
    h.view.offer(
      station("s", [
        showing("i", {
          kind: "picture",
          view: "card",
          image: "knight",
          caption: "The knight",
          widthM: 1,
        }),
        tap("t", "Next"),
      ]),
    );
    h.view.continueTapped();
    release(new Blob(["late"]));
    await settle();
    expect(h.dom.image.hidden).toBe(true);
    expect(h.urls.created).toEqual([]);
    expect(h.dom.status.textContent).toBe("");

    const shown = harness();
    shown.view.offer(
      station("s", [
        showing("i", {
          kind: "picture",
          view: "card",
          image: "knight",
          widthM: 1,
        }),
        tap("t", "Next"),
      ]),
    );
    await settle();
    expect(shown.dom.image).toMatchObject({ hidden: false, src: "blob:0" });
    shown.view.continueTapped();
    expect(shown.urls.revoked).toEqual(["blob:0"]);
  });

  it("never shows a picture over the pixel cap: says so, and keeps the words (R2)", async () => {
    // Why this test matters (K4 review R2): a story picture went straight
    // into an <img>, which the browser decodes at whatever size the file
    // states.
    const h = harness({
      checkPicture: () => Promise.resolve("it is 20000 x 20000 pixels"),
    });
    h.view.offer(
      station("s", [
        showing("i", {
          kind: "picture",
          view: "card",
          image: "knight",
          caption: "The knight",
          widthM: 1,
        }),
      ]),
    );
    await settle();
    expect(h.urls.created).toEqual([]);
    expect(h.dom.image.hidden).toBe(true);
    expect(h.dom.text.textContent).toBe("The knight");
    expect(h.dom.status.textContent).toBe(
      "The picture is too large to show here - the words are below.",
    );
  });

  it("an auto step advances on its timer; a tap first cancels the timer", () => {
    const h = harness();
    h.view.offer(
      station("s", [
        { ...tap("a", "One"), advance: { mode: "auto", afterS: 4 } },
        tap("b", "Two"),
        tap("c", "Three"),
      ]),
    );
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(4000);
    h.timers[0]!.fn();
    expect(h.dom.text.textContent).toBe("Two");

    const early = harness();
    early.view.offer(
      station("s", [
        { ...tap("a", "One"), advance: { mode: "auto", afterS: 4 } },
        tap("b", "Two"),
      ]),
    );
    early.view.continueTapped();
    expect(early.timers[0]!.cancelled).toBe(true);
  });

  it("a choice hides continue, offers its options, and jumps to the chosen step", () => {
    const h = harness();
    h.view.offer(
      station("s", [
        {
          id: "c",
          action: {
            kind: "choice",
            prompt: "Enter?",
            options: [
              { id: "y", label: "Yes", goto: "in" },
              { id: "n", label: "No", goto: "out" },
            ],
          },
          advance: { mode: "tap" },
        },
        tap("in", "Inside"),
        tap("out", "Outside"),
      ]),
    );
    expect(h.dom.continueButton.hidden).toBe(true);
    expect(h.lastChoices().map((c) => c.label)).toEqual(["Yes", "No"]);
    h.lastChoices()[1]!.click();
    expect(h.dom.text.textContent).toBe("Outside");
    expect(h.dom.continueButton.hidden).toBe(false);
  });

  it("one story at a time: a second station waits behind its button, and the button stops the first", () => {
    const h = harness();
    h.view.offer(
      station("a", [tap("a1", "A one"), tap("a2", "A two")], "Gate"),
    );
    h.view.offer(station("b", [tap("b1", "B one")], "Well"));
    expect(h.dom.text.textContent).toBe("A one");
    expect(h.dom.playNext).toEqual({
      hidden: false,
      textContent: "Play: Well",
    });
    h.view.playNextNow();
    expect(h.audio.stop).toHaveBeenCalled();
    expect(h.view.playing()).toBe("b");
    // The interrupted story waits its turn again; nothing was finished.
    expect(h.dom.playNext.textContent).toBe("Play: Gate");
    expect(h.ended).toEqual([]);
    h.view.continueTapped();
    expect(h.ended).toEqual(["b"]);
    // The queued story starts on its own, from its first step.
    expect(h.view.playing()).toBe("a");
    expect(h.dom.text.textContent).toBe("A one");
    expect(h.dom.playNext.hidden).toBe(true);
  });

  it("ends a story on request: the playing one stops and the next starts; a queued one leaves the queue; either reports its end (R9)", () => {
    // Why this test matters (K4 review R9): a story whose choices all loop
    // back never ends; the guide's "End this story" must end it here, and
    // the station is done only through the story's reported end.
    const h = harness();
    h.view.offer(station("a", [tap("a1", "A one"), tap("a2", "A two")]));
    h.view.offer(station("b", [tap("b1", "B one")]));
    h.view.offer(station("c", [tap("c1", "C one")]));
    h.view.end("b");
    expect(h.ended).toEqual(["b"]);
    expect(h.view.playing()).toBe("a");
    h.view.end("a");
    expect(h.ended).toEqual(["b", "a"]);
    expect(h.view.playing()).toBe("c");
    expect(h.dom.text.textContent).toBe("C one");
    // A station the panel does not hold (its story was lost with a
    // session) still reports its end, so it cannot stay found for good.
    h.view.end("z");
    expect(h.ended).toEqual(["b", "a", "z"]);
  });

  it("offers each station once, and stopAll empties the panel and the queue", () => {
    const h = harness();
    const a = station("a", [tap("a1", "A")]);
    h.view.offer(a);
    h.view.offer(a);
    h.view.offer(station("b", [tap("b1", "B")]));
    h.view.offer(station("b", [tap("b1", "B")]));
    expect(h.dom.playNext.textContent).toBe("Play: the next station");
    h.view.stopAll();
    expect(h.dom.panel.hidden).toBe(true);
    expect(h.dom.playNext.hidden).toBe(true);
    expect(h.view.playing()).toBeNull();
    expect(h.stage.clear).toHaveBeenCalled();
    h.view.continueTapped();
    expect(h.ended).toEqual([]);
  });
});

describe("the station's name and description (B2b step 6)", () => {
  // Why: at the station the visitor reads where they are - its name over
  // the story card, and the creator's description of the place below it
  // (the format's `station.description`). A station without one shows no
  // empty line, and the next station's card never keeps the last one's.
  it("shows the station's name and description over its story, none for a station without one, and hides it at the end", () => {
    const h = harness();
    h.view.offer({
      ...station("gate", [tap("a", "Hello")], "The gate"),
      description: "The castle's main gate,\nbuilt in 1400.",
    });
    h.view.offer(station("well", [tap("b", "Water")], "The well"));
    expect(h.dom.title.textContent).toBe("The gate");
    expect(h.dom.description).toEqual({
      textContent: "The castle's main gate,\nbuilt in 1400.",
      hidden: false,
    });
    h.view.continueTapped(); // the gate's end; the well's story starts
    expect(h.dom.title.textContent).toBe("The well");
    expect(h.dom.description).toEqual({ textContent: "", hidden: true });
    h.view.continueTapped();
    expect(h.dom.panel.hidden).toBe(true);
    expect(h.dom.description.hidden).toBe(true);
  });

  // Why: a station made on the phone has no story steps - only its name,
  // its description and its card picture. Its card used to close in the
  // same tick it opened (an empty story ends at once), so the visitor
  // never read the description nor saw the picture of any such station.
  // The card now stays until the visitor taps Continue, and only then is
  // the station done.
  it("holds the card of a station with no story - its name, description and picture - until Continue", async () => {
    const h = harness();
    h.view.offer({
      ...station("bench", [], "The bench"),
      description: "Sit and look at the lake.",
      image: "still",
    });
    expect(h.dom.panel.hidden).toBe(false);
    expect(h.dom.title.textContent).toBe("The bench");
    expect(h.dom.description).toEqual({
      textContent: "Sit and look at the lake.",
      hidden: false,
    });
    expect(h.dom.continueButton.hidden).toBe(false);
    expect(h.view.playing()).toBe("bench");
    expect(h.ended).toEqual([]);
    await settle();
    expect(h.dom.stationImage).toEqual({
      src: "blob:0",
      alt: "The bench",
      hidden: false,
    });
    h.view.continueTapped();
    expect(h.dom.panel.hidden).toBe(true);
    expect(h.ended).toEqual(["bench"]);
    expect(h.dom.stationImage.hidden).toBe(true);
    expect(h.urls.revoked).toEqual(["blob:0"]);
  });

  // Why: the card picture belongs to the station, not to a step: it stays
  // over the whole story while its steps change, and is freed at its end.
  it("keeps the station's card picture over every step of its story", async () => {
    const h = harness();
    h.view.offer({
      ...station("gate", [tap("a", "Hello"), tap("b", "Bye")], "The gate"),
      image: "still",
    });
    await settle();
    expect(h.dom.stationImage.hidden).toBe(false);
    const url = h.dom.stationImage.src;
    h.view.continueTapped();
    await settle();
    expect(h.dom.text.textContent).toBe("Bye");
    expect(h.dom.stationImage).toMatchObject({ src: url, hidden: false });
    expect(h.urls.revoked).not.toContain(url);
    h.view.continueTapped();
    expect(h.dom.stationImage.hidden).toBe(true);
    expect(h.urls.revoked).toContain(url);
  });

  // Why: a station with no story whose card picture cannot be shown left
  // a card with only its name and Continue, and no word of why. The status
  // line says it, over every step of a story too, and goes with the card.
  it("says why the station's card picture is missing, until its card ends", async () => {
    const unreadable = harness({
      loadAsset: () => Promise.reject(new Error("gone")),
    });
    unreadable.view.offer({
      ...station("bench", [], "The bench"),
      image: "still",
    });
    await settle();
    expect(unreadable.dom.stationImage.hidden).toBe(true);
    expect(unreadable.dom.status.textContent).toBe(
      "The station's picture could not be loaded.",
    );
    unreadable.view.continueTapped();
    expect(unreadable.dom.status.textContent).toBe("");

    const large = harness({
      checkPicture: () => Promise.resolve("too large"),
    });
    large.view.offer({
      ...station("gate", [tap("a", "Hello"), tap("b", "Bye")]),
      image: "still",
    });
    await settle();
    expect(large.dom.status.textContent).toBe(
      "The station's picture is too large to show here.",
    );
    large.view.continueTapped();
    await settle();
    expect(large.dom.text.textContent).toBe("Bye");
    expect(large.dom.status.textContent).toBe(
      "The station's picture is too large to show here.",
    );
    large.view.continueTapped();
    expect(large.dom.status.textContent).toBe("");
  });

  // Why: a card picture that lands after its story ended (a slow read)
  // must not paint over the next station's card.
  it("drops a card picture that lands after its story ended", async () => {
    let release: (blob: Blob) => void = () => undefined;
    const h = harness({
      loadAsset: () =>
        new Promise<Blob>((resolve) => {
          release = resolve;
        }),
    });
    h.view.offer({ ...station("gate", [tap("a", "Hi")]), image: "still" });
    h.view.continueTapped();
    release(new Blob(["late"]));
    await settle();
    expect(h.dom.stationImage.hidden).toBe(true);
    expect(h.urls.created).toEqual([]);
  });

  // Why: a station with nothing to read - no story, no description, no
  // picture - has no card to hold: it is done when found, as before.
  it("ends a station with no story and nothing to show at once", () => {
    const h = harness();
    h.view.offer(station("empty", [], "Empty"));
    expect(h.dom.panel.hidden).toBe(true);
    expect(h.ended).toEqual(["empty"]);
  });
});

describe("a story's world blocks (B2b)", () => {
  // Why (station blocks plan B2b step 2, B-Q4): a story block with a
  // world view (a pin, a plane, a placed model) stands in the world from
  // the moment its step is reached, for the rest of the visit. The view
  // is where a step is reached, so it says which world block it reached -
  // after a tap, after a choice - and never a card or a stage block,
  // whose lifetimes are the panel's and the stage's.
  it("says each world block a step reaches, after a tap and after a choice, and no card or stage block", () => {
    const reached: string[] = [];
    const h = harness({
      onBlockShown: (stationId, blockId) => {
        reached.push(`${stationId}:${blockId}`);
      },
    });
    const sign = showing("sign", {
      kind: "shortText",
      view: "pin",
      caption: "The old sign",
    });
    const card = tap("words", "Some words");
    const figure = showing("figure", {
      kind: "character",
      view: "stage",
      name: "K",
      image: "knight",
      caption: "Halt",
    });
    const plane = showing("plane", {
      kind: "picture",
      view: "plane",
      image: "knight",
      widthM: 1,
    });
    const arch = showing("arch", {
      kind: "model",
      view: "placed",
      asset: "arch",
      sizeM: 2,
    });
    const blockOf = (step: TourStep) =>
      step.action.kind === "show" ? step.action.block : "";
    h.view.offer(
      station("s", [
        sign,
        card,
        figure,
        {
          id: "c",
          action: {
            kind: "choice",
            prompt: "Which?",
            options: [
              { id: "p", label: "Picture", goto: "plane" },
              { id: "m", label: "Model", goto: "arch" },
            ],
          },
          advance: { mode: "tap" },
        },
        plane,
        arch,
      ]),
    );
    expect(reached).toEqual([`s:${blockOf(sign)}`]);
    h.view.continueTapped(); // the card
    h.view.continueTapped(); // the stage figure
    expect(reached).toEqual([`s:${blockOf(sign)}`]);
    h.view.continueTapped(); // the choice
    h.lastChoices()[1]!.click(); // the model
    expect(reached).toEqual([`s:${blockOf(sign)}`, `s:${blockOf(arch)}`]);
    h.view.continueTapped(); // the end
    expect(h.ended).toEqual(["s"]);
    expect(reached).toHaveLength(2);
  });
});

describe("the story card's dots and its redraw", () => {
  // Why these tests matter: the story card in the sheet draws a dot per
  // step and fills the current one over an auto step's timer, so the view
  // says where the story is; and the sheet redraws when a story starts,
  // moves on or ends, which only the view knows.
  it("says the step, the count and the auto step's time, and nothing without a story", () => {
    const h = harness();
    expect(h.view.progress()).toBeNull();
    h.view.offer(
      station("s", [
        { ...tap("a", "One"), advance: { mode: "auto", afterS: 4 } },
        tap("b", "Two"),
        tap("c", "Three"),
      ]),
    );
    expect(h.view.progress()).toEqual({ index: 0, count: 3, autoMs: 4000 });
    h.view.continueTapped();
    expect(h.view.progress()).toEqual({ index: 1, count: 3, autoMs: null });
    h.view.continueTapped();
    h.view.continueTapped();
    expect(h.view.progress()).toBeNull();
  });

  // Why this test matters: while the visitor is
  // asked whether to end the story, the step must not move on under the
  // question; "Keep listening" starts the step's timer again from its
  // full length, and the dots show it (no timed fill while held).
  it("a held step stops its timer; released, it runs again from the start", () => {
    const h = harness();
    h.view.offer(
      station("s", [
        { ...tap("a", "One"), advance: { mode: "auto", afterS: 4 } },
        tap("b", "Two"),
      ]),
    );
    const first = h.timers.at(-1)!;
    h.view.holdStep(true);
    expect(first.cancelled).toBe(true);
    expect(h.view.progress()).toEqual({ index: 0, count: 2, autoMs: null });
    h.view.holdStep(true);
    expect(h.timers.filter((t) => !t.cancelled)).toEqual([]);
    h.view.holdStep(false);
    const again = h.timers.at(-1)!;
    expect(again).not.toBe(first);
    expect(again).toMatchObject({ ms: 4000, cancelled: false });
    expect(h.view.progress()).toEqual({ index: 0, count: 2, autoMs: 4000 });
    again.fn();
    expect(h.dom.text.textContent).toBe("Two");
    // A tap step has no timer to hold or start.
    const scheduled = h.timers.length;
    h.view.holdStep(true);
    h.view.holdStep(false);
    expect(h.timers.length).toBe(scheduled);
  });

  it("a hold set with no story is dropped when the next story starts", () => {
    const h = harness();
    h.view.holdStep(true);
    h.view.offer(
      station("s", [
        { ...tap("a", "One"), advance: { mode: "auto", afterS: 2 } },
      ]),
    );
    expect(h.timers.at(-1)).toMatchObject({ ms: 2000, cancelled: false });
  });

  it("has no dots for a scene with a choice", () => {
    const h = harness();
    h.view.offer(
      station("s", [
        tap("a", "One"),
        {
          id: "c",
          action: {
            kind: "choice",
            prompt: "Which?",
            options: [{ id: "x", label: "X", goto: "a" }],
          },
          advance: { mode: "tap" },
        },
      ]),
    );
    expect(h.view.progress()).toBeNull();
  });

  it("asks for a redraw when a story starts, moves on, ends, and when everything stops", () => {
    const h = harness();
    h.view.offer(station("s", [tap("a", "One"), tap("b", "Two")]));
    const started = h.changes.count;
    expect(started).toBeGreaterThan(0);
    h.view.continueTapped();
    expect(h.changes.count).toBeGreaterThan(started);
    const moved = h.changes.count;
    h.view.continueTapped();
    expect(h.changes.count).toBeGreaterThan(moved);
    const ended = h.changes.count;
    h.view.stopAll();
    expect(h.changes.count).toBeGreaterThan(ended);
  });
});
