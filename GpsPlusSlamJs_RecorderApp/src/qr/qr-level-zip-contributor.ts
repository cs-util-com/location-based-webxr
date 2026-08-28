/**
 * Writes each fixed QR code's minted anchor into the recording zip, as
 * `qr/<id>.json`.
 *
 * WHY IT LOOKS LIKE THIS. The framework calls contributors on EVERY
 * crash-safety sync, not only at save — the COLMAP contributor's own comment
 * warns that a from-scratch re-parse of `actions/` there would be O(session²).
 * So this reads the sighting accumulator's maintained state and nothing else.
 *
 * WHY IT REFUSES FOREIGN CODES. Without that check the recorder would write a
 * real latitude and longitude for every WiFi sticker, menu code and parcel
 * label the camera happened to see, into a zip the author then publishes. The
 * predicate is the same one that gates the network path, deliberately: one
 * rule, two call sites.
 *
 * @see gps-plus-slam-app-framework/ar/qr/qr-anchor-mint — the mint itself.
 * @see qr-sighting-feeder.ts — where the sightings come from.
 */

import { mintQrAnchorFromSightings } from 'gps-plus-slam-app-framework/ar/qr/qr-anchor-mint';
import { qrLevelFileName } from 'gps-plus-slam-app-framework/ar/qr/qr-level-archive';
import { qrCodeId } from 'gps-plus-slam-app-framework/utils/qr-payload/qr-code-id';
import { qrCodeIsOurs } from 'gps-plus-slam-app-framework/utils/qr-payload/qr-code-origin';
import type { ZipExportContributor } from 'gps-plus-slam-app-framework/storage';
import type { QrSightingFeeder } from './qr-sighting-feeder';

/** Top-level folder this contributor owns inside the zip. Not exported: the
 *  framework prepends it, so nothing outside this file needs the string, and
 *  a named export nothing imports is what the dead-code check flags. */
const QR_LEVEL_SUBDIR = 'qr';

/** What happened to one code, for the session summary screen. */
export interface QrAnchorOutcome {
  /** The decoded text, so the author can tell which poster this was. */
  text: string;
  /** Its short identity — also the file name, when one was written. */
  id: string;
  /** Written, or the plain-words reason it was not. */
  written: boolean;
  detail: string;
  sightingCount: number;
  rotationSpreadDeg?: number;
  sizeM?: number;
  /** The weighted position that was written, and the unweighted comparison. */
  lat?: number;
  lon?: number;
  unweightedLat?: number;
  unweightedLon?: number;
}

export interface QrLevelZipContributorDeps {
  /** The session's sighting fold; `null` when QR recording is off. */
  getFeeder: () => QrSightingFeeder | null;
  /** Hosts whose codes we own — foreign codes are never minted. */
  allowedHosts: readonly string[];
  /** Injected clock, so a contributor run is reproducible in tests. */
  nowIso: () => string;
  /** Receives what happened, for the summary screen. */
  onOutcomes?: (outcomes: readonly QrAnchorOutcome[]) => void;
}

export function createQrLevelZipContributor(
  deps: QrLevelZipContributorDeps
): ZipExportContributor {
  return {
    subdir: QR_LEVEL_SUBDIR,
    async contribute(addFile) {
      const feeder = deps.getFeeder();
      // A session with QR recording off contributes nothing — the contract
      // says return 0 rather than throw.
      if (feeder === null) return 0;

      // The burst in progress is not closed yet, and under recency weighting
      // it is the one that counts MOST — stopping right after a final scan
      // would otherwise discard the best evidence there is.
      feeder.accumulator.flush();

      const outcomes: QrAnchorOutcome[] = [];
      let written = 0;
      for (const text of feeder.accumulator.codes()) {
        if (!qrCodeIsOurs(text, deps.allowedHosts)) {
          outcomes.push({
            text,
            id: '',
            written: false,
            detail:
              'Not one of our printed codes, so nothing was written for it.',
            sightingCount: feeder.accumulator.sightings(text).length,
          });
          continue;
        }
        const id = await qrCodeId(text);
        const result = mintQrAnchorFromSightings({
          sightings: feeder.accumulator.sightings(text),
          spansFrameChange: feeder.accumulator.spansFrameChange(text),
          nowIso: deps.nowIso(),
        });
        if (!result.ok) {
          outcomes.push({
            text,
            id,
            written: false,
            detail: result.detail,
            sightingCount: feeder.accumulator.sightings(text).length,
          });
          continue;
        }
        if (!result.level.ok) {
          outcomes.push({
            text,
            id,
            written: false,
            detail: result.level.error,
            sightingCount: result.quality.sightingCount,
          });
          continue;
        }
        await addFile(
          qrLevelFileName(id),
          new Blob([result.level.json], { type: 'application/json' })
        );
        written += 1;
        outcomes.push({
          text,
          id,
          written: true,
          detail: `Placed from ${String(result.quality.sightingCount)} visits.`,
          sightingCount: result.quality.sightingCount,
          rotationSpreadDeg: result.quality.rotationSpreadDeg,
          sizeM: result.quality.sizeM,
          lat: result.level.level.qr.geo?.lat,
          lon: result.level.level.qr.geo?.lon,
          unweightedLat: result.quality.unweighted.lat,
          unweightedLon: result.quality.unweighted.lon,
        });
      }
      deps.onOutcomes?.(outcomes);
      return written;
    },
  };
}
