/**
 * What a finished recording claims about itself.
 *
 * WHY THESE TESTS EXIST NOW AND NOT BEFORE. This record was built inside
 * the Recorder's `performStop`, so every assertion about it had to be made
 * through a flow that also stops cameras, drains a write queue, syncs to a
 * file handle and renders a summary screen. The 85 tests around that flow
 * check that it HAPPENS; almost none check what it SAYS, because saying so
 * meant standing up the whole stop.
 *
 * The record is what the map-centric browser reads to place a tour without
 * unzipping it, and what a support question ("which build was this?") is
 * answered from. It is worth being able to assert directly - and since
 * 2026-09-28 it is written by two apps (the Recorder and the Tour Viewer's
 * troubleshooting recording), which is why it lives in the framework.
 *
 * @see session-metadata-record.ts.md
 */

import { describe, it, expect, vi } from 'vitest';

import {
  buildSessionMetadataRecord,
  sanitizedPageUrl,
  writeSessionMetadata,
  type SessionMetadataInput,
} from './session-metadata-record';

const BUILD = {
  commitHash: 'a1b2c3d',
  appVersion: '0.1.0',
  libraryVersion: '1.25.0',
  frameworkVersion: '1.24.0',
  buildTime: '2026-09-28T10:00:00.000Z',
};

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

  it('declares the current odometry era, so a replay does not migrate it as era 1', () => {
    // A recording WITHOUT this field is read as era 1 (raw WebXR, `gpsPoint`
    // payloads) and rewritten by the Recorder's migration - wrong for every
    // recording made today, the Tour Viewer's included.
    expect(buildSessionMetadataRecord(BASE).odomCoordVersion).toBe(5);
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

  it('leaves the page url OUT when there is none, rather than writing undefined', () => {
    // The persisted shape declares it optional; a consumer compiled with
    // `exactOptionalPropertyTypes` (the Tour Viewer) cannot hand an explicit
    // `undefined` to the writer.
    const record = buildSessionMetadataRecord({ ...BASE, pageUrl: undefined });

    expect('pageUrl' in record).toBe(false);
    expect(buildSessionMetadataRecord(BASE).pageUrl).toBe(
      'https://example.invalid/recorder'
    );
  });

  it('stamps the build info the CALLER injects', () => {
    // Injected rather than read here: the build constants are each app's own
    // (Vite `define` blocks), and the framework cannot know any app's.
    const record = buildSessionMetadataRecord({
      ...BASE,
      getBuildInfo: () => BUILD,
    });

    expect(record.build).toEqual(BUILD);
  });

  it('omits the build info when there is none, or when reading it throws', () => {
    // Stamped at deploy time and simply absent in a dev server - its absence
    // must not cost the session its metadata.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = buildSessionMetadataRecord({
      ...BASE,
      getBuildInfo: () => {
        throw new Error('Missing or invalid build metadata: __BUILD_COMMIT__');
      },
    });
    warn.mockRestore();

    expect('build' in throwing).toBe(false);
    expect('build' in buildSessionMetadataRecord(BASE)).toBe(false);
  });
});

describe('sanitizedPageUrl', () => {
  // Why: the page URL goes into a file that is handed to other people. A
  // Tour Viewer launch carries the tour's link in `?qr=` (possibly a private
  // Drive link), so the query and the hash never leave the device.
  it('drops the query and the hash', () => {
    expect(
      sanitizedPageUrl('https://example.com/tour/?qr=https%3A%2F%2Fx#frag')
    ).toBe('https://example.com/tour/');
  });

  it('keeps the scheme of an opaque-origin url (file://)', () => {
    expect(sanitizedPageUrl('file:///C:/foo/index.html?x=1')).toBe(
      'file:///C:/foo/index.html'
    );
  });

  it('is undefined without a url', () => {
    expect(sanitizedPageUrl(undefined)).toBeUndefined();
    expect(sanitizedPageUrl('')).toBeUndefined();
  });

  it('still cuts a string the URL parser refuses at its first ? or #', () => {
    expect(sanitizedPageUrl('not a url#a?b')).toBe('not a url');
    expect(sanitizedPageUrl('not a url')).toBe('not a url');
  });
});

describe('writeSessionMetadata', () => {
  it('never lets a failed write take the stop flow down', async () => {
    // Everything after this point in `performStop` ends the session, builds the
    // summary and returns the user to a usable screen. A throw here would leave
    // the recording controls up with the Stop button stuck on "Stopping…" - a
    // bricked UI after a successful recording.
    const writer = vi.fn().mockRejectedValue(new Error('quota exceeded'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(writeSessionMetadata(writer, BASE)).resolves.toBeUndefined();
    error.mockRestore();
  });

  it('hands the writer exactly the record it built', async () => {
    const writer = vi.fn().mockResolvedValue(undefined);

    await writeSessionMetadata(writer, BASE);

    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0]?.[0]).toEqual(buildSessionMetadataRecord(BASE));
  });
});
