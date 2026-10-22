/**
 * How the globe's global maps are fetched (round-3 plan 2026-10-08-2345
 * M1, §18): decoded off the main thread where the browser can (an
 * `ImageBitmap`), so the cloud map's preview and its four 4,096 x 2,048
 * pieces do not stall a frame while the flight starts; a plain image
 * element elsewhere.
 *
 * @see globe-map-loader.ts.md
 */
import * as THREE from "three";

import type { GlobeSource } from "./globe-sources.js";

/** A size to decode an image at, pixels. */
interface GlobeMapSize {
  readonly width: number;
  readonly height: number;
}

/** How the global maps are fetched: a texture that fills in later. */
export interface GlobeSurfaceLoader {
  /**
   * `size`, where the loader `resizes`, decodes the image at that size
   * (the cloud map's half-size pieces on a device that cannot hold the
   * full map); a loader that does not resize ignores it.
   */
  loadTexture(
    source: GlobeSource,
    onLoad: () => void,
    onError: () => void,
    size?: GlobeMapSize,
  ): THREE.Texture;
  /** Whether `loadTexture` honours `size`. */
  readonly resizes?: boolean;
}

/**
 * Whether this browser decodes images off the main thread with the options
 * the globe needs (flipped rows, no colour conversion): three's own rule
 * for its glTF loader, since Safari before 17 and Firefox before 98 did not
 * honour them. Not for a missing `createImageBitmap`.
 */
export function decodesOffThread(
  userAgent: string | undefined,
  hasCreateImageBitmap: boolean,
): boolean {
  if (!hasCreateImageBitmap) return false;
  if (typeof userAgent !== "string") return true;
  const safari = /^((?!chrome|android).)*safari/i.test(userAgent);
  const safariVersion = Number(/Version\/(\d+)/.exec(userAgent)?.[1] ?? -1);
  if (safari && safariVersion < 17) return false;
  const firefox = /Firefox\/(\d+)\./.exec(userAgent);
  if (firefox && Number(firefox[1]) < 98) return false;
  return true;
}

/**
 * The plain loader: an image element, decoded when it is first drawn, at
 * its own size (it does not resize).
 */
export const elementMapLoader: GlobeSurfaceLoader = {
  resizes: false,
  loadTexture: (source, onLoad, onError) =>
    new THREE.TextureLoader().load(
      source.path,
      () => onLoad(),
      undefined,
      () => onError(),
    ),
};

/**
 * The off-thread loader: the rows flipped by the decoder (WebGL does not
 * flip an `ImageBitmap`), no premultiplying and no colour conversion (the
 * clouds are numbers; the night map's sRGB is decoded by its texture's
 * colour space). The bitmap is closed when its texture is disposed. A
 * `size` is decoded at that size (createImageBitmap's resizeWidth and
 * resizeHeight, high quality), with no full-size copy made first.
 */
const bitmapMapLoader: GlobeSurfaceLoader = {
  resizes: true,
  loadTexture: (source, onLoad, onError, size) => {
    const texture = new THREE.Texture();
    texture.flipY = false;
    new THREE.ImageBitmapLoader()
      .setOptions({
        imageOrientation: "flipY",
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
        ...(size
          ? {
              resizeWidth: size.width,
              resizeHeight: size.height,
              resizeQuality: "high",
            }
          : {}),
      })
      .load(
        source.path,
        (bitmap) => {
          texture.image = bitmap;
          texture.needsUpdate = true;
          texture.addEventListener("dispose", () => bitmap.close());
          onLoad();
        },
        undefined,
        () => onError(),
      );
    return texture;
  },
};

/** The loader for this browser. */
export function globeMapLoader(): GlobeSurfaceLoader {
  return decodesOffThread(
    typeof navigator === "undefined" ? undefined : navigator.userAgent,
    typeof createImageBitmap === "function",
  )
    ? bitmapMapLoader
    : elementMapLoader;
}
