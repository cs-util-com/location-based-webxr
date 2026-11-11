/**
 * The asset shelf's runner: the queue of optimization jobs for one open
 * tour, and the commands the shelf's panel calls (retry, use the
 * original, remove with undo, optimize this tour). Its plain data is the
 * `assetShelf` slice (`asset-shelf-slice.ts`); the Blobs - an original
 * kept for "use the original" - stay here. Jobs run first in, first out,
 * `slots` at a time; each result is judged (not at least 10 % smaller
 * keeps the original, still over the entry or pixel cap fails with words)
 * and a
 * good one goes through the session's swap, which re-checks it against
 * the document. A save never waits for a job.
 *
 * @see asset-shelf.ts.md
 */

import type { UnknownAction } from "@reduxjs/toolkit";
import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { DEFAULT_ARCHIVE_LIMITS } from "gps-plus-slam-app-framework/storage";

import type { TourDocumentState } from "../../tour-document.js";
import {
  OptimizerCrashed,
  type OptimizeOutcome,
  type OptimizerHost,
  type OptimizerTable,
} from "./asset-optimizers.js";
import {
  assetShelfActions as act,
  selectShelfRows,
  type AssetShelfState,
  type ShelfEntry,
} from "./asset-shelf-slice.js";
import {
  OPTIMIZER_SETTINGS,
  OPTIMIZER_SLOTS,
  type OptimizerSettings,
} from "./optimizer-settings.js";

/** Why a file stays as it came in, and why one failed: the shelf's words. */
export const NO_OPTIMIZER =
  "This kind of file cannot be made smaller yet; it is used as it is.";
export const NOT_SMALLER =
  "Kept as it was: a smaller version would save less than a tenth.";
/** The original fits, but what the optimizer made from it would not: it
 *  is kept, and the words say the result was too large, not too little
 *  smaller. */
export const RESULT_TOO_LARGE =
  "Kept as it was: the version made from it came out larger than a tour takes.";
const ORIGINAL_USED = "The original is used, as you asked.";
const UNREADABLE = "Its bytes could not be read to make it smaller.";
const TOO_LARGE =
  "Still too large to stay in the tour, and it could not be made small enough. Use a smaller file, or remove it.";

/** The new file's record as the session's swap takes it. */
interface ShelfSwap {
  readonly blob: Blob;
  readonly path: string;
  readonly width?: number;
  readonly height?: number;
  /** "Use the original": the creator's choice, remembered by the draft. */
  readonly originalChosen?: true;
}

/** An original a smaller file replaced: its record, and its bytes, read
 *  when "use the original" asks for them. */
interface HeldOriginal {
  readonly asset: TourAsset;
  readonly load: () => Promise<Blob | undefined>;
}

export interface AssetShelfDeps {
  readonly store: {
    dispatch(action: UnknownAction): unknown;
    getState(): {
      readonly assetShelf: AssetShelfState;
      readonly tourDocument: TourDocumentState;
    };
    /** After every action: an original no longer offered is let go. */
    subscribe(listener: () => void): () => void;
  };
  readonly optimizers: OptimizerTable;
  readonly host: OptimizerHost;
  readonly settings?: OptimizerSettings;
  /** Jobs at once (default: a phone's, `OPTIMIZER_SLOTS`). */
  readonly slots?: number;
  /** The asset's bytes as the tour holds them now. */
  readonly bytesOf: (id: string) => Promise<Blob | undefined>;
  /** The asset's record as the tour holds it now. */
  readonly recordOf: (id: string) => TourAsset | undefined;
  /** The session's swap (`EditorSession.swapAsset`). */
  readonly swap: (
    id: string,
    file: ShelfSwap,
  ) => Promise<
    | { readonly kind: "swapped" }
    | { readonly kind: "refused"; readonly reason: string }
  >;
  /** The largest file a save writes (default: the archive's entry cap). */
  readonly maxFileBytes?: number;
}

export interface AssetShelf {
  /** A file on the shelf: one brought in is queued at once (kept, with
   *  words, when its kind has no optimizer); an opened tour's waits for
   *  `optimizeTour`. A second add of an id is no change. */
  add(
    asset: TourAsset,
    name: string,
    bytes: number,
    origin: ShelfEntry["origin"],
  ): void;
  /** A reload put back a smaller file the draft kept: on the shelf as
   *  optimized, no job run for it, its original offered when `original`
   *  can read its bytes. */
  restored(
    asset: TourAsset,
    name: string,
    sizes: { readonly originalBytes: number; readonly optimizedBytes: number },
    original?: HeldOriginal,
  ): void;
  /** A reload put back a file brought in whose original the creator
   *  chose ("use the original"): on the shelf as that choice left it -
   *  kept, and retryable - never queued by itself. A second add of an id is no change. */
  originalKept(asset: TourAsset, name: string, bytes: number): void;
  /** Retry a retryable end; false when there is none. */
  retry(id: string): boolean;
  /** Put the original back in place of the smaller file; false when it
   *  is not offered (`ShelfRow.canUseOriginal`) or the swap was refused. */
  useOriginal(id: string): Promise<boolean>;
  /** The file leaves the shelf, its job stopped and its original no longer
   *  kept by the shelf; the returned undo puts it back (queued again when
   *  it was waiting or running), with that original - held by the undo
   *  alone, so dropping the undo lets it go. Null for an id the shelf does
   *  not hold. */
  remove(id: string): (() => void) | null;
  /** Whether the shelf keeps the original of `id` ("use the original"):
   *  bytes that may be large. */
  holdsOriginal(id: string): boolean;
  /** "Optimize this tour": every opened tour's file still idle is queued;
   *  how many were. */
  optimizeTour(): number;
  /** Every job stopped, the host too; the shelf takes nothing more. */
  close(): void;
}

export function createAssetShelf(deps: AssetShelfDeps): AssetShelf {
  const { store, optimizers, host } = deps;
  const settings = deps.settings ?? OPTIMIZER_SETTINGS;
  const slots = Math.max(1, deps.slots ?? OPTIMIZER_SLOTS.phone);
  const maxBytes = deps.maxFileBytes ?? DEFAULT_ARCHIVE_LIMITS.maxEntryBytes;
  const running = new Map<string, AbortController>();
  /** The originals a smaller file replaced, while they are offered. */
  const originals = new Map<string, HeldOriginal>();
  let closed = false;

  const entries = () => store.getState().assetShelf.entries;
  const dispatch = (action: UnknownAction) => {
    if (!closed) store.dispatch(action);
  };

  /** Each original no longer offered - a save wrote the smaller file's
   *  bytes, or the job left "optimized" - is let go: it may be large. One
   *  whose entry left the shelf went with it (`remove`). */
  function freeOriginals(): void {
    if (closed || originals.size === 0) return;
    for (const row of selectShelfRows(store.getState())) {
      if (!originals.has(row.id) || row.canUseOriginal) continue;
      originals.delete(row.id);
      dispatch(act.originalFreed({ id: row.id }));
    }
  }
  const unsubscribe = store.subscribe(freeOriginals);

  function pump(): void {
    if (closed) return;
    const waiting = Object.values(entries())
      .filter((e) => e.phase === "queued" && !running.has(e.id))
      .sort((a, b) => a.seq - b.seq);
    for (const entry of waiting) {
      if (running.size >= slots) return;
      void run(entry);
    }
  }

  /** Whether job `stop` still owns entry `id`'s run. */
  const owns = (id: string, stop: AbortController) =>
    !closed && running.get(id) === stop && !stop.signal.aborted;

  async function run(entry: ShelfEntry): Promise<void> {
    const { id } = entry;
    const optimizer = optimizers[entry.kind];
    const stop = new AbortController();
    running.set(id, stop);
    dispatch(act.jobStarted({ id }));
    try {
      if (optimizer === null) {
        dispatch(act.jobKept({ id, reason: NO_OPTIMIZER }));
        return;
      }
      const source = await deps.bytesOf(id);
      const before = deps.recordOf(id);
      if (!owns(id, stop)) return;
      if (source === undefined || before === undefined) {
        dispatch(act.jobFailed({ id, reason: UNREADABLE, retryable: true }));
        return;
      }
      const outcome = await optimizer.optimize(source, {
        signal: stop.signal,
        progress: (fraction) => {
          if (owns(id, stop)) dispatch(act.jobProgress({ id, fraction }));
        },
        settings,
        host,
      });
      if (!owns(id, stop)) return;
      await land(id, source, before, outcome, stop);
    } catch (err) {
      if (!owns(id, stop)) return;
      const crashed = err instanceof OptimizerCrashed;
      const words = err instanceof Error ? err.message : String(err);
      dispatch(
        act.jobFailed({
          id,
          reason: `It could not be made smaller: ${words}`,
          retryable: true,
          crashed,
        }),
      );
    } finally {
      if (running.get(id) === stop) running.delete(id);
      pump();
    }
  }

  async function land(
    id: string,
    source: Blob,
    before: TourAsset,
    outcome: OptimizeOutcome,
    stop: AbortController,
  ): Promise<void> {
    // The caps a save checks (bytes per entry, a picture's pixels): a file
    // over either blocks every save, so the shelf must never land one. One
    // known side counts as a square of it (the other is unknown, not
    // none); a file with neither side is no picture and has no pixel cap.
    const fits = (bytes: number, width?: number, height?: number) =>
      bytes <= maxBytes &&
      (width ?? height ?? 0) * (height ?? width ?? 0) <= TOUR_MAX_IMAGE_PIXELS;
    const overCap = !fits(source.size, before.width, before.height);
    if (outcome.kind === "kept") {
      if (overCap) {
        dispatch(act.jobFailed({ id, reason: TOO_LARGE, retryable: false }));
      } else {
        dispatch(act.jobKept({ id, reason: outcome.reason }));
      }
      return;
    }
    // A result keeps the original's size when it declares none.
    const width = outcome.width ?? before.width;
    const height = outcome.height ?? before.height;
    if (!fits(outcome.blob.size, width, height)) {
      // An original that fits stays; only one that does not is a failure.
      if (overCap) {
        dispatch(act.jobFailed({ id, reason: TOO_LARGE, retryable: false }));
      } else {
        dispatch(act.jobKept({ id, reason: RESULT_TOO_LARGE }));
      }
      return;
    }
    if (!overCap && outcome.blob.size > source.size * settings.keepAbove) {
      dispatch(act.jobKept({ id, reason: NOT_SMALLER }));
      return;
    }
    const swapped = await deps.swap(id, {
      blob: outcome.blob,
      path: `content/${id}.${outcome.extension}`,
      ...(outcome.width === undefined ? {} : { width: outcome.width }),
      ...(outcome.height === undefined ? {} : { height: outcome.height }),
    });
    if (!owns(id, stop)) return;
    if (swapped.kind === "refused") {
      dispatch(act.jobFailed({ id, reason: swapped.reason, retryable: true }));
      return;
    }
    originals.set(id, { asset: before, load: () => Promise.resolve(source) });
    dispatch(
      act.jobOptimized({
        id,
        optimizedBytes: outcome.blob.size,
        originalHeld: true,
      }),
    );
  }

  function stopJob(id: string): void {
    const stop = running.get(id);
    if (stop === undefined) return;
    running.delete(id);
    stop.abort();
  }

  return {
    add(asset, name, bytes, origin) {
      if (closed) return;
      const optimizable = optimizers[asset.kind] !== null;
      dispatch(
        act.entryAdded({
          id: asset.id,
          kind: asset.kind,
          name,
          origin,
          originalBytes: bytes,
          queued: optimizable && origin === "added",
          ...(optimizable ? {} : { keptReason: NO_OPTIMIZER }),
        }),
      );
      pump();
    },
    originalKept(asset, name, bytes) {
      if (closed) return;
      dispatch(
        act.entryAdded({
          id: asset.id,
          kind: asset.kind,
          name,
          origin: "added",
          originalBytes: bytes,
          queued: false,
          keptReason: ORIGINAL_USED,
          keptRetryable: true,
        }),
      );
    },
    restored(asset, name, sizes, original) {
      if (closed) return;
      stopJob(asset.id);
      if (original === undefined) originals.delete(asset.id);
      else originals.set(asset.id, original);
      dispatch(
        act.optimizedRestored({
          id: asset.id,
          kind: asset.kind,
          name,
          ...sizes,
          originalHeld: original !== undefined,
        }),
      );
      pump();
    },
    retry(id) {
      if (closed) return false;
      const before = entries()[id];
      dispatch(act.jobRetried({ id }));
      if (entries()[id] === before) return false;
      pump();
      return true;
    },
    async useOriginal(id) {
      const original = originals.get(id);
      const offered = selectShelfRows(store.getState()).find(
        (r) => r.id === id,
      )?.canUseOriginal;
      if (closed || original === undefined || offered !== true) return false;
      const { asset } = original;
      const blob = await original.load().catch(() => undefined);
      if (blob === undefined || closed || originals.get(id) !== original) {
        return false;
      }
      const swapped = await deps.swap(id, {
        blob,
        path: asset.path,
        ...(asset.width === undefined ? {} : { width: asset.width }),
        ...(asset.height === undefined ? {} : { height: asset.height }),
        originalChosen: true,
      });
      if (swapped.kind === "refused" || closed) return false;
      originals.delete(id);
      dispatch(act.originalUsed({ id, reason: ORIGINAL_USED }));
      return true;
    },
    remove(id) {
      const entry = entries()[id];
      if (closed || entry === undefined) return null;
      stopJob(id);
      // The undo alone keeps it: an original may be large, and a removal
      // nobody takes back must not hold it until the tour closes.
      let held = originals.get(id);
      originals.delete(id);
      dispatch(act.entryRemoved({ id }));
      pump();
      return () => {
        if (closed || entries()[id] !== undefined) return;
        const waiting = entry.phase === "queued" || entry.phase === "running";
        if (held !== undefined) originals.set(id, held);
        held = undefined;
        dispatch(
          act.entryRestored({
            entry: waiting
              ? { ...entry, phase: "queued", progress: 0, attempts: 0 }
              : entry,
          }),
        );
        pump();
      };
    },
    holdsOriginal: (id) => originals.has(id),
    optimizeTour() {
      if (closed) return 0;
      let queued = 0;
      for (const entry of Object.values(entries())) {
        if (entry.origin !== "opened" || entry.phase !== "idle") continue;
        if (optimizers[entry.kind] === null) continue;
        dispatch(act.jobQueued({ id: entry.id }));
        queued++;
      }
      pump();
      return queued;
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const id of [...running.keys()]) stopJob(id);
      originals.clear();
      host.close();
    },
  };
}
