/**
 * The debug layer's decoded thumbnails, keyed by their capture's picture
 * entry name: the side table beside the store's `debugLayer` slice (which
 * holds the names and places, never a decoded picture). The 3D view on
 * the globe copies their pixels into its atlas, also when it opens after
 * they were decoded, so the table keeps them until the layer clears.
 *
 * The table owns them: a thumbnail it drops (a clear, or a newer one for
 * the same name) has its blob URL freed (`free`, by default
 * `revokeDebugThumbnail`), so no thumbnail's URL outlives its tour.
 * `version()` changes with every change, so a view polling once a frame
 * sees new thumbnails without a subscription.
 *
 * @see debug-thumbs.ts.md
 */

import { revokeDebugThumbnail } from "./debug-capture-layer.js";

/** What a view reads of the table. */
export interface DebugThumbsRead {
  /** The thumbnail of the capture `image`, or undefined. */
  get(image: string): HTMLImageElement | undefined;
  /** Changes whenever a thumbnail comes or the table is cleared. */
  version(): number;
}

export interface DebugThumbs extends DebugThumbsRead {
  set(image: string, picture: HTMLImageElement): void;
  clear(): void;
  readonly size: number;
}

export function createDebugThumbs(
  free: (picture: HTMLImageElement) => void = revokeDebugThumbnail,
): DebugThumbs {
  const thumbs = new Map<string, HTMLImageElement>();
  let version = 0;
  return {
    get: (image) => thumbs.get(image),
    version: () => version,
    set(image, picture) {
      if (typeof image !== "string" || image === "") return;
      const was = thumbs.get(image);
      if (was !== undefined && was !== picture) free(was);
      thumbs.set(image, picture);
      version++;
    },
    clear() {
      if (thumbs.size === 0) return;
      for (const picture of thumbs.values()) free(picture);
      thumbs.clear();
      version++;
    },
    get size() {
      return thumbs.size;
    },
  };
}
