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
import { SRGBColorSpace, type Texture } from "three";

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
