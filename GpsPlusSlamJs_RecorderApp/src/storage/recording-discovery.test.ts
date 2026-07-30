/**
 * Tests for Session Browser UI module
 *
 * Why this test file matters:
 * The session browser is the primary UX for Replay Mode (Iteration 5 of
 * 2026-02-19-replay-mode.md). It enumerates scenarios and sessions from a
 * FileSystemDirectoryHandle, parses session dates from filenames, and
 * controls the "Start Replay" button state. These are the building blocks
 * that Iteration 6 (integration) wires into main.ts.
 *
 * Tests use MockFSDirectoryHandle from test-utils/browser-mocks.ts to
 * simulate the File System Access API in a Node.js test environment.
 */

import { describe, it, expect, vi } from 'vitest';
import { MockFSDirectoryHandle } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';
import {
  listScenariosFromFolder,
  listSessionZipsInScenario,
  extractScenarioNamesFromZips,
} from './recording-discovery';
import { parseDateFromSessionFilename } from './session-zip-naming';

// ============================================================================
// listScenariosFromFolder
// ============================================================================

describe('listScenariosFromFolder', () => {
  it('returns top-level directory names from a folder handle', async () => {
    // Why: The session browser must enumerate scenario folders to populate
    // the scenario dropdown. Only directories should be returned, not files.
    const root = new MockFSDirectoryHandle('root');
    const parisDir = new MockFSDirectoryHandle('Paris Eiffeltower');
    const munichDir = new MockFSDirectoryHandle('Munich Olympiapark');
    root.addDirectory('Paris Eiffeltower', parisDir);
    root.addDirectory('Munich Olympiapark', munichDir);
    // Add a stray file that should be ignored
    root.addFile('notes.txt', 'some notes');

    const scenarios = await listScenariosFromFolder(root);

    expect(scenarios).toHaveLength(2);
    expect(scenarios).toContain('Paris Eiffeltower');
    expect(scenarios).toContain('Munich Olympiapark');
  });

  it('returns empty array when folder has no subdirectories', async () => {
    // Why: Edge case — folder might contain only files (no scenarios yet).
    const root = new MockFSDirectoryHandle('empty-root');
    root.addFile('readme.txt', 'nothing here');

    const scenarios = await listScenariosFromFolder(root);

    expect(scenarios).toEqual([]);
  });

  it('returns empty array for a completely empty folder', async () => {
    // Why: Brand new, untouched folder selected by user.
    const root = new MockFSDirectoryHandle('empty');

    const scenarios = await listScenariosFromFolder(root);

    expect(scenarios).toEqual([]);
  });

  it('sorts scenario names alphabetically', async () => {
    // Why: Consistent ordering makes the dropdown predictable regardless
    // of file system iteration order.
    const root = new MockFSDirectoryHandle('root');
    root.addDirectory('Zebra Park', new MockFSDirectoryHandle('Zebra Park'));
    root.addDirectory('Alpha City', new MockFSDirectoryHandle('Alpha City'));
    root.addDirectory('Middle Town', new MockFSDirectoryHandle('Middle Town'));

    const scenarios = await listScenariosFromFolder(root);

    expect(scenarios).toEqual(['Alpha City', 'Middle Town', 'Zebra Park']);
  });
});

// ============================================================================
// listSessionZipsInScenario
// ============================================================================

describe('listSessionZipsInScenario', () => {
  it('returns zip files from a scenario directory', async () => {
    // Why: Each scenario folder contains *.zip session recordings. The browser
    // must enumerate them for the session list.
    const scenario = new MockFSDirectoryHandle('Paris Eiffeltower');
    scenario.addFile('recording-2026-01-27_14-30-11utc.zip', '');
    scenario.addFile('recording-2026-02-06_03-52-13utc.zip', '');

    const sessions = await listSessionZipsInScenario(scenario);

    expect(sessions).toHaveLength(2);
    expect(sessions[0].filename).toBe('recording-2026-02-06_03-52-13utc.zip');
    expect(sessions[1].filename).toBe('recording-2026-01-27_14-30-11utc.zip');
  });

  it('ignores non-zip files and subdirectories', async () => {
    // Why: Scenario folders may contain refPoints/ subdirectory and other files.
    // Only *.zip files are session recordings.
    const scenario = new MockFSDirectoryHandle('Munich');
    scenario.addFile('recording-2026-02-10_09-00-00utc.zip', '');
    scenario.addFile('notes.txt', 'some notes');
    scenario.addDirectory('refPoints', new MockFSDirectoryHandle('refPoints'));

    const sessions = await listSessionZipsInScenario(scenario);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].filename).toBe('recording-2026-02-10_09-00-00utc.zip');
  });

  it('returns empty array when no zip files exist', async () => {
    // Why: Scenario folder might only have refPoints/ and no recordings yet.
    const scenario = new MockFSDirectoryHandle('Empty Scenario');
    scenario.addDirectory('refPoints', new MockFSDirectoryHandle('refPoints'));

    const sessions = await listSessionZipsInScenario(scenario);

    expect(sessions).toEqual([]);
  });

  it('returns sessions sorted by filename in reverse order (most recent first)', async () => {
    // Why: Filenames contain timestamps; reverse-alphabetical sort = reverse-chronological.
    // Most recent recording appears at the top of the session list (UX feedback 2026-03-23 Issue 3).
    const scenario = new MockFSDirectoryHandle('TestScenario');
    scenario.addFile('recording-2026-02-19_10-15-00utc.zip', '');
    scenario.addFile('recording-2026-01-27_14-30-11utc.zip', '');
    scenario.addFile('recording-2026-02-06_03-52-13utc.zip', '');

    const sessions = await listSessionZipsInScenario(scenario);

    expect(sessions.map((s) => s.filename)).toEqual([
      'recording-2026-02-19_10-15-00utc.zip',
      'recording-2026-02-06_03-52-13utc.zip',
      'recording-2026-01-27_14-30-11utc.zip',
    ]);
  });

  it('each session entry includes a FileSystemFileHandle', async () => {
    // Why: The integration layer needs the file handle to read the zip bytes
    // when the user selects a session for replay.
    const scenario = new MockFSDirectoryHandle('TestScenario');
    scenario.addFile('recording-2026-01-27_14-30-11utc.zip', 'zip-content');

    const sessions = await listSessionZipsInScenario(scenario);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].fileHandle).toBeDefined();
    expect(sessions[0].fileHandle.kind).toBe('file');
    expect(sessions[0].fileHandle.name).toBe(
      'recording-2026-01-27_14-30-11utc.zip'
    );
  });

  it('each session entry includes parsed date when filename matches pattern', async () => {
    // Why: The UI should show a human-readable date for each session.
    const scenario = new MockFSDirectoryHandle('TestScenario');
    scenario.addFile('recording-2026-02-19_10-15-00utc.zip', '');

    const sessions = await listSessionZipsInScenario(scenario);

    expect(sessions[0].date).toBeInstanceOf(Date);
    expect(sessions[0].date!.toISOString()).toBe('2026-02-19T10:15:00.000Z');
  });

  it('session entry date is null when filename does not match pattern', async () => {
    // Why: Users might manually place zip files with non-standard names.
    // The browser should still list them but without a parsed date.
    const scenario = new MockFSDirectoryHandle('TestScenario');
    scenario.addFile('my-custom-recording.zip', '');

    const sessions = await listSessionZipsInScenario(scenario);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].filename).toBe('my-custom-recording.zip');
    expect(sessions[0].date).toBeNull();
  });

  it('handles zip files with scenario prefix in filename', async () => {
    // Why: The generateSessionFilename function creates names like
    // "Paris-session-2026-01-30_14-30-45utc.zip". The date parser
    // must handle this prefix format too.
    const scenario = new MockFSDirectoryHandle('Paris');
    scenario.addFile('Paris-session-2026-01-30_14-30-45utc.zip', '');

    const sessions = await listSessionZipsInScenario(scenario);

    expect(sessions[0].date).toBeInstanceOf(Date);
    expect(sessions[0].date!.toISOString()).toBe('2026-01-30T14:30:45.000Z');
  });
});

// ============================================================================
// parseDateFromSessionFilename
// ============================================================================

describe('parseDateFromSessionFilename', () => {
  it('parses date from recording-YYYY-MM-DD_HH-MM-SSutc.zip pattern', () => {
    // Why: This is the standard filename pattern produced by the recorder app.
    const date = parseDateFromSessionFilename(
      'recording-2026-02-19_10-15-00utc.zip'
    );

    expect(date).toBeInstanceOf(Date);
    expect(date!.getUTCFullYear()).toBe(2026);
    expect(date!.getUTCMonth()).toBe(1); // February = 1 (0-indexed)
    expect(date!.getUTCDate()).toBe(19);
    expect(date!.getUTCHours()).toBe(10);
    expect(date!.getUTCMinutes()).toBe(15);
    expect(date!.getUTCSeconds()).toBe(0);
  });

  it('parses date from scenario-prefixed filename', () => {
    // Why: generateSessionFilename creates "ScenarioName-session-YYYY-MM-DD_HH-MM-SSutc.zip"
    const date = parseDateFromSessionFilename(
      'Paris-Eiffeltower-session-2026-01-30_14-30-45utc.zip'
    );

    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe('2026-01-30T14:30:45.000Z');
  });

  it('returns null for non-matching filenames', () => {
    // Why: Graceful degradation for manually placed or renamed zip files.
    expect(parseDateFromSessionFilename('random-file.zip')).toBeNull();
    expect(parseDateFromSessionFilename('my-recording.zip')).toBeNull();
    expect(parseDateFromSessionFilename('session.zip')).toBeNull();
  });

  it('returns null for filenames with partial date patterns', () => {
    // Why: Prevent false positives from incomplete patterns.
    expect(parseDateFromSessionFilename('recording-2026-02.zip')).toBeNull();
    expect(parseDateFromSessionFilename('recording-2026-02-19.zip')).toBeNull();
  });

  it('handles midnight timestamps', () => {
    // Why: Edge case for recordings started at midnight UTC.
    const date = parseDateFromSessionFilename(
      'recording-2026-01-01_00-00-00utc.zip'
    );

    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('handles end-of-day timestamps', () => {
    // Why: Edge case for recordings started at 23:59:59 UTC.
    const date = parseDateFromSessionFilename(
      'recording-2025-12-31_23-59-59utc.zip'
    );

    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe('2025-12-31T23:59:59.000Z');
  });

  it('returns null for regex-matching but invalid dates like Feb 30', () => {
    // Why: The regex can match digit patterns that are not real calendar dates.
    // The isNaN guard must catch these and return null.
    // Note: JavaScript Date is lenient with some invalid dates (e.g., month 13
    // becomes January of next year), so we test with an obviously invalid
    // combination that still fails the isNaN check.
    const date = parseDateFromSessionFilename(
      'recording-0000-00-00_00-00-00utc.zip'
    );

    // Month "00" is invalid for Date (months are 1-12 in ISO)
    expect(date).toBeNull();
  });

  it('returns null for impossible calendar dates instead of rolling them over', () => {
    // Why: V8 normalizes out-of-range ISO components instead of yielding
    // Invalid Date — new Date('2026-02-30T10:00:00Z') is silently March 2 —
    // so the isNaN guard alone did NOT enforce the "not Feb 30" validation
    // the parser documents; a renamed zip with an impossible date sorted
    // under a fabricated timestamp instead of falling back to
    // File.lastModified (PR #163 review, coderabbit).
    expect(
      parseDateFromSessionFilename('recording-2026-02-30_10-00-00utc.zip')
    ).toBeNull();
    expect(
      parseDateFromSessionFilename('recording-2025-02-29_10-00-00utc.zip')
    ).toBeNull(); // non-leap year
    expect(
      parseDateFromSessionFilename('recording-2026-04-31_10-00-00utc.zip')
    ).toBeNull();
  });

  it('returns null for out-of-range time or month components instead of rolling them over', () => {
    // Why: the same rollover hazard applies to time fields (hour 24 → next
    // day) and month 13 (→ January of the next year).
    expect(
      parseDateFromSessionFilename('recording-2026-02-19_24-00-00utc.zip')
    ).toBeNull();
    expect(
      parseDateFromSessionFilename('recording-2026-02-19_10-60-00utc.zip')
    ).toBeNull();
    expect(
      parseDateFromSessionFilename('recording-2026-02-19_10-00-61utc.zip')
    ).toBeNull();
    expect(
      parseDateFromSessionFilename('recording-2026-13-01_10-00-00utc.zip')
    ).toBeNull();
  });

  it('still accepts real leap-day timestamps', () => {
    // Why: the round-trip validation must not over-reject valid dates.
    const date = parseDateFromSessionFilename(
      'recording-2028-02-29_23-59-59utc.zip'
    );
    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe('2028-02-29T23:59:59.000Z');
  });
});

// ============================================================================
// extractScenarioNamesFromZips
// ============================================================================

describe('extractScenarioNamesFromZips', () => {
  // Why this test suite matters:
  // Issue 1 from 2026-02-27 user feedback — when a user selects a folder with
  // existing ZIP files, the scenario dropdown must be populated. Top-level ZIPs
  // with scenario prefixes (e.g., "Paris-session-...utc.zip") should contribute
  // their scenario name to the dropdown. This function extracts those names.

  it('extracts scenario name from scenario-prefixed zip filenames', async () => {
    // Why: ZIPs like "Paris-session-2026-01-30_14-30-45utc.zip" encode the
    // scenario name before "-session-". This must be extracted.
    const root = new MockFSDirectoryHandle('root');
    root.addFile('Paris-session-2026-01-30_14-30-45utc.zip', '');
    root.addFile('Munich-session-2026-02-06_03-52-13utc.zip', '');

    const names = await extractScenarioNamesFromZips(root);

    expect(names).toContain('Paris');
    expect(names).toContain('Munich');
    expect(names).toHaveLength(2);
  });

  it('ignores timestamp-only zip filenames (no scenario info)', async () => {
    // Why: New recordings use "YYYY-MM-DD_HH-MM-SSutc.zip" with no scenario
    // prefix. These contain no scenario name to extract.
    const root = new MockFSDirectoryHandle('root');
    root.addFile('2026-02-19_10-15-00utc.zip', '');
    root.addFile('recording-2026-01-27_14-30-11utc.zip', '');

    const names = await extractScenarioNamesFromZips(root);

    expect(names).toEqual([]);
  });

  it('deduplicates scenario names from multiple zips', async () => {
    // Why: A scenario may have multiple session ZIPs at the root level.
    // The scenario name should only appear once in the result.
    const root = new MockFSDirectoryHandle('root');
    root.addFile('Paris-session-2026-01-30_14-30-45utc.zip', '');
    root.addFile('Paris-session-2026-02-10_09-00-00utc.zip', '');
    root.addFile('Munich-session-2026-02-06_03-52-13utc.zip', '');

    const names = await extractScenarioNamesFromZips(root);

    expect(names).toEqual(['Munich', 'Paris']);
  });

  it('returns sorted scenario names', async () => {
    // Why: Consistent ordering for the dropdown, same as listScenariosFromFolder.
    const root = new MockFSDirectoryHandle('root');
    root.addFile('Zebra-session-2026-01-01_00-00-00utc.zip', '');
    root.addFile('Alpha-session-2026-01-01_00-00-00utc.zip', '');

    const names = await extractScenarioNamesFromZips(root);

    expect(names).toEqual(['Alpha', 'Zebra']);
  });

  it('ignores non-zip files and directories', async () => {
    // Why: Only .zip files can carry scenario info in their filename.
    const root = new MockFSDirectoryHandle('root');
    root.addFile('notes.txt', 'some notes');
    root.addDirectory('SomeDir', new MockFSDirectoryHandle('SomeDir'));
    root.addFile('Paris-session-2026-01-30_14-30-45utc.zip', '');

    const names = await extractScenarioNamesFromZips(root);

    expect(names).toEqual(['Paris']);
  });

  it('handles multi-word scenario names with hyphens', async () => {
    // Why: Scenario names may contain hyphens, e.g., "Paris-Eiffeltower".
    // The parser must split on "-session-" not just any hyphen.
    const root = new MockFSDirectoryHandle('root');
    root.addFile('Paris-Eiffeltower-session-2026-01-30_14-30-45utc.zip', '');

    const names = await extractScenarioNamesFromZips(root);

    expect(names).toEqual(['Paris-Eiffeltower']);
  });

  it('returns empty array for empty folder', async () => {
    // Why: Edge case — folder has no files at all.
    const root = new MockFSDirectoryHandle('empty');

    const names = await extractScenarioNamesFromZips(root);

    expect(names).toEqual([]);
  });
});

// ============================================================================
// Integration: folder with real ZIP structure → scenario + session discovery
// ============================================================================

describe('Integration: folder scan discovers scenarios and sessions', () => {
  // Why this test suite matters:
  // Issue 1 from 2026-02-27 user feedback — user requested an integration test
  // that creates 2 real ZIP files and verifies the full production code path for
  // scenario discovery and session listing. These tests exercise
  // listScenariosFromFolder, extractScenarioNamesFromZips, and
  // listSessionZipsInScenario together on a realistic folder structure.

  it('discovers scenarios from subdirectories containing ZIP files', async () => {
    // Why: The primary folder layout has scenario subdirectories. The full
    // discovery pipeline must find them and list their sessions.
    const root = new MockFSDirectoryHandle('RecordingData');

    // Scenario A: Paris with 2 ZIP sessions
    const parisDir = new MockFSDirectoryHandle('Paris Eiffeltower');
    parisDir.addFile('recording-2026-01-27_14-30-11utc.zip', 'zip-content-1');
    parisDir.addFile(
      'Paris Eiffeltower-session-2026-02-06_03-52-13utc.zip',
      'zip-content-2'
    );
    parisDir.addDirectory('refPoints', new MockFSDirectoryHandle('refPoints'));
    root.addDirectory('Paris Eiffeltower', parisDir);

    // Scenario B: Munich with 1 ZIP session
    const munichDir = new MockFSDirectoryHandle('Munich Olympiapark');
    munichDir.addFile('recording-2026-02-10_09-00-00utc.zip', 'zip-content-3');
    root.addDirectory('Munich Olympiapark', munichDir);

    // Step 1: Discover scenarios
    const scenarios = await listScenariosFromFolder(root);
    expect(scenarios).toEqual(['Munich Olympiapark', 'Paris Eiffeltower']);

    // Step 2: List sessions in each scenario
    const parisHandle = await root.getDirectoryHandle('Paris Eiffeltower');
    const parisSessions = await listSessionZipsInScenario(parisHandle);
    expect(parisSessions).toHaveLength(2);
    expect(parisSessions[0].filename).toBe(
      'recording-2026-01-27_14-30-11utc.zip'
    );
    expect(parisSessions[1].filename).toBe(
      'Paris Eiffeltower-session-2026-02-06_03-52-13utc.zip'
    );

    const munichHandle = await root.getDirectoryHandle('Munich Olympiapark');
    const munichSessions = await listSessionZipsInScenario(munichHandle);
    expect(munichSessions).toHaveLength(1);
    expect(munichSessions[0].date?.toISOString()).toBe(
      '2026-02-10T09:00:00.000Z'
    );
  });

  it('discovers scenarios from both subdirectories and top-level ZIP prefixes', async () => {
    // Why: A folder may have a mix of organized (subdirectory) and flat
    // (top-level ZIP) layouts. Both must contribute scenario names.
    const root = new MockFSDirectoryHandle('MixedData');

    // Subdirectory scenario
    const berlinDir = new MockFSDirectoryHandle('Berlin Mitte');
    berlinDir.addFile('recording-2026-02-15_08-00-00utc.zip', 'zip-data');
    root.addDirectory('Berlin Mitte', berlinDir);

    // Top-level ZIPs with scenario prefix
    root.addFile('Tokyo-Tower-session-2026-02-20_12-00-00utc.zip', 'zip-data');
    root.addFile('Tokyo-Tower-session-2026-02-21_14-00-00utc.zip', 'zip-data');

    // Top-level ZIP without scenario prefix (timestamp-only)
    root.addFile('2026-03-01_10-00-00utc.zip', 'zip-data');

    // Step 1: Scenarios from subdirectories
    const dirScenarios = await listScenariosFromFolder(root);
    expect(dirScenarios).toEqual(['Berlin Mitte']);

    // Step 2: Scenarios from ZIP filenames
    const zipScenarios = await extractScenarioNamesFromZips(root);
    expect(zipScenarios).toEqual(['Tokyo-Tower']);

    // Step 3: Merge and deduplicate (simulating what handleOpenFolder does)
    const allScenarios = [
      ...new Set([...dirScenarios, ...zipScenarios]),
    ].sort();
    expect(allScenarios).toEqual(['Berlin Mitte', 'Tokyo-Tower']);
  });

  it('handles a folder with only top-level ZIPs (no subdirectories)', async () => {
    // Why: Some users may dump all ZIP files flat in a folder without
    // creating scenario subdirectories. extractScenarioNamesFromZips must
    // still find scenario names where possible.
    const root = new MockFSDirectoryHandle('FlatFolder');
    root.addFile('Paris-session-2026-01-30_14-30-45utc.zip', 'zip-data');
    root.addFile('Paris-session-2026-02-05_10-00-00utc.zip', 'zip-data');
    root.addFile('recording-2026-02-19_10-15-00utc.zip', 'zip-data');
    root.addFile('2026-02-20_09-00-00utc.zip', 'zip-data');

    const dirScenarios = await listScenariosFromFolder(root);
    expect(dirScenarios).toEqual([]);

    const zipScenarios = await extractScenarioNamesFromZips(root);
    expect(zipScenarios).toEqual(['Paris']);

    // The merged result contains only "Paris" — the timestamp-only ZIPs
    // are not lost (they're still in the folder) but don't contribute
    // scenario names because none can be inferred.
    const allScenarios = [
      ...new Set([...dirScenarios, ...zipScenarios]),
    ].sort();
    expect(allScenarios).toEqual(['Paris']);
  });
});

// ============================================================================
// discoverScenariosFromZipMetadata (Issue 1 — 2026-03-01 user feedback)
// ============================================================================

import {
  discoverScenariosFromZipMetadata,
  type ScenarioSessionMap,
} from './recording-discovery';
import { DEFAULT_SCENARIO } from './session-zip-naming';
import { produceTestZip } from 'gps-plus-slam-app-framework/test-utils/zip-round-trip-helpers';

describe('discoverScenariosFromZipMetadata', () => {
  // Why this suite matters:
  // This is the core function for Issue 1 — it reads session.json metadata
  // from root-level zip files to discover scenario names. This replaces the
  // filename-based approach (extractScenarioNamesFromZips) which can't handle
  // timestamp-only filenames like "2026-03-01_09-08-48utc.zip".

  it('discovers a scenario from a zip with session.json metadata', async () => {
    // Why: The most basic case — a single zip at root level with session.json
    // containing a scenarioName. This is the exact user scenario from Bug 1.
    const testZip = await produceTestZip({ scenarioName: 'ParkWalk' });
    const root = new MockFSDirectoryHandle('UserRecordings');
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    expect(result.scenarioNames).toEqual(['ParkWalk']);
    expect(result.scenarioSessions.has('ParkWalk')).toBe(true);
    const sessions = result.scenarioSessions.get('ParkWalk')!;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].filename).toBe('2026-03-01_09-08-48utc.zip');
    expect(sessions[0].fileHandle).toBeDefined();
    expect(sessions[0].fileHandle.kind).toBe('file');
  });

  it('attaches h3Cells from session.json metadata to each entry', async () => {
    // Why: the map-centric browser (Step 3 / D2) reads the per-tour coverage
    // index straight from session.json during discovery, so it can place a tour
    // without unzipping its GPS data. The discovered entry must carry h3Cells.
    const cells = ['8b1fa1da1d64fff', '8b1fa1da1d4afff', '8b1fa1da1c09fff'];
    const testZip = await produceTestZip({
      scenarioName: 'Covered',
      h3Cells: cells,
    });
    const root = new MockFSDirectoryHandle('Recordings');
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    const entry = result.scenarioSessions.get('Covered')![0]!;
    expect(entry.h3Cells).toEqual(cells);
  });

  it('leaves h3Cells undefined for legacy recordings without the field', async () => {
    // Why: recordings made before the coverage index existed have no h3Cells.
    // Discovery must leave the field undefined so the browser knows to backfill
    // from the GPS path rather than treating it as "no coverage".
    const testZip = await produceTestZip({ scenarioName: 'Legacy' }); // no h3Cells
    const root = new MockFSDirectoryHandle('Recordings');
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    const entry = result.scenarioSessions.get('Legacy')![0]!;
    expect(entry.h3Cells).toBeUndefined();
  });

  it('preserves an empty h3Cells array as "no coverage" (not undefined)', async () => {
    // Why: an empty array is a valid, intended state meaning "the recording has
    // no GPS coverage". It MUST stay distinct from undefined (legacy, needs
    // backfill) — conflating them would force a needless GPS re-read on every
    // genuinely-empty recording. This guards the boundary against an
    // over-broad "empty -> undefined" parse fix.
    const testZip = await produceTestZip({
      scenarioName: 'Empty',
      h3Cells: [],
    });
    const root = new MockFSDirectoryHandle('Recordings');
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    const entry = result.scenarioSessions.get('Empty')![0]!;
    expect(entry.h3Cells).toEqual([]);
  });

  it('treats a malformed h3Cells array (no string entries) as legacy', async () => {
    // Why: session.json comes from a file on disk and may be corrupt. An array
    // whose entries are not strings (e.g. [123]) is untrustworthy metadata — it
    // must yield undefined so the coverage index falls back to deriving coverage
    // from the authoritative GPS path, NOT be misread as valid "no coverage".
    const testZip = await produceTestZip({
      scenarioName: 'Malformed',
      h3Cells: [123, 456] as unknown as string[],
    });
    const root = new MockFSDirectoryHandle('Recordings');
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    const entry = result.scenarioSessions.get('Malformed')![0]!;
    expect(entry.h3Cells).toBeUndefined();
  });

  it('treats a partially-malformed h3Cells array as legacy', async () => {
    // Why: if any entry is a non-string, the array is evidence of corruption.
    // Silently keeping the valid strings would surface a wrong (truncated)
    // coverage that looks valid; treating the whole array as untrustworthy and
    // backfilling from GPS recovers the correct, complete coverage instead.
    const testZip = await produceTestZip({
      scenarioName: 'PartlyBad',
      h3Cells: ['8b1fa1da1d64fff', 123] as unknown as string[],
    });
    const root = new MockFSDirectoryHandle('Recordings');
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    const entry = result.scenarioSessions.get('PartlyBad')![0]!;
    expect(entry.h3Cells).toBeUndefined();
  });

  it('treats an array of string-typed but invalid H3 ids as legacy', async () => {
    // Why: corruption is not limited to wrong-typed entries. A string that is
    // not a valid H3 id (e.g. "garbage") is just as untrustworthy as a number,
    // but is *string-typed* so the type-only filter would let it through. It
    // must be rejected at the boundary so coverage is re-derived from the
    // authoritative GPS path.
    //
    // This matters because the invalid id does NOT crash downstream and so
    // would fail silently: `cellToLatLng('garbage')` does not throw — it
    // returns a garbage coordinate (~79N), which would mis-frame the map in
    // `map-browser.ts` `fitToCoverage`; and `clusterCellsByZoom` already drops
    // invalid cells, so the corruption would never surface as an error. The
    // only safe place to catch it is here, at the parse boundary.
    const testZip = await produceTestZip({
      scenarioName: 'BadIds',
      h3Cells: ['garbage', 'not-an-h3-cell'],
    });
    const root = new MockFSDirectoryHandle('Recordings');
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    const entry = result.scenarioSessions.get('BadIds')![0]!;
    expect(entry.h3Cells).toBeUndefined();
  });

  it('treats a mix of valid and invalid H3 id strings as legacy', async () => {
    // Why: all-or-nothing — one invalid id makes the whole array untrustworthy
    // (same rationale as the partially-malformed/non-string case above). Keeping
    // only the valid ids would surface a truncated-but-valid-looking coverage,
    // which is worse than backfilling the complete coverage from GPS.
    const testZip = await produceTestZip({
      scenarioName: 'MixedIds',
      h3Cells: ['8b1fa1da1d64fff', 'garbage'],
    });
    const root = new MockFSDirectoryHandle('Recordings');
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    const entry = result.scenarioSessions.get('MixedIds')![0]!;
    expect(entry.h3Cells).toBeUndefined();
  });

  it('groups multiple zips by their scenarioName from metadata', async () => {
    // Why: A folder may contain multiple zips from different scenarios.
    // The function must group them correctly by the scenarioName in session.json.
    const zip1 = await produceTestZip({ scenarioName: 'Paris' });
    const zip2 = await produceTestZip({ scenarioName: 'Paris' });
    const zip3 = await produceTestZip({ scenarioName: 'Tokyo' });

    const root = new MockFSDirectoryHandle('MixedRecordings');
    root.addFile('2026-03-01_09-00-00utc.zip', zip1.zipData);
    root.addFile('2026-03-01_10-00-00utc.zip', zip2.zipData);
    root.addFile('2026-03-02_09-00-00utc.zip', zip3.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    expect(result.scenarioNames).toEqual(['Paris', 'Tokyo']);
    expect(result.scenarioSessions.get('Paris')).toHaveLength(2);
    expect(result.scenarioSessions.get('Tokyo')).toHaveLength(1);
  });

  it('ignores non-zip files', async () => {
    // Why: The root folder may contain non-zip files (e.g., text files,
    // images). These must be skipped entirely.
    const testZip = await produceTestZip({ scenarioName: 'TestScenario' });
    const root = new MockFSDirectoryHandle('Mixed');
    root.addFile('notes.txt', 'some notes');
    root.addFile('session.zip', testZip.zipData);
    root.addFile('readme.md', '# Readme');

    const result = await discoverScenariosFromZipMetadata(root);

    expect(result.scenarioNames).toEqual(['TestScenario']);
    expect(result.scenarioSessions.get('TestScenario')).toHaveLength(1);
  });

  it('ignores subdirectories', async () => {
    // Why: Subdirectories should not be treated as zip files.
    // listScenariosFromFolder already handles subdirectory-based scenarios.
    const testZip = await produceTestZip({ scenarioName: 'MyScenario' });
    const root = new MockFSDirectoryHandle('RootFolder');
    root.addFile('recording.zip', testZip.zipData);
    const subdir = new MockFSDirectoryHandle('SomeSubdir');
    root.addDirectory('SomeSubdir', subdir);

    const result = await discoverScenariosFromZipMetadata(root);

    // Only the zip file should be discovered, not the subdirectory
    expect(result.scenarioNames).toEqual(['MyScenario']);
  });

  it('returns empty results for a directory with no zip files', async () => {
    // Why: Edge case — folder with only subdirectories and text files.
    const root = new MockFSDirectoryHandle('Emptyish');
    root.addFile('notes.txt', 'hello');
    const sub = new MockFSDirectoryHandle('SubFolder');
    root.addDirectory('SubFolder', sub);

    const result = await discoverScenariosFromZipMetadata(root);

    expect(result.scenarioNames).toEqual([]);
    expect(result.scenarioSessions.size).toBe(0);
  });

  it('returns sorted scenario names', async () => {
    // Why: Consistent alphabetical ordering matches the convention of other
    // recording-discovery functions (listScenariosFromFolder, etc.).
    const zipZ = await produceTestZip({ scenarioName: 'Zurich' });
    const zipA = await produceTestZip({ scenarioName: 'Athens' });
    const zipM = await produceTestZip({ scenarioName: 'Munich' });

    const root = new MockFSDirectoryHandle('Root');
    root.addFile('z.zip', zipZ.zipData);
    root.addFile('a.zip', zipA.zipData);
    root.addFile('m.zip', zipM.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    expect(result.scenarioNames).toEqual(['Athens', 'Munich', 'Zurich']);
  });

  it('sessions within a scenario are sorted by filename in reverse order (most recent first)', async () => {
    // Why: Reverse-alphabetical = reverse-chronological for timestamp-based filenames.
    // Most recent recording appears at the top (UX feedback 2026-03-23 Issue 3).
    const zip1 = await produceTestZip({ scenarioName: 'Paris' });
    const zip2 = await produceTestZip({ scenarioName: 'Paris' });

    const root = new MockFSDirectoryHandle('Root');
    root.addFile('b-recording.zip', zip1.zipData);
    root.addFile('a-recording.zip', zip2.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    const sessions = result.scenarioSessions.get('Paris')!;
    expect(sessions[0].filename).toBe('b-recording.zip');
    expect(sessions[1].filename).toBe('a-recording.zip');
  });

  it('parses date from zip filename into SessionEntry', async () => {
    // Why: SessionEntry.date should be populated from the filename timestamp,
    // consistent with listSessionZipsInScenario behavior.
    const testZip = await produceTestZip({ scenarioName: 'Test' });
    const root = new MockFSDirectoryHandle('Root');
    root.addFile('recording-2026-03-01_09-08-48utc.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    const session = result.scenarioSessions.get('Test')![0];
    expect(session.date).toBeInstanceOf(Date);
    expect(session.date!.toISOString()).toBe('2026-03-01T09:08:48.000Z');
  });

  it('uses DEFAULT_SCENARIO for zips without valid session.json', async () => {
    // Why: Pre-F2-fix zips or corrupted zips may lack session.json entirely.
    // These should still be discoverable under the default scenario name.
    const root = new MockFSDirectoryHandle('Root');
    // A zip file with invalid content — loadSessionMetadata will return null
    root.addFile('old-recording.zip', new Uint8Array([0]));

    const result = await discoverScenariosFromZipMetadata(root);

    // The invalid zip should be grouped under DEFAULT_SCENARIO.
    expect(result.scenarioNames).toEqual([DEFAULT_SCENARIO]);
    expect(result.scenarioSessions.has(DEFAULT_SCENARIO)).toBe(true);
    const sessions = result.scenarioSessions.get(DEFAULT_SCENARIO)!;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].filename).toBe('old-recording.zip');
  });

  it('merges "Default Scenario" metadata with zips lacking metadata under DEFAULT_SCENARIO', async () => {
    // Why: UX feedback 2026-03-23 Issue 2 — "(Unknown)" and "Default Scenario"
    // both represent "user didn't name a scenario". They must be merged into a
    // single entry so the dropdown doesn't show two useless entries.
    const defaultZip = await produceTestZip({
      scenarioName: 'Default Scenario',
    });
    const root = new MockFSDirectoryHandle('Root');
    root.addFile('new-recording.zip', defaultZip.zipData);
    root.addFile('old-recording.zip', new Uint8Array([0])); // no valid session.json

    const result = await discoverScenariosFromZipMetadata(root);

    // Both should be merged under a single DEFAULT_SCENARIO entry
    expect(result.scenarioNames).toEqual([DEFAULT_SCENARIO]);
    expect(result.scenarioSessions.get(DEFAULT_SCENARIO)).toHaveLength(2);
  });

  it('DEFAULT_SCENARIO equals "Default Scenario"', () => {
    // Why: The canonical display name is "Default Scenario", replacing the
    // old "(Unknown)" label (UX feedback 2026-03-23 Issue 2).
    expect(DEFAULT_SCENARIO).toBe('Default Scenario');
  });

  it('does NOT call arrayBuffer() on files — uses Blob-based reading for memory efficiency', async () => {
    // Why: The original implementation loaded entire zip files into memory via
    // file.arrayBuffer(). For large recordings (100+ MB each), this caused
    // excessive memory consumption when scanning many zips. The fix uses
    // BlobReader which reads only the central directory + session.json entry,
    // avoiding full-file buffering. This test proves arrayBuffer is not called.
    const testZip = await produceTestZip({ scenarioName: 'MemTest' });
    const root = new MockFSDirectoryHandle('Root');
    root.addFile('recording.zip', testZip.zipData);

    // Get the file handle and spy on its getFile method to intercept the File object
    const fileHandle = await root.getFileHandle('recording.zip');
    const originalGetFile = fileHandle.getFile.bind(fileHandle);
    const arrayBufferSpy = vi.fn();

    fileHandle.getFile = vi.fn(async () => {
      const file = await originalGetFile();
      // Wrap the file to spy on arrayBuffer
      const originalArrayBuffer = file.arrayBuffer.bind(file);
      file.arrayBuffer = async () => {
        arrayBufferSpy();
        return originalArrayBuffer();
      };
      return file;
    });

    const result = await discoverScenariosFromZipMetadata(root);

    // Functionality still works
    expect(result.scenarioNames).toEqual(['MemTest']);
    // But arrayBuffer was NOT called — BlobReader reads from Blob directly
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// ScenarioSessionMap type-contract
// ============================================================================

describe('type-contract: ScenarioSessionMap', () => {
  // Why this test matters: ScenarioSessionMap is the canonical alias for
  // Map<string, SessionEntry[]>. This test verifies the type is structurally
  // correct and used consistently across the codebase via discoverScenariosFromZipMetadata.

  it('discoverScenariosFromZipMetadata result uses ScenarioSessionMap', async () => {
    const testZip = await produceTestZip({ scenarioName: 'TypeCheck' });
    const root = new MockFSDirectoryHandle('root');
    root.addFile('test.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    // The scenarioSessions field should be assignable to ScenarioSessionMap
    const map: ScenarioSessionMap = result.scenarioSessions;
    expect(map).toBeInstanceOf(Map);
    expect(map.has('TypeCheck')).toBe(true);
    const entries = map.get('TypeCheck')!;
    expect(entries).toHaveLength(1);
    expect(entries[0].filename).toBe('test.zip');
  });
});
