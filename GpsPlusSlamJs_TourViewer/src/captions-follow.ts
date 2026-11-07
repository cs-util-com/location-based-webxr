/**
 * When the captions strip shows, and what: inside a station, the first
 * of its free long texts a visitor sees in the captions view, while its
 * read-along fits. Leaving the station pauses the voice, and coming back
 * carries it on. Called on every
 * camera frame.
 *
 * @see captions-follow.ts.md
 */

import type {
  TourBlock,
  TourLongTextBlock,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import type { CaptionsStrip } from "./captions-strip.js";
import type { NarrationVisitor } from "./narration-visitor.js";
import { shownView } from "./visitor-prefs.js";

/** The first long text of `blocks` a visitor sees in captions, or null. */
export function captionsBlock(
  blocks: readonly TourBlock[],
  stored: unknown,
  verdictOf: NarrationVisitor["verdictOf"],
): TourLongTextBlock | null {
  for (const block of blocks) {
    if (block.kind !== "longText") continue;
    const verdict = verdictOf(block);
    const view = shownView({
      audience: "visitor",
      block,
      stored,
      ...(verdict === undefined ? {} : { verdict }),
    });
    if (view === "captions") return block;
  }
  return null;
}

export interface CaptionsFollowDeps {
  readonly strip: Pick<CaptionsStrip, "show" | "hide">;
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
}

export interface CaptionsFollow {
  /** Shows, moves or hides the strip; cheap enough for every frame. */
  sync(): void;
  /** The AR session ended: the strip goes, the voice pauses. */
  stop(): void;
}

export function createCaptionsFollow(deps: CaptionsFollowDeps): CaptionsFollow {
  let presentSeen: string | null = null;
  return {
    sync() {
      const { blocks, presentId, stored } = deps.read();
      if (presentId !== presentSeen) {
        // A voice does not follow the visitor out of its station.
        if (presentSeen !== null) deps.narration.pauseAll(presentSeen);
        presentSeen = presentId;
        if (presentId !== null) deps.narration.carryOn(presentId);
      }
      const block = captionsBlock(blocks, stored, (b) =>
        deps.narration.verdictOf(b),
      );
      const content = block === null ? null : deps.narration.captions(block);
      if (content === null) deps.strip.hide();
      else deps.strip.show(content);
    },
    stop() {
      presentSeen = null;
      deps.strip.hide();
      deps.narration.pauseAll();
    },
  };
}
