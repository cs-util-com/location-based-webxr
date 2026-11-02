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
import {
  isStageCharacterView,
  lineReadingMs,
  type StageCharacterView,
} from "./character-views.js";
import type { CharacterVoice } from "./character-look.js";
import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import type { StageCharacterLook } from "./scene-stage.js";
import { stationHasCard, stationTitle } from "./station-run.js";

/** The story panel's elements, all inside `#ar-root` (the DOM overlay). */
export interface SceneViewDom {
  readonly panel: Pick<HTMLElement, "hidden">;
  readonly title: Pick<HTMLElement, "textContent">;
  /** The station's description under its name (B2b step 6); hidden for a
   *  station without one. */
  readonly description: Pick<HTMLElement, "textContent" | "hidden">;
  /** A character's name; hidden for other steps. */
  readonly speaker: Pick<HTMLElement, "textContent" | "hidden">;
  /** The character's round portrait beside his name (the `portrait`
   *  view); absent: none. */
  readonly portrait?: Pick<HTMLImageElement, "src" | "alt" | "hidden">;
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

/** What the story card uses of its `<video>` element (`onended`: a
 *  `lineEnd` step waits for the clip's end). */
type SceneVideo = Pick<
  HTMLVideoElement,
  "src" | "poster" | "hidden" | "pause" | "removeAttribute" | "load"
> & {
  onended: ((ev: Event) => void) | null;
  /** The visitor started the clip (the player does not autoplay). */
  onplay: ((ev: Event) => void) | null;
  /** The clip loaded but cannot be played (it does not decode here). */
  onerror: OnErrorEventHandler;
};

/** The sound of a step (one channel: a new clip stops the previous). */
export interface SceneAudio {
  /** Rejects when the browser refuses to play (the captions still show). */
  play(blob: Blob, onEnded: () => void): Promise<void>;
  stop(): void;
  /** The playing clip's length (ms) once known, else null; absent: never
   *  known. */
  durationMs?(): number | null;
}

/** What a step shows in AR at its station. `onWaiting`: the decoded
 *  figure waits for the station's pose (`scene-stage.ts`). */
interface SceneStage {
  showCharacter(
    stationId: string,
    image: Blob,
    onWaiting?: () => void,
    look?: StageCharacterLook,
  ): Promise<void>;
  /** The step's voice, which a character look follows; `durationMs`, the
   *  voice's length when known as it starts speaking. */
  setVoice?(voice: CharacterVoice, durationMs?: number): void;
  /** The story ended: a character look stays in the world (absent: the
   *  story's end clears the stage). */
  release?(): void;
  /** A tap on the bubble view's look: its bubble shuts or opens. */
  toggleBubble?(): void;
  showModel(
    stationId: string,
    model: Blob,
    onWaiting?: () => void,
  ): Promise<void>;
  clear(): void;
}

/** A `lineEnd` step's wait after its voice ended (the narration's tail). */
const LINE_TAIL_MS = 600;

export interface SceneViewDeps {
  readonly dom: SceneViewDom;
  /** The tour's media by asset id (`content/<id>.<ext>`). */
  readonly assets: ReadonlyMap<string, TourAsset>;
  /** The tour's declared characters by id (minor 2): a story view of one
   *  with a frames sheet stands from the sheet. None when absent. */
  readonly characters?: ReadonlyMap<string, TourCharacter>;
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
  /** A failure the panel's status line cannot show, because no story
   *  plays and the panel is hidden: his voice, tapped after his story,
   *  could not play. The app says it in its toast. None: not said. */
  sayFailure?(text: string): void;
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
  /** A tap on the step's character (his figure, bubble or stage in the
   *  world, or his portrait in the card): a story view's voice plays, or
   *  stops while it plays; the bubble view's bubble shuts or opens. False
   *  when the step shows no character in a story view. */
  characterTapped(): boolean;
  /** The `?debug=1` lines of the story: a frames sheet that could not be
   *  read (he stands in his one pose), naming it; none otherwise. */
  debugLines(): string[];
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
  /** Bumped when a voice starts or is stopped: a voice still loading
   *  when the visitor tapped it off lands on nothing. */
  let voiceRun = 0;
  /** The character of a story view the stage holds, whose voice a tap
   *  plays (the bubble view: whose bubble a tap shuts): set by his step
   *  and kept after it and after his story - he stays in the world and a
   *  tap works whenever he stands (the prototype's rule) - until the
   *  stage is cleared or another figure or model takes it. */
  let tapTarget: {
    readonly view: StageCharacterView;
    readonly voice: string | undefined;
  } | null = null;
  /** The step held (`holdStep`): no timer runs. */
  let held = false;
  /** The step's voice or sound, which a `lineEnd` step waits for: none
   *  (or it could not play: the words' reading time stands in), playing,
   *  or ended. */
  let lineVoice: "none" | "playing" | "ended" = "none";
  /** The sound playing is his voice (a tap on him then stops it), not
   *  another step's sound (a tap on him then does nothing). */
  let voiceIsHis = false;
  /** The step shows a video: its clip has its own sound, so a tap on him
   *  plays nothing through the whole step, before and while it plays -
   *  unless the clip cannot be read, when there is no sound to clash. */
  let videoStep = false;
  /** The step's object URLs (a picture; a clip and its poster). */
  const liveUrls: string[] = [];
  /** The step's media share one status line (r881 re-review M1: one
   *  asset's settle blanked another's line). What it says, per step: */
  /** The figure or model the stage holds back for the visitor's position. */
  let figureWait: string | null = null;
  /** The media still loading, in the order they started. */
  const loading: string[] = [];
  /** What went wrong with the step's media, per asset (its `what`), in
   *  the order it went wrong: until the step changes. One asset's line
   *  never clears another's. */
  const notices = new Map<string, string>();
  /** The frames sheet that could not be read this story, for the
   *  `?debug=1` readout. */
  let sheetFailure: string | null = null;
  /** The station's card picture's object URL, freed when its story ends. */
  let stationUrl: string | null = null;
  /** Bumped when the card picture goes: a read that lands later is dropped. */
  let stationToken = 0;
  /** Why the card picture is not shown: kept over every step of the
   *  story, gone with the picture. */
  let stationNotice: string | null = null;

  /** The status line from the step's media: a parked figure, else what
   *  still loads; then what went wrong, which outlives both; then why the
   *  card picture is missing. */
  function showStatus(): void {
    const current = loading.at(-1);
    const now =
      figureWait ?? (current === undefined ? null : `Loading the ${current}…`);
    dom.status.textContent = [now, ...notices.values(), stationNotice]
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
    if (dom.portrait !== undefined) {
      dom.portrait.hidden = true;
      dom.portrait.src = "";
    }
    stopVideo();
    lineVoice = "none";
    voiceIsHis = false;
    videoStep = false;
    voiceRun += 1;
    deps.stage.setVoice?.("idle");
    figureWait = null;
    loading.length = 0;
    notices.clear();
    showStatus();
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
    video.onended = null;
    video.onplay = null;
    video.onerror = null;
  }

  /** The stage is cleared: nothing of his stands to tap. */
  function clearStage(): void {
    tapTarget = null;
    deps.stage.clear();
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
    onFail?: () => void,
  ): void {
    const asset = deps.assets.get(assetId);
    if (asset === undefined) {
      onFail?.();
      return;
    }
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
        if (typeof outcome === "string") notices.set(what, outcome);
        showStatus();
      })
      .catch(() => {
        if (token !== renderToken) return;
        loaded();
        notices.set(
          what,
          `The ${what} could not be loaded - the words are below.`,
        );
        showStatus();
        onFail?.();
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

  /** Play the step's sound. His own voice (`his`: the one a tap on the
   *  figure standing in the world plays) also tells the stage - his ring,
   *  footer and beckon; any other sound, a card view's voice among them,
   *  leaves his look alone. A `lineEnd` step moves on when it ends, or,
   *  when it cannot play, after the words' reading time. */
  function playSound(assetId: string, his: boolean): void {
    voiceRun += 1;
    const run = voiceRun;
    lineVoice = "playing";
    voiceIsHis = his;
    const lost = (): void => {
      if (run !== voiceRun) return;
      lineVoice = "none";
      if (his) deps.stage.setVoice?.("idle");
      // After his story the panel is hidden: its status line is not seen.
      if (his && story === null) {
        deps.sayFailure?.("The voice could not be played here.");
      }
      rearmLineEnd();
    };
    withAsset(
      assetId,
      "sound",
      async (blob) => {
        if (run !== voiceRun) return undefined;
        try {
          await deps.audio.play(blob, () => {
            if (run !== voiceRun) return;
            lineVoice = "ended";
            if (his) deps.stage.setVoice?.("spoken");
            rearmLineEnd();
          });
          if (run === voiceRun && his && lineVoice === "playing") {
            // Its length, when the element knows it, times the read-along.
            const ms = deps.audio.durationMs?.() ?? null;
            if (ms === null) deps.stage.setVoice?.("speaking");
            else deps.stage.setVoice?.("speaking", ms);
          }
          return undefined;
        } catch {
          if (run !== voiceRun) return undefined;
          lost();
          return "The sound did not play here - the words are below.";
        }
      },
      lost,
    );
  }

  /** A `lineEnd` step's wait changed (its voice ended or was lost). */
  function rearmLineEnd(): void {
    const step = story?.player.current() ?? null;
    if (step === null || step.advance.mode !== "lineEnd") return;
    cancelTimer?.();
    cancelTimer = null;
    armTimer(step);
    deps.onChange?.();
  }

  /** How long a `lineEnd` step still waits once its voice is out of the
   *  way: its tail after the voice, the words' reading time with none;
   *  null while the voice plays. */
  function lineEndMs(): number | null {
    if (lineVoice === "playing") return null;
    if (lineVoice === "ended") return LINE_TAIL_MS;
    return lineReadingMs(dom.text.textContent ?? "");
  }

  /** The step's portrait (the `portrait` view): measured like a picture. */
  async function showPortrait(blob: Blob, name: string): Promise<void> {
    const portrait = dom.portrait;
    if (portrait === undefined) return;
    const token = renderToken;
    if ((await deps.checkPicture(blob)) !== null) return;
    if (token !== renderToken) return;
    portrait.src = stepUrl(blob);
    portrait.alt = name;
    portrait.hidden = false;
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
        // On a reading stand or a reading sign the text stands in the world
        // (from this step on, as a placed model), drawn as pixels: the card
        // names it by its title and carries its words too, so they can be
        // read here and reached by a screen reader.
        if (block.view === "lectern" || block.view === "reading") {
          const words = plainTextOf(parseTourMarkdown(block.body)).text;
          dom.text.textContent =
            words === "" ? block.title : `${block.title}\n\n${words}`;
          return;
        }
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
      case "character": {
        dom.text.textContent = block.caption;
        // A story view (format 4.2) stands as a character look; `stage`
        // as the plain cut-out; `card` only in the card.
        const view = block.view;
        const look = isStageCharacterView(view)
          ? {
              view,
              name: block.name,
              line: block.caption,
              voiced: view !== "bubble" && block.voice !== undefined,
              pose: block.pose,
            }
          : undefined;
        const stand = (
          blob: Blob,
          spec: StageCharacterLook | undefined,
        ): Promise<void> =>
          stageFigure("figure", (onWaiting) =>
            spec === undefined
              ? deps.stage.showCharacter(station.id, blob, onWaiting)
              : deps.stage.showCharacter(station.id, blob, onWaiting, spec),
          );
        // A declared character's frames sheet (his talking and beckoning
        // poses) stands a story view; the portrait stays his image.
        const sheet =
          look === undefined || block.character === undefined
            ? undefined
            : deps.characters?.get(block.character)?.frames;
        if (look !== undefined && sheet !== undefined) {
          if (view === "portrait") {
            withAsset(block.image, "portrait", (blob) => {
              void showPortrait(blob, block.name);
            });
          }
          withAsset(
            sheet,
            "figure",
            (blob) => stand(blob, { ...look, sheet: true }),
            () => {
              // An unreadable sheet: he stands in his one pose, so the
              // figure's failure line `withAsset` just wrote does not
              // hold (another asset's line stays); the debug readout
              // names the sheet.
              notices.delete("figure");
              showStatus();
              sheetFailure = `story: the frames sheet "${sheet}" of "${block.character ?? ""}" could not be read - he stands in his one pose`;
              withAsset(block.image, "figure", (blob) => stand(blob, look));
            },
          );
        } else if (view === "stage" || look !== undefined) {
          withAsset(block.image, "figure", async (blob) => {
            if (view === "portrait") void showPortrait(blob, block.name);
            await stand(blob, look);
          });
        }
        // A story view's voice plays on a tap on him (the prototype's
        // rule; `characterTapped`), the bubble view's never; the stage
        // and card views play it with the step, as 4.0 did.
        if (look !== undefined) {
          tapTarget = { view: look.view, voice: block.voice };
        } else {
          // A plain figure takes the stage from him; a card view leaves
          // the stage as it was.
          if (view === "stage") tapTarget = null;
          // Not the voice of a figure the visitor taps: his look (if one
          // stands) is left alone.
          if (block.voice !== undefined) playSound(block.voice, false);
        }
        return;
      }
      case "audio":
        dom.text.textContent = block.transcript;
        playSound(block.audio, false);
        return;
      case "video": {
        // The card plays it: the browser's controls, so a tap plays it (a
        // gesture, so its sound may play); the transcript below. The
        // player shows only with its clip, so its play control always has
        // something to play; until then - and for good when the clip
        // cannot be read, which the status line says (`withAsset`) - the
        // poster stands as a still picture.
        dom.text.textContent = block.transcript;
        // The player does not start by itself: until the visitor starts
        // the clip a `lineEnd` step waits the transcript's reading time
        // (as for one that cannot be read); once it plays, its end.
        lineVoice = "none";
        videoStep = true;
        const run = voiceRun;
        const lost = (): void => {
          if (run !== voiceRun) return;
          lineVoice = "none";
          // No clip plays this step: a tap on him may play his voice.
          videoStep = false;
          rearmLineEnd();
        };
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
        withAsset(
          block.video,
          "video",
          (blob) => {
            clipShown = true;
            dom.video.onplay = () => {
              if (run !== voiceRun || lineVoice === "playing") return;
              lineVoice = "playing";
              rearmLineEnd();
            };
            dom.video.onended = () => {
              if (run !== voiceRun) return;
              lineVoice = "ended";
              rearmLineEnd();
            };
            // A clip that loads but does not decode never plays: no
            // sound to clash with, so as one that cannot be read.
            dom.video.onerror = () => {
              if (run !== voiceRun) return;
              notices.set(
                "video",
                "The video could not be played here - the words are below.",
              );
              showStatus();
              lost();
            };
            dom.video.src = stepUrl(blob);
            dom.image.hidden = true;
            dom.image.src = "";
            dom.video.hidden = false;
          },
          lost,
        );
        return;
      }
      case "model":
        dom.text.textContent = block.title ?? "";
        if (block.view !== "stage") return;
        // The model takes the stage from him.
        tapTarget = null;
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

  /** An auto step's timer, from its full length; a `lineEnd` step's
   *  once its voice is out of the way (`lineEndMs`); none while held. */
  function armTimer(step: TourStep): void {
    // One timer: a voice lost while its step renders arms it early.
    cancelTimer?.();
    cancelTimer = null;
    if (held || step.action.kind === "choice") return;
    const ms = timerMs(step);
    if (ms === null) return;
    cancelTimer = deps.schedule(() => {
      cancelTimer = null;
      if (story !== null) render(story.player.next());
    }, ms);
  }

  /** The step's own timer (ms), or null for none (a tap step, a voice
   *  still playing). */
  function timerMs(step: TourStep): number | null {
    switch (step.advance.mode) {
      case "auto":
        return step.advance.afterS * 1000;
      case "lineEnd":
        return lineEndMs();
      case "tap":
        return null;
    }
  }

  function start(station: TourStation): void {
    held = false;
    sheetFailure = null;
    clearStage();
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

  /** A station has something to read without a story (`stationHasCard`,
   *  the walk's own rule). */
  function hasCard(station: TourStation): boolean {
    return stationHasCard(station, deps.assets);
  }

  /** The station's card picture: read and measured like a step's picture,
   *  shown under its name for the whole story. A picture that cannot be
   *  read or is too large is left out, and the status line says so; the
   *  name and the words stay. */
  function showStationImage(station: TourStation): void {
    hideStationImage();
    const asset =
      station.image === undefined ? undefined : deps.assets.get(station.image);
    if (asset === undefined) return;
    const token = stationToken;
    const alt = stationTitle(station);
    const missing = (why: string): void => {
      if (token !== stationToken) return;
      stationNotice = why;
      showStatus();
    };
    deps
      .loadAsset(asset.path)
      .then(async (blob) => {
        if (token !== stationToken) return;
        if ((await deps.checkPicture(blob)) !== null) {
          missing("The station's picture is too large to show here.");
          return;
        }
        if (token !== stationToken) return;
        stationUrl = deps.objectUrls.create(blob);
        dom.stationImage.src = stationUrl;
        dom.stationImage.alt = alt;
        dom.stationImage.hidden = false;
      })
      .catch(() => {
        missing("The station's picture could not be loaded.");
      });
  }

  /** The card picture goes, its status with it, and a read still in
   *  flight lands on nothing. */
  function hideStationImage(): void {
    stationToken += 1;
    if (stationUrl !== null) deps.objectUrls.revoke(stationUrl);
    stationUrl = null;
    dom.stationImage.hidden = true;
    dom.stationImage.src = "";
    if (stationNotice !== null) {
      stationNotice = null;
      showStatus();
    }
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
    // A character look stays in the world after his story (he goes when
    // his station is left); anything else leaves with it.
    if (deps.stage.release === undefined) clearStage();
    else deps.stage.release();
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
    characterTapped() {
      const target = tapTarget;
      if (target === null) return false;
      if (target.view === "bubble") {
        deps.stage.toggleBubble?.();
        return true;
      }
      if (target.voice === undefined) return true;
      // The step's own sound or clip is out: the tap is taken (it hit
      // him) and plays nothing over it, nor stops it - its end is what a
      // lineEnd step waits for.
      if (videoStep || (lineVoice === "playing" && !voiceIsHis)) return true;
      if (lineVoice === "playing") {
        // A tap while he speaks stops him; a lineEnd step then waits only
        // its tail.
        voiceRun += 1;
        deps.audio.stop();
        lineVoice = "ended";
        deps.stage.setVoice?.("idle");
      } else {
        playSound(target.voice, true);
      }
      rearmLineEnd();
      return true;
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
      // The debug readout names nothing of a tour that is gone.
      sheetFailure = null;
      releaseStep();
      hideStationImage();
      clearStage();
      dom.panel.hidden = true;
      renderQueue();
      deps.onChange?.();
    },
    debugLines: () => (sheetFailure === null ? [] : [sheetFailure]),
    playing: () => story?.station.id ?? null,
    progress() {
      const step = story?.player.current() ?? null;
      if (story === null || story.count === null || step === null) return null;
      const playable = story.station.steps.filter(isPlayableInK4);
      return {
        index: playable.indexOf(step),
        count: story.count,
        autoMs: held ? null : timerMs(step),
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
