/**
 * MIME type for an asset's Blob, derived from its `tour.json` filename.
 *
 * The zip stores raw bytes with no content type, but the Blob URL handed to the
 * scene should carry the right MIME — some engines refuse e.g. audio whose type
 * lies. TASK §2.5 explicitly allows MP3/OGG and JPG/PNG, so the type cannot be
 * hard-coded per `AssetType`; it comes from the file extension, with a sensible
 * per-type default for unknown extensions.
 */

import type { AssetType } from "../../../store/types.js";

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const DEFAULT_MIME_BY_TYPE: Readonly<Record<AssetType, string>> = {
  model: "model/gltf-binary",
  audio: "audio/mpeg",
  sprite: "image/png",
};

/** MIME from the filename's extension; falls back to the asset type's default. */
export function mimeForAsset(filename: string, type: AssetType): string {
  const ext = /\.([^./\\]+)$/.exec(filename)?.[1]?.toLowerCase();
  const byExtension = ext === undefined ? undefined : MIME_BY_EXTENSION[ext];
  return byExtension ?? DEFAULT_MIME_BY_TYPE[type];
}
