/**
 * The session-metadata record (`session.json`) a finished recording leaves
 * behind.
 *
 * WHY IT IS ITS OWN MODULE. It was forty-five lines inside the Recorder's
 * `performStop`, which is one function inside `createRecordingSessionHandlers`
 * - 717 lines carrying eight distinct concerns. This is the piece of that
 * pipeline whose inputs are all VALUES: it closes over no mutable state of the
 * enclosing factory, so it could move out without threading anything.
 *
 * WHY IT IS IN THE FRAMEWORK (2026-09-28). A second app writes recordings
 * now: the Tour Viewer's troubleshooting recording, which must replay in the
 * Recorder's desktop replay. The replay decides whether to migrate a
 * recording from `odomCoordVersion`, so two writers of this record must agree
 * on it - which is shared behaviour, and shared behaviour has one
 * implementation (DEC-H3). The build info, which each app stamps at its own
 * build, is injected rather than read here.
 *
 * WHAT IT DOES NOT DO: decide anything. It is a record builder plus the one
 * write, so what a finished session claims about itself can be asserted
 * directly rather than through a stop flow that also stops cameras.
 *
 * @see session-metadata-record.ts.md
 */

import { gpsPathToCoverageCells, H3_RESOLUTION } from '../geo/h3-proximity';
import { createLogger } from '../utils/logger';
import type { SessionMetadata } from './opfs-storage';

const log = createLogger('session-metadata');

/** Build/environment info, as the persisted shape declares it. */
type SessionBuildInfo = NonNullable<SessionMetadata['build']>;

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
  /** When the recording started (the first `startSession`), when known. */
  readonly startTime: number | undefined;
  readonly contextTag: string;
  readonly gpsPositions: readonly MetadataGpsPoint[];
  readonly frameCount: number;
  readonly userAgent: string;
  readonly pageUrl: string | undefined;
  /**
   * The app's build stamp. A getter, because reading it may THROW where the
   * build constants were never injected (a dev server) - and that must cost
   * the record its `build` field, not the record. Absent: no `build` field.
   */
  readonly getBuildInfo?: () => SessionBuildInfo;
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
  readonly build?: SessionBuildInfo;
  /**
   * Absent, not `undefined`, when there is no url: the persisted shape
   * declares it optional, and under `exactOptionalPropertyTypes` an explicit
   * `undefined` does not fit it. The written JSON is the same either way.
   */
  readonly pageUrl?: string;
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
  let build: SessionBuildInfo | undefined;
  try {
    build = input.getBuildInfo?.();
  } catch (error) {
    // Build metadata is stamped at deploy time and simply absent in a dev
    // server. Its absence must not cost the session its metadata.
    log.warn('Build metadata unavailable for session metadata', error);
  }

  // Per-tour H3 coverage index (Step 2 / D1): deduped res-11 cells the GPS path
  // crossed, so the map-centric browser can place this tour without unzipping
  // its GPS data.
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
    ...(input.pageUrl === undefined ? {} : { pageUrl: input.pageUrl }),
    h3Cells,
    h3Resolution: H3_RESOLUTION,
  };
}

/**
 * The page url without its query and hash, for a record that leaves the
 * device: a query can carry a private link (the Tour Viewer's `?qr=`).
 * `undefined` without a url.
 */
export function sanitizedPageUrl(href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }

  try {
    const url = new URL(href);
    // Clearing search/hash and using toString() (rather than origin+pathname)
    // preserves the scheme correctly for URLs with opaque origins
    // (e.g. file:// where url.origin is the literal string "null").
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    const queryIndex = href.indexOf('?');
    const hashIndex = href.indexOf('#');
    const cutIndex = [queryIndex, hashIndex]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];

    return cutIndex === undefined ? href : href.slice(0, cutIndex);
  }
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
