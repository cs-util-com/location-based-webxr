/**
 * A narrated long text's read-along timing, read only when its text opens
 * (the reading sheet, or the captions strip mounting) and judged against
 * the text the visitor sees. A missing entry, a structural fault, a track
 * that no longer fits the words (`tourTimingStaleReason`), or any other
 * throw is STALE: the text shows plain, with the voice where there is one,
 * and the visitor is told nothing - there is nothing they could do about
 * it. The reason goes to the console for the creator.
 *
 * @see narration-timing.ts.md
 */

import type { TourLongTextBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import {
  parseTourTimingText,
  TOUR_TIMING_MAX_BYTES,
  tourTimingStaleReason,
  type TourTiming,
} from "gps-plus-slam-app-framework/ar/tour-timing";

/**
 * What a text's read-along is now:
 * - `none`: the text declares no timing (no narration, or a voice only);
 * - `unread`: it declares one that was not asked for yet;
 * - `pending`: being read and checked;
 * - `live`: it fits the text;
 * - `stale`: it does not, or could not be read.
 */
export type NarrationVerdict = "none" | "unread" | "pending" | "live" | "stale";

export interface NarrationTimingsDeps {
  /** One archive entry as text under `maxBytes` (`loadEntryText`); the
   *  name is the manifest's (`timing/<id>.json`), the caller joins the
   *  archive's wrap. */
  readEntry(name: string, maxBytes: number): Promise<string>;
  /** Where a stale reason goes (the console by default). */
  warn?: (message: string) => void;
  /** A settled check (live or stale): a view that waited may redraw. */
  onSettled?(block: TourLongTextBlock): void;
}

export interface NarrationTimings {
  /** The verdict for `block` as it stands; never starts a read. */
  verdict(block: TourLongTextBlock): NarrationVerdict;
  /** Reads and checks `block`'s timing once (per id, body and entry):
   *  the timing when live, null otherwise. Never rejects. */
  load(block: TourLongTextBlock): Promise<TourTiming | null>;
}

interface Known {
  verdict: "pending" | "live" | "stale";
  readonly done: Promise<TourTiming | null>;
}

/** The judge of a tour's timings; one per open tour. */
export function createNarrationTimings(
  deps: NarrationTimingsDeps,
): NarrationTimings {
  const known = new Map<string, Known>();
  const warn =
    deps.warn ??
    ((message: string) => {
      console.warn(message);
    });

  const keyOf = (block: TourLongTextBlock, entry: string): string =>
    `${block.id}\u0000${entry}\u0000${block.body}`;

  async function check(
    block: TourLongTextBlock,
    entry: string,
  ): Promise<TourTiming> {
    const timing = parseTourTimingText(
      await deps.readEntry(entry, TOUR_TIMING_MAX_BYTES),
    );
    const plain = plainTextOf(parseTourMarkdown(block.body)).text;
    const durationMs = block.narration?.durationMs;
    const reason = tourTimingStaleReason(timing, {
      plainLength: plain.length,
      textHash: await textHashOf(plain),
      ...(durationMs === undefined ? {} : { durationMs }),
    });
    if (reason !== null) throw new Error(reason);
    return timing;
  }

  return {
    verdict(block) {
      const entry = block.narration?.timing;
      if (entry === undefined) return "none";
      return known.get(keyOf(block, entry))?.verdict ?? "unread";
    },
    load(block) {
      const entry = block.narration?.timing;
      if (entry === undefined) return Promise.resolve(null);
      const key = keyOf(block, entry);
      const have = known.get(key);
      if (have !== undefined) return have.done;
      let record: Known | null = null;
      const done = Promise.resolve()
        .then(() => check(block, entry))
        .then(
          (timing): TourTiming | null => {
            if (record !== null) record.verdict = "live";
            return timing;
          },
          (error: unknown): TourTiming | null => {
            if (record !== null) record.verdict = "stale";
            warn(
              `The read-along of "${block.id}" is off: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return null;
          },
        )
        .then((timing) => {
          try {
            deps.onSettled?.(block);
          } catch {
            // A view's redraw failing must not turn a verdict into a throw.
          }
          return timing;
        });
      record = { verdict: "pending", done };
      known.set(key, record);
      return done;
    },
  };
}
