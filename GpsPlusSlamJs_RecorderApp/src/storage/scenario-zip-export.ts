/**
 * Scenario ZIP Export (recorder-owned)
 *
 * Resolves the recorder's `scenarios/{name}/{session}/` OPFS layout to a
 * session directory handle and hands it to the framework's layout-agnostic
 * `exportSessionHandleAsZip`. The framework owns the ZIP schema (session.json /
 * actions/ / images/ + extension contributors); the recorder owns only the
 * scenario path resolution.
 *
 * Carved out of the framework's `storage/zip-export.ts` scenario branch in
 * Iter 7C of the AppFramework / RecorderApp boundary migration so the framework
 * no longer knows about scenarios.
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md
 */

import {
  exportSessionHandleAsZip,
  type ExportSessionAsZipOptions,
  type ZipExportResult,
} from 'gps-plus-slam-app-framework/storage/zip-export';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { writeFileOrAbort } from 'gps-plus-slam-app-framework/storage/write-file-or-abort';

const log = createLogger('ScenarioZipExport');

/**
 * Resolve `gps-plus-slam/scenarios/{scenarioName}/{sessionName}` to a session
 * directory handle. Re-acquires from `navigator.storage` to avoid holding
 * stale references. Throws a clear, layer-specific error when the scenario or
 * the session is missing.
 */
async function resolveScenarioSessionHandle(
  scenarioName: string,
  sessionName: string
): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory();
  const appRoot = await opfsRoot.getDirectoryHandle('gps-plus-slam');

  let scenarioHandle: FileSystemDirectoryHandle;
  try {
    const scenariosDir = await appRoot.getDirectoryHandle('scenarios');
    scenarioHandle = await scenariosDir.getDirectoryHandle(scenarioName);
  } catch {
    throw new Error(`Scenario "${scenarioName}" not found in OPFS storage`);
  }

  try {
    return await scenarioHandle.getDirectoryHandle(sessionName);
  } catch {
    throw new Error(
      `Session "${sessionName}" not found in scenario "${scenarioName}"`
    );
  }
}

/**
 * Export a scenario-nested session from OPFS as a ZIP blob.
 *
 * @throws Error if the scenario or session does not exist.
 */
export async function exportScenarioSessionAsZip(
  scenarioName: string,
  sessionName: string,
  options?: ExportSessionAsZipOptions
): Promise<ZipExportResult> {
  log.info(`Exporting scenario session: ${scenarioName}/${sessionName}`);
  const sessionHandle = await resolveScenarioSessionHandle(
    scenarioName,
    sessionName
  );
  return exportSessionHandleAsZip(sessionHandle, options);
}

/**
 * Sync a scenario-nested session's ZIP to an external file handle (periodic
 * crash-safety sync during recording, and the final sync at stop).
 *
 * @throws Error if the scenario or session does not exist.
 */
export async function syncScenarioSessionToExternalZip(
  fileHandle: FileSystemFileHandle,
  scenarioName: string,
  sessionName: string,
  options?: ExportSessionAsZipOptions
): Promise<ZipExportResult> {
  log.info(
    `Syncing scenario session to external ZIP: ${scenarioName}/${sessionName}`
  );
  const result = await exportScenarioSessionAsZip(
    scenarioName,
    sessionName,
    options
  );

  // Was a bare createWritable/write/close with NO abort guard, so a failed
  // write committed a partial ZIP over the user's previous export and leaked
  // the handle's lock. See the framework helper's docs.
  await writeFileOrAbort(fileHandle, result.blob);

  log.info(`Synced ${result.blob.size} bytes to external file`);
  return result;
}
