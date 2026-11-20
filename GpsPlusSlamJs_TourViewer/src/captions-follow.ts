/**
 * When a narrated text's words show, where, and what: inside a station,
 * the first of its free long texts whose read-along fits, at the bottom
 * (the narration box) or travelling from its reading sign
 * (`travelling-box.ts`), as the visitor's pick or else the creator's
 * choice says. Never outside a station, whatever blocks it is given.
 * Leaving the station pauses the voice, and coming back carries it on.
 * Each fitting narrated sign gets its voice chip. Called on every camera
 * frame.
 *
 * @see captions-follow.ts.md
 */

import type {
  TourBlock,
  TourLongTextBlock,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import type { NarrationBox } from "./narration-box.js";
import type { NarrationClock } from "./narration-player.js";
import type { NarrationVisitor } from "./narration-visitor.js";
import type { ReadingSignHandle, ReadingSignVoice } from "./reading-sign.js";
import { preferredView, shownView, viewNeedsFail } from "./visitor-prefs.js";

/** Where a narrated text's words show: at the bottom, or travelling
 *  from its sign. */
type NarratedMode = "box" | "travel";

export interface NarratedShown {
  readonly block: TourLongTextBlock;
  readonly mode: NarratedMode;
}

/** Whether `block` has a read-along that fits (a timing declared and not
 *  found stale): the captions view's own needs. */
function readsAlong(
  block: TourBlock,
  verdict: ReturnType<NarrationVisitor["verdictOf"]>,
): block is TourLongTextBlock {
  return (
    block.kind === "longText" &&
    block.narration?.timing !== undefined &&
    viewNeedsFail(block, "captions", verdict) === null
  );
}

/**
 * The first long text of `blocks` whose read-along fits and whose words
 * show, with where: shown in captions, the box; shown as a reading sign,
 * the travel when the visitor picked Reading, or when the creator chose
 * the sign (`narration.words`) and the visitor picked nothing or a view
 * the text cannot meet (a lectern for a text with pictures: the creator's
 * view shows, so the creator's choice holds), else the box. A text shown
 * at a lectern shows its words itself and is passed over. Null: none.
 */
export function narratedShown(
  blocks: readonly TourBlock[],
  stored: unknown,
  verdictOf: NarrationVisitor["verdictOf"],
): NarratedShown | null {
  const picked = preferredView(stored, "longText", "world");
  for (const block of blocks) {
    const verdict = verdictOf(block);
    if (!readsAlong(block, verdict)) continue;
    const view = shownView({
      audience: "visitor",
      block,
      stored,
      ...(verdict === undefined ? {} : { verdict }),
    });
    if (view === "captions") return { block, mode: "box" };
    if (view !== "reading") continue;
    // A Captions pick never gets here for a text that reads along, so a
    // pick other than Reading is none or one the text cannot meet.
    const travel = picked === "reading" || block.narration?.words === "sign";
    return { block, mode: travel ? "travel" : "box" };
  }
  return null;
}

/** A sign's voice chip: playing as the page's store says, else the end
 *  or a pause from where the voice stands (a length not known yet is no
 *  end), else idle. */
export function chipOf(
  voice: Pick<NarrationClock, "nowMs" | "durationMs">,
  playing: boolean,
): ReadingSignVoice {
  if (playing) return "playing";
  const at = voice.nowMs();
  const total = voice.durationMs();
  if (total > 0 && at >= total) return "ended";
  return at > 0 ? "paused" : "idle";
}

/** What the page needs to start a text's travel from its sign. */
export interface TravelStart {
  /** The text's block id. */
  readonly id: string;
  readonly sign: ReadingSignHandle;
  readonly travelling: () => boolean;
  /** The text's words are shown (its voice is there to follow). */
  readonly voice: () => boolean;
  readonly inStation: () => boolean;
  readonly sheetOpen: () => boolean;
}

export interface CaptionsFollowDeps {
  readonly box: Pick<NarrationBox, "show" | "hide">;
  readonly narration: Pick<
    NarrationVisitor,
    "verdictOf" | "captions" | "pauseAll" | "carryOn"
  >;
  /** The present station's placed free blocks (none outside a station),
   *  its id, and the stored preference. */
  read(): {
    readonly blocks: readonly TourBlock[];
    readonly presentId: string | null;
    readonly stored: unknown;
  };
  /** Starts the travel of a text's words from its sign, or null where the
   *  page cannot (no scene or camera yet): the words then show at the
   *  bottom. */
  travel(start: TravelStart): { stop(): void } | null;
  /** The mounted reading sign of the text `blockId`, or null. */
  signOf(blockId: string): ReadingSignHandle | null;
  /** The reading sheet is open. */
  sheetOpen(): boolean;
  /** The page's store says the shown text `key`'s voice plays. */
  playing(key: string): boolean;
}

export interface CaptionsFollow {
  /** Shows, moves or hides the words; cheap enough for every frame. */
  sync(): void;
  /** The AR session ended: the words go, the voice pauses. */
  stop(): void;
}

export function createCaptionsFollow(deps: CaptionsFollowDeps): CaptionsFollow {
  let presentSeen: string | null = null;
  let content: ReturnType<NarrationVisitor["captions"]> = null;
  let travel: {
    readonly id: string;
    readonly sign: ReadingSignHandle;
    readonly run: { stop(): void };
  } | null = null;
  /** The sign last given its shown text's chip, and that text's voice. */
  let chipped: {
    readonly id: string;
    readonly sign: ReadingSignHandle;
    readonly voice: Pick<NarrationClock, "nowMs" | "durationMs">;
  } | null = null;

  function stopTravel(): void {
    const running = travel;
    travel = null;
    running?.run.stop();
  }

  /** One travel for the text `id` from `sign` (null: none). */
  function steer(id: string | null, sign: ReadingSignHandle | null): void {
    if (travel !== null && (travel.id !== id || travel.sign !== sign)) {
      stopTravel();
    }
    if (travel !== null || id === null || sign === null) return;
    const run = deps.travel({
      id,
      sign,
      travelling: () => travel !== null,
      voice: () => content !== null,
      inStation: () => presentSeen !== null,
      sheetOpen: () => deps.sheetOpen(),
    });
    if (run !== null) travel = { id, sign, run };
  }

  /** Every fitting narrated sign's chip: the shown text's follows its
   *  voice, the others are idle. A sign whose text stops being the shown
   *  one (the visitor left, or another text shows) says where its voice
   *  stopped, wherever it still stands; a sign gone is left alone. */
  function chips(blocks: readonly TourBlock[], shown: TourBlock | null): void {
    const sign =
      shown === null || content === null ? null : deps.signOf(shown.id);
    if (
      chipped !== null &&
      chipped.sign !== sign &&
      deps.signOf(chipped.id) === chipped.sign
    ) {
      chipped.sign.setVoiceState(chipOf(chipped.voice, false));
    }
    chipped =
      shown === null || sign === null || content === null
        ? null
        : { id: shown.id, sign, voice: content.player };
    for (const block of blocks) {
      if (!readsAlong(block, deps.narration.verdictOf(block))) continue;
      const sign = deps.signOf(block.id);
      if (sign === null) continue;
      sign.setVoiceState(
        block === shown && content !== null
          ? chipOf(content.player, deps.playing(block.id))
          : "idle",
      );
    }
  }

  /** A voice does not follow the visitor out of its station. */
  function arrive(presentId: string | null): void {
    if (presentId === presentSeen) return;
    if (presentSeen !== null) deps.narration.pauseAll(presentSeen);
    presentSeen = presentId;
    if (presentId !== null) deps.narration.carryOn(presentId);
  }

  /** The box: hidden without words or under an open sheet; the ghost
   *  while travelling (a travel hides by its own rules). */
  function place(): void {
    if (content === null || (travel === null && deps.sheetOpen())) {
      deps.box.hide();
    } else deps.box.show(content, travel === null ? "natural" : "travel");
  }

  return {
    sync() {
      const { blocks, presentId, stored } = deps.read();
      arrive(presentId);
      // The station's radius is the voice's: no station, no words.
      const shown =
        presentId === null
          ? null
          : narratedShown(blocks, stored, (b) => deps.narration.verdictOf(b));
      content = shown === null ? null : deps.narration.captions(shown.block);
      const travelId =
        shown?.mode === "travel" && content !== null ? shown.block.id : null;
      steer(travelId, travelId === null ? null : deps.signOf(travelId));
      place();
      chips(blocks, shown?.block ?? null);
    },
    stop() {
      presentSeen = null;
      content = null;
      chipped = null;
      stopTravel();
      deps.box.hide();
      deps.narration.pauseAll();
    },
  };
}
