/**
 * The session-metadata record a finished recording leaves behind.
 *
 * WHY IT IS ITS OWN MODULE. It was forty-five lines inside `performStop`, which
 * is one function inside `createRecordingSessionHandlers` - 717 lines carrying
 * eight distinct concerns, from prior-ref-point loading to Android back-gesture
 * handling. This is the piece of that pipeline whose inputs are all VALUES:
 * unlike the sync, the ZIP export and the teardown around it, it closes over no
 * mutable state of the enclosing factory, so it can move out without threading
 * anything.
 *
 * That is also why it moved FIRST. The rest of the stop pipeline shares roughly
 * ten pieces of mutable factory state - the sync manager it claims ownership of
 * before awaiting, the store subscription, the last sync result, the
 * re-entrancy flags - and moving those is a design change rather than a
 * relocation.
 *
 * WHAT IT DOES NOT DO: decide anything. It is a record builder plus the one
 * write, so what a finished session claims about itself can be asserted
 * directly rather than through a stop flow that also stops cameras.
 *
 * @see session-metadata-record.ts.md
 */

import {
  gpsPathToCoverageCells,
  H3_RESOLUTION,
} from 'gps-plus-slam-app-framework/geo';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { getBuildInfo, type BuildInfo } from '../utils/build-info';

const log = createLogger('session-metadata');

/**
 * A GPS sample, reduced to what the coverage index needs.
 *
 * Module-private: nothing outside names it, and knip fails the root dead-code
 * check on an exported type nobody imports. It is reachable structurally as
 * `SessionMetadataInput["gpsPositions"][number]` if that ever changes.
 */
interface MetadataGpsPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface SessionMetadataInput {
  /** Epoch ms captured the moment recording stopped, before any slow I/O. */
  readonly endTime: number;
  /** `sessionMetadata.startTime` from the store, when it is there. */
  readonly startTime: number | undefined;
  readonly contextTag: string;
  readonly gpsPositions: readonly MetadataGpsPoint[];
  readonly frameCount: number;
  readonly userAgent: string;
  readonly pageUrl: string | undefined;
}

/** The shape the store's writer accepts. Kept structural on purpose. */
export interface SessionMetadataRecord {
  readonly version: 1;
  readonly odomCoordVersion: 5;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly contextTag: string;
  readonly actionCount: number;
  readonly frameCount: number;
  readonly userAgent: string;
  /**
   * TYPED, NOT `unknown`. The store's writer takes the concrete shape, so a
   * loose type here only moves the mismatch to the call site - which is where
   * the gate found it, one stage after a narrower typecheck had passed.
   */
  readonly build?: BuildInfo;
  readonly pageUrl: string | undefined;
  /**
   * MUTABLE, matching the store's writer rather than this module's taste.
   * A `readonly` array is the better default and is not assignable to the
   * `string[]` the persisted shape declares - being stricter than the consumer
   * is still a type error.
   */
  readonly h3Cells: string[];
  readonly h3Resolution: number;
}

/**
 * Builds the record. Pure: no I/O, no clock, no store.
 *
 * **A MISSING `startTime` FALLS BACK TO `endTime`, and that is a known lie
 * rather than a sensible default.** It means a session whose start was never
 * recorded reports a duration of approximately zero. The caller logs an error
 * when it happens, because the honest alternative - refusing to write metadata
 * at all - would lose the recording's only self-description over a field that
 * is missing precisely when something else has already gone wrong.
 */
export function buildSessionMetadataRecord(
  input: SessionMetadataInput
): SessionMetadataRecord {
  let build: BuildInfo | undefined;
  try {
    build = getBuildInfo();
  } catch (error) {
    // Build metadata is stamped at deploy time and simply absent in a dev
    // server. Its absence must not cost the session its metadata.
    log.warn('Build metadata unavailable for session metadata', error);
  }

  // Per-tour H3 coverage index (Step 2 / D1): deduped res-11 cells the GPS path
  // crossed, so the map-centric browser can place this tour without unzipping
  // its GPS data. Computed at stop, while the path is still in state.
  const h3Cells = gpsPathToCoverageCells(
    input.gpsPositions.map((p) => ({ lat: p.latitude, lng: p.longitude }))
  );

  return {
    version: 1,
    odomCoordVersion: 5,
    startedAt: new Date(input.startTime ?? input.endTime).toISOString(),
    endedAt: new Date(input.endTime).toISOString(),
    contextTag: input.contextTag,
    actionCount: input.gpsPositions.length,
    frameCount: input.frameCount,
    userAgent: input.userAgent,
    ...(build ? { build } : {}),
    pageUrl: input.pageUrl,
    h3Cells,
    h3Resolution: H3_RESOLUTION,
  };
}

/**
 * Writes the record, and never lets a failure take the stop flow down with it.
 *
 * The stop flow past this point ends the session, builds the summary and
 * returns the user to a usable screen. A recording whose metadata failed to
 * write is still a recording; a stop that threw here would leave the controls
 * on screen with the button stuck busy.
 */
export async function writeSessionMetadata(
  writer: (record: SessionMetadataRecord) => Promise<void>,
  input: SessionMetadataInput
): Promise<void> {
  try {
    await writer(buildSessionMetadataRecord(input));
  } catch (err) {
    log.error('Failed to write session metadata:', err);
  }
}
