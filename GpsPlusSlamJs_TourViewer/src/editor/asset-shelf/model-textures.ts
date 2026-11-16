/**
 * A 3D model's embedded textures made smaller with the picture step's
 * device (`picture-step.ts`): the longest side at most the settings'
 * limit, never enlarged, and written as a format every glTF viewer reads
 * without an extension (JPEG or PNG):
 * - a colour texture (base colour, emission) as JPEG (or WebP, when the
 *   settings ask for it, named through EXT_texture_webp) at the colour
 *   quality, unless a material blends or cuts by its alpha (then PNG);
 * - a data texture (normals, roughness and metalness, occlusion, and any
 *   texture a material extension names) as JPEG at the data quality, or
 *   PNG when it came as PNG (a lossless map stays lossless);
 * - an image no texture names, one of another type (WebP), one kept in a
 *   `data:` URI, or one that cannot be decoded: left as it is.
 * An image used both ways takes the data rule (the stricter use wins).
 * A texture whose result is not smaller and not resized keeps its bytes.
 * The report's largest side counts every texture in the binary chunk,
 * one left as it is by its file header (`imageInfo`).
 *
 * @see model-textures.ts.md
 */

import { imageInfo } from "gps-plus-slam-app-framework/utils/image-header";

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
  /** The largest texture side after the pass, over every image a texture
   *  uses from the binary chunk (one left as it is read by its header). */
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

/** The format `use` of a `mime` source is written as: alpha first (PNG,
 *  so it survives), then data (a PNG stays lossless, else the lossy type
 *  at the data quality), then colour (the lossy type at the colour
 *  quality). The lossy type is the settings' `textureType`, JPEG when
 *  left out. An image used as colour and as data takes the data rule. */
export function textureFormat(
  use: ImageUse,
  mime: string,
  settings: ModelSettings,
): PictureFormat {
  const lossy = settings.textureType ?? JPEG;
  if (use.alpha) return { type: PNG, quality: 1 };
  if (use.data) {
    return mime === PNG
      ? { type: PNG, quality: 1 }
      : { type: lossy, quality: settings.dataQuality };
  }
  return { type: lossy, quality: settings.colourQuality };
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

/** The side of an image a texture uses that the pass leaves as it is (of
 *  another type, or not decodable), from its header; 0 when none reads. */
function keptSide(
  parts: GlbParts,
  image: GltfObject | null,
  use: ImageUse | undefined,
): number {
  const view = indexOf(image?.["bufferView"]);
  const bytes = view === null ? undefined : parts.views[view];
  if (use === undefined || bytes === undefined) return 0;
  const info = imageInfo(bytes);
  return info === null ? 0 : Math.max(info.width, info.height);
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

const WEBP = "image/webp";
const WEBP_EXTENSION = "EXT_texture_webp";

/** Points every texture of an image in `webp` at it through
 *  EXT_texture_webp (in place of its core `source`, which must be JPEG or
 *  PNG) and lists the extension as used and required: a viewer without it
 *  could not draw those textures at all. */
function nameWebpImages(json: GltfObject, webp: ReadonlySet<number>): void {
  if (webp.size === 0) return;
  for (const item of listOf(json, "textures") ?? []) {
    const texture = objectOf(item);
    const source = indexOf(texture?.["source"]);
    if (texture === null || source === null || !webp.has(source)) continue;
    delete texture["source"];
    texture["extensions"] = {
      ...objectOf(texture["extensions"]),
      [WEBP_EXTENSION]: { source },
    };
  }
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    const list = (listOf(json, key) ?? []).filter((n) => n !== WEBP_EXTENSION);
    json[key] = [...list, WEBP_EXTENSION];
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
  const webp = new Set<number>();
  for (let i = 0; i < images.length; i++) {
    if (control.signal.aborted) throw stoppedError();
    const image = objectOf(images[i]);
    const source = candidate(parts, image, uses.get(i));
    if (image === null || source === null) {
      largestSide = Math.max(largestSide, keptSide(parts, image, uses.get(i)));
      continue;
    }
    bytesBefore += source.bytes.length;
    const result = await rewrite(source, uses.get(i)!, settings, device);
    largestSide = Math.max(
      largestSide,
      result?.side ?? keptSide(parts, image, uses.get(i)),
    );
    if (result !== null && "bytes" in result) {
      image["bufferView"] = appendView(parts, result.bytes);
      image["mimeType"] = result.type;
      if (result.type === WEBP) webp.add(i);
      changed++;
      bytesAfter += result.bytes.length;
    } else {
      bytesAfter += source.bytes.length;
    }
    control.progress(
      span.from + ((span.to - span.from) * (i + 1)) / images.length,
    );
  }
  nameWebpImages(parts.json, webp);
  return {
    changed,
    kept: images.length - changed,
    bytesBefore,
    bytesAfter,
    largestSide,
  };
}
