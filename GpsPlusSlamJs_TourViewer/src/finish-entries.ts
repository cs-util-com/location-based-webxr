/**
 * The files a Finish writes into the rebuilt zip (code book refactor plan
 * `GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`,
 * M1): every level it is given, the manifest, and the photos' bytes.
 * Extracted from the Finish handler in `creator-setup.ts`, where it was
 * assembled for exactly one code. Pure.
 *
 * @see finish-entries.ts.md
 */

import {
  qrLevelEntryName,
  qrLevelIdFromEntryName,
} from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";

import type { LevelText } from "./code-book.js";

/** One file to write: its path in the zip and its bytes. */
export interface FinishEntry {
  readonly path: string;
  readonly data: string | Blob;
}

export function finishEntries(input: {
  /** The names of the entries the zip holds now. */
  readonly entryNames: readonly string[];
  /** The levels to write, in order. */
  readonly levels: readonly LevelText[];
  /** The tour's folder prefix inside the zip ("" at the root). */
  readonly wrap: string;
  /** The tour carries a signed file list that continues (K1 R7). */
  readonly listed: boolean;
  readonly manifestPath: string;
  readonly manifestJson: string;
  /** Photos placed on this device, with their content path and bytes. */
  readonly photos: readonly { readonly image: string; readonly blob: Blob }[];
}): FinishEntry[] {
  const levels = input.levels.map(({ id, json }) => ({
    // A level the zip already holds - also in the tolerated wrapped shape
    // (`mytour/qr/<id>.json`) - is replaced where it is: a second copy at
    // the root would leave a stale duplicate on every Finish. A listed
    // tour's new level goes inside the tour's folder, where its list can
    // name it (R7); others keep the root.
    path:
      input.entryNames.find((name) => qrLevelIdFromEntryName(name) === id) ??
      `${input.listed ? input.wrap : ""}${qrLevelEntryName(id)}`,
    data: json,
  }));
  return [
    ...levels,
    { path: input.manifestPath, data: input.manifestJson },
    ...input.photos.map((p) => ({
      path: `${input.wrap}${p.image}`,
      data: p.blob,
    })),
  ];
}
