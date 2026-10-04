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
} from "gps-plus-slam-app-framework/ar/tour-stations";

import { createScenePlayer, type ScenePlayer } from "./scene-player.js";
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

/** What a step shows in AR at its station. */
export interface SceneStage {
  showCharacter(
    stationId: string,
    image: Blob,
    size?: { readonly width?: number; readonly height?: number },
  ): Promise<void>;
  showModel(stationId: string, model: Blob): Promise<void>;
  clear(): void;
}

export interface SceneViewDeps {
  readonly dom: SceneViewDom;
  /** The tour's media by asset id (`content/<id>.<ext>`). */
  readonly assets: ReadonlyMap<string, TourAsset>;
  loadAsset(path: string): Promise<Blob>;
  readonly audio: SceneAudio;
  readonly stage: SceneStage;
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
}

export interface SceneView {
  /** A station was found: play it, or queue it behind the story playing. */
  offer(station: TourStation): void;
  /** The "Play" button's tap: stop the story playing, play the next. */
  playNextNow(): void;
  /** The continue tap. */
  continueTapped(): void;
  /** No story any more (the session ended, the tour closed). */
  stopAll(): void;
  /** The station whose story plays, or null. */
  playing(): string | null;
}

export function createSceneView(deps: SceneViewDeps): SceneView {
  const { dom } = deps;
  let story: { station: TourStation; player: ScenePlayer } | null = null;
  const queue: TourStation[] = [];
  /** Bumped per rendered step: a load that lands later is dropped. */
  let renderToken = 0;
  let cancelTimer: (() => void) | null = null;
  let liveUrl: string | null = null;

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
   * cleared when it shows, the use's own line when it returns one, a
   * failure line when it could not be read (UI async-feedback rule).
   */
  function withAsset(
    assetId: string,
    what: string,
    use: (blob: Blob) => Promise<string | void> | void,
  ): void {
    const asset = deps.assets.get(assetId);
    if (asset === undefined) return;
    const token = renderToken;
    dom.status.textContent = `Loading the ${what}…`;
    deps
      .loadAsset(asset.path)
      .then(async (blob) => {
        if (token !== renderToken) return;
        const outcome = await use(blob);
        if (token === renderToken) dom.status.textContent = outcome ?? "";
      })
      .catch(() => {
        if (token !== renderToken) return;
        dom.status.textContent = `The ${what} could not be loaded - the words are below.`;
      });
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

  /** Show one step's block: its words at once, its media as they load. */
  function showBlock(station: TourStation, block: TourBlock): void {
    switch (block.kind) {
      case "text":
        dom.text.textContent = block.text;
        return;
      case "image":
        dom.text.textContent = block.caption ?? "";
        withAsset(block.asset, "picture", (blob) => {
          liveUrl = deps.objectUrls.create(blob);
          dom.image.src = liveUrl;
          dom.image.alt = block.caption ?? "";
          dom.image.hidden = false;
        });
        return;
      case "character":
        dom.text.textContent = block.caption;
        withAsset(block.image, "figure", (blob) => {
          const asset = deps.assets.get(block.image);
          return deps.stage.showCharacter(station.id, blob, {
            ...(asset?.width === undefined ? {} : { width: asset.width }),
            ...(asset?.height === undefined ? {} : { height: asset.height }),
          });
        });
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
          deps.stage.showModel(station.id, blob),
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
    const block = step.block;
    dom.speaker.hidden = block.kind !== "character";
    dom.speaker.textContent = block.kind === "character" ? block.name : "";
    dom.continueButton.hidden = block.kind === "choice";
    showBlock(story.station, block);
    if (step.advance.mode === "auto" && block.kind !== "choice") {
      cancelTimer = deps.schedule(() => {
        cancelTimer = null;
        if (story !== null) render(story.player.next());
      }, step.advance.afterS * 1000);
    }
  }

  function start(station: TourStation): void {
    deps.stage.clear();
    story = { station, player: createScenePlayer(station.steps) };
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
    stopAll() {
      queue.length = 0;
      story = null;
      releaseStep();
      deps.stage.clear();
      dom.panel.hidden = true;
      renderQueue();
    },
    playing: () => story?.station.id ?? null,
  };
}
