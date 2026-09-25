/**
 * `packTour` — bundle a tour + its asset bytes into an uncompressed `tour.zip`
 * (Component 5, the authoring-side export step).
 *
 * Thin adapter over the framework's generic `packFilesAsZip`: this file owns
 * only the tour-specific parts — resolving `AssetId`s to `File`s and mapping
 * `Tour` into the framework's manifest/entry shape. ZIP mechanics (store mode,
 * entry-path safety) live in `gps-plus-slam-app-framework/storage`.
 *
 * Scope: this does NOT validate the tour schema — the caller's `Tour` is typed
 * and normally comes from `selectExportedTour`. It DOES validate asset
 * coverage (every declared asset has bytes), because that failure is
 * invisible in the artifact rather than caught by the type system.
 *
 * @see plans/Shared-Contract.md §1 (schema + Invariant 3)
 * @see plans/2026-07-14-packaging-plan.md (decisions 4, 5, 6, 10, 12, 14)
 */

import {
  packFilesAsZip,
  ZipPackagingError,
} from "gps-plus-slam-app-framework/storage";

import type { AssetId, Tour } from "../../../store/types.js";

/** Every failure this module reports: missing asset bytes, or an unusable path. */
export class PackagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackagingError";
  }
}

/** Path of the manifest at the ZIP root — the first thing component 6 reads. */
const TOUR_JSON = "tour.json";

/** An asset resolved to the bytes that will be written at its in-zip path. */
interface ResolvedAsset {
  readonly filename: string;
  readonly file: File;
}

/**
 * Pair every declared asset with its `File`.
 *
 * @throws {PackagingError} listing ALL ids with no file — the author fixes one
 * round-trip instead of discovering them one at a time.
 */
function resolveAssets(
  tour: Tour,
  assetFiles: Map<AssetId, File>,
): ResolvedAsset[] {
  const resolved: ResolvedAsset[] = [];
  const missing: AssetId[] = [];

  for (const asset of tour.assets) {
    const file = assetFiles.get(asset.id);
    if (file === undefined) missing.push(asset.id);
    else resolved.push({ filename: asset.filename, file });
  }

  if (missing.length > 0) {
    throw new PackagingError(
      `packTour: no File provided for asset id(s): ${missing.join(", ")}`,
    );
  }
  return resolved;
}

/**
 * Bundle a tour into an uncompressed ZIP Blob.
 *
 * @precondition `tour` has passed `validateTour` (or was produced by
 * `selectExportedTour` from the authoring slice).
 * @throws {PackagingError} if an `AssetId` in `tour.assets` has no `File` in
 * `assetFiles`, or if the asset filenames are not a safe, unique set. Both are
 * checked before any bytes are read, so a rejected call never leaves a partial
 * archive behind.
 */
export async function packTour(
  tour: Tour,
  assetFiles: Map<AssetId, File>,
): Promise<Blob> {
  const assets = resolveAssets(tour, assetFiles);

  try {
    const assetEntries = await Promise.all(
      assets.map(async ({ filename, file }) => ({
        path: filename,
        data: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    return await packFilesAsZip([
      { path: TOUR_JSON, data: JSON.stringify(tour) },
      ...assetEntries,
    ]);
  } catch (err) {
    if (err instanceof ZipPackagingError) {
      throw new PackagingError(`packTour: ${err.message}`);
    }
    throw err;
  }
}
