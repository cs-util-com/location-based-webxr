/**
 * What a finished recording claims about itself.
 *
 * WHY THESE TESTS EXIST NOW AND NOT BEFORE. This record was built inside
 * `performStop`, so every assertion about it had to be made through a flow that
 * also stops cameras, drains a write queue, syncs to a file handle and renders a
 * summary screen. The 85 tests around that flow check that it HAPPENS; almost
 * none check what it SAYS, because saying so meant standing up the whole stop.
 *
 * The record is what the map-centric browser reads to place a tour without
 * unzipping it, and what a support question ("which build was this?") is
 * answered from. It is worth being able to assert directly.
 *
 * @see session-metadata-record.ts.md
 */

import { describe, it, expect, vi } from 'vitest';

import {
  buildSessionMetadataRecord,
  writeSessionMetadata,
  type SessionMetadataInput,
} from './session-metadata-record';

const BASE: SessionMetadataInput = {
  endTime: Date.UTC(2026, 8, 22, 10, 30, 0),
  startTime: Date.UTC(2026, 8, 22, 10, 0, 0),
  contextTag: 'cellar',
  gpsPositions: [
    { latitude: 50.9231, longitude: 6.9445 },
    { latitude: 50.9232, longitude: 6.9446 },
  ],
  frameCount: 12,
  userAgent: 'test-agent/1.0',
  pageUrl: 'https://example.invalid/recorder',
};

describe('buildSessionMetadataRecord', () => {
  it('reports the session it actually recorded', () => {
    const record = buildSessionMetadataRecord(BASE);

    expect(record.startedAt).toBe('2026-09-22T10:00:00.000Z');
    expect(record.endedAt).toBe('2026-09-22T10:30:00.000Z');
    expect(record.contextTag).toBe('cellar');
    // `actionCount` is the GPS sample count, which is what it has always been -
    // pinned here because the name suggests otherwise and a reader could
    // "correct" it to the action-log length.
    expect(record.actionCount).toBe(2);
    expect(record.frameCount).toBe(12);
  });

  it('carries a coverage cell for every distinct place the walk touched', () => {
    // THE FIELD THE TOUR BROWSER EXISTS ON. Without it, placing a recording on
    // a map means unzipping its GPS data - which is the whole cost the index
    // was added to avoid. Two samples a metre apart share one res-11 cell, so
    // the count is about de-duplication rather than about sample count.
    const record = buildSessionMetadataRecord(BASE);

    expect(record.h3Cells.length).toBeGreaterThan(0);
    expect(new Set(record.h3Cells).size).toBe(record.h3Cells.length);
    expect(record.h3Resolution).toBe(11);
  });

  it('writes an empty coverage index rather than failing on a walk with no fixes', () => {
    // A recording made indoors with no GPS lock is still a recording, and its
    // metadata is the only thing that can say so.
    const record = buildSessionMetadataRecord({ ...BASE, gpsPositions: [] });

    expect(record.h3Cells).toEqual([]);
    expect(record.actionCount).toBe(0);
  });

  it('falls back to the end time when the start was never recorded, which is a KNOWN lie', () => {
    // Not a sensible default: it reports a duration of about zero. It is the
    // lesser of two evils - refusing to write would lose the recording's only
    // self-description over a field that is missing precisely when something
    // else has already gone wrong - and the caller logs an error when it
    // happens. Pinned so nobody "fixes" the fallback into a throw without
    // reading that argument.
    const record = buildSessionMetadataRecord({
      ...BASE,
      startTime: undefined,
    });

    expect(record.startedAt).toBe(record.endedAt);
  });
});

describe('writeSessionMetadata', () => {
  it('never lets a failed write take the stop flow down', () => {
    // Everything after this point in `performStop` ends the session, builds the
    // summary and returns the user to a usable screen. A throw here would leave
    // the recording controls up with the Stop button stuck on "Stopping…" - a
    // bricked UI after a successful recording.
    const writer = vi.fn().mockRejectedValue(new Error('quota exceeded'));

    return expect(writeSessionMetadata(writer, BASE)).resolves.toBeUndefined();
  });

  it('hands the writer exactly the record it built', async () => {
    const writer = vi.fn().mockResolvedValue(undefined);

    await writeSessionMetadata(writer, BASE);

    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0]?.[0]).toEqual(buildSessionMetadataRecord(BASE));
  });
});
