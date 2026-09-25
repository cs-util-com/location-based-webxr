/**
 * Pure `AssetEntry` construction for component 10 (TASK.md §2.3). Reuses
 * packaging's (component 5) `assetFilename` convention so a tour authored
 * here always packs cleanly — no second, drifting filename implementation.
 *
 * @see plans/2026-08-07-authoring-plan.md
 */

import { assetFilename } from "../../packaging/core/asset-filename.js";
import type { AssetEntry, AssetId, AssetType } from "../../../store/types.js";

/** Asset-backed content slots — mirrors authoring-slice's own `AssetSlot`. */
export type AssetSlot = "model" | "sprite" | "audio";

const SLOT_TYPE: Record<AssetSlot, AssetType> = {
  model: "model",
  sprite: "sprite",
  audio: "audio",
};

/** Builds the AssetEntry to register + attach for a picked File. */
export function buildAssetEntry(
  id: AssetId,
  slot: AssetSlot,
  file: File,
): AssetEntry {
  return {
    id,
    type: SLOT_TYPE[slot],
    filename: assetFilename(id, file),
  };
}

/** File extensions each slot accepts (contract: `AssetType` is `sprite |
 *  model | audio` = image | GLTF/GLB | MP3/OGG — plans/Shared-Contract.md
 *  §2.1). Also drives each tile's `accept` attribute in the view. */
export const ALLOWED_EXTENSIONS: Record<AssetSlot, readonly string[]> = {
  model: [".glb", ".gltf"],
  sprite: [".jpg", ".jpeg", ".png", ".webp", ".gif"],
  audio: [".mp3", ".ogg"],
};

/**
 * True if `file`'s extension matches what `slot` accepts. Checked by
 * extension rather than `file.type`: browsers report an empty or generic
 * MIME type for GLB/GLTF (and often for OGG) depending on OS, so the
 * filename is the only reliable signal here — same reasoning `assetFilename`
 * already uses for the in-zip name.
 */
export function isAllowedAssetFile(slot: AssetSlot, file: File): boolean {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : "";
  return ALLOWED_EXTENSIONS[slot].includes(ext);
}
