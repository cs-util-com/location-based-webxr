/**
 * The visitor's story panel (tour kit plan K4, §4.2): plays a found
 * station's scene (`scene-player.ts`) in the DOM overlay, with its media,
 * its words, the tap to continue and the timed advance, scene choices,
 * and ONE story at a time: a station found while another story plays waits
 * behind a "Play" button, and tapping that button stops the story playing
 * (the community PR idea of "a new tap stops the previous one", K-D4: the
 * idea, not the implementation). A station with several playable stories
 * opens on a picker of their titles (`story-choice.ts`).
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
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  isTourStoryBlock,
  type TourStory,
  type TourStoryBlock,
  type TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import {
  createScenePlayer,
  isPlayableInK4,
  playableStepCount,
  type ScenePlayer,
} from "./scene-player.js";
import {
  createStoryChoices,
  storyPickLabel,
  type StoryPicker,
} from "./story-choice.js";
import {
  showItemCard,
  type ItemCardHost,
  type ItemClip,
  type ItemTapTarget,
  type ItemVideo,
  type ItemWorld,
} from "./item-card.js";
import { worldBlockReachedBy } from "./shown-blocks.js";
import { lineReadingMs } from "./character-views.js";
import type { CharacterVoice } from "./character-look.js";
import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
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
  /** Text, caption or transcript: a step may have none (a video, a sound or a character without one). */
  readonly text: Pick<HTMLElement, "textContent">;
  /** Loading and failures of this step's media, `aria-live`. */
  readonly status: Pick<HTMLElement, "textContent">;
  readonly image: Pick<HTMLImageElement, "src" | "alt" | "hidden">;
  /** The station's card picture under its name, over its whole story;
   *  hidden for a station without one. */
  readonly stationImage: Pick<HTMLImageElement, "src" | "alt" | "hidden">;
  /** The video card's player (B2b): a `<video controls playsinline>`
   *  above the transcript. */
  readonly video: ItemVideo;
  readonly choices: Pick<HTMLElement, "replaceChildren">;
  readonly continueButton: Pick<HTMLElement, "hidden">;
  readonly playNext: Pick<HTMLElement, "textContent" | "hidden">;
  /** An empty element of the card an item fills on its own (`item-card.ts`),
   *  emptied when the step changes; absent: no item has one. */
  readonly surface?: HTMLElement;
}

/** The sound of a step (one channel: a new clip stops the previous). */
export interface SceneAudio {
  /** Rejects when the browser refuses to play (the captions still show). */
  play(blob: Blob, onEnded: () => void): Promise<void>;
  stop(): void;
  /** The playing clip's length (ms) once known, else null; absent: never
   *  known. */
  durationMs?(): number | null;
  /** What is left of it (ms) once known, else null; absent: never known. */
  leftMs?(): number | null;
  /** A clip the voice channel holds comes back: the visitor tapped its
   *  figure. Absent where no channel holds a clip. */
  takeBack?(): void;
}

/** What a step shows in AR at its station: the world an item draws on
 *  (`onWaiting`: what it drew waits for the station's pose,
 *  `scene-stage.ts`), and what the panel itself tells the stage. */
interface SceneStage extends Required<ItemWorld> {
  /** The step's voice, which a character look follows; `durationMs`, the
   *  voice's length when known as it starts speaking. */
  setVoice?(voice: CharacterVoice, durationMs?: number): void;
  /** The story ended: a character look stays in the world (absent: the
   *  story's end clears the stage). */
  release?(): void;
  /** A tap on the bubble view's look: its bubble shuts or opens. */
  toggleBubble?(): void;
  clear(): void;
}

/** A `lineEnd` step's wait after its voice ended (the narration's tail). */
const LINE_TAIL_MS = 600;

export interface SceneViewDeps {
  readonly dom: SceneViewDom;
  /** The tour's media by asset id (`content/<id>.<ext>`). */
  readonly assets: ReadonlyMap<string, TourAsset>;
  /** The tour's declared characters by id: a story view of one
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
  /** Moves the focus to a button of `createChoiceButton`: the picker's
   *  first story when it opens. None: left where it is. */
  focusChoice?(button: Node): void;
  /** A one-shot clock (an auto step): returns the cancel. */
  schedule(fn: () => void, ms: number): () => void;
  readonly objectUrls: {
    create(blob: Blob): string;
    revoke(url: string): void;
  };
  /** The station is done: its one story played to its end, or the last
   *  unplayed of several, or the visitor left its picker. */
  onStoryEnd(stationId: string): void;
  /** Shows an item's card (the item lab swaps a kind in; `showItemCard`
   *  otherwise). */
  showItem?(block: TourBlock, host: ItemCardHost): void;
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
  /** The step's clip in the page's voice channel (`voice-focus.ts`): told
   *  each time it starts and when it is over. None: no channel. */
  readonly videoVoice?: { started(): void; ended(): void };
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
  /** A tap on the step's character (his figure, bubble or pop-up stage in
   *  the world, or his portrait in the card): his voice, which played with
   *  the step, plays again, or stops while it plays; the bubble view's
   *  bubble shuts or opens. False when the step shows no character in a
   *  look. */
  characterTapped(): boolean;
  /** The `?debug=1` lines of the story: a frames sheet that could not be
   *  read (he stands in his one pose), naming it; none otherwise. */
  debugLines(): string[];
  /** End this station's story now (the guide's "End this story", K4
   *  review R9): the playing one stops and the next queued one starts, a
   *  queued one leaves the queue; its end is reported either way, also for
   *  a station the panel does not hold. With a story of its picker left
   *  unplayed the picker comes back instead, and nothing is reported. */
  end(stationId: string): void;
  /** No story any more (the session ended, the tour closed). */
  stopAll(): void;
  /** The station whose panel is open (its story, card or picker), or null. */
  playing(): string | null;
  /** The station whose story picker shows, or null: nothing plays yet, and
   *  an end there ends the station. */
  choosing(): string | null;
  /** Where the story playing is; null with none (a picker shows no dots),
   *  or for a scene with a choice (no fixed number of steps). */
  progress(): StoryProgress | null;
  /** Hold the step while the visitor is asked whether to end the story:
   *  an auto step's timer stops (its `autoMs`
   *  reads null); released, it starts again from its full length. A new
   *  story starts unheld. */
  holdStep(held: boolean): void;
  /** The voice channel holds the step's voice, or let it go: the same stop
   *  of the timer as {@link SceneView.holdStep}, and his look goes quiet
   *  and speaks again with what is left. */
  holdVoice(held: boolean): void;
}

export function createSceneView(deps: SceneViewDeps): SceneView {
  const { dom } = deps;
  /** The station's turn. Its `played` story, or null: its card or its
   *  picker, over an empty player, so Continue and `end` finish it. */
  let story: {
    station: TourStation;
    played: TourStory | null;
    children: readonly TourStoryChild[];
    player: ScenePlayer;
    count: number | null;
  } | null = null;
  /** The turn showing a picker: a story tapped takes a new turn. */
  let pickerTurn: object | null = null;
  const queue: TourStation[] = [];
  const choices = createStoryChoices();
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
   *  stage is cleared or another figure takes it. */
  let tapTarget: ItemTapTarget | null = null;
  /** The step held (`holdStep`): no timer runs. */
  let held = false;
  /** The voice channel holds the step's voice (`holdVoice`): no timer runs
   *  either, and this hold is not the guide's to lift. */
  let voiceHeld = false;
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
  /* The step's media share one status line (r881 re-review M1: one
   *  asset's settle blanked another's line). What it says, per step: */
  /** The figure the stage holds back for the visitor's position. */
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
    voiceHeld = false;
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
    dom.surface?.replaceChildren();
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
    deps.videoVoice?.ended();
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

  /** Show a figure on the stage. While the stage holds it back
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
            if (!voiceHeld) saySpeaking(deps.audio.durationMs?.() ?? null);
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

  /** His look speaks, for `ms` when that is known. */
  function saySpeaking(ms: number | null): void {
    if (ms === null) deps.stage.setVoice?.("speaking");
    else deps.stage.setVoice?.("speaking", ms);
  }

  /** A `lineEnd` step's wait changed (its voice ended or was lost). */
  function rearmLineEnd(): void {
    const step = story?.player.current() ?? null;
    if (
      step === null ||
      !isTourStoryBlock(step) ||
      step.advance.mode !== "lineEnd"
    ) {
      return;
    }
    cancelTimer?.();
    cancelTimer = null;
    armTimer(step);
    deps.onChange?.();
  }

  /** How long a `lineEnd` step still waits once its voice is out of the
   *  way: its tail after the voice, the words' reading time with none;
   *  null while the voice plays, and while a clip with no words to read
   *  waits to be started (a reading floor would move on before it). */
  function lineEndMs(): number | null {
    if (lineVoice === "playing") return null;
    if (lineVoice === "ended") return LINE_TAIL_MS;
    const words = dom.text.textContent ?? "";
    if (videoStep && words.trim() === "") return null;
    return lineReadingMs(words);
  }

  /** The step's clip: its own sound, so nothing else plays through the
   *  whole step (`videoStep`), and a `lineEnd` step follows it. */
  function videoClip(): ItemClip {
    lineVoice = "none";
    videoStep = true;
    const run = voiceRun;
    return {
      started() {
        if (run !== voiceRun) return;
        // Also a re-play after the channel held it: it takes the channel.
        deps.videoVoice?.started();
        if (lineVoice === "playing") return;
        lineVoice = "playing";
        rearmLineEnd();
      },
      ended() {
        if (run !== voiceRun) return;
        deps.videoVoice?.ended();
        lineVoice = "ended";
        rearmLineEnd();
      },
      lost(why) {
        if (run !== voiceRun) return;
        deps.videoVoice?.ended();
        if (why !== undefined) {
          notices.set("video", why);
          showStatus();
        }
        lineVoice = "none";
        // No clip plays this step: a tap on him may play his voice.
        videoStep = false;
        rearmLineEnd();
      },
    };
  }

  /** What the step's item gets of this panel (`item-card.ts`). */
  function itemHost(station: TourStation): ItemCardHost {
    const token = renderToken;
    // An item draws through the two doors only, never the panel's own
    // calls on the stage (clear, release, voice, bubble).
    const world: ItemWorld = {
      showCharacter: (...a) => deps.stage.showCharacter(...a),
    };
    return {
      slots: dom,
      ...(dom.surface === undefined ? {} : { surface: dom.surface }),
      ...(deps.characters === undefined ? {} : { characters: deps.characters }),
      checkPicture: (blob) => deps.checkPicture(blob),
      asset: withAsset,
      url: stepUrl,
      sound: (id) => {
        playSound(id, false);
      },
      stage: {
        stand: (what, draw) =>
          stageFigure(what, (onWaiting) =>
            draw(world, { stationId: station.id, onWaiting }),
          ),
        tapTarget(target) {
          if (token !== renderToken) return;
          tapTarget = target;
          // In a story his voice plays with his step, in every look; a
          // tap on him stops it while it plays and plays it again after
          // (`characterTapped`).
          if (target?.voice !== undefined) playSound(target.voice, true);
        },
      },
      clip: videoClip,
      showing: () => token === renderToken,
      notice(what, text) {
        if (text === null) notices.delete(what);
        else notices.set(what, text);
        showStatus();
      },
      debugLine(text) {
        sheetFailure = text;
      },
    };
  }

  /** Show one child of the story: a block, or a choice's buttons. The
   *  player skips quizzes until K5. */
  function showChild(station: TourStation, child: TourStoryChild): void {
    if (isTourStoryBlock(child)) {
      (deps.showItem ?? showItemCard)(child, itemHost(station));
      return;
    }
    if (child.kind !== "choice") return;
    dom.text.textContent = child.prompt;
    dom.choices.replaceChildren(
      ...child.options.map((option) =>
        deps.createChoiceButton(option.label, () => {
          if (story !== null) render(story.player.choose(option.id));
        }),
      ),
    );
  }

  function render(step: TourStoryChild | null): void {
    releaseStep();
    if (story === null) return;
    if (step === null) {
      endStory();
      return;
    }
    dom.speaker.hidden = true;
    dom.speaker.textContent = "";
    dom.continueButton.hidden = step.kind === "choice";
    const reached = worldBlockReachedBy(step);
    if (reached !== null) deps.onBlockShown?.(story.station.id, reached.id);
    showChild(story.station, step);
    armTimer(step);
    deps.onChange?.();
  }

  /** An auto step's timer, from its full length; a `lineEnd` step's
   *  once its voice is out of the way (`lineEndMs`); none while held. */
  function armTimer(step: TourStoryChild): void {
    // One timer: a voice lost while its step renders arms it early.
    cancelTimer?.();
    cancelTimer = null;
    if (held || voiceHeld || !isTourStoryBlock(step)) return;
    const ms = timerMs(step);
    if (ms === null) return;
    cancelTimer = deps.schedule(() => {
      cancelTimer = null;
      if (story !== null) render(story.player.next());
    }, ms);
  }

  /** The step's own timer (ms), or null for none (a tap step, a voice
   *  still playing). */
  function timerMs(step: TourStoryBlock): number | null {
    switch (step.advance.mode) {
      case "auto":
        return step.advance.afterS * 1000;
      case "lineEnd":
        return lineEndMs();
      case "tap":
        return null;
    }
  }

  /** The station's turn, with `played` as its story; its player. */
  function takeTurn(
    station: TourStation,
    played: TourStory | null,
  ): ScenePlayer {
    held = false;
    sheetFailure = null;
    const children = played?.children ?? [];
    const player = createScenePlayer(children);
    story = {
      station,
      played,
      children,
      player,
      count: playableStepCount(children),
    };
    return player;
  }

  function start(station: TourStation): void {
    clearStage();
    const panel = choices.panelOf(station, hasCard(station));
    const player = takeTurn(
      station,
      panel.show === "story" ? panel.story : null,
    );
    dom.panel.hidden = false;
    dom.title.textContent = stationTitle(station);
    showDescription(station.description ?? "");
    showStationImage(station);
    renderQueue();
    if (panel.show === "picker") {
      showPicker(panel);
    } else if (panel.show === "card") {
      // No story, but a card to read: it stays until Continue, which ends
      // it (the player's `next()` of an empty story is its end).
      showCard("");
      deps.onChange?.();
    } else {
      render(player.current());
    }
  }

  /** A turn with no story: the station's name, its card and `words`, and
   *  Continue. */
  function showCard(words: string): void {
    releaseStep();
    dom.speaker.hidden = true;
    dom.speaker.textContent = "";
    dom.text.textContent = words;
    dom.continueButton.hidden = false;
  }

  /** The station's stories to tap, on a turn with no story. */
  function showPicker(picker: StoryPicker): void {
    pickerTurn = story;
    showCard("Choose a story");
    const buttons = picker.picks.map((pick) =>
      deps.createChoiceButton(storyPickLabel(pick), () => {
        playPicked(pick.story);
      }),
    );
    dom.choices.replaceChildren(...buttons);
    deps.onChange?.();
    const first = buttons[0];
    if (first !== undefined) deps.focusChoice?.(first);
  }

  /** The tapped story plays under the station's name, which stays. */
  function playPicked(picked: TourStory): void {
    if (story === null) return;
    clearStage();
    render(takeTurn(story.station, picked).current());
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
    if (ended !== null && ended.played !== null) {
      const back = choices.storyEnded(ended.station, ended.played.id);
      if (back !== null) {
        takeTurn(ended.station, null);
        showPicker(back);
        return;
      }
    }
    dom.panel.hidden = true;
    showDescription("");
    hideStationImage();
    if (ended !== null) {
      choices.forget(ended.station);
      deps.onStoryEnd(ended.station.id);
    }
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
      if (target.bubble) {
        deps.stage.toggleBubble?.();
        return true;
      }
      if (target.voice === undefined) return true;
      // The step's own sound or clip is out: the tap is taken (it hit
      // him) and plays nothing over it, nor stops it - its end is what a
      // lineEnd step waits for.
      if (videoStep || (lineVoice === "playing" && !voiceIsHis)) return true;
      if (lineVoice === "playing" && voiceHeld) {
        // Held by the channel, his voice is continued: an active tap wins.
        deps.audio.takeBack?.();
      } else if (lineVoice === "playing") {
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
      choices.forget({ id: stationId });
      deps.onStoryEnd(stationId);
    },
    stopAll() {
      queue.length = 0;
      story = null;
      choices.clear();
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
    choosing: () =>
      story !== null && story === pickerTurn ? story.station.id : null,
    progress() {
      const step = story?.player.current() ?? null;
      if (story === null || story.count === null || step === null) return null;
      const playable = story.children.filter(isPlayableInK4);
      return {
        index: playable.indexOf(step),
        count: story.count,
        autoMs:
          held || voiceHeld || !isTourStoryBlock(step) ? null : timerMs(step),
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
    holdVoice(hold) {
      if (hold === voiceHeld) return;
      voiceHeld = hold;
      cancelTimer?.();
      cancelTimer = null;
      if (voiceIsHis && lineVoice === "playing") {
        if (hold) deps.stage.setVoice?.("idle");
        else saySpeaking(deps.audio.leftMs?.() ?? null);
      }
      const step = story?.player.current() ?? null;
      if (!hold && step !== null) armTimer(step);
      deps.onChange?.();
    },
  };
}
