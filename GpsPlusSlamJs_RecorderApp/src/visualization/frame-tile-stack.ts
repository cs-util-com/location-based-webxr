/**
 * The frame-tile stack - a `FrameTileVisualizer` under the alignment-riding
 * parent plus the store feed that decodes each captured frame into a
 * textured plane - built ONCE for the live AR scene (`ar/wire-ar-scene.ts`)
 * and for the replay scene (`replay/replay-mode.ts`).
 *
 * The two sites differ in the blob source (the live capture cache vs the
 * recording ZIP) and in the tile cap, which is LIVE-ONLY: replay omits it so
 * coverage auditing sees the full recorded path (Step 4 of the 2026-07-03
 * fps plan). The display divisor is the same setting on both sides
 * (`frameTileDisplay.divisor`, a display preference re-read per replay so an
 * old recording renders at the current setting). Until 2026-09-04 the two
 * sites carried the decode + error wiring in two copies.
 *
 * See `frame-tile-stack.ts.md`.
 */

import type * as THREE from 'three';
import { decodeFrameTexture } from 'gps-plus-slam-app-framework/visualization/frame-texture-decoder';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { RecorderStore } from '../state/recorder-store';
import type { StoreRef } from '../state/store-ref';
import { FrameTileVisualizer } from './frame-tile-visualizer';
import { wireFrameTileSubscribers } from './wire-frame-tile-subscribers';

const log = createLogger('Recorder');

export interface FrameTileStackDeps {
  /** The alignment-riding parent (NOT the scene root): tile poses are raw WebXR. */
  readonly arWorldGroup: THREE.Group;
  readonly storeRef: StoreRef<RecorderStore>;
  /** Where a frame's bytes come from: the live capture cache, or the ZIP. */
  readonly blobSource: (imageFile: string) => Promise<Blob | null>;
  /** `frameTileDisplay.divisor` - the display-texture downscale. */
  readonly divisor: number;
  /**
   * LIVE-ONLY FIFO cap on tiles kept in the scene. Omit in replay: the
   * visualizer is then constructed without options, which the replay test
   * pins, and the whole recorded path stays visible.
   */
  readonly maxTiles?: number;
}

/** Wires the stack; the returned function unsubscribes and disposes it. */
export function wireFrameTileStack({
  arWorldGroup,
  storeRef,
  blobSource,
  divisor,
  maxTiles,
}: FrameTileStackDeps): () => void {
  const visualizer =
    maxTiles === undefined
      ? new FrameTileVisualizer(arWorldGroup)
      : new FrameTileVisualizer(arWorldGroup, { maxTiles });
  const unsubscribe = wireFrameTileSubscribers({
    storeRef,
    visualizer,
    blobSource,
    decodeTexture: (blob) => decodeFrameTexture(blob, divisor),
    onError: (err, imageFile) => {
      log.warn(`Frame tile decode failed for "${imageFile}"`, err);
    },
  });
  return () => {
    unsubscribe();
    visualizer.dispose();
  };
}
