/**
 * A story's preview in the editor: the story played by the visitor's own
 * story panel (`scene-view.ts`, its player `scene-player.ts`) in a dialog
 * over the editor, from its first step, as a visitor who found its station
 * would meet it: its words, pictures, videos and sounds, its choices and
 * jumps, its timers and its end. Only that story is offered (its station
 * stands in holding nothing else), so no picker comes between.
 *
 * What stands in the visitor's world (a character's figure, a pin) has no
 * world here: a line under the panel names it instead. The player goes past
 * a quiz, as the visitor's does today; the dialog says so when the story
 * holds one.
 *
 * @see story-preview.ts.md
 */
import type {
  TourAsset,
  TourCharacter,
  TourManifest,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  tourStories,
  type TourStory,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { createSceneAudio } from "../scene-audio.js";
import {
  createSceneView,
  type SceneAudio,
  type SceneView,
  type SceneViewDom,
} from "../scene-view.js";
import { pictureProblem } from "../image-cap.js";

export interface StoryPreviewDeps {
  /** The page the dialog goes into (its body). */
  readonly doc: Document;
  /** The open tour as it is now, unsaved edits included; null: none. */
  readonly tour: () => TourManifest | null;
  /** A content entry of the open tour (`content/<id>.<ext>`). */
  loadAsset(path: string): Promise<Blob>;
  /** The sound channel; default: one `<audio>` element. */
  readonly audio?: SceneAudio & { unlock?(): void };
  /** A one-shot clock; default: `setTimeout`. */
  schedule?(fn: () => void, ms: number): () => void;
}

export interface StoryPreview {
  /** Play the story `storyId` from its first step, the focus in the
   *  dialog, `opener` getting it back on close. Returns why it cannot
   *  (no tour, no such story, no steps), else null. */
  open(storyId: string, opener?: HTMLElement): string | null;
  close(): void;
  isOpen(): boolean;
}

/** Why a preview did not open. */
export const PREVIEW_NO_STORY = "That story is no longer in this tour.";
export const PREVIEW_NO_STEPS =
  "This story has no steps yet: add one to preview it.";

/** What the dialog says under a story with a quiz. */
export const PREVIEW_QUIZ_NOTE =
  "Quizzes are not played yet: the visitor's player goes past them.";

function make<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

/** The story `storyId` and the station holding it, or null. */
function storyAt(
  tour: TourManifest | null,
  storyId: string,
): { readonly station: TourStation; readonly story: TourStory } | null {
  for (const station of tour?.stations ?? []) {
    const story = tourStories(station).find((s) => s.id === storyId);
    if (story !== undefined) return { station, story };
  }
  return null;
}

export function createStoryPreview(deps: StoryPreviewDeps): StoryPreview {
  const { doc } = deps;
  const root = make(doc, "div", "spv");
  root.id = "story-preview";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "spv-title");
  root.dataset["testid"] = "story-preview";
  root.hidden = true;

  const bar = make(doc, "div", "spvbar");
  const where = make(doc, "div", "where");
  const heading = make(doc, "b", "");
  heading.id = "spv-title";
  const sub = make(doc, "span", "", "As a visitor meets it at its station");
  where.append(heading, sub);
  const again = make(doc, "button", "act", "Play again");
  again.type = "button";
  again.dataset["spv"] = "again";
  const close = make(doc, "button", "act", "Close");
  close.type = "button";
  close.dataset["spv"] = "close";
  bar.append(where, again, close);

  const panel = make(doc, "section", "spvpanel");
  panel.setAttribute("aria-live", "polite");
  const title = make(doc, "h3", "stitle");
  const description = make(doc, "p", "desc");
  const stationImage = make(doc, "img", "simg");
  const portrait = make(doc, "img", "portrait");
  const speaker = make(doc, "p", "speaker");
  const image = make(doc, "img", "image");
  const video = make(doc, "video", "video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  const surface = make(doc, "div", "surface");
  const text = make(doc, "p", "text");
  const status = make(doc, "p", "status");
  const choices = make(doc, "div", "choices");
  for (const hide of [description, stationImage, portrait, speaker, image]) {
    hide.hidden = true;
  }
  video.hidden = true;
  stationImage.alt = "";
  portrait.alt = "";
  image.alt = "";
  panel.append(
    title,
    description,
    stationImage,
    portrait,
    speaker,
    image,
    video,
    surface,
    text,
    status,
    choices,
  );
  const acts = make(doc, "div", "spvacts");
  const goOn = make(doc, "button", "act primary", "Continue");
  goOn.type = "button";
  goOn.dataset["spv"] = "continue";
  goOn.hidden = true;
  const playNext = make(doc, "button", "act");
  playNext.type = "button";
  playNext.hidden = true;
  acts.append(goOn, playNext);
  const world = make(doc, "p", "spvworld");
  world.hidden = true;
  const note = make(doc, "p", "spvnote", PREVIEW_QUIZ_NOTE);
  note.hidden = true;
  const ended = make(doc, "p", "spvend", "The story has ended.");
  ended.hidden = true;
  root.append(bar, panel, acts, world, ended, note);
  doc.body.append(root);

  const dom: SceneViewDom = {
    panel,
    title,
    description,
    speaker,
    portrait,
    text,
    status,
    image,
    stationImage,
    video,
    choices,
    continueButton: goOn,
    playNext,
    surface,
  };
  const objectUrls = {
    create: (blob: Blob) => URL.createObjectURL(blob),
    revoke: (url: string) => {
      URL.revokeObjectURL(url);
    },
  };
  const audio =
    deps.audio ??
    createSceneAudio({
      createElement: () => new Audio(),
      objectUrls,
    });
  /** What stands in the visitor's world, said in words. */
  const sayWorld = (line: string): void => {
    world.textContent = line;
    world.hidden = line === "";
  };
  let shown: {
    readonly storyId: string;
    readonly station: TourStation;
  } | null = null;
  let opener: HTMLElement | null = null;
  const view: SceneView = createSceneView({
    dom,
    get assets(): ReadonlyMap<string, TourAsset> {
      return new Map((deps.tour()?.assets ?? []).map((a) => [a.id, a]));
    },
    get characters(): ReadonlyMap<string, TourCharacter> {
      return new Map((deps.tour()?.characters ?? []).map((c) => [c.id, c]));
    },
    loadAsset: (path) => deps.loadAsset(path),
    audio,
    stage: {
      showCharacter: (_station, _image, _waiting, look) => {
        sayWorld(`In the visitor's world: ${look.name} stands at the station.`);
        return Promise.resolve();
      },
      release: () => {
        sayWorld("");
      },
      clear: () => {
        sayWorld("");
      },
    },
    checkPicture: (blob) => pictureProblem(blob),
    createChoiceButton: (label, onClick) => {
      const button = make(doc, "button", "act", label);
      button.type = "button";
      button.addEventListener("click", onClick);
      return button;
    },
    focusChoice: (button) => {
      (button as HTMLElement).focus();
    },
    schedule:
      deps.schedule ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => {
          clearTimeout(timer);
        };
      }),
    objectUrls,
    onStoryEnd: () => {
      ended.hidden = false;
      panel.hidden = true;
      again.focus();
    },
  });

  /** The story's station holding only it: the visitor's panel offers no
   *  picker, and plays it from its first step. */
  function play(storyId: string): string | null {
    const found = storyAt(deps.tour(), storyId);
    if (found === null) return PREVIEW_NO_STORY;
    if (found.story.children.length === 0) return PREVIEW_NO_STEPS;
    view.stopAll();
    sayWorld("");
    ended.hidden = true;
    note.hidden = !found.story.children.some((c) => c.kind === "quiz");
    heading.textContent = `Preview: ${found.story.title}`;
    shown = {
      storyId,
      station: { ...found.station, children: [found.story] },
    };
    view.offer(shown.station);
    return null;
  }

  function closePreview(): void {
    if (root.hidden) return;
    view.stopAll();
    root.hidden = true;
    shown = null;
    const back = opener;
    opener = null;
    if (back?.isConnected === true) back.focus();
  }

  root.addEventListener("click", (event) => {
    const act = (event.target as Element).closest<HTMLElement>("[data-spv]")
      ?.dataset["spv"];
    if (act === "close") closePreview();
    if (act === "continue") view.continueTapped();
    if (act === "again" && shown !== null) play(shown.storyId);
  });
  playNext.addEventListener("click", () => {
    view.playNextNow();
  });
  // Escape closes the preview and goes no further: the page's own Escape
  // would drop the editor's selection.
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closePreview();
  });

  return {
    open(storyId, from) {
      // Inside the press that opened it: the sound may play later.
      audio.unlock?.();
      const refused = play(storyId);
      if (refused !== null) return refused;
      opener = from ?? null;
      root.hidden = false;
      close.focus();
      return null;
    },
    close: closePreview,
    isOpen: () => !root.hidden,
  };
}
