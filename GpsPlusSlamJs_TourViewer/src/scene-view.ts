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
  TourStation,
  TourStep,
  TourStepAction,
} from "gps-plus-slam-app-framework/ar/tour-stations";

import {
  createScenePlayer,
  isPlayableInK4,
  playableStepCount,
  type ScenePlayer,
} from "./scene-player.js";
import { stationTitle } from "./station-run.js";

/** The story panel's elements, all inside `#ar-root` (the DOM overlay). */
export interface SceneViewDom {
  readonly panel: Pick<HTMLElement, "hidden">;
  readonly title: Pick<HTMLElement, "textContent">;
  /** A character's name; hidden for other steps. */
  readonly speaker: Pick<HTMLElement, "textContent" | "hidden">;
  /** Text, caption or transcript: every step has words (captions always). */
  readonly text: Pick<HTMLElement, "textContent">;
  /** Loading and failures of this step's media, `aria-live`. */
  readonly status: Pick<HTMLElement, "textContent">;
  readonly image: Pick<HTMLImageElement, "src" | "alt" | "hidden">;
  readonly choices: Pick<HTMLElement, "replaceChildren">;
  readonly continueButton: Pick<HTMLElement, "hidden">;
  readonly playNext: Pick<HTMLElement, "textContent" | "hidden">;
}

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
  let liveUrl: string | null = null;
  /** The step's media share one status line (r881 re-review M1: one
   *  asset's settle blanked another's line). What it says, per step: */
  /** The figure or model the stage holds back for the visitor's position. */
  let figureWait: string | null = null;
  /** The media still loading, in the order they started. */
  const loading: string[] = [];
  /** What went wrong with the step's media: true until the step changes. */
  let notice: string | null = null;

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
    if (liveUrl !== null) {
      deps.objectUrls.revoke(liveUrl);
      liveUrl = null;
    }
    dom.image.hidden = true;
    dom.image.src = "";
    figureWait = null;
    loading.length = 0;
    notice = null;
    dom.status.textContent = "";
    dom.choices.replaceChildren();
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

  /** Show one step's action: its words at once, its media as they load. */
  function showBlock(station: TourStation, block: TourStepAction): void {
    switch (block.kind) {
      case "text":
        dom.text.textContent = block.text;
        return;
      case "image":
        dom.text.textContent = block.caption ?? "";
        withAsset(block.asset, "picture", async (blob) => {
          const token = renderToken;
          if ((await deps.checkPicture(blob)) !== null) {
            return "The picture is too large to show here - the words are below.";
          }
          if (token !== renderToken) return undefined;
          liveUrl = deps.objectUrls.create(blob);
          dom.image.src = liveUrl;
          dom.image.alt = block.caption ?? "";
          dom.image.hidden = false;
          return undefined;
        });
        return;
      case "character":
        dom.text.textContent = block.caption;
        withAsset(block.image, "figure", (blob) =>
          stageFigure("figure", (onWaiting) =>
            deps.stage.showCharacter(station.id, blob, onWaiting),
          ),
        );
        if (block.voice !== undefined) playSound(block.voice);
        return;
      case "audio":
        dom.text.textContent = block.transcript;
        playSound(block.asset);
        return;
      case "video":
        // Video is later (plan §5 K4): its transcript stands in.
        dom.text.textContent = block.transcript;
        return;
      case "model":
        dom.text.textContent = block.caption ?? "";
        withAsset(block.asset, "3D model", (blob) =>
          stageFigure("3D model", (onWaiting) =>
            deps.stage.showModel(station.id, blob, onWaiting),
          ),
        );
        return;
      case "choice":
        dom.text.textContent = block.prompt;
        dom.choices.replaceChildren(
          ...block.options.map((option) =>
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

  function render(step: TourStep | null): void {
    releaseStep();
    if (story === null) return;
    if (step === null) {
      endStory();
      return;
    }
    const block = step.action;
    dom.speaker.hidden = block.kind !== "character";
    dom.speaker.textContent = block.kind === "character" ? block.name : "";
    dom.continueButton.hidden = block.kind === "choice";
    showBlock(story.station, block);
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
    renderQueue();
    render(story.player.current());
  }

  function endStory(): void {
    const ended = story;
    story = null;
    releaseStep();
    deps.stage.clear();
    dom.panel.hidden = true;
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
