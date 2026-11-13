/**
 * The asset shelf's optimizer contract and its table: one row per asset
 * kind, an object literal (no registry), so the milestone that adds the
 * picture optimizer edits one row and no file the shelf's panel edits.
 * A row is null while the kind has no optimizer; that is also what
 * decides whether a file over the caps may come in at all
 * (`optimizerShrinks`, read by `readTourFile`'s `shrinks`).
 *
 * An optimizer runs on the page and may do a step there (a sound is
 * decoded with `decodeAudioData`, which Workers lack) before it hands the
 * heavy part to the Worker through `ctx.host`.
 *
 * @see asset-optimizers.ts.md
 */

import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";

import type { OptimizerSettings } from "./optimizer-settings.js";
import { SOUND_DECODER, soundOptimizer } from "./sound-optimizer.js";

/** What an optimizer made of a file. */
export type OptimizeOutcome =
  | {
      readonly kind: "optimized";
      readonly blob: Blob;
      /** The new file's extension, allowlisted for its kind (`webp`). */
      readonly extension: string;
      /** An image's new size in pixels. */
      readonly width?: number;
      readonly height?: number;
    }
  | {
      /** The original stays, for `reason` (plain words). */
      readonly kind: "kept";
      readonly reason: string;
    };

/** How a run is told to stop and reports how far it is. */
export interface OptimizeControl {
  readonly signal: AbortSignal;
  /** 0..1. */
  readonly progress: (fraction: number) => void;
}

/** The Worker that does an optimizer's heavy part (`optimizer-client.ts`).
 *  `run` rejects with `OptimizerCrashed` when the Worker died under it,
 *  and with an `AbortError` once `signal` aborted. `transfer` moves
 *  buffers of `payload` to the Worker instead of copying them (a
 *  sound's decoded samples); they are unusable on the page afterwards. */
export interface OptimizerHost {
  run(
    kind: TourAssetKind,
    payload: unknown,
    settings: OptimizerSettings,
    control: OptimizeControl,
    transfer?: readonly Transferable[],
  ): Promise<OptimizeOutcome>;
  /** Stop every run and the Worker. */
  close(): void;
}

export interface OptimizeContext extends OptimizeControl {
  readonly settings: OptimizerSettings;
  readonly host: OptimizerHost;
}

export interface AssetOptimizer {
  /** `source`, the file as it came in, made smaller. Throws (or rejects)
   *  for a failure the shelf shows with Retry. */
  optimize(source: Blob, ctx: OptimizeContext): Promise<OptimizeOutcome>;
}

export type OptimizerTable = Readonly<
  Record<TourAssetKind, AssetOptimizer | null>
>;

/** A picture's whole optimization runs in the Worker
 *  (`picture-step.ts`): the page hands over the file as it is. */
const PICTURE_OPTIMIZER: AssetOptimizer = {
  optimize: (source, ctx) => ctx.host.run("image", source, ctx.settings, ctx),
};

/** The optimizers this build has: pictures (WebP, in the Worker) and
 *  sounds (decoded on the page, Ogg Opus in the Worker). Model textures
 *  get their row in a milestone of their own; video stays without one
 *  (no transcode in the first version). */
export const ASSET_OPTIMIZERS: OptimizerTable = {
  image: PICTURE_OPTIMIZER,
  audio: soundOptimizer(SOUND_DECODER),
  video: null,
  model: null,
};

/** Whether a file of `kind` can be made smaller here: only then may one
 *  over the caps come in (`TourFileContext.shrinks`). */
export function optimizerShrinks(
  table: OptimizerTable,
): (kind: TourAssetKind) => boolean {
  return (kind) => table[kind] !== null;
}

/** The Worker died under a run (out of memory shows as its error event):
 *  the job counts one attempt and is tried again while attempts remain. */
export class OptimizerCrashed extends Error {
  constructor() {
    super("the optimizer stopped unexpectedly");
    this.name = "OptimizerCrashed";
  }
}
