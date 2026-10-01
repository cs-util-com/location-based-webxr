/**
 * The GPS observations a recorded action carries, whichever of the core's two
 * GPS actions it is (core 1.26): `gpsData/recordGpsEvent` carries one,
 * `gpsData/recordGpsEventBatch` carries several that the store solves once
 * (the Tour Viewer's code votes and keep-alive ticks, authoring plan
 * 2026-09-28-0953 D18). Every reader of a recording that wants "the GPS
 * events" goes through here, so a fix inside a batch never vanishes from it
 * (the M2e/M2f milestone review #5 found three readers that knew only the
 * single action).
 *
 * @see gps-event-actions.ts.md
 */

import { recordGpsEvent, recordGpsEventBatch } from 'gps-plus-slam-js';

/** The two action types that carry GPS observations. */
export const GPS_EVENT_ACTION_TYPES: readonly string[] = [
  recordGpsEvent.type,
  recordGpsEventBatch.type,
];

/**
 * The GPS event payloads `action` carries, in recorded order: `[payload]` for
 * a `recordGpsEvent`, the batch's `events` for a `recordGpsEventBatch`, and
 * `[]` for any other action, a missing payload, or a batch without an
 * `events` list. A sparse batch yields its present entries.
 *
 * The entries are NOT validated - each reader checks the fields it reads, as
 * it did for the single action. That keeps every reader's handling of a
 * malformed fix exactly what it was, now for each event of a batch too.
 */
export function recordedGpsEventPayloads(action: unknown): readonly unknown[] {
  if (typeof action !== 'object' || action === null) return [];
  const { type, payload } = action as { type?: unknown; payload?: unknown };
  if (type === recordGpsEvent.type) {
    return payload === undefined ? [] : [payload];
  }
  if (type !== recordGpsEventBatch.type) return [];
  if (typeof payload !== 'object' || payload === null) return [];
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  // `filter` skips the holes of a sparse array, which `events.length`
  // and an index loop would read as undefined entries.
  return events.filter(() => true);
}
