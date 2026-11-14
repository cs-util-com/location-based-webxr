/**
 * A 3D model's embedded textures made smaller with the picture step's
 * device (`picture-step.ts`): the longest side at most the settings'
 * limit, never enlarged, and written as a format every glTF viewer reads
 * without an extension (JPEG or PNG):
 * - a colour texture (base colour, emission) as JPEG at the colour
 *   quality, unless a material blends or cuts by its alpha (then PNG);
 * - a data texture (normals, roughness and metalness, occlusion, and any
 *   texture a material extension names) as JPEG at the data quality, or
 *   PNG when it came as PNG (a lossless map stays lossless);
 * - an image no texture names, one of another type (WebP), one kept in a
 *   `data:` URI, or one that cannot be decoded: left as it is.
 * A texture whose result is not smaller and not resized keeps its bytes.
 *
 * @see model-textures.ts.md
 */

import {
  appendView,
  type GlbParts,
  type GltfObject,
  indexOf,
  listOf,
  objectOf,
} from "./glb-file.js";
import type { ModelSettings } from "./optimizer-settings.js";
import {
  type DecodedPicture,
  fitWithin,
  type PictureDevice,
  type PictureFormat,
} from "./picture-step.js";
import { stoppedError, type WorkerStepControl } from "./optimizer-protocol.js";

/** How the materials use an image. */
interface ImageUse {
  colour: boolean;
  data: boolean;
  /** A material blends or cuts by this image's alpha. */
  alpha: boolean;
}

export interface TextureReport {
  /** Textures rewritten. */
  readonly changed: number;
  /** Textures left as they are (not smaller, unused, of another type). */
  readonly kept: number;
  /** Image bytes before and after, over all images. */
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  /** The largest texture side after the pass. */
  readonly largestSide: number;
}

/** The core material slots a data texture fills. */
const DATA_SLOTS = ["normalTexture", "occlusionTexture"] as const;

function sourceOf(json: GltfObject, info: unknown): number | null {
  const texture = indexOf(objectOf(info)?.["index"]);
  if (texture === null) return null;
  return indexOf(
    objectOf((listOf(json, "textures") ?? [])[texture])?.["source"],
  );
}

/** Every texture reference (`{ index }` under a key ending in `Texture`)
 *  inside a material extension, however deep. */
function extensionTextures(value: unknown, found: unknown[]): void {
  const object = objectOf(value);
  if (object === null) return;
  for (const [key, item] of Object.entries(object)) {
    if (key.endsWith("Texture")) found.push(item);
    else extensionTextures(item, found);
  }
}

/** How each image is used, by image index. */
export function imageUses(json: GltfObject): Map<number, ImageUse> {
  const uses = new Map<number, ImageUse>();
  const mark = (info: unknown, how: keyof ImageUse) => {
    const image = sourceOf(json, info);
    if (image === null) return;
    const use = uses.get(image) ?? { colour: false, data: false, alpha: false };
    use[how] = true;
    uses.set(image, use);
  };
  for (const item of listOf(json, "materials") ?? []) {
    const material = objectOf(item) ?? {};
    const pbr = objectOf(material["pbrMetallicRoughness"]) ?? {};
    const blends =
      material["alphaMode"] === "BLEND" || material["alphaMode"] === "MASK";
    mark(pbr["baseColorTexture"], "colour");
    if (blends) mark(pbr["baseColorTexture"], "alpha");
    mark(material["emissiveTexture"], "colour");
    mark(pbr["metallicRoughnessTexture"], "data");
    for (const slot of DATA_SLOTS) mark(material[slot], "data");
    const more: unknown[] = [];
    extensionTextures(material["extensions"], more);
    more.forEach((info) => mark(info, "data"));
  }
  return uses;
}

const JPEG = "image/jpeg";
const PNG = "image/png";

/** The format `use` of a `mime` source is written as. */
export function textureFormat(
  use: ImageUse,
  mime: string,
  settings: ModelSettings,
): PictureFormat {
  if (use.alpha) return { type: PNG, quality: 1 };
  if (use.data) {
    return mime === PNG
      ? { type: PNG, quality: 1 }
      : { type: JPEG, quality: settings.dataQuality };
  }
  return { type: JPEG, quality: settings.colourQuality };
}

/** An image the pass may rewrite: in the binary chunk, JPEG or PNG, used
 *  by a texture. */
function candidate(
  parts: GlbParts,
  image: GltfObject | null,
  use: ImageUse | undefined,
): { bytes: Uint8Array; mime: string } | null {
  const view = indexOf(image?.["bufferView"]);
  const mime = image?.["mimeType"];
  if (use === undefined || view === null) return null;
  if (mime !== JPEG && mime !== PNG) return null;
  const bytes = parts.views[view];
  return bytes === undefined ? null : { bytes, mime };
}

interface Rewrite {
  readonly bytes: Uint8Array;
  readonly type: string;
  readonly side: number;
}

/** One image through the device, or null when it stays as it is. */
async function rewrite<P extends DecodedPicture>(
  source: { bytes: Uint8Array; mime: string },
  use: ImageUse,
  settings: ModelSettings,
  device: PictureDevice<P>,
): Promise<Rewrite | { readonly side: number } | null> {
  let picture: P;
  try {
    picture = await device.decode(
      new Blob([source.bytes as Uint8Array<ArrayBuffer>], {
        type: source.mime,
      }),
      "texture",
    );
  } catch {
    return null;
  }
  try {
    const size = fitWithin(
      picture.width,
      picture.height,
      settings.textureMaxSidePx,
    );
    const format = textureFormat(use, source.mime, settings);
    const resized =
      size.width !== picture.width || size.height !== picture.height;
    if (!resized && format.type === source.mime && format.type === PNG) {
      return { side: Math.max(size.width, size.height) };
    }
    const blob = await device.encode(picture, size.width, size.height, format);
    if (blob.type !== format.type) {
      throw new Error(`this browser cannot write ${format.type} pictures`);
    }
    const side = Math.max(size.width, size.height);
    if (!resized && blob.size >= source.bytes.length) return { side };
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      type: format.type,
      side,
    };
  } finally {
    picture.close();
  }
}

/** Makes `parts`' textures smaller (changed in place). Progress runs
 *  from `from` to `to` of the whole job. */
export async function shrinkTextures<P extends DecodedPicture>(
  parts: GlbParts,
  settings: ModelSettings,
  device: PictureDevice<P>,
  control: WorkerStepControl,
  span: { readonly from: number; readonly to: number } = { from: 0, to: 1 },
): Promise<TextureReport> {
  const images = listOf(parts.json, "images") ?? [];
  const uses = imageUses(parts.json);
  let changed = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  let largestSide = 0;
  for (let i = 0; i < images.length; i++) {
    if (control.signal.aborted) throw stoppedError();
    const image = objectOf(images[i]);
    const source = candidate(parts, image, uses.get(i));
    if (image === null || source === null) continue;
    bytesBefore += source.bytes.length;
    const result = await rewrite(source, uses.get(i)!, settings, device);
    largestSide = Math.max(largestSide, result?.side ?? 0);
    if (result !== null && "bytes" in result) {
      image["bufferView"] = appendView(parts, result.bytes);
      image["mimeType"] = result.type;
      changed++;
      bytesAfter += result.bytes.length;
    } else {
      bytesAfter += source.bytes.length;
    }
    control.progress(
      span.from + ((span.to - span.from) * (i + 1)) / images.length,
    );
  }
  return {
    changed,
    kept: images.length - changed,
    bytesBefore,
    bytesAfter,
    largestSide,
  };
}
