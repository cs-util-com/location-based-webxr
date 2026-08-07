/**
 * Replay Zip Discovery — TDD Bug Exploration Tests
 *
 * Why this test file matters:
 * These tests document and reproduce two bugs found during the 2026-03-01
 * user testing session. The user recorded a session on a phone, transferred
 * the produced zip file to the desktop replay app, and was unable to replay it.
 *
 * Following the TDD-based Bug Exploration approach (see AGENTS.md), these
 * tests were written BEFORE any fix to serve as:
 *   1. Executable documentation of the exact problems found
 *   2. Regression guards once fixed
 *   3. History of the user testing session findings
 *
 * @see docs/2026-03-01-user-feedback.md for full analysis and options
 */

import { describe, it, expect } from 'vitest';
import { MockFSDirectoryHandle } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';
import {
  listScenariosFromFolder,
  listSessionZipsInScenario,
  extractScenarioNamesFromZips,
} from './recording-discovery';

// ============================================================================
// Bug 1: Replay mode doesn't discover scenarios from zip files
// ============================================================================

describe('Bug 1: Replay mode zip discovery (2026-03-01 user feedback)', () => {
  // Context:
  // The user placed a phone-recorded zip file (2026-03-01_09-08-48utc.zip)
  // in a folder and opened that folder in replay mode. The app found 0
  // scenarios because listScenariosFromFolder() only looks for subdirectories.

  it('listScenariosFromFolder returns empty when folder contains only zip files', async () => {
    // Why: This reproduces the exact user scenario — a folder with one zip
    // file and no subdirectories. listScenariosFromFolder only finds
    // directories, so it returns []. This is the root cause of Bug 1.
    const root = new MockFSDirectoryHandle('UserRecordings');
    root.addFile('2026-03-01_09-08-48utc.zip', 'zip-content');

    const scenarios = await listScenariosFromFolder(root);

    // Current behavior: returns empty — the zip file is invisible
    expect(scenarios).toEqual([]);
  });

  it('extractScenarioNamesFromZips also returns empty for timestamp-only zip filenames', async () => {
    // Why: Even the recording-mode zip scanner wouldn't help here. The zip
    // filename "2026-03-01_09-08-48utc.zip" has no scenario prefix (it
    // doesn't match "{ScenarioName}-session-{timestamp}utc.zip"). So even
    // if replay mode called extractScenarioNamesFromZips, it would still
    // find 0 scenarios. The fix must handle timestamp-only filenames.
    const root = new MockFSDirectoryHandle('UserRecordings');
    root.addFile('2026-03-01_09-08-48utc.zip', 'zip-content');

    const zipScenarios = await extractScenarioNamesFromZips(root);

    // Current behavior: returns empty — timestamp-only names are ignored
    expect(zipScenarios).toEqual([]);
  });

  it('replay mode has no way to find zip files at root level as replayable sessions', async () => {
    // Why: This is the integration-level proof of Bug 1. The replay mode
    // code path (handleOpenFolder when isReplayMode) only calls
    // listScenariosFromFolder. Neither that function nor
    // extractScenarioNamesFromZips can discover timestamp-only zips.
    // There is currently NO function that lists root-level zip files as
    // directly replayable sessions.
    const root = new MockFSDirectoryHandle('UserRecordings');
    root.addFile('2026-03-01_09-08-48utc.zip', 'zip-content');
    root.addFile('2026-02-28_15-30-00utc.zip', 'zip-content-2');

    const dirScenarios = await listScenariosFromFolder(root);
    const zipScenarios = await extractScenarioNamesFromZips(root);
    const allScenarios = [
      ...new Set([...dirScenarios, ...zipScenarios]),
    ].sort();

    // Both discovery mechanisms fail for timestamp-only zips
    expect(allScenarios).toEqual([]);

    // But there ARE replayable zip files in the folder — we just can't find them.
    // A new function is needed: something like listRootLevelZipFiles() that
    // returns zip file entries regardless of naming convention.
  });

  it('replay mode DOES discover scenario-prefixed zips (but not timestamp-only ones)', async () => {
    // Why: This documents the partial gap. extractScenarioNamesFromZips works
    // for scenario-prefixed zips like "Paris-session-2026-...utc.zip", but
    // the replay mode code path never calls it. This test shows that calling
    // it would help for prefixed zips, but not for the user's actual case
    // (timestamp-only format).
    const root = new MockFSDirectoryHandle('MixedRecordings');
    root.addFile('Paris-session-2026-02-28_15-30-00utc.zip', 'zip-content-1');
    root.addFile('2026-03-01_09-08-48utc.zip', 'zip-content-2');

    const dirScenarios = await listScenariosFromFolder(root);
    const zipScenarios = await extractScenarioNamesFromZips(root);

    // extractScenarioNamesFromZips finds "Paris" but misses the timestamp-only zip
    expect(dirScenarios).toEqual([]);
    expect(zipScenarios).toEqual(['Paris']);

    // The timestamp-only zip is still invisible to all discovery mechanisms
  });
});

// ============================================================================
// Bug 1 FIX VERIFICATION: discoverScenariosFromZipMetadata works for the
// exact user scenario — timestamp-only zips at root level
// ============================================================================

import { discoverScenariosFromZipMetadata } from './recording-discovery';

describe('Bug 1 fix: discoverScenariosFromZipMetadata finds timestamp-only zips (2026-03-01)', () => {
  // Why this suite matters:
  // These tests verify the fix for Bug 1 end-to-end using real zip bytes
  // produced by produceTestZip. They prove the user's exact scenario now
  // works: a folder with timestamp-only zips is fully discoverable.

  it('discovers scenario from a timestamp-only zip filename via session.json metadata', async () => {
    // Why: The user's zip was named "2026-03-01_09-08-48utc.zip" — no
    // scenario prefix. discoverScenariosFromZipMetadata reads session.json
    // inside the zip to find the scenario name. This is the core fix.
    const testZip = await produceTestZip({ scenarioName: 'UserSession' });
    const root = new MockFSDirectoryHandle('UserRecordings');
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);

    const result = await discoverScenariosFromZipMetadata(root);

    expect(result.scenarioNames).toEqual(['UserSession']);
    expect(result.scenarioSessions.get('UserSession')).toHaveLength(1);
    expect(result.scenarioSessions.get('UserSession')![0].filename).toBe(
      '2026-03-01_09-08-48utc.zip'
    );
  });

  it('merges with listScenariosFromFolder for comprehensive discovery', async () => {
    // Why: After the fix, replay mode calls BOTH listScenariosFromFolder (for
    // subdirectory scenarios) AND discoverScenariosFromZipMetadata (for zip
    // metadata scenarios). This test simulates the merged result.
    const testZip = await produceTestZip({ scenarioName: 'ZipScenario' });
    const root = new MockFSDirectoryHandle('MixedFolder');
    // A subdirectory-based scenario
    const subdir = new MockFSDirectoryHandle('DirScenario');
    root.addDirectory('DirScenario', subdir);
    // A root-level zip with metadata
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);

    const dirScenarios = await listScenariosFromFolder(root);
    const zipDiscovery = await discoverScenariosFromZipMetadata(root);

    const allScenarios = [
      ...new Set([...dirScenarios, ...zipDiscovery.scenarioNames]),
    ].sort();

    expect(allScenarios).toEqual(['DirScenario', 'ZipScenario']);
  });
});

// ============================================================================
// Bug 2: No sessions listed after unzipping a recording into a subfolder
// ============================================================================

describe('Bug 2: Sessions not listed for unzipped recording folder (2026-03-01 user feedback)', () => {
  // Context:
  // After the user unzipped 2026-03-01_09-08-48utc.zip, a subfolder was
  // created containing raw recording data (actions/, frames/, session.json).
  // listScenariosFromFolder found this subfolder as a "scenario", but
  // listSessionZipsInScenario found 0 sessions inside it because the
  // function looks for .zip files, not raw recording data.

  it('listSessionZipsInScenario returns empty for an unzipped recording folder', async () => {
    // Why: This reproduces the exact user scenario. After unzipping, the
    // folder contains raw recording data — actions/*.json, frames/*.jpg,
    // session.json — but NO .zip files. listSessionZipsInScenario filters
    // for .zip files only, so it returns [].
    const unzippedFolder = new MockFSDirectoryHandle('2026-03-01_09-08-48utc');

    // Simulate the contents of an unzipped recording
    const actionsDir = new MockFSDirectoryHandle('actions');
    actionsDir.addFile(
      '000001.json',
      '{"type":"gps/positionUpdated","payload":{}}'
    );
    actionsDir.addFile('000002.json', '{"type":"xr/poseUpdated","payload":{}}');
    actionsDir.addFile(
      '000003.json',
      '{"type":"gps/positionUpdated","payload":{}}'
    );
    unzippedFolder.addDirectory('actions', actionsDir);

    const framesDir = new MockFSDirectoryHandle('frames');
    framesDir.addFile('frame-000001.jpg', 'jpeg-bytes');
    unzippedFolder.addDirectory('frames', framesDir);

    unzippedFolder.addFile(
      'session.json',
      JSON.stringify({
        scenarioName: 'Test Scenario',
        sessionName: 'session-001',
        startTime: '2026-03-01T09:08:48Z',
      })
    );

    const sessions = await listSessionZipsInScenario(unzippedFolder);

    // Current behavior: returns empty — no .zip files found inside
    expect(sessions).toEqual([]);
  });

  it('an unzipped recording folder IS recognized as a scenario but yields 0 sessions', async () => {
    // Why: This is the full end-to-end reproduction. The user's folder
    // has both the original zip AND the unzipped subfolder. The subfolder
    // shows up as a "scenario" in the dropdown, but selecting it shows
    // no sessions. This proves the disconnect between scenario discovery
    // (which finds the subfolder) and session listing (which expects zips).
    const root = new MockFSDirectoryHandle('UserRecordings');

    // The original zip file (still present after unzipping)
    root.addFile('2026-03-01_09-08-48utc.zip', 'zip-content');

    // The unzipped subfolder
    const unzippedFolder = new MockFSDirectoryHandle('2026-03-01_09-08-48utc');
    const actionsDir = new MockFSDirectoryHandle('actions');
    actionsDir.addFile('000001.json', '{"type":"gps/positionUpdated"}');
    unzippedFolder.addDirectory('actions', actionsDir);
    unzippedFolder.addFile('session.json', '{"scenarioName":"Test"}');
    root.addDirectory('2026-03-01_09-08-48utc', unzippedFolder);

    // Step 1: listScenariosFromFolder finds the unzipped directory
    const scenarios = await listScenariosFromFolder(root);
    expect(scenarios).toEqual(['2026-03-01_09-08-48utc']);

    // Step 2: User selects the scenario → listSessionZipsInScenario on it
    const scenarioHandle = await root.getDirectoryHandle(
      '2026-03-01_09-08-48utc'
    );
    const sessions = await listSessionZipsInScenario(scenarioHandle);

    // Bug: 0 sessions found! The unzipped folder has actions/ and session.json
    // but no .zip files. The user sees an empty session list.
    expect(sessions).toEqual([]);

    // Meanwhile, the original zip file at root level is also invisible
    // (listScenariosFromFolder ignores files, only finds directories).
  });

  it('a properly structured scenario folder with zips inside works correctly', async () => {
    // Why: This is the "control" test — it proves the expected folder
    // structure DOES work. The bug only manifests when the user's folder
    // structure doesn't match the assumed two-level hierarchy.
    // This test should pass (it documents the working case).
    const root = new MockFSDirectoryHandle('ProperlyStructured');

    const scenario = new MockFSDirectoryHandle('MyScenario');
    scenario.addFile('2026-03-01_09-08-48utc.zip', 'zip-content');
    scenario.addFile('2026-02-28_15-30-00utc.zip', 'zip-content-2');
    root.addDirectory('MyScenario', scenario);

    // Step 1: Scenario found
    const scenarios = await listScenariosFromFolder(root);
    expect(scenarios).toEqual(['MyScenario']);

    // Step 2: Sessions found inside scenario folder
    const scenarioHandle = await root.getDirectoryHandle('MyScenario');
    const sessions = await listSessionZipsInScenario(scenarioHandle);
    expect(sessions).toHaveLength(2);
    // Reverse-alphabetical order (newest first, Issue #3 2026-03-23)
    expect(sessions[0].filename).toBe('2026-03-01_09-08-48utc.zip');
    expect(sessions[1].filename).toBe('2026-02-28_15-30-00utc.zip');
  });
});

// ============================================================================
// Precondition: session.json metadata exists in produced zips (post-F2 fix)
// ============================================================================

import {
  loadSessionMetadata,
  readZipEntries,
} from 'gps-plus-slam-app-framework/storage/zip-reader';
import { produceTestZip } from 'gps-plus-slam-app-framework/test-utils/zip-round-trip-helpers';

describe('Issue 1 precondition: session.json present in produced zips (post-F2 fix)', () => {
  // Context:
  // The selected fix for Issue 1 (Option D) reads session.json from each
  // root-level zip to extract the scenarioName. This ONLY works if the
  // recording app actually writes session.json into the zip.
  //
  // The F2 fix reordered handleStopRecording() so writeSessionMetadata()
  // runs BEFORE the final sync. These tests prove the positive case —
  // zips produced by the corrected pipeline contain session.json with
  // the correct scenarioName.
  //
  // Historical note: The original tests here loaded a static pre-F2-fix
  // zip (TestDataJs/2026-03-01_09-08-48utc.zip) and asserted session.json
  // was ABSENT. That zip was deleted because it was produced by an outdated
  // app version. These round-trip tests replace it with self-contained,
  // deterministic verification using produceTestZip().

  it('produced zip contains session.json with scenarioName', async () => {
    // Why: proves the F2 fix works — zips produced by the current pipeline
    // include session.json. This is the core precondition for Issue 1's
    // Option D fix (read scenarioName from session.json inside each zip).
    const testZip = await produceTestZip({ scenarioName: 'MyScenario' });
    const entries = await readZipEntries(testZip.zipData);
    const sessionEntry = entries.find(
      (e) => !e.directory && e.filename.endsWith('session.json')
    );
    expect(sessionEntry).toBeDefined();
  });

  it('loadSessionMetadata returns correct metadata from produced zip', async () => {
    // Why: loadSessionMetadata is the exact function the Issue 1 fix will
    // use to extract scenarioName from each root-level zip. This test
    // validates the full chain: produce zip → loadSessionMetadata → get
    // scenarioName (carried in the opaque `contextTag` field post-Iter 0
    // of the AppFramework/RecorderApp boundary migration). If this passes,
    // Issue 1 Option D can rely on it.
    const testZip = await produceTestZip({ scenarioName: 'ParkWalk' });
    const metadata = await loadSessionMetadata(testZip.zipData);
    expect(metadata).not.toBeNull();
    expect(metadata!.contextTag).toBe('ParkWalk');
  });

  it('produced zip contains actions and session.json together', async () => {
    // Why: proves the F2 ordering (writeSessionMetadata before syncNow)
    // produces complete zips with BOTH action data and session metadata.
    // This mirrors the F2 bug pattern test — the old zip had actions but
    // no session.json. The corrected pipeline produces both.
    const testZip = await produceTestZip();
    const entries = await readZipEntries(testZip.zipData);
    const actionEntries = entries.filter(
      (e) =>
        !e.directory &&
        e.filename.includes('actions/') &&
        e.filename.endsWith('.json')
    );
    const sessionEntry = entries.find(
      (e) => !e.directory && e.filename.endsWith('session.json')
    );
    expect(actionEntries.length).toBeGreaterThan(0);
    expect(sessionEntry).toBeDefined();
  });
});
