/**
 * The visitor's story panel (tour kit plan K4, §4.2): plays a found
 * station's scene (`scene-player.ts`) in the DOM overlay, with its media,
 * captions always, the tap to continue and the timed advance, scene choices,
 * and ONE story at a time: a station found while another story plays waits
 * behind a "Play" button, and tapping that button stops the story playing
 * (the community PR idea of "a new tap stops the previous one", K-D4: the
 * idea, not the implementation).
 *
 * Owns no AR: what a step shows at the station (a cut-out character, a 3D
 * model) goes to the caller's `stage`; the sound goes to the caller's
 * `audio`. Media are read through `loadAsset` (the tour session's
 * `loadContentEntry`, which applies K0's caps and K1's per-entry hash
 * check) and shown as object URLs that are revoked when the step changes.
 */

import type {
  TourAsset,
  TourBlock,
  TourStation,
  TourStep,
  TourStepAction,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  createScenePlayer,
  isPlayableInK4,
  playableStepCount,
  type ScenePlayer,
} from "./scene-player.js";
import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import { worldBlockReachedBy } from "./shown-blocks.js";
import { stationTitle } from "./station-run.js";

/** The story panel's elements, all inside `#ar-root` (the DOM overlay). */
export interface SceneViewDom {
  readonly panel: Pick<HTMLElement, "hidden">;
  readonly title: Pick<HTMLElement, "textContent">;
  /** The station's description under its name (B2b step 6); hidden for a
   *  station without one. */
  readonly description: Pick<HTMLElement, "textContent" | "hidden">;
  /** A character's name; hidden for other steps. */
  readonly speaker: Pick<HTMLElement, "textContent" | "hidden">;
  /** Text, caption or transcript: every step has words (captions always). */
  readonly text: Pick<HTMLElement, "textContent">;
  /** Loading and failures of this step's media, `aria-live`. */
  readonly status: Pick<HTMLElement, "textContent">;
  readonly image: Pick<HTMLImageElement, "src" | "alt" | "hidden">;
  /** The station's card picture under its name, over its whole story;
   *  hidden for a station without one. */
  readonly stationImage: Pick<HTMLImageElement, "src" | "alt" | "hidden">;
  /** The video card's player (B2b): a `<video controls playsinline>`
   *  above the transcript. */
  readonly video: SceneVideo;
  readonly choices: Pick<HTMLElement, "replaceChildren">;
  readonly continueButton: Pick<HTMLElement, "hidden">;
  readonly playNext: Pick<HTMLElement, "textContent" | "hidden">;
}

/** What the story card uses of its `<video>` element. */
type SceneVideo = Pick<
  HTMLVideoElement,
  "src" | "poster" | "hidden" | "pause" | "removeAttribute" | "load"
>;

/** The sound of a step (one channel: a new clip stops the previous). */
export interface SceneAudio {
  /** Rejects when the browser refuses to play (the captions still show). */
  play(blob: Blob, onEnded: () => void): Promise<void>;
  stop(): void;
}

/** What a step shows in AR at its station. `onWaiting`: the decoded
 *  figure waits for the station's pose (`scene-stage.ts`). */
interface SceneStage {
  showCharacter(
    stationId: string,
    image: Blob,
    onWaiting?: () => void,
  ): Promise<void>;
  showModel(
    stationId: string,
    model: Blob,
    onWaiting?: () => void,
  ): Promise<void>;
  clear(): void;
}

export interface SceneViewDeps {
  readonly dom: SceneViewDom;
  /** The tour's media by asset id (`content/<id>.<ext>`). */
  readonly assets: ReadonlyMap<string, TourAsset>;
  loadAsset(path: string): Promise<Blob>;
  readonly audio: SceneAudio;
  readonly stage: SceneStage;
  /** Why a picture may not be shown (its header states more pixels than
   *  the tour cap, or cannot be read; K4 review R2), or null. Measured
   *  before the browser decodes it in the <img>. */
  checkPicture(blob: Blob): Promise<string | null>;
  /** A choice button; the view wires nothing else into it. */
  createChoiceButton(label: string, onClick: () => void): Node;
  /** A one-shot clock (an auto step): returns the cancel. */
  schedule(fn: () => void, ms: number): () => void;
  readonly objectUrls: {
    create(blob: Blob): string;
    revoke(url: string): void;
  };
  /** A story played to its end: the station is done. */
  onStoryEnd(stationId: string): void;
  /** The story started, moved to another step, ended or stopped, or the
   *  queue changed: what the sheet draws of it (`progress`) may differ. */
  onChange?(): void;
  /** A step reached a block with a world view (a pin, a plane, a placed
   *  model): it stands in the station's world from now on (station
   *  blocks plan B2b, `shown-blocks.ts`). Its words show in the card as
   *  before. */
  onBlockShown?(stationId: string, blockId: string): void;
}

/** Where a choice-free story is (the story card's dots). */
export interface StoryProgress {
  /** The step showing, from 0. */
  readonly index: number;
  /** The scene's steps (`playableStepCount`). */
  readonly count: number;
  /** The step's own timer (an auto step), ms; null for a tap step. */
  readonly autoMs: number | null;
}

export interface SceneView {
  /** A station was found: play it, or queue it behind the story playing. */
  offer(station: TourStation): void;
  /** The "Play" button's tap: stop the story playing, play the next. */
  playNextNow(): void;
  /** The continue tap. */
  continueTapped(): void;
  /** End this station's story now (the guide's "End this story", K4
   *  review R9): the playing one stops and the next queued one starts, a
   *  queued one leaves the queue; its end is reported either way, also for
   *  a station the panel does not hold. */
  end(stationId: string): void;
  /** No story any more (the session ended, the tour closed). */
  stopAll(): void;
  /** The station whose story plays, or null. */
  playing(): string | null;
  /** Where the story playing is; null with none, or for a scene with a
   *  choice (no fixed number of steps). */
  progress(): StoryProgress | null;
  /** Hold the step while the visitor is asked whether to end the story:
   *  an auto step's timer stops (its `autoMs`
   *  reads null); released, it starts again from its full length. A new
   *  story starts unheld. */
  holdStep(held: boolean): void;
}

export function createSceneView(deps: SceneViewDeps): SceneView {
  const { dom } = deps;
  let story: {
    station: TourStation;
    player: ScenePlayer;
    count: number | null;
  } | null = null;
  const queue: TourStation[] = [];
  /** Bumped per rendered step: a load that lands later is dropped. */
  let renderToken = 0;
  let cancelTimer: (() => void) | null = null;
  /** The step held (`holdStep`): no timer runs. */
  let held = false;
  /** The step's object URLs (a picture; a clip and its poster). */
  const liveUrls: string[] = [];
  /** The step's media share one status line (r881 re-review M1: one
   *  asset's settle blanked another's line). What it says, per step: */
  /** The figure or model the stage holds back for the visitor's position. */
  let figureWait: string | null = null;
  /** The media still loading, in the order they started. */
  const loading: string[] = [];
  /** What went wrong with the step's media: true until the step changes. */
  let notice: string | null = null;
  /** The station's card picture's object URL, freed when its story ends. */
  let stationUrl: string | null = null;
  /** Bumped when the card picture goes: a read that lands later is dropped. */
  let stationToken = 0;

  /** The status line from the step's media: a parked figure, else what
   *  still loads; then what went wrong, which outlives both. */
  function showStatus(): void {
    const current = loading.at(-1);
    const now =
      figureWait ?? (current === undefined ? null : `Loading the ${current}…`);
    dom.status.textContent = [now, notice]
      .filter((part) => part !== null)
      .join(" ");
  }

  function releaseStep(): void {
    renderToken += 1;
    cancelTimer?.();
    cancelTimer = null;
    deps.audio.stop();
    for (const url of liveUrls.splice(0)) deps.objectUrls.revoke(url);
    dom.image.hidden = true;
    dom.image.src = "";
    stopVideo();
    figureWait = null;
    loading.length = 0;
    notice = null;
    dom.status.textContent = "";
    dom.choices.replaceChildren();
  }

  /** The player stops and lets its clip go (removing `src` and `load()`
   *  is how a media element drops its resource; `src = ""` would ask
   *  for the page's own URL). */
  function stopVideo(): void {
    const { video } = dom;
    video.pause();
    video.removeAttribute("src");
    video.removeAttribute("poster");
    video.load();
    video.hidden = true;
  }

  /** An object URL for this step, freed when the step changes. */
  function stepUrl(blob: Blob): string {
    const url = deps.objectUrls.create(blob);
    liveUrls.push(url);
    return url;
  }

  function renderQueue(): void {
    const next = queue[0];
    dom.playNext.hidden = next === undefined;
    dom.playNext.textContent =
      next === undefined ? "" : `Play: ${stationTitle(next)}`;
  }

  /**
   * Load one asset of the step, with its in-progress line and its outcome:
   * its loading line goes when it is read, the use's own line stays when
   * it returns one, a failure line when it could not be read (UI
   * async-feedback rule). Another asset's lines are left alone.
   */
  function withAsset(
    assetId: string,
    what: string,
    use: (blob: Blob) => Promise<string | void> | void,
  ): void {
    const asset = deps.assets.get(assetId);
    if (asset === undefined) return;
    const token = renderToken;
    loading.push(what);
    showStatus();
    const loaded = (): void => {
      const at = loading.indexOf(what);
      if (at >= 0) loading.splice(at, 1);
    };
    deps
      .loadAsset(asset.path)
      .then(async (blob) => {
        if (token !== renderToken) return;
        loaded();
        showStatus();
        const outcome = await use(blob);
        if (token !== renderToken) return;
        if (typeof outcome === "string") notice = outcome;
        showStatus();
      })
      .catch(() => {
        if (token !== renderToken) return;
        loaded();
        notice = `The ${what} could not be loaded - the words are below.`;
        showStatus();
      });
  }

  /** Show a figure or model on the stage. While the stage holds it back
   *  for the visitor's position (no GPS zero, or no heading yet: r881
   *  re-review M-B) the status says so; once it stands that line goes. */
  async function stageFigure(
    what: string,
    show: (onWaiting: () => void) => Promise<void>,
  ): Promise<void> {
    const token = renderToken;
    await show(() => {
      if (token !== renderToken) return;
      figureWait = `Waiting for your position to place the ${what}…`;
      showStatus();
    });
    if (token === renderToken) figureWait = null;
  }

  function playSound(assetId: string): void {
    withAsset(assetId, "sound", async (blob) => {
      try {
        await deps.audio.play(blob, () => undefined);
        return undefined;
      } catch {
        return "The sound did not play here - the words are below.";
      }
    });
  }

  /** Show one `show` step's block, as the step kinds of earlier versions
   *  showed it: its words at once, its media as they load. A `stage`
   *  figure or model stands at the station (with its voice); every other view shows in
   *  the card; a world view (pin, plane, placed model) also stands in the
   *  station's world from this step on (`onBlockShown`, B2b). */
  function showBlock(station: TourStation, block: TourBlock): void {
    switch (block.kind) {
      case "shortText":
        dom.text.textContent = block.caption;
        return;
      case "longText":
        // Its plain text P (S0): paragraphs a blank line apart, shown as
        // breaks (`white-space: pre-line`), no markup characters (B2b).
        dom.text.textContent = plainTextOf(parseTourMarkdown(block.body)).text;
        return;
      case "picture": {
        dom.text.textContent = block.caption ?? "";
        const alt = block.alt ?? block.caption ?? "";
        withAsset(block.image, "picture", async (blob) => {
          const token = renderToken;
          if ((await deps.checkPicture(blob)) !== null) {
            return "The picture is too large to show here - the words are below.";
          }
          if (token !== renderToken) return undefined;
          dom.image.src = stepUrl(blob);
          dom.image.alt = alt;
          dom.image.hidden = false;
          return undefined;
        });
        return;
      }
      case "character":
        dom.text.textContent = block.caption;
        if (block.view === "stage") {
          withAsset(block.image, "figure", (blob) =>
            stageFigure("figure", (onWaiting) =>
              deps.stage.showCharacter(station.id, blob, onWaiting),
            ),
          );
        }
        if (block.voice !== undefined) playSound(block.voice);
        return;
      case "audio":
        dom.text.textContent = block.transcript;
        playSound(block.audio);
        return;
      case "video": {
        // The card plays it: the browser's controls, so a tap plays it (a
        // gesture, so its sound may play); the transcript below. The
        // player shows only with its clip, so its play control always has
        // something to play; until then - and for good when the clip
        // cannot be read, which the status line says (`withAsset`) - the
        // poster stands as a still picture.
        dom.text.textContent = block.transcript;
        let clipShown = false;
        if (block.poster !== undefined) {
          withAsset(block.poster, "poster", (blob) => {
            const url = stepUrl(blob);
            dom.video.poster = url;
            if (clipShown) return;
            dom.image.src = url;
            dom.image.alt = "";
            dom.image.hidden = false;
          });
        }
        withAsset(block.video, "video", (blob) => {
          clipShown = true;
          dom.video.src = stepUrl(blob);
          dom.image.hidden = true;
          dom.image.src = "";
          dom.video.hidden = false;
        });
        return;
      }
      case "model":
        dom.text.textContent = block.title ?? "";
        if (block.view !== "stage") return;
        withAsset(block.asset, "3D model", (blob) =>
          stageFigure("3D model", (onWaiting) =>
            deps.stage.showModel(station.id, blob, onWaiting),
          ),
        );
        return;
    }
  }

  /** Show one step's action: a block, or a choice's buttons. */
  function showAction(station: TourStation, action: TourStepAction): void {
    switch (action.kind) {
      case "show": {
        const block = station.blocks.find((b) => b.id === action.block);
        // The reader resolved every `show`: none names a missing block.
        if (block !== undefined) showBlock(station, block);
        return;
      }
      case "choice":
        dom.text.textContent = action.prompt;
        dom.choices.replaceChildren(
          ...action.options.map((option) =>
            deps.createChoiceButton(option.label, () => {
              if (story !== null) render(story.player.choose(option.id));
            }),
          ),
        );
        return;
      case "quiz":
        // Unreachable: the player skips quizzes until K5.
        return;
    }
  }

  /** The block a step shows, or null for a choice or a quiz. */
  function shownBlock(station: TourStation, step: TourStep): TourBlock | null {
    const { action } = step;
    if (action.kind !== "show") return null;
    return station.blocks.find((b) => b.id === action.block) ?? null;
  }

  function render(step: TourStep | null): void {
    releaseStep();
    if (story === null) return;
    if (step === null) {
      endStory();
      return;
    }
    const block = shownBlock(story.station, step);
    dom.speaker.hidden = block?.kind !== "character";
    dom.speaker.textContent = block?.kind === "character" ? block.name : "";
    dom.continueButton.hidden = step.action.kind === "choice";
    const reached = worldBlockReachedBy(story.station, step);
    if (reached !== null) deps.onBlockShown?.(story.station.id, reached.id);
    showAction(story.station, step.action);
    armTimer(step);
    deps.onChange?.();
  }

  /** An auto step's timer, from its full length; none while held. */
  function armTimer(step: TourStep): void {
    if (held || step.advance.mode !== "auto" || step.action.kind === "choice") {
      return;
    }
    cancelTimer = deps.schedule(() => {
      cancelTimer = null;
      if (story !== null) render(story.player.next());
    }, step.advance.afterS * 1000);
  }

  function start(station: TourStation): void {
    held = false;
    deps.stage.clear();
    story = {
      station,
      player: createScenePlayer(station.steps),
      count: playableStepCount(station.steps),
    };
    dom.panel.hidden = false;
    dom.title.textContent = stationTitle(station);
    showDescription(station.description ?? "");
    showStationImage(station);
    renderQueue();
    const first = story.player.current();
    if (first === null && hasCard(station)) {
      // No story, but a card to read: it stays until Continue, which ends
      // it (the player's `next()` of an empty story is its end).
      releaseStep();
      dom.speaker.hidden = true;
      dom.speaker.textContent = "";
      dom.text.textContent = "";
      dom.continueButton.hidden = false;
      deps.onChange?.();
      return;
    }
    render(first);
  }

  /** A station has something to read without a story: a description or a
   *  card picture. */
  function hasCard(station: TourStation): boolean {
    return (
      (station.description ?? "") !== "" ||
      (station.image !== undefined && deps.assets.has(station.image))
    );
  }

  /** The station's card picture: read and measured like a step's picture,
   *  shown under its name for the whole story. A picture that cannot be
   *  read or is too large is left out; the name and the words stay. */
  function showStationImage(station: TourStation): void {
    hideStationImage();
    const asset =
      station.image === undefined ? undefined : deps.assets.get(station.image);
    if (asset === undefined) return;
    const token = stationToken;
    const alt = stationTitle(station);
    deps
      .loadAsset(asset.path)
      .then(async (blob) => {
        if (token !== stationToken) return;
        if ((await deps.checkPicture(blob)) !== null) return;
        if (token !== stationToken) return;
        stationUrl = deps.objectUrls.create(blob);
        dom.stationImage.src = stationUrl;
        dom.stationImage.alt = alt;
        dom.stationImage.hidden = false;
      })
      .catch(() => undefined);
  }

  /** The card picture goes, and a read still in flight lands on nothing. */
  function hideStationImage(): void {
    stationToken += 1;
    if (stationUrl !== null) deps.objectUrls.revoke(stationUrl);
    stationUrl = null;
    dom.stationImage.hidden = true;
    dom.stationImage.src = "";
  }

  /** The station's description under its name; none hides the line. */
  function showDescription(text: string): void {
    dom.description.textContent = text;
    dom.description.hidden = text === "";
  }

  function endStory(): void {
    const ended = story;
    story = null;
    releaseStep();
    deps.stage.clear();
    dom.panel.hidden = true;
    showDescription("");
    hideStationImage();
    if (ended !== null) deps.onStoryEnd(ended.station.id);
    const next = queue.shift();
    if (next !== undefined) start(next);
    else renderQueue();
    deps.onChange?.();
  }

  return {
    offer(station) {
      if (story?.station.id === station.id) return;
      if (queue.some((s) => s.id === station.id)) return;
      if (story === null) start(station);
      else {
        queue.push(station);
        renderQueue();
      }
    },
    playNextNow() {
      const next = queue.shift();
      if (next === undefined) return;
      // One story at a time: the one playing stops and waits its turn
      // again (its station stays found, not done).
      if (story !== null) queue.push(story.station);
      story = null;
      releaseStep();
      start(next);
    },
    continueTapped() {
      if (story !== null) render(story.player.next());
    },
    end(stationId) {
      if (story?.station.id === stationId) {
        endStory();
        return;
      }
      const at = queue.findIndex((s) => s.id === stationId);
      if (at >= 0) {
        queue.splice(at, 1);
        renderQueue();
      }
      deps.onStoryEnd(stationId);
    },
    stopAll() {
      queue.length = 0;
      story = null;
      releaseStep();
      hideStationImage();
      deps.stage.clear();
      dom.panel.hidden = true;
      renderQueue();
      deps.onChange?.();
    },
    playing: () => story?.station.id ?? null,
    progress() {
      const step = story?.player.current() ?? null;
      if (story === null || story.count === null || step === null) return null;
      const playable = story.station.steps.filter(isPlayableInK4);
      return {
        index: playable.indexOf(step),
        count: story.count,
        autoMs:
          step.advance.mode === "auto" && !held
            ? step.advance.afterS * 1000
            : null,
      };
    },
    holdStep(hold) {
      if (hold === held) return;
      held = hold;
      cancelTimer?.();
      cancelTimer = null;
      const step = story?.player.current() ?? null;
      if (!hold && step !== null) armTimer(step);
    },
  };
}
