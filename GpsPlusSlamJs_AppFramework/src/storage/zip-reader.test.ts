/**
 * Unit tests for zip-reader.ts
 *
 * Why these tests matter: The zip-reader module provides production-ready
 * utilities for reading recording zip files. It extracts action JSON files
 * and session metadata, enabling replay, import, and validation workflows.
 * These tests use a programmatically produced zip (via the round-trip
 * helper) to ensure fidelity with the current app format.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Reader } from '@zip.js/zip.js';
import {
  readZipEntries,
  loadActionsFromZip,
  loadSessionMetadata,
  loadSessionMetadataFromBlob,
  loadEntriesFromSubdir,
  toZipReader,
  MAX_ACTION_FILE_SIZE,
  type ZipActionEntry,
} from './zip-reader';
import { ArchiveLimitError } from './archive-limits';
import { DecompressionBudget } from './capped-zip-entries';
import {
  produceTestZip,
  type TestZipResult,
} from '../test-utils/zip-round-trip-helpers';

describe('zip-reader', () => {
  // Zip data produced by the round-trip helper once in beforeAll
  // and shared across all read-only tests.
  let testZip: TestZipResult;
  let zipData: Uint8Array;
  let entries: Awaited<ReturnType<typeof readZipEntries>>;
  let actions: ZipActionEntry[];
  let sessionMetadata: Awaited<ReturnType<typeof loadSessionMetadata>>;

  beforeAll(async () => {
    testZip = await produceTestZip();
    zipData = testZip.zipData;
    entries = await readZipEntries(zipData);
    actions = await loadActionsFromZip(zipData);
    sessionMetadata = await loadSessionMetadata(zipData);
  });

  describe('readZipEntries', () => {
    it('returns all file entries from the produced zip', () => {
      // Why: basic smoke test that the zip can be opened and entries enumerated.
      // The produced zip has action files + frame files + session.json
      // (directory entries may or may not be present depending on ZipWriter).
      const fileEntries = entries.filter((e) => !e.directory);
      expect(fileEntries.length).toBe(
        testZip.totalActionCount + testZip.frameCount + 1 // +1 for session.json
      );
    });

    it('includes file entries for actions, frames, and metadata', () => {
      // Why: callers need to find specific entry types by path
      const fileNames = entries
        .filter((e) => !e.directory)
        .map((e) => e.filename);
      const actionFiles = fileNames.filter((f) => f.startsWith('actions/'));
      const frameFiles = fileNames.filter((f) => f.startsWith('images/')); // renamed from frames/ (Q5)
      expect(actionFiles.length).toBe(testZip.totalActionCount);
      expect(frameFiles.length).toBe(testZip.frameCount);
      expect(fileNames).toContain('session.json');
    });

    it('entries have filename and size properties', () => {
      // Why: downstream code relies on filename for filtering and sorting
      for (const entry of entries) {
        expect(entry.filename).toBeDefined();
        expect(typeof entry.filename).toBe('string');
      }
    });
  });

  describe('loadActionsFromZip', () => {
    it('loads all actions from the produced recording', () => {
      // Why: validates correct filtering and parsing of actions/ JSON files
      expect(actions).toHaveLength(testZip.totalActionCount);
    });

    it('returns actions sorted by index (filename order)', () => {
      // Why: replay depends on chronological ordering of actions
      for (let i = 1; i < actions.length; i++) {
        expect(actions[i].index).toBeGreaterThan(actions[i - 1].index);
      }
    });

    it('each action has a type string and numeric index', () => {
      // Why: Redux actions must have a type field; index must be numeric for ordering
      for (const entry of actions) {
        expect(typeof entry.action.type).toBe('string');
        expect(entry.action.type.length).toBeGreaterThan(0);
        expect(typeof entry.index).toBe('number');
        expect(entry.filename).toMatch(/\.json$/);
      }
    });

    it('first action is recorder/startSession', () => {
      // Why: recordings must start with a startSession action
      expect(actions[0].action.type).toBe('recording/startSession');
    });

    it('preserves action payloads', () => {
      // Why: payloads carry state data needed for replay (GPS coords, session metadata, etc.)
      // startSession should have payload with scenarioName
      const startAction = actions[0].action as {
        type: string;
        payload: { scenarioName: string };
      };
      expect(startAction.payload).toBeDefined();
      expect(startAction.payload.scenarioName).toBe(testZip.scenarioName);
    });

    it('extracts correct index from filenames', () => {
      // Why: index is derived from zero-padded filenames like 000001.json
      expect(actions[0].index).toBe(1);
      expect(actions[0].filename).toContain('000001.json');
      expect(actions[actions.length - 1].index).toBe(testZip.totalActionCount);
    });
  });

  describe('loadSessionMetadata', () => {
    it('returns session metadata when session.json is present', () => {
      // Why: the round-trip zip includes session.json with full metadata
      // (post-F2-fix behavior); the reader must parse it correctly
      expect(sessionMetadata).not.toBeNull();
      expect(sessionMetadata!.contextTag).toBe(testZip.scenarioName);
      expect(sessionMetadata!.version).toBe(1);
      expect(sessionMetadata!.actionCount).toBe(testZip.totalActionCount);
      expect(sessionMetadata!.frameCount).toBe(testZip.frameCount);
    });
  });

  describe('size limit protection', () => {
    it('exports a MAX_ACTION_FILE_SIZE constant', () => {
      // Why: consumers may need the limit for UI messaging or pre-validation
      expect(typeof MAX_ACTION_FILE_SIZE).toBe('number');
      expect(MAX_ACTION_FILE_SIZE).toBe(1_048_576); // 1 MB
    });

    it('all real action entries are well under the default limit', () => {
      // Why: validates that the production limit is generous enough for real data
      // and that the uncompressedSize property is available on entries
      const fileEntries = entries.filter((e) => !e.directory);
      expect(fileEntries.length).toBeGreaterThan(0);
      for (const e of fileEntries) {
        expect(e.uncompressedSize).toBeLessThan(MAX_ACTION_FILE_SIZE);
      }
    });

    it('loadActionsFromZip throws when an entry exceeds maxFileSize', async () => {
      // Why: verifies the size guard rejects oversized entries before decompression.
      // Uses a tiny maxFileSize with the real zip so real entries trigger the guard.
      await expect(
        loadActionsFromZip(zipData, /* maxFileSize */ 10)
      ).rejects.toThrow(/exceeds maximum allowed size/);
    });

    it('loadActionsFromZip succeeds when entries are within maxFileSize', async () => {
      // Why: confirms the guard does not interfere when entries are within limits.
      // Uses a very large limit to ensure all entries pass.
      const result = await loadActionsFromZip(zipData, 10_000_000);
      expect(result).toHaveLength(testZip.totalActionCount);
    });

    it('loadSessionMetadata throws when session.json exceeds maxFileSize', async () => {
      // Why: session.json should also be size-guarded to prevent OOM.
      // We create a programmatic zip with a session.json to test this path.
      const { ZipWriter, Uint8ArrayWriter, TextReader } =
        await import('@zip.js/zip.js');

      const zipWriter = new ZipWriter(new Uint8ArrayWriter());
      await zipWriter.add('session.json', new TextReader('{"hello":"world"}'));
      const zipBytes = await zipWriter.close();

      // With a limit of 5 bytes, the 17-byte session.json should be rejected
      await expect(
        loadSessionMetadata(new Uint8Array(zipBytes), 5)
      ).rejects.toThrow(/exceeds maximum allowed size/);
    });
  });

  describe('unexpected action filenames', () => {
    /** Helper: create a synthetic zip with given action filenames */
    async function createZipWithActions(
      files: { name: string; content: string }[]
    ): Promise<Uint8Array> {
      const { ZipWriter, Uint8ArrayWriter, TextReader } =
        await import('@zip.js/zip.js');
      const zipWriter = new ZipWriter(new Uint8ArrayWriter());
      for (const f of files) {
        await zipWriter.add(f.name, new TextReader(f.content));
      }
      const zipBytes = await zipWriter.close();
      return new Uint8Array(zipBytes);
    }

    it('logs a warning for action files with non-numeric names', async () => {
      // Why: files like "actions/my-notes.json" pass the filter but produce
      // NaN indices. A warning makes diagnosis easier without rejecting
      // the file outright — the action is still dispatched.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const data = await createZipWithActions([
        {
          name: 'actions/000001.json',
          content: '{"type":"recording/startSession"}',
        },
        {
          name: 'actions/my-notes.json',
          content: '{"type":"custom/note","payload":"hello"}',
        },
      ]);

      const actions = await loadActionsFromZip(data);

      // Both files should still be loaded (not rejected)
      expect(actions).toHaveLength(2);

      // A warning should have been logged about the unexpected filename
      // (the logger calls console.warn for WARN-level messages)
      const allWarnArgs = warnSpy.mock.calls
        .map((call) => call.join(' '))
        .join(' ');
      expect(allWarnArgs).toMatch(/my-notes\.json/);
      expect(allWarnArgs).toMatch(/unexpected|non-numeric|NaN/i);

      warnSpy.mockRestore();
    });

    it('still includes actions with unexpected names in results', async () => {
      // Why: the user explicitly wants all action files dispatched, even
      // those with unexpected names — only a warning, not rejection.
      const data = await createZipWithActions([
        {
          name: 'actions/000001.json',
          content: '{"type":"recording/startSession"}',
        },
        {
          name: 'actions/readme.json',
          content: '{"type":"custom/readme"}',
        },
        {
          name: 'actions/000002.json',
          content: '{"type":"recording/stopSession"}',
        },
      ]);

      const actions = await loadActionsFromZip(data);

      expect(actions).toHaveLength(3);
      // The non-numeric file should still appear with NaN index
      const oddEntry = actions.find((a) => a.filename.includes('readme.json'));
      expect(oddEntry).toBeDefined();
      expect(oddEntry!.action.type).toBe('custom/readme');
      expect(Number.isNaN(oddEntry!.index)).toBe(true);
    });

    it('does not warn for standard numeric action filenames', async () => {
      // Why: normal files should not trigger any warnings
      const data = await createZipWithActions([
        {
          name: 'actions/000001.json',
          content: '{"type":"recording/startSession"}',
        },
        {
          name: 'actions/000002.json',
          content: '{"type":"recording/gps"}',
        },
      ]);

      // Spy on console.warn to confirm no warnings
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const actions = await loadActionsFromZip(data);

      expect(actions).toHaveLength(2);
      // No warn calls about unexpected filenames
      const zipReaderWarns = warnSpy.mock.calls.filter((call) =>
        call.some(
          (arg) =>
            typeof arg === 'string' &&
            (arg.includes('ZipReader') || arg.includes('unexpected'))
        )
      );
      expect(zipReaderWarns).toHaveLength(0);

      warnSpy.mockRestore();
    });
  });

  describe('malformed action JSON files', () => {
    /** Helper: create a synthetic zip with given action filenames */
    async function createZipWithActions(
      files: { name: string; content: string }[]
    ): Promise<Uint8Array> {
      const { ZipWriter, Uint8ArrayWriter, TextReader } =
        await import('@zip.js/zip.js');
      const zipWriter = new ZipWriter(new Uint8ArrayWriter());
      for (const f of files) {
        await zipWriter.add(f.name, new TextReader(f.content));
      }
      const zipBytes = await zipWriter.close();
      return new Uint8Array(zipBytes);
    }

    it('skips malformed JSON and returns remaining valid actions', async () => {
      // Why: A single corrupt/truncated action file (plausible after a crash
      // or OPFS write failure) must not crash the entire replay. The sibling
      // function loadGpsPathFromBlob already wraps JSON.parse in try/catch
      // and continues; loadActionsFromZip should do the same.
      const data = await createZipWithActions([
        {
          name: 'actions/000001.json',
          content: '{"type":"gpsData/setZeroPos","payload":{"lat":1,"lon":2}}',
        },
        { name: 'actions/000002.json', content: '{ INVALID JSON !!!' },
        {
          name: 'actions/000003.json',
          content: '{"type":"recording/endSession"}',
        },
      ]);

      const result = await loadActionsFromZip(data);

      expect(result).toHaveLength(2);
      expect(result[0]!.action.type).toBe('gpsData/setZeroPos');
      expect(result[1]!.action.type).toBe('recording/endSession');
    });

    it('logs a warning for each skipped malformed entry', async () => {
      // Why: silent skipping would make debugging harder; a warning lets
      // the user/dev know data was lost in the recording.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const data = await createZipWithActions([
        {
          name: 'actions/000001.json',
          content: '{"type":"recording/startSession"}',
        },
        { name: 'actions/000002.json', content: 'not json at all' },
        { name: 'actions/000003.json', content: '{truncated' },
      ]);

      const result = await loadActionsFromZip(data);

      expect(result).toHaveLength(1);

      // Both malformed files should produce warnings
      const allWarnText = warnSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(allWarnText).toMatch(/000002\.json/);
      expect(allWarnText).toMatch(/000003\.json/);

      warnSpy.mockRestore();
    });

    it('returns empty array when all action files are malformed', async () => {
      // Why: even if every file is corrupt, the function should not throw —
      // the caller gets an empty array and can handle it gracefully.
      const data = await createZipWithActions([
        { name: 'actions/000001.json', content: '' },
        { name: 'actions/000002.json', content: 'garbage' },
      ]);

      const result = await loadActionsFromZip(data);
      expect(result).toHaveLength(0);
    });
  });

  describe('action shape validation (valid JSON but invalid action structure)', () => {
    // Why this suite matters:
    // JSON.parse succeeds for values like null, 42, "hello", [] — all of which
    // lack the required `type` string. The `as RecordedAction` cast provides no
    // runtime safety. These tests verify that loadActionsFromZip rejects such
    // entries instead of silently pushing them into the results array.

    /** Helper: create a synthetic zip with given action filenames */
    async function createZipWithActions(
      files: { name: string; content: string }[]
    ): Promise<Uint8Array> {
      const { ZipWriter, Uint8ArrayWriter, TextReader } =
        await import('@zip.js/zip.js');
      const zipWriter = new ZipWriter(new Uint8ArrayWriter());
      for (const f of files) {
        await zipWriter.add(f.name, new TextReader(f.content));
      }
      const zipBytes = await zipWriter.close();
      return new Uint8Array(zipBytes);
    }

    it.each([
      { label: 'null', content: 'null' },
      { label: 'number', content: '42' },
      { label: 'string', content: '"hello"' },
      { label: 'boolean', content: 'true' },
      { label: 'array', content: '[1,2,3]' },
    ])(
      'skips action file containing valid JSON $label (not an object with type)',
      async ({ content }) => {
        // Why: JSON.parse("null") etc. succeeds but the result lacks a `type`
        // string. loadActionsFromZip must skip these rather than push them.
        const data = await createZipWithActions([
          {
            name: 'actions/000001.json',
            content: '{"type":"recording/startSession"}',
          },
          { name: 'actions/000002.json', content },
          {
            name: 'actions/000003.json',
            content: '{"type":"recording/endSession"}',
          },
        ]);

        const result = await loadActionsFromZip(data);

        expect(result).toHaveLength(2);
        expect(result[0]!.action.type).toBe('recording/startSession');
        expect(result[1]!.action.type).toBe('recording/endSession');
      }
    );

    it('skips an object without a type property', async () => {
      // Why: { "payload": "data" } is a valid JSON object but not a valid
      // Redux action — the `type` field is required.
      const data = await createZipWithActions([
        {
          name: 'actions/000001.json',
          content: '{"type":"recording/startSession"}',
        },
        {
          name: 'actions/000002.json',
          content: '{"payload":"no type here"}',
        },
      ]);

      const result = await loadActionsFromZip(data);

      expect(result).toHaveLength(1);
      expect(result[0]!.action.type).toBe('recording/startSession');
    });

    it('skips an object with a non-string type property', async () => {
      // Why: { "type": 123 } passes `typeof parsed === 'object'` but type
      // must be a string for Redux actions.
      const data = await createZipWithActions([
        {
          name: 'actions/000001.json',
          content: '{"type":"recording/startSession"}',
        },
        { name: 'actions/000002.json', content: '{"type":123}' },
      ]);

      const result = await loadActionsFromZip(data);

      expect(result).toHaveLength(1);
      expect(result[0]!.action.type).toBe('recording/startSession');
    });

    it('logs warnings for each skipped invalid-shape entry', async () => {
      // Why: callers/developers need visibility when data is silently dropped.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const data = await createZipWithActions([
        { name: 'actions/000001.json', content: 'null' },
        { name: 'actions/000002.json', content: '{"payload":"no type"}' },
        {
          name: 'actions/000003.json',
          content: '{"type":"recording/ok"}',
        },
      ]);

      const result = await loadActionsFromZip(data);
      expect(result).toHaveLength(1);

      const allWarnText = warnSpy.mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(allWarnText).toMatch(/000001\.json/);
      expect(allWarnText).toMatch(/000002\.json/);
      expect(allWarnText).not.toMatch(/000003\.json/);

      warnSpy.mockRestore();
    });
  });
});

// ============================================================================
// loadSessionMetadataFromBlob (memory-efficient metadata reading)
// ============================================================================

describe('loadSessionMetadataFromBlob', () => {
  // Why this suite matters:
  // The original loadSessionMetadata requires the caller to load the entire zip
  // file into a Uint8Array. For metadata-only discovery (discoverScenariosFromZipMetadata),
  // this wastes memory — zip.js can read just the central directory + session.json
  // entry from a Blob without buffering the full file. This Blob-based variant
  // enables memory-efficient scanning of many large zip files.

  let testZip: TestZipResult;

  beforeAll(async () => {
    testZip = await produceTestZip();
  });

  it('returns the same metadata as loadSessionMetadata for a valid zip', async () => {
    // Why: The Blob-based variant must produce identical results to the
    // Uint8Array-based one — it's a memory optimization, not a behavior change.
    const blob = new Blob([testZip.zipData as BlobPart]);
    const blobResult = await loadSessionMetadataFromBlob(blob);
    const arrayResult = await loadSessionMetadata(testZip.zipData);

    expect(blobResult).toEqual(arrayResult);
  });

  it('returns session metadata with scenarioName from a Blob', async () => {
    // Why: Basic functionality check — read scenarioName (now carried in
    // contextTag) from session.json inside a zip provided as a Blob.
    const blob = new Blob([testZip.zipData as BlobPart]);
    const metadata = await loadSessionMetadataFromBlob(blob);

    expect(metadata).not.toBeNull();
    expect(metadata!.contextTag).toBe(testZip.scenarioName);
    expect(metadata!.version).toBe(1);
  });

  it('returns null when session.json is absent from the zip', async () => {
    // Why: Graceful degradation — pre-F2-fix zips may not have session.json.
    const { ZipWriter, Uint8ArrayWriter, TextReader } =
      await import('@zip.js/zip.js');
    const zipWriter = new ZipWriter(new Uint8ArrayWriter());
    await zipWriter.add(
      'actions/000001.json',
      new TextReader('{"type":"recording/startSession"}')
    );
    const zipBytes = await zipWriter.close();
    const blob = new Blob([zipBytes]);

    const metadata = await loadSessionMetadataFromBlob(blob);
    expect(metadata).toBeNull();
  });

  it('throws when session.json exceeds maxFileSize', async () => {
    // Why: Size guard must still be enforced in the Blob path.
    const { ZipWriter, Uint8ArrayWriter, TextReader } =
      await import('@zip.js/zip.js');
    const zipWriter = new ZipWriter(new Uint8ArrayWriter());
    await zipWriter.add('session.json', new TextReader('{"hello":"world"}'));
    const zipBytes = await zipWriter.close();
    const blob = new Blob([zipBytes]);

    await expect(loadSessionMetadataFromBlob(blob, 5)).rejects.toThrow(
      /exceeds maximum allowed size/
    );
  });

  it('accepts a File object since File extends Blob', async () => {
    // Why: In the browser, handle.getFile() returns a File (which is a Blob).
    // The function must work with File objects directly — this is the real
    // call path in discoverScenariosFromZipMetadata.
    const file = new File([testZip.zipData as BlobPart], 'recording.zip', {
      type: 'application/zip',
    });
    const metadata = await loadSessionMetadataFromBlob(file);

    expect(metadata).not.toBeNull();
    expect(metadata!.contextTag).toBe(testZip.scenarioName);
  });
});

// ============================================================================
// loadGpsPathFromBlob
// ============================================================================

import { loadGpsPathFromBlob } from './zip-reader';

describe('loadGpsPathFromBlob', () => {
  // Why this suite matters:
  // UX feedback 2026-03-23 Issue 1 — when a session is selected in the replay
  // setup screen, a GPS path preview map is shown. This function extracts
  // GPS coordinates from a zip using BlobReader (memory-efficient, same pattern
  // as loadSessionMetadataFromBlob) without keeping all actions in memory.

  it('extracts GPS coordinates from a zip with GPS actions', async () => {
    // Why: Core happy-path — a realistic zip with 10 GPS events should
    // produce 10 coordinate pairs in the correct lat/lng order.
    const zip = await produceTestZip({
      gpsEventCount: 5,
      zeroPos: { lat: 50.0, lon: 8.0 },
    });
    const blob = new Blob([zip.zipData as BlobPart]);

    const coords = await loadGpsPathFromBlob(blob);

    expect(coords).toHaveLength(5);
    // Coordinates should match the produced pattern: lat = 50 + (i+1)*0.0001
    for (let i = 0; i < 5; i++) {
      expect(coords[i].lat).toBeCloseTo(50.0 + (i + 1) * 0.0001, 4);
      expect(coords[i].lng).toBeCloseTo(8.0 + (i + 1) * 0.0001, 4);
    }
  });

  it('ignores non-GPS actions (add2dImage, startSession, setZeroPos)', async () => {
    // Why: The zip contains many action types but only recordGpsEvent actions
    // have GPS coordinates. The function must filter correctly.
    const zip = await produceTestZip({
      gpsEventCount: 3,
      imagesBeforeSetZero: 4,
      imagesAfterSetZero: 4,
    });
    const blob = new Blob([zip.zipData as BlobPart]);

    const coords = await loadGpsPathFromBlob(blob);

    // Only 3 GPS events — images, startSession, and setZeroPos are excluded
    expect(coords).toHaveLength(3);
  });

  it('returns empty array for zip with no GPS actions', async () => {
    // Why: A recording might have zero GPS events (e.g., indoor-only session
    // that started before any GPS fix). Should return empty, not throw.
    const zip = await produceTestZip({ gpsEventCount: 0 });
    const blob = new Blob([zip.zipData as BlobPart]);

    const coords = await loadGpsPathFromBlob(blob);

    expect(coords).toEqual([]);
  });

  it('returns empty array for invalid/corrupted zip', async () => {
    // Why: Corrupted zips should not crash the preview — graceful degradation.
    const blob = new Blob([new Uint8Array([0, 1, 2, 3])]);

    const coords = await loadGpsPathFromBlob(blob);

    expect(coords).toEqual([]);
  });

  it('works with File objects (File extends Blob)', async () => {
    // Why: In production, we get File from FileSystemFileHandle.getFile().
    const zip = await produceTestZip({ gpsEventCount: 2 });
    const file = new File([zip.zipData as BlobPart], 'recording.zip', {
      type: 'application/zip',
    });

    const coords = await loadGpsPathFromBlob(file);

    expect(coords).toHaveLength(2);
  });

  it('returns coordinates in action-file order (chronological)', async () => {
    // Why: GPS path must be drawn as a polyline in temporal order.
    // Action files are numbered sequentially, so the coordinates should
    // follow the same order as the recording.
    const zip = await produceTestZip({
      gpsEventCount: 5,
      zeroPos: { lat: 10.0, lon: 20.0 },
    });
    const blob = new Blob([zip.zipData as BlobPart]);

    const coords = await loadGpsPathFromBlob(blob);

    // Each successive GPS event moves northeast: lat and lng should increase
    for (let i = 1; i < coords.length; i++) {
      expect(coords[i].lat).toBeGreaterThan(coords[i - 1].lat);
      expect(coords[i].lng).toBeGreaterThan(coords[i - 1].lng);
    }
  });

  it('omits accuracy when GPS events do not include latLongAccuracy', async () => {
    // Why: pre-accuracy recordings (and devices that don't report
    // GeolocationCoordinates.accuracy) must keep working — accuracy stays
    // undefined rather than being defaulted to 0 (which would render as a
    // point) or NaN.
    const zip = await produceTestZip({ gpsEventCount: 2 });
    const blob = new Blob([zip.zipData as BlobPart]);

    const coords = await loadGpsPathFromBlob(blob);

    expect(coords).toHaveLength(2);
    for (const c of coords) {
      expect(c.accuracy).toBeUndefined();
    }
  });

  it('extracts latLongAccuracy from GPS events when present', async () => {
    // Why: the 2D map preview draws a per-event accuracy circle. Without
    // this extraction the preview would have no accuracy data to visualize.
    const zip = await produceTestZip({
      gpsEventCount: 3,
      gpsAccuracy: 7.5,
    });
    const blob = new Blob([zip.zipData as BlobPart]);

    const coords = await loadGpsPathFromBlob(blob);

    expect(coords).toHaveLength(3);
    for (const c of coords) {
      expect(c.accuracy).toBe(7.5);
    }
  });

  it('reads every fix inside a recordGpsEventBatch, in order, between the single fixes around it', async () => {
    // Why (core 1.26; Tour Viewer authoring plan 2026-09-28-0953 D18): a
    // viewer recording carries a device fix together with its keep-alive
    // ring as ONE batch action. A reader that knew only `recordGpsEvent`
    // drew a track with every such fix missing (M2e/M2f milestone review
    // #5). Each event is read as the single action is read - an event
    // without coordinates is skipped alone, as a single one would be.
    const fix = (lat: number, accuracy?: number) => ({
      odomPosition: [0, 0, 0],
      odomRotation: [0, 0, 0, 1],
      rawGpsPoint: {
        id: `gps-${String(lat)}`,
        latitude: lat,
        longitude: 8,
        timestamp: 1_700_000_000_000,
        ...(accuracy === undefined ? {} : { latLongAccuracy: accuracy }),
      },
    });
    const { ZipWriter, Uint8ArrayWriter, TextReader } =
      await import('@zip.js/zip.js');
    const writer = new ZipWriter(new Uint8ArrayWriter());
    const actions = [
      { type: 'gpsData/recordGpsEvent', payload: fix(50.1, 3) },
      {
        type: 'gpsData/recordGpsEventBatch',
        payload: {
          events: [
            fix(50.2, 4),
            { ...fix(0), rawGpsPoint: { id: 'broken' } },
            fix(50.3, 5),
          ],
        },
      },
      { type: 'gpsData/recordGpsEvent', payload: fix(50.4) },
    ];
    for (const [i, action] of actions.entries()) {
      await writer.add(
        `actions/${String(i + 1).padStart(8, '0')}.json`,
        new TextReader(JSON.stringify(action))
      );
    }
    const blob = new Blob([await writer.close()]);

    const coords = await loadGpsPathFromBlob(blob);

    expect(coords).toEqual([
      { lat: 50.1, lng: 8, accuracy: 3 },
      { lat: 50.2, lng: 8, accuracy: 4 },
      { lat: 50.3, lng: 8, accuracy: 5 },
      { lat: 50.4, lng: 8 },
    ]);
  });

  it('draws only device fixes: synthetic QR votes and readings of an unknown source are left out', async () => {
    // Why (Tour Viewer authoring plan 2026-09-28-0953, M2e milestone review
    // #8): a code's votes are recorded as GPS events at points up to 30 m
    // along the code's face, where nobody walked - in the Tour Viewer inside
    // a batch, in the Recorder one `recordGpsEvent` each. This path is the
    // replay preview's track AND the Recorder's coverage backfill, so a vote
    // here draws a walk that never happened and marks cells nobody visited.
    // An unrecognised stamp is not rounded to "device" either (the core's
    // `gpsPointSourceOf` contract); an absent one is a device fix.
    const point = (lat: number, source?: unknown) => ({
      odomPosition: [0, 0, 0],
      odomRotation: [0, 0, 0, 1],
      rawGpsPoint: {
        id: `p-${String(lat)}`,
        latitude: lat,
        longitude: 8,
        timestamp: 1_700_000_000_000,
        ...(source === undefined ? {} : { source }),
      },
    });
    const { ZipWriter, Uint8ArrayWriter, TextReader } =
      await import('@zip.js/zip.js');
    const writer = new ZipWriter(new Uint8ArrayWriter());
    const actions = [
      { type: 'gpsData/recordGpsEvent', payload: point(50.1) },
      { type: 'gpsData/recordGpsEvent', payload: point(50.11, 'synthetic-qr') },
      {
        type: 'gpsData/recordGpsEventBatch',
        payload: {
          events: [
            point(50.2, 'device'),
            point(50.21, 'synthetic-qr'),
            point(50.22, 'synthetic-qr'),
          ],
        },
      },
      { type: 'gpsData/recordGpsEvent', payload: point(50.3, 'future-beacon') },
      { type: 'gpsData/recordGpsEvent', payload: point(50.4, 7) },
      { type: 'gpsData/recordGpsEvent', payload: point(50.5) },
    ];
    for (const [i, action] of actions.entries()) {
      await writer.add(
        `actions/${String(i + 1).padStart(8, '0')}.json`,
        new TextReader(JSON.stringify(action))
      );
    }
    const blob = new Blob([await writer.close()]);

    const coords = await loadGpsPathFromBlob(blob);

    expect(coords.map((c) => c.lat)).toEqual([50.1, 50.2, 50.5]);
  });
});

describe('ZipSource lazy Reader input', () => {
  // Why these tests matter: the corpus-validation gate in
  // GpsPlusSlamJs_Investigation reads 100+ recording zips (2.4 GB) from disk,
  // and loading whole archives into memory to validate a few KB of JSON
  // breached its 60 s regression budget (see that repo's
  // docs/2026-07-09-1944-regression-gate-budget-breach-followup.md). The helpers
  // therefore accept any zip.js Reader (ranged, lazy) in addition to
  // Uint8Array. These tests prove the Reader path is result-equivalent to
  // the Uint8Array path, that lazy getText works after the helper returned,
  // and that ONE shared Reader instance survives the concurrent triple-use
  // pattern of gps-plus-slam-recorder's loadRecording (Promise.all over
  // loadActionsFromZip + loadSessionMetadata + loadEntriesFromSubdir).

  /**
   * Ranged reader that never hands zip.js the whole buffer — reads are served
   * strictly by (index, length) slices, mimicking an fd-backed lazy reader.
   * init() is deliberately idempotent so a single instance can back several
   * ZipReader constructions (the shared-instance pattern of loadRecording).
   */
  class RangedTestReader extends Reader<void> {
    private readonly data: Uint8Array;
    constructor(data: Uint8Array) {
      super(undefined);
      this.data = data;
    }
    override async init(): Promise<void> {
      await super.init?.();
      this.size = this.data.length;
    }
    readUint8Array(index: number, length: number): Promise<Uint8Array> {
      const end = Math.min(index + length, this.data.length);
      return Promise.resolve(this.data.slice(index, end));
    }
  }

  let zipData: Uint8Array;

  beforeAll(async () => {
    zipData = (await produceTestZip()).zipData;
  });

  it('exports toZipReader as the runtime capability marker', () => {
    // Why: consumers outside this workspace (the Investigation project)
    // resolve this module from the published dist at runtime and probe
    // `typeof toZipReader === 'function'` before passing lazy Readers.
    // Renaming or removing this export silently downgrades them to the
    // eager whole-file path.
    expect(typeof toZipReader).toBe('function');
  });

  it('readZipEntries returns the same entries for Reader and Uint8Array input', async () => {
    const fromBytes = await readZipEntries(zipData);
    const fromReader = await readZipEntries(new RangedTestReader(zipData));
    expect(fromReader.map((e) => e.filename)).toEqual(
      fromBytes.map((e) => e.filename)
    );
  });

  it('loadActionsFromZip returns identical actions for Reader input', async () => {
    const fromBytes = await loadActionsFromZip(zipData);
    const fromReader = await loadActionsFromZip(new RangedTestReader(zipData));
    expect(fromReader).toEqual(fromBytes);
  });

  it('loadSessionMetadata returns identical metadata for Reader input', async () => {
    const fromBytes = await loadSessionMetadata(zipData);
    const fromReader = await loadSessionMetadata(new RangedTestReader(zipData));
    expect(fromReader).toEqual(fromBytes);
  });

  it('loadEntriesFromSubdir supports lazy getText after the helper returned', async () => {
    // Why: loadEntriesFromSubdir closes its ZipReader before callers invoke
    // getText() — the Reader path must keep serving ranged reads afterwards
    // (the Uint8Array path gets this for free from the in-memory buffer).
    const fromBytes = await loadEntriesFromSubdir(zipData, 'actions');
    const fromReader = await loadEntriesFromSubdir(
      new RangedTestReader(zipData),
      'actions'
    );
    expect(fromReader.map((e) => e.relativePath)).toEqual(
      fromBytes.map((e) => e.relativePath)
    );
    expect(fromReader.length).toBeGreaterThan(0);
    expect(await fromReader[0]!.getText()).toBe(await fromBytes[0]!.getText());
  });

  it('one shared Reader instance survives concurrent triple use', async () => {
    // Why: loadRecording runs loadActionsFromZip + loadSessionMetadata +
    // readSidecarRefPoints over the SAME input via Promise.all. With a
    // shared lazy Reader that means three ZipReaders over one Reader
    // instance concurrently — init() re-entry and interleaved ranged reads
    // must not corrupt results.
    const shared = new RangedTestReader(zipData);
    const [actionsResult, meta, subdir] = await Promise.all([
      loadActionsFromZip(shared),
      loadSessionMetadata(shared),
      loadEntriesFromSubdir(shared, 'actions'),
    ]);
    expect(actionsResult).toEqual(await loadActionsFromZip(zipData));
    expect(meta).toEqual(await loadSessionMetadata(zipData));
    expect(subdir.length).toBeGreaterThan(0);
  });
});

/**
 * Why these tests matter (tour kit plan K0): a tour zip is often a whole
 * recording, and the Tour Viewer parses its action stream through
 * `loadActionsFromZip`. The per-entry check reads each entry's DECLARED
 * size, so many entries each just under it - kilobytes deflated, a
 * megabyte inflated - added up without any limit. The actions now read
 * through a `DecompressionBudget` that counts the bytes actually inflated
 * and caps the archive total.
 */
describe('loadActionsFromZip under a decompression budget', () => {
  async function deflatedActions(count: number): Promise<Uint8Array> {
    const { ZipWriter, Uint8ArrayWriter, TextReader } =
      await import('@zip.js/zip.js');
    const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 9 });
    const padding = 'x'.repeat(500_000);
    for (let i = 1; i <= count; i += 1) {
      await writer.add(
        `actions/${String(i).padStart(6, '0')}.json`,
        new TextReader(JSON.stringify({ type: 'test/pad', payload: padding }))
      );
    }
    return writer.close();
  }

  it('stops at the archive total even though every entry is under the per-entry cap', async () => {
    const zip = await deflatedActions(4); // 4 x ~500 KB inflated, a few KB on disk
    const budget = new DecompressionBudget({
      maxEntryBytes: 1_048_576,
      maxTotalBytes: 1_200_000,
    });
    const err = await loadActionsFromZip(
      zip,
      MAX_ACTION_FILE_SIZE,
      budget
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveLimitError);
    expect((err as ArchiveLimitError).kind).toBe('total-bytes');
  });

  it('reads the same stream in full under a budget that fits it', async () => {
    const zip = await deflatedActions(4);
    const budget = new DecompressionBudget({
      maxEntryBytes: 1_048_576,
      maxTotalBytes: 4_000_000,
    });
    const result = await loadActionsFromZip(zip, MAX_ACTION_FILE_SIZE, budget);
    expect(result).toHaveLength(4);
    expect(budget.totalBytes).toBeGreaterThan(2_000_000);
  });

  it('uses a default budget sized from the archive when none is passed', async () => {
    // The default allowance has a 64 MiB floor, so a small real stream is
    // unaffected - the guard only bites on a crafted archive.
    const zip = await deflatedActions(2);
    expect(await loadActionsFromZip(zip)).toHaveLength(2);
  });
});
