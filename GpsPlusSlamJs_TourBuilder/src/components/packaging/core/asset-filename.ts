/**
 * Canonical filename for an asset inside `tour.zip` (Component 5).
 *
 * The authoring UI calls this when it builds an `AssetEntry`; `packTour` then
 * writes the asset bytes at `entry.filename` verbatim and component 6 uses the
 * same string as its central-directory lookup key. The name is therefore a
 * one-way decision made here and carried in `tour.json` — nothing re-derives it.
 *
 * @see plans/Shared-Contract.md §1 ("filename convention")
 * @see plans/2026-07-14-packaging-plan.md (decision 11)
 */

import type { AssetId } from "../../../store/types.js";

/**
 * Build the in-zip path for an asset: `assets/<id>.<lowercased-extension>`.
 *
 * Pure. Performs no validation of `id` — `packTour` rejects an unsafe or
 * duplicated resulting path at pack time, so a bad id fails loudly there rather
 * than producing a ZIP entry that escapes the `assets/` prefix.
 */
export function assetFilename(id: AssetId, file: File): string {
  const dot = file.name.lastIndexOf(".");
  // `dot > 0`, not `>= 0`: a leading dot marks a dotfile (".glb"), not an
  // extension. Lowercased so two files differing only in case cannot become two
  // entries that a case-insensitive filesystem sees as one.
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : "";
  return `assets/${id}${ext}`;
}
