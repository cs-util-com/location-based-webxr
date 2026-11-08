/**
 * The asset shelf's plain data (`assetShelf`): one entry per file on the
 * shelf - its kind, name and sizes, where it came from, and its job
 * (`asset-jobs.ts`) - and the selector the shelf's panel reads
 * (`selectShelfRows`), which adds what the tour document knows: the places
 * that use the file, its queue position, how often a preview must reload
 * it (`assetSwaps`) and whether "use the original" can be offered. Blobs
 * are never state: the runner (`asset-shelf.ts`) keeps them, and its
 * commands (retry, use the original, remove with undo, optimize this
 * tour) live there, outside the selector.
 *
 * @see asset-shelf-slice.ts.md
 */

import {
  createSelector,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { assetUsesOf, type TourDocumentState } from "../../tour-document.js";
import {
  IDLE_JOB,
  jobFailed,
  jobKept,
  jobOptimized,
  jobProgress,
  jobQueued,
  jobRetried,
  jobStarted,
  originalUsed,
  type ShelfJob,
  type ShelfPhase,
} from "./asset-jobs.js";

/** One file on the shelf. */
export interface ShelfEntry extends ShelfJob {
  readonly id: string;
  readonly kind: TourAssetKind;
  /** The file's name as it came in (an opened tour's: its path). */
  readonly name: string;
  /** Brought in here (optimized at once), or in the opened tour
   *  (optimized only through "Optimize this tour"). */
  readonly origin: "added" | "opened";
  readonly originalBytes: number;
  /** The smaller file's bytes, once there is one. */
  readonly optimizedBytes?: number;
  /** The runner keeps the original's bytes ("use the original"). */
  readonly originalHeld: boolean;
  /** Arrival order: the queue is first in, first out. */
  readonly seq: number;
}

export interface AssetShelfState {
  readonly entries: Readonly<Record<string, ShelfEntry>>;
  readonly nextSeq: number;
}

export const initialAssetShelfState: AssetShelfState = {
  entries: {},
  nextSeq: 0,
};

interface EntryAddedPayload {
  readonly id: string;
  readonly kind: TourAssetKind;
  readonly name: string;
  readonly origin: ShelfEntry["origin"];
  readonly originalBytes: number;
  /** Queued at once; otherwise idle - or kept, with `keptReason`. */
  readonly queued: boolean;
  readonly keptReason?: string;
}

/** `state` with entry `id` replaced by `next(entry)`; unchanged when it
 *  holds no such entry or `next` changes nothing. */
function withJob(
  state: AssetShelfState,
  id: string,
  next: (job: ShelfEntry) => ShelfJob,
  extra: Partial<ShelfEntry> = {},
): AssetShelfState {
  const entry = state.entries[id];
  if (entry === undefined) return state;
  const job = next(entry);
  if (job === entry) return state;
  return {
    ...state,
    entries: { ...state.entries, [id]: { ...entry, ...job, ...extra } },
  };
}

const assetShelfSlice = createSlice({
  name: "assetShelf",
  initialState: initialAssetShelfState,
  reducers: {
    /** A new open: the shelf starts empty. */
    cleared: () => initialAssetShelfState,
    entryAdded(state, action: PayloadAction<EntryAddedPayload>) {
      const p = action.payload;
      if (state.entries[p.id] !== undefined) return state;
      const job: ShelfJob = p.queued
        ? jobQueued(IDLE_JOB)
        : p.keptReason === undefined
          ? IDLE_JOB
          : { ...IDLE_JOB, phase: "kept", reason: p.keptReason };
      const entry: ShelfEntry = {
        id: p.id,
        kind: p.kind,
        name: p.name,
        origin: p.origin,
        originalBytes: p.originalBytes,
        originalHeld: false,
        seq: state.nextSeq,
        ...job,
      };
      return {
        entries: { ...state.entries, [p.id]: entry },
        nextSeq: state.nextSeq + 1,
      };
    },
    entryRemoved(state, action: PayloadAction<{ readonly id: string }>) {
      if (state.entries[action.payload.id] === undefined) return state;
      const entries = { ...state.entries };
      delete entries[action.payload.id];
      return { ...state, entries };
    },
    /** An undo of a removal: the entry as it was. */
    entryRestored(
      state,
      action: PayloadAction<{ readonly entry: ShelfEntry }>,
    ) {
      const { entry } = action.payload;
      if (state.entries[entry.id] !== undefined) return state;
      return { ...state, entries: { ...state.entries, [entry.id]: entry } };
    },
    jobQueued: (state, action: PayloadAction<{ readonly id: string }>) =>
      withJob(state, action.payload.id, jobQueued),
    jobStarted: (state, action: PayloadAction<{ readonly id: string }>) =>
      withJob(state, action.payload.id, jobStarted),
    jobProgress: (
      state,
      action: PayloadAction<{ readonly id: string; readonly fraction: number }>,
    ) =>
      withJob(state, action.payload.id, (job) =>
        jobProgress(job, action.payload.fraction),
      ),
    jobOptimized: (
      state,
      action: PayloadAction<{
        readonly id: string;
        readonly optimizedBytes: number;
        readonly originalHeld: boolean;
      }>,
    ) =>
      withJob(state, action.payload.id, jobOptimized, {
        optimizedBytes: action.payload.optimizedBytes,
        originalHeld: action.payload.originalHeld,
      }),
    jobKept: (
      state,
      action: PayloadAction<{ readonly id: string; readonly reason: string }>,
    ) =>
      withJob(state, action.payload.id, (job) =>
        jobKept(job, action.payload.reason),
      ),
    jobFailed: (
      state,
      action: PayloadAction<{
        readonly id: string;
        readonly reason: string;
        readonly retryable: boolean;
        readonly crashed?: boolean;
      }>,
    ) =>
      withJob(state, action.payload.id, (job) =>
        jobFailed(job, action.payload.reason, action.payload),
      ),
    jobRetried: (state, action: PayloadAction<{ readonly id: string }>) =>
      withJob(state, action.payload.id, jobRetried),
    /** "Use the original": the smaller file left again. */
    originalUsed(
      state,
      action: PayloadAction<{ readonly id: string; readonly reason: string }>,
    ) {
      const { id, reason } = action.payload;
      const entry = state.entries[id];
      if (entry === undefined) return state;
      const next = withJob(state, id, (job) => originalUsed(job, reason), {
        originalHeld: false,
      });
      if (next === state) return state;
      const entries = { ...next.entries };
      const { optimizedBytes: _gone, ...rest } = entries[id]!;
      entries[id] = rest;
      return { ...next, entries };
    },
  },
});

export const assetShelfReducer = assetShelfSlice.reducer;
export const assetShelfActions = assetShelfSlice.actions;

/** One row of the shelf's panel. */
export interface ShelfRow {
  readonly id: string;
  readonly kind: TourAssetKind;
  readonly name: string;
  readonly origin: ShelfEntry["origin"];
  readonly status: ShelfPhase;
  readonly progress: number;
  readonly reason?: string;
  readonly retryable: boolean;
  readonly originalBytes: number;
  readonly optimizedBytes?: number;
  /** What the file adds to the tour now: the smaller file's, else the
   *  original's. */
  readonly estimatedBytes: number;
  /** 0-based among the queued, null when not queued. */
  readonly queuePosition: number | null;
  /** Blocks (and station cards) that use the file. */
  readonly placesInUse: number;
  /** How often a smaller file replaced the asset's: a preview built from
   *  the old bytes reloads when this changes. */
  readonly swaps: number;
  /** The original's bytes are kept and no save wrote the smaller file
   *  yet (the draft's own rule). */
  readonly canUseOriginal: boolean;
}

interface ShelfRoot {
  readonly assetShelf: AssetShelfState;
  readonly tourDocument: TourDocumentState;
}

export const selectShelfRows = createSelector(
  [
    (root: ShelfRoot) => root.assetShelf,
    (root: ShelfRoot) => root.tourDocument,
  ],
  (shelf, doc): ShelfRow[] => {
    const entries = Object.values(shelf.entries).sort((a, b) => a.seq - b.seq);
    const queued = entries.filter((e) => e.phase === "queued").map((e) => e.id);
    const uses = assetUsesOf(doc);
    const writtenPath = new Map(
      (doc.written?.assets ?? []).map((a) => [a.id, a.path]),
    );
    const currentPath = new Map(doc.addedAssets.map((a) => [a.id, a.path]));
    return entries.map((e) => {
      const position = queued.indexOf(e.id);
      const current = currentPath.get(e.id);
      return {
        id: e.id,
        kind: e.kind,
        name: e.name,
        origin: e.origin,
        status: e.phase,
        progress: e.progress,
        ...(e.reason === undefined ? {} : { reason: e.reason }),
        retryable: e.retryable,
        originalBytes: e.originalBytes,
        ...(e.optimizedBytes === undefined
          ? {}
          : { optimizedBytes: e.optimizedBytes }),
        estimatedBytes: e.optimizedBytes ?? e.originalBytes,
        queuePosition: position < 0 ? null : position,
        placesInUse: uses.get(e.id) ?? 0,
        swaps: doc.assetSwaps[e.id] ?? 0,
        canUseOriginal:
          e.phase === "optimized" &&
          e.originalHeld &&
          current !== undefined &&
          writtenPath.get(e.id) !== current,
      };
    });
  },
);
