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
  const dom: SceneViewDom = {
    panel: { hidden: true },
    title: { textContent: "" },
    speaker: { textContent: "", hidden: true },
    text: { textContent: "" },
    status: { textContent: "" },
    image: { src: "", alt: "", hidden: true },
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

  // Why: this version plays no clip; a video's transcript is what the
  // visitor gets, so a video block never leaves the card empty.
  it("shows a video's transcript in its place", () => {
    const h = harness();
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
    expect(h.dom.text.textContent).toBe("The gate opens at dawn.");
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
