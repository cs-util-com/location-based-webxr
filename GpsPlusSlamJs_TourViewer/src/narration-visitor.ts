/**
 * The visitor's narrated texts, for one open tour: each text's voice (one
 * shared player for its sheet and its captions strip, fetched on the
 * first play), its read-along (read when its text opens, judged by
 * `narration-timing.ts`), and what the sheet and the strip are given.
 * The page asks it per block; a new tour starts it afresh.
 *
 * @see narration-visitor.ts.md
 */

import type {
  TourBlock,
  TourLongTextBlock,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import type { CaptionsContent } from "./captions-strip.js";
import type { SheetNarration } from "./long-text-sheet.js";
import { plainSentences, type TextSpan } from "./long-text-sentences.js";
import {
  createNarrationPlayer,
  type NarrationPlayer,
  type NarrationPlayerDeps,
} from "./narration-player.js";
import {
  createNarrationTimings,
  type NarrationTimings,
  type NarrationVerdict,
} from "./narration-timing.js";

/** What the open tour gives: its entries and its assets. */
export interface NarratedTour {
  /** One archive entry as text (`TourSession.loadEntryText`). */
  loadEntryText(filename: string, maxBytes?: number): Promise<string>;
  /** The wrap folder the manifest's names are under. */
  readonly manifestWrap: string;
}

export interface NarrationVisitorDeps {
  /** The open tour, or null; a new object is a new tour. */
  tour(): NarratedTour | null;
  /** The tour's assets (`manifest.assets`). */
  assets():
    | readonly {
        readonly id: string;
        readonly path: string;
        readonly kind: string;
      }[]
    | undefined;
  /** An asset's file by its path (the stations' prefetch cache). */
  loadAsset(path: string): Promise<Blob>;
  /** A voice that could not be fetched (the page's error channel). */
  onError(message: string): void;
  /** Makes a player (a seam for tests). */
  makePlayer?: (deps: NarrationPlayerDeps) => NarrationPlayer;
  /** Where a stale read-along's reason goes (the console by default). */
  warn?: (message: string) => void;
}

export interface NarrationVisitor {
  /** A text's read-along verdict; undefined for a block that is not a
   *  long text. Never starts a read. */
  verdictOf(block: TourBlock): NarrationVerdict | undefined;
  /** Bumped whenever a read-along settles, so views drawn by a verdict
   *  can tell when to look again. */
  revision(): number;
  /** The sheet's narration for a text with a voice (its read-along read
   *  now), or undefined for a silent one. */
  sheetNarration(block: TourLongTextBlock): SheetNarration | undefined;
  /** The captions strip's content for a text whose read-along fits, or
   *  null - while it is read (the read starts here) or when it does not. */
  captions(block: TourLongTextBlock): CaptionsContent | null;
  /** Pauses every voice (the visitor left the station, or the AR ended). */
  pauseAll(): void;
  /** Lets every voice go (the tour closed). */
  reset(): void;
}

/** The path of an audio asset, or null when the tour has none by that
 *  id. */
export function audioAssetPath(
  assets: ReturnType<NarrationVisitorDeps["assets"]>,
  id: string,
): string | null {
  const found = assets?.find((a) => a.id === id && a.kind === "audio");
  return found?.path ?? null;
}

interface Plain {
  readonly body: string;
  readonly text: string;
  readonly sentences: readonly TextSpan[];
}

export function createNarrationVisitor(
  deps: NarrationVisitorDeps,
): NarrationVisitor {
  const makePlayer = deps.makePlayer ?? createNarrationPlayer;
  let tourSeen: NarratedTour | null = null;
  let timings: NarrationTimings | null = null;
  let revision = 0;
  const players = new Map<string, NarrationPlayer>();
  const live = new Map<string, TourTiming>();
  const plains = new Map<string, Plain>();

  /** The judge for the open tour; a new tour drops the old one's. */
  function judge(): NarrationTimings | null {
    const tour = deps.tour();
    if (tour !== tourSeen) {
      reset();
      tourSeen = tour;
      timings =
        tour === null
          ? null
          : createNarrationTimings({
              readEntry: (name, maxBytes) =>
                tour.loadEntryText(`${tour.manifestWrap}${name}`, maxBytes),
              onSettled: () => {
                revision += 1;
              },
              ...(deps.warn === undefined ? {} : { warn: deps.warn }),
            });
    }
    return timings;
  }

  const keyOf = (block: TourLongTextBlock): string =>
    `${block.id}\u0000${block.narration?.timing ?? ""}\u0000${block.body}`;

  function load(block: TourLongTextBlock): Promise<TourTiming | null> {
    const t = judge();
    if (t === null) return Promise.resolve(null);
    const key = keyOf(block);
    return t.load(block).then((timing) => {
      // Only the judge of the tour still open may fill the cache.
      if (timing !== null && t === timings) live.set(key, timing);
      return timing;
    });
  }

  function playerOf(block: TourLongTextBlock): NarrationPlayer | null {
    const narration = block.narration;
    if (narration === undefined) return null;
    judge();
    const key = `${block.id}\u0000${narration.audio}`;
    const have = players.get(key);
    if (have !== undefined) return have;
    const player = makePlayer({
      load: () => {
        const path = audioAssetPath(deps.assets(), narration.audio);
        if (path === null) {
          return Promise.reject(
            new Error(`no audio asset "${narration.audio}" in the tour`),
          );
        }
        return deps.loadAsset(path);
      },
      ...(narration.durationMs === undefined
        ? {}
        : { durationMs: narration.durationMs }),
      onError: (error) => {
        deps.onError(
          `The voice of "${block.title}" could not be played: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    });
    players.set(key, player);
    return player;
  }

  function plainOf(block: TourLongTextBlock): Plain {
    const have = plains.get(block.id);
    if (have?.body === block.body) return have;
    const plain = plainTextOf(parseTourMarkdown(block.body));
    const made = {
      body: block.body,
      text: plain.text,
      // The sheet's own cut (it is given no language either), so the
      // strip and the sheet follow the voice by the same sentences.
      sentences: plainSentences(plain.text, plain.leaves),
    };
    plains.set(block.id, made);
    return made;
  }

  function reset(): void {
    for (const player of players.values()) player.dispose();
    players.clear();
    live.clear();
    plains.clear();
    timings = null;
    tourSeen = null;
  }

  return {
    verdictOf(block) {
      if (block.kind !== "longText") return undefined;
      return judge()?.verdict(block) ?? "none";
    },
    revision: () => revision,
    sheetNarration(block) {
      const narration = block.narration;
      const player = playerOf(block);
      if (narration === undefined || player === null) return undefined;
      return {
        player,
        timing: load(block),
        synthetic: narration.synthetic,
        ...(narration.voiceCredit === undefined
          ? {}
          : { voiceCredit: narration.voiceCredit }),
      };
    },
    captions(block) {
      const narration = block.narration;
      const t = judge();
      if (narration?.timing === undefined || t === null) return null;
      const verdict = t.verdict(block);
      if (verdict === "unread") {
        void load(block);
        return null;
      }
      const timing = verdict === "live" ? live.get(keyOf(block)) : undefined;
      const player = playerOf(block);
      if (timing === undefined || player === null) return null;
      const plain = plainOf(block);
      return {
        key: block.id,
        title: block.title,
        plain: plain.text,
        sentences: plain.sentences,
        timing,
        player,
        synthetic: narration.synthetic,
        ...(narration.voiceCredit === undefined
          ? {}
          : { voiceCredit: narration.voiceCredit }),
      };
    },
    pauseAll() {
      for (const player of players.values()) {
        if (player.playing()) player.pause();
      }
    },
    reset,
  };
}
