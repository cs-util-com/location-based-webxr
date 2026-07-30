/**
 * Session-ZIP naming & scenario-identity helpers.
 *
 * Shared by the replay/recording folder discovery
 * (`storage/recording-discovery.ts`), the recording-mode ref-point indexing
 * pass (`storage/ref-point-recovery.ts`), and the two consumers that only need
 * `DEFAULT_SCENARIO` (`ui/hud.ts`, `recording/recording-session-handlers.ts`).
 *
 * It was split out of the discovery module in 2026-07 to dodge the
 * `no-storage-importing-ui` rule while that module still sat in `ui/`; the
 * module moved to `storage/` on 2026-07-30, so this file now stands on the
 * plain merit of being the one place scenario identity is decided.
 */

/**
 * Canonical scenario name used for recordings with no explicit scenario.
 * Both missing metadata and explicit "Default Scenario" in session.json
 * map to this value (UX feedback 2026-03-23 Issue 2).
 */
export const DEFAULT_SCENARIO = 'Default Scenario';

/**
 * Regex matching the timestamp portion of session zip filenames.
 *
 * Matches both formats:
 * - "recording-YYYY-MM-DD_HH-MM-SSutc.zip"
 * - "ScenarioName-session-YYYY-MM-DD_HH-MM-SSutc.zip"
 *
 * Captures: year, month, day, hours, minutes, seconds
 */
const SESSION_DATE_PATTERN =
  /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})utc\.zip$/;

/**
 * Parse a UTC date from a session zip filename.
 *
 * Supports both standard recording filenames and scenario-prefixed filenames:
 * - "recording-2026-02-19_10-15-00utc.zip"
 * - "Paris-session-2026-01-30_14-30-45utc.zip"
 *
 * @param filename - The zip filename to parse
 * @returns Parsed Date in UTC, or null if the filename doesn't match the
 * expected pattern or encodes an impossible timestamp (e.g. Feb 30, hour 24)
 */
export function parseDateFromSessionFilename(filename: string): Date | null {
  const match = SESSION_DATE_PATTERN.exec(filename);
  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hours);
  const mi = Number(minutes);
  const s = Number(seconds);

  // Construct via Date.UTC and verify every component round-trips: engines
  // NORMALIZE out-of-range components instead of rejecting them (V8 turns
  // 2026-02-30 into March 2, hour 24 into the next day), so an isNaN check
  // alone would accept impossible timestamps and sort the zip under a
  // fabricated date instead of falling back to File.lastModified.
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d ||
    date.getUTCHours() !== h ||
    date.getUTCMinutes() !== mi ||
    date.getUTCSeconds() !== s
  ) {
    return null;
  }

  return date;
}

/**
 * Resolve the scenario name a recording belongs to from its `session.json`
 * metadata (as returned by `loadSessionMetadataFromBlob`).
 *
 * Precedence: `contextTag` (current framework field, post-Iter 0 of the
 * AppFramework/RecorderApp boundary migration) → legacy `scenarioName`
 * (older exported zips) → `DEFAULT_SCENARIO`. Missing metadata, empty
 * strings, and the literal "Default Scenario" all canonicalize to
 * `DEFAULT_SCENARIO` (UX feedback 2026-03-23 Issue 2).
 *
 * Shared by the replay-mode discovery (`discoverScenariosFromZipMetadata`)
 * and the recording-mode ref-point indexing pass
 * (`indexRefPointDefinitionsFromFolder`) so the precedence rules live in
 * exactly one place (2026-07-05 folder-import plan §3.1).
 */
export function resolveScenarioNameFromMetadata(
  metadata: Record<string, unknown> | null
): string {
  const legacyScenarioName = metadata?.scenarioName;
  const tag =
    typeof metadata?.contextTag === 'string' && metadata.contextTag.length > 0
      ? metadata.contextTag
      : typeof legacyScenarioName === 'string' && legacyScenarioName.length > 0
        ? legacyScenarioName
        : null;
  return tag !== null && tag !== DEFAULT_SCENARIO ? tag : DEFAULT_SCENARIO;
}
