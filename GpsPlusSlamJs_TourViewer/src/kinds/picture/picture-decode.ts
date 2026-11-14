/**
 * How a picture world part reads its image: the tour's capped decode at
 * half size, as a picture plane's, in sRGB; and the decoded picture's
 * height over its width. Shared by the framed print and cut-out
 * (`world.ts`) and the viewpoint views (`viewpoint-world.ts`).
 *
 * @see picture-decode.ts.md
 */
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";
import { SRGBColorSpace, type Object3D, type Texture } from "three";

/** The image file as an upright sRGB texture; null: it cannot be shown. */
export async function decodePicture(blob: Blob): Promise<Texture | null> {
  const texture = await decodeFrameTexture(blob, 2, {
    maxPixels: TOUR_MAX_IMAGE_PIXELS,
  });
  if (texture !== null) texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The texture's height over its width; 1 when it states no size. */
export function pictureAspect(texture: Texture): number {
  const image = texture.image as
    { readonly width?: unknown; readonly height?: unknown } | null | undefined;
  const w = image?.width;
  const h = image?.height;
  return typeof w === "number" && typeof h === "number" && w > 0 && h > 0
    ? h / w
    : 1;
}

/** Where a drawn picture keeps its image's aspect (`markDrawnAspect`). */
const DRAWN_ASPECT = "pictureAspect";

/** Records on a drawn picture part's object its image's aspect (height
 *  over width), once the image is read: the editor's field-of-view lines
 *  take it (`drawnAspect`). */
export function markDrawnAspect(object: Object3D, aspect: number): void {
  object.userData[DRAWN_ASPECT] = aspect;
}

/** The aspect `markDrawnAspect` recorded on `object`; null before the
 *  image is read, or for anything not a positive finite number. */
export function drawnAspect(object: Object3D): number | null {
  const aspect: unknown = object.userData[DRAWN_ASPECT];
  return typeof aspect === "number" && Number.isFinite(aspect) && aspect > 0
    ? aspect
    : null;
}
