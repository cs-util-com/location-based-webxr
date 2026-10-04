import { describe, expect, it, vi } from "vitest";
import type {
  TourAsset,
  TourStation,
  TourStep,
} from "gps-plus-slam-app-framework/ar/tour-stations";

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

const tap = (id: string, text: string): TourStep => ({
  id,
  block: { kind: "text", text },
  advance: { mode: "tap" },
});

function station(id: string, steps: TourStep[], title?: string): TourStation {
  return {
    id,
    ...(title === undefined ? {} : { title }),
    anchor: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 } },
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
  } = {},
) {
  const { dom, lastChoices } = fakeDom();
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const ended: string[] = [];
  const urls = { created: [] as string[], revoked: [] as string[] };
  const audio = {
    play: vi.fn(overrides.play ?? (() => Promise.resolve())),
    stop: vi.fn(),
  };
  const stage = {
    showCharacter: vi.fn(() => Promise.resolve()),
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
  });
  return { view, dom, timers, ended, urls, audio, stage, lastChoices };
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
        {
          id: "k",
          block: {
            kind: "character",
            name: "Sir Kay",
            image: "knight",
            caption: "Welcome, traveller.",
            voice: "voice",
          },
          advance: { mode: "tap" },
        },
      ]),
    );
    expect(h.dom.speaker).toEqual({ textContent: "Sir Kay", hidden: false });
    expect(h.dom.text.textContent).toBe("Welcome, traveller.");
    expect(h.dom.status.textContent).toMatch(/Loading/);
    await settle();
    expect(h.stage.showCharacter).toHaveBeenCalledWith(
      "gate",
      expect.any(Blob),
      { width: 300, height: 600 },
    );
    expect(h.audio.play).toHaveBeenCalledTimes(1);
    expect(h.dom.status.textContent).toBe("");
  });

  it("says when a sound is refused or a file cannot be read, and keeps the words", async () => {
    const refused = harness({
      play: () => Promise.reject(new Error("NotAllowedError")),
    });
    refused.view.offer(
      station("s", [
        {
          id: "a",
          block: { kind: "audio", asset: "voice", transcript: "Listen." },
          advance: { mode: "tap" },
        },
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
        {
          id: "m",
          block: { kind: "model", asset: "arch", caption: "The arch" },
          advance: { mode: "tap" },
        },
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
        {
          id: "i",
          block: { kind: "image", asset: "knight", caption: "The knight" },
          advance: { mode: "tap" },
        },
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
        {
          id: "i",
          block: { kind: "image", asset: "knight" },
          advance: { mode: "tap" },
        },
        tap("t", "Next"),
      ]),
    );
    await settle();
    expect(shown.dom.image).toMatchObject({ hidden: false, src: "blob:0" });
    shown.view.continueTapped();
    expect(shown.urls.revoked).toEqual(["blob:0"]);
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
          block: {
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
