/**
 * Fatal load-time failures for the cloud-storage tour source.
 *
 * `TourLoadError` is the first of the two error tiers (C14): it aborts the whole
 * `openRemoteTour` and is surfaced to the onboarding gate as "this tour link
 * isn't usable / this file is broken". The second tier — a soft per-asset
 * `getAssetUrl` rejection that only degrades a single waypoint — is a plain
 * rejection, not this type (see the framework's `StructuralReadError` for its
 * permanent-vs-transient split).
 *
 * @see plans/2026-07-24-cloud-loader-plan.md (C6, C11, C14)
 * @see plans/2026-08-18-cloud-loader-framework-extraction-plan.md (E1)
 */

import type { RangeProbeRejectCause } from "gps-plus-slam-app-framework/storage";

/** Why a tour failed to open. The onboarding gate branches on this. The first
 *  four causes are produced by the framework's opening probe; the last two are
 *  specific to what "a tour" means (tour.json parsing, the asset-manifest join). */
export type TourLoadCause =
  | RangeProbeRejectCause
  | "invalid-tour-json" // tour.json absent or fails validateTour
  | "asset-missing-in-zip"; // a referenced AssetEntry.filename is not in the zip

/** A fatal failure while opening a hosted tour.zip. */
export class TourLoadError extends Error {
  override readonly name = "TourLoadError";
  /** Named `loadCause` to avoid colliding with the standard `Error.cause`. */
  readonly loadCause: TourLoadCause;

  constructor(loadCause: TourLoadCause, message: string) {
    super(message);
    this.loadCause = loadCause;
  }
}
