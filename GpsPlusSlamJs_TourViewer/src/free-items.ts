/**
 * The free items' host: what a station shows that no story brings. It is the
 * second host of `showItemCard` (`scene-view.ts` is the story's), and it stands
 * a station's free characters as figures: from arrival, on every return,
 * several in one station, each on a stage of his own. A tap plays his voice in
 * the visitor's one voice channel (`voice-focus.ts`); walking away pauses it
 * and his return carries on. A free video has no look yet, so nothing is built
 * for one here (`content-placement.ts` holds its seam).
 *
 * Never a story: a station with only free items stays stepless, and this host
 * reports no step, no end and no status line. A failure the visitor must hear
 * of goes to `sayFailure`.
 *
 * @see free-items.ts.md
 */

import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import type {
  TourAsset,
  TourBlock,
  TourCharacterBlock,
  TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import type { SelectTargetRay } from "gps-plus-slam-app-framework/ar";
import type { Object3D } from "three";

import type { CharacterVoice } from "./character-look.js";
import {
  showItemCard,
  type ItemCardHost,
  type ItemTapTarget,
  type ItemVideo,
  type ItemWorld,
} from "./item-card.js";
import {
  createNarrationPlayer,
  type NarrationPlayer,
  type NarrationPlayerDeps,
} from "./narration-player.js";
import type { SceneStage } from "./scene-stage.js";
import {
  focusedPlayer,
  type FocusedPlayer,
  type VoiceFocus,
} from "./voice-focus.js";

/** What this host uses of a stage (one per figure: a stage holds one). */
type FreeStage = Pick<
  SceneStage,
  | "showCharacter"
  | "setVoice"
  | "release"
  | "clear"
  | "characterTapTargets"
  | "toggleBubble"
  | "faceVisitor"
  | "follow"
>;

export interface FreeItemsDeps {
  /** The open tour; a new object is a new tour. */
  tour(): Pick<TourManifest, "stations"> | null;
  /** The tour's declared characters by id. */
  characters(): ReadonlyMap<string, TourCharacter>;
  /** The tour's assets by id. */
  assets(): ReadonlyMap<string, TourAsset>;
  /** An asset's file by its path (the stations' prefetch cache). */
  loadAsset(path: string): Promise<Blob>;
  makeStage(): FreeStage;
  readonly focus: VoiceFocus;
  /** Why a picture may not be shown, or null. */
  checkPicture(blob: Blob): Promise<string | null>;
  /** The part of `targets` a tap reaches, by its key, or null. */
  pick(
    targets: ReadonlyMap<string, Object3D>,
    tap: SelectTargetRay | null,
  ): string | null;
  /** A failure the visitor must hear of (no panel shows here). */
  sayFailure(text: string): void;
  /** Makes a player (a seam for tests). */
  makePlayer?: (deps: NarrationPlayerDeps) => NarrationPlayer;
  /** Shows an item's card (the item lab swaps a kind in; `showItemCard`
   *  otherwise). */
  showItem?(block: TourBlock, host: ItemCardHost): void;
}

export interface FreeItems {
  /** Which stations' content shows now: their figures stand, the others'
   *  go. Every tick. */
  follow(isShown: (stationId: string) => boolean): void;
  /** Turn standing figures towards the visitor (NUE). */
  faceVisitor(visitorNue: readonly [number, number, number]): void;
  /** A visitor's tap in AR: true when it hit a free figure. */
  tapped(tap: SelectTargetRay | null): boolean;
  /** The AR session ended or the tour closed: nothing stands, no voice is
   *  kept. */
  stop(): void;
}

interface Figure {
  readonly stationId: string;
  readonly block: TourCharacterBlock;
  stage: FreeStage | null;
  player: FocusedPlayer | null;
  /** He stands in his station (or is being stood). */
  standing: boolean;
  /** Bumped when he goes: a file landing later is dropped. */
  run: number;
  target: ItemTapTarget | null;
  /** His voice was wanted when the visitor left, so it carries on at return:
   *  0 for not, else the leaving's place in line, so the voice heard last has
   *  the highest. */
  left: number;
  /** What the stage was last told of his voice. */
  voice: CharacterVoice;
  /** The stage was told the voice's length. */
  timed: boolean;
}

const NO_CLIP = {
  started: () => undefined,
  ended: () => undefined,
  lost: () => undefined,
};

/** The card this host has no use for: a figure's words stand with him, so
 *  these places are written and never read. */
function offCard(): ItemCardHost["slots"] {
  return {
    text: { textContent: "" },
    speaker: { textContent: "", hidden: true },
    image: { src: "", alt: "", hidden: true },
    // Only a video writes here, and this host never shows one.
    video: {} as ItemVideo,
  };
}

export function createFreeItems(deps: FreeItemsDeps): FreeItems {
  const makePlayer = deps.makePlayer ?? createNarrationPlayer;
  /** The tour `figures` were read from; undefined before the first look. */
  let seen: ReturnType<FreeItemsDeps["tour"]> | undefined;
  let figures: readonly Figure[] = [];
  /** How many voices were left so far: orders `Figure.left`. */
  let leavings = 0;

  function figuresOf(tour: Pick<TourManifest, "stations"> | null): Figure[] {
    return (tour?.stations ?? []).flatMap((station) =>
      tourFreeBlocks(station).flatMap((block) =>
        block.kind === "character"
          ? [
              {
                stationId: station.id,
                block,
                stage: null,
                player: null,
                standing: false,
                run: 0,
                target: null,
                left: 0,
                voice: "idle" as const,
                timed: false,
              },
            ]
          : [],
      ),
    );
  }

  function stop(): void {
    for (const figure of figures) {
      figure.run += 1;
      figure.stage?.clear();
      figure.player?.dispose();
    }
    figures = [];
    seen = undefined;
  }

  /** The figures of the open tour; another tour lets the old ones go. */
  function sync(): void {
    const tour = deps.tour();
    if (tour === seen) return;
    stop();
    seen = tour;
    figures = figuresOf(tour);
  }

  function tell(figure: Figure, voice: CharacterVoice, ms?: number): void {
    figure.voice = voice;
    figure.stage?.setVoice(voice, ms);
  }

  /** His look follows his voice: speaking with what is left of it (the look
   *  times its words by that), heard once it ran out. */
  function voiceChanged(figure: Figure): void {
    const { player } = figure;
    if (player === null) return;
    if (!player.playing()) {
      if (figure.voice !== "speaking") return;
      figure.timed = false;
      // A voice that never started was not heard; one held carries on.
      const heard = !player.wanted() && player.nowMs() > 0;
      tell(figure, heard ? "spoken" : "idle");
      return;
    }
    const leftMs = player.durationMs() - player.nowMs();
    if (figure.voice === "speaking" && (figure.timed || leftMs <= 0)) return;
    figure.timed = leftMs > 0;
    if (figure.timed) tell(figure, "speaking", leftMs);
    else tell(figure, "speaking");
  }

  function playerOf(figure: Figure, voiceId: string): FocusedPlayer {
    if (figure.player !== null) return figure.player;
    const inner = makePlayer({
      load: () => {
        const asset = deps.assets().get(voiceId);
        return asset === undefined
          ? Promise.reject(new Error(`no voice "${voiceId}" in the tour`))
          : deps.loadAsset(asset.path);
      },
      onError: () => {
        tell(figure, "idle");
        deps.sayFailure("The voice could not be played here.");
      },
    });
    const player = focusedPlayer(inner, deps.focus);
    figure.player = player;
    inner.onChange(() => {
      voiceChanged(figure);
    });
    return player;
  }

  function hostOf(figure: Figure, stage: FreeStage): ItemCardHost {
    const { run } = figure;
    // Only a figure's door: a model never stands free here.
    const world: ItemWorld = {
      showCharacter: (stationId, blob, _onWaiting, look) =>
        stage.showCharacter(
          stationId,
          blob,
          undefined,
          // His line has no card to sit in here.
          look === undefined ? undefined : { ...look, noCard: true },
        ),
    };
    const showing = (): boolean => run === figure.run;
    return {
      slots: offCard(),
      characters: deps.characters(),
      checkPicture: (blob) => deps.checkPicture(blob),
      asset(id, _what, use, onFail) {
        const failed = (): void => {
          if (!showing()) return;
          if (onFail !== undefined) onFail();
          else deps.sayFailure(`${figure.block.name} could not be shown here.`);
        };
        const asset = deps.assets().get(id);
        if (asset === undefined) {
          failed();
          return;
        }
        deps
          .loadAsset(asset.path)
          .then(async (blob) => {
            if (showing()) await use(blob);
          })
          .catch(failed);
      },
      // Neither is reached: no card place here shows a file, and a free
      // character's voice plays on a tap, not with a step.
      url: () => "",
      sound: () => undefined,
      stage: {
        // Nothing waits here for the visitor's position: no line says so.
        stand: (_what, draw) => draw(world, { stationId: figure.stationId }),
        tapTarget(target) {
          figure.target = target;
        },
      },
      clip: () => NO_CLIP,
      showing,
      notice: () => undefined,
      debugLine: () => undefined,
    };
  }

  function stand(figure: Figure): void {
    if (figure.stage === null) return;
    figure.standing = true;
    (deps.showItem ?? showItemCard)(figure.block, hostOf(figure, figure.stage));
  }

  function leave(figure: Figure): void {
    figure.standing = false;
    figure.run += 1;
    figure.target = null;
    tell(figure, "idle");
    if (figure.player?.wanted() === true) {
      leavings += 1;
      figure.left = leavings;
      figure.player.pause();
    }
    figure.stage?.release();
  }

  /** The voices left among `here`: the one heard last plays, the next
   *  waits behind it. */
  function carryOn(here: readonly Figure[]): void {
    const voices = here.filter((figure) => figure.left > 0);
    voices.sort((a, b) => b.left - a.left);
    for (const figure of voices) {
      figure.left = 0;
      figure.player?.carryOn();
    }
  }

  /** The held first: pausing the one heard wakes what it holds. */
  const heardLast = (a: Figure, b: Figure): number =>
    Number(a.player?.playing() === true) - Number(b.player?.playing() === true);

  return {
    follow(isShown) {
      sync();
      for (const figure of figures) {
        if (figure.stage === null && isShown(figure.stationId)) {
          figure.stage = deps.makeStage();
        }
        figure.stage?.follow(isShown);
      }
      // The leaves come first: a voice coming back finds the sound free.
      const going = figures.filter(
        (figure) => figure.standing && !isShown(figure.stationId),
      );
      going.sort(heardLast).forEach(leave);
      // One a tick: several together would be one long task.
      const next = figures.find(
        (figure) => !figure.standing && isShown(figure.stationId),
      );
      if (next !== undefined) stand(next);
      carryOn(figures.filter((figure) => isShown(figure.stationId)));
    },
    faceVisitor(visitor) {
      for (const figure of figures) figure.stage?.faceVisitor(visitor);
    },
    tapped(tap) {
      const owners = new Map<string, Figure>();
      const targets = new Map<string, Object3D>();
      figures.forEach((figure, f) => {
        if (!figure.standing) return;
        figure.stage?.characterTapTargets().forEach((part, p) => {
          const key = `free-${String(f)}-${String(p)}`;
          owners.set(key, figure);
          targets.set(key, part);
        });
      });
      if (targets.size === 0) return false;
      const hit = deps.pick(targets, tap);
      const figure = hit === null ? undefined : owners.get(hit);
      if (figure === undefined) return false;
      const { target } = figure;
      if (target?.bubble === true) {
        figure.stage?.toggleBubble();
      } else if (target?.voice !== undefined) {
        const player = playerOf(figure, target.voice);
        if (player.playing()) {
          tell(figure, "idle");
          player.stop();
        } else {
          player.play();
        }
      }
      return true;
    },
    stop,
  };
}
