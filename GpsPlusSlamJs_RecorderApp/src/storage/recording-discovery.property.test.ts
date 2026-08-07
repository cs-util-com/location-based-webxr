/**
 * Property-based tests for Session Browser Module
 *
 * Why this test file matters:
 * Property-based tests validate that core invariants hold across a wide range
 * of randomly generated inputs, catching edge cases that example-based tests
 * miss. For the session browser, the key properties are:
 * - parseDateFromSessionFilename always returns null or a valid Date
 * - Parsed dates preserve the timestamp components from the filename
 * - listScenariosFromFolder always returns sorted, directory-only names
 * - listSessionZipsInScenario always returns sorted, zip-only entries
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  listScenariosFromFolder,
  listSessionZipsInScenario,
  extractScenarioNamesFromZips,
} from './recording-discovery';
import { parseDateFromSessionFilename } from './session-zip-naming';
import { MockFSDirectoryHandle } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a valid UTC date components tuple within realistic ranges */
const arbDateComponents = fc.record({
  year: fc.integer({ min: 2020, max: 2030 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }), // 28 to avoid month-length issues
  hours: fc.integer({ min: 0, max: 23 }),
  minutes: fc.integer({ min: 0, max: 59 }),
  seconds: fc.integer({ min: 0, max: 59 }),
});

/** Generate a well-formed session filename from date components */
function toSessionFilename(d: {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `recording-${d.year}-${pad2(d.month)}-${pad2(d.day)}_${pad2(d.hours)}-${pad2(d.minutes)}-${pad2(d.seconds)}utc.zip`;
}

/** Arbitrary for a scenario-prefixed session filename */
const arbPrefixedFilename = fc
  .tuple(fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,19}$/), arbDateComponents)
  .map(([prefix, d]) => {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return `${prefix}-session-${d.year}-${pad2(d.month)}-${pad2(d.day)}_${pad2(d.hours)}-${pad2(d.minutes)}-${pad2(d.seconds)}utc.zip`;
  });

/** Random string that does NOT end with the date+utc.zip pattern */
const arbNonMatchingFilename = fc
  .stringMatching(/^[a-z][a-z0-9-]{1,20}\.zip$/)
  .filter((s) => !/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}utc\.zip$/.test(s));

// ---------------------------------------------------------------------------
// parseDateFromSessionFilename properties
// ---------------------------------------------------------------------------

describe('parseDateFromSessionFilename — properties', () => {
  it('always returns a valid Date for well-formed recording filenames', () => {
    // Property: any filename constructed from valid date components via
    // toSessionFilename must produce a non-null Date.
    fc.assert(
      fc.property(arbDateComponents, (d) => {
        const filename = toSessionFilename(d);
        const result = parseDateFromSessionFilename(filename);
        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).not.toBeNaN();
      }),
      { numRuns: 200 }
    );
  });

  it('preserves year/month/day/hour/minute/second from the filename', () => {
    // Property: the parsed Date's UTC components must exactly match the
    // components used to construct the filename.
    fc.assert(
      fc.property(arbDateComponents, (d) => {
        const filename = toSessionFilename(d);
        const result = parseDateFromSessionFilename(filename)!;
        expect(result.getUTCFullYear()).toBe(d.year);
        expect(result.getUTCMonth() + 1).toBe(d.month); // 0-indexed
        expect(result.getUTCDate()).toBe(d.day);
        expect(result.getUTCHours()).toBe(d.hours);
        expect(result.getUTCMinutes()).toBe(d.minutes);
        expect(result.getUTCSeconds()).toBe(d.seconds);
      }),
      { numRuns: 200 }
    );
  });

  it('always returns a valid Date for scenario-prefixed filenames', () => {
    // Property: prefixed filenames (e.g., "Paris-session-2026-...utc.zip")
    // should also parse successfully.
    fc.assert(
      fc.property(arbPrefixedFilename, (filename) => {
        const result = parseDateFromSessionFilename(filename);
        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).not.toBeNaN();
      }),
      { numRuns: 200 }
    );
  });

  it('returns null for filenames that do not match the date pattern', () => {
    // Property: random filenames without the full date+utc.zip suffix
    // must return null (no false positives).
    fc.assert(
      fc.property(arbNonMatchingFilename, (filename) => {
        const result = parseDateFromSessionFilename(filename);
        expect(result).toBeNull();
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// listScenariosFromFolder properties
// ---------------------------------------------------------------------------

describe('listScenariosFromFolder — properties', () => {
  it('result is always sorted alphabetically', async () => {
    // Property: no matter what order directories are added, the result is sorted.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,15}$/), {
          minLength: 0,
          maxLength: 10,
        }),
        async (names) => {
          const uniqueNames = [...new Set(names)];
          const root = new MockFSDirectoryHandle('root');
          for (const name of uniqueNames) {
            root.addDirectory(name, new MockFSDirectoryHandle(name));
          }
          const result = await listScenariosFromFolder(root);
          const sorted = [...result].sort();
          expect(result).toEqual(sorted);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('never includes file entries', async () => {
    // Property: even with mixed files and directories, only directories appear.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), {
          minLength: 1,
          maxLength: 5,
        }),
        fc.array(fc.stringMatching(/^[a-z]{1,8}\.txt$/), {
          minLength: 1,
          maxLength: 5,
        }),
        async (dirNames, fileNames) => {
          const root = new MockFSDirectoryHandle('root');
          for (const d of [...new Set(dirNames)]) {
            root.addDirectory(d, new MockFSDirectoryHandle(d));
          }
          for (const f of [...new Set(fileNames)]) {
            root.addFile(f, 'content');
          }
          const result = await listScenariosFromFolder(root);
          // None of the file names should appear
          for (const f of fileNames) {
            expect(result).not.toContain(f);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// listSessionZipsInScenario properties
// ---------------------------------------------------------------------------

describe('listSessionZipsInScenario — properties', () => {
  it('result is always sorted by filename in reverse order (most recent first)', async () => {
    // Property: session entries are always sorted by filename in reverse order
    // (Z→A) regardless of insertion order. Reverse-chronological = most recent on top
    // (UX feedback 2026-03-23 Issue 3).
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbDateComponents, { minLength: 0, maxLength: 8 }),
        async (dates) => {
          const scenario = new MockFSDirectoryHandle('TestScenario');
          for (const d of dates) {
            scenario.addFile(toSessionFilename(d), '');
          }
          const result = await listSessionZipsInScenario(scenario);
          const filenames = result.map((s) => s.filename);
          const reverseSorted = [...filenames].sort().reverse();
          expect(filenames).toEqual(reverseSorted);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('only includes .zip files', async () => {
    // Property: non-zip files and directories are never in the result.
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbDateComponents, { minLength: 1, maxLength: 3 }),
        fc.array(fc.stringMatching(/^[a-z]{1,8}\.(txt|json|csv)$/), {
          minLength: 1,
          maxLength: 3,
        }),
        async (dates, otherFiles) => {
          const scenario = new MockFSDirectoryHandle('Scenario');
          for (const d of dates) {
            scenario.addFile(toSessionFilename(d), '');
          }
          for (const f of [...new Set(otherFiles)]) {
            scenario.addFile(f, 'data');
          }
          scenario.addDirectory(
            'refPoints',
            new MockFSDirectoryHandle('refPoints')
          );

          const result = await listSessionZipsInScenario(scenario);
          for (const entry of result) {
            expect(entry.filename).toMatch(/\.zip$/);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// extractScenarioNamesFromZips properties
// ---------------------------------------------------------------------------

describe('extractScenarioNamesFromZips — properties', () => {
  it('result is always sorted alphabetically', async () => {
    // Property: extracted scenario names are always in alphabetical order,
    // matching the contract of listScenariosFromFolder for consistent merging.
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(
            fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,12}$/),
            arbDateComponents
          ),
          { minLength: 1, maxLength: 8 }
        ),
        async (entries) => {
          const root = new MockFSDirectoryHandle('root');
          for (const [prefix, d] of entries) {
            const pad2 = (n: number) => String(n).padStart(2, '0');
            const filename = `${prefix}-session-${d.year}-${pad2(d.month)}-${pad2(d.day)}_${pad2(d.hours)}-${pad2(d.minutes)}-${pad2(d.seconds)}utc.zip`;
            root.addFile(filename, '');
          }
          const result = await extractScenarioNamesFromZips(root);
          const sorted = [...result].sort();
          expect(result).toEqual(sorted);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('result never contains duplicates', async () => {
    // Property: even when multiple ZIPs share the same scenario prefix,
    // each scenario name appears exactly once.
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,8}$/),
          fc.array(arbDateComponents, { minLength: 2, maxLength: 5 })
        ),
        async ([prefix, dates]) => {
          const root = new MockFSDirectoryHandle('root');
          for (const d of dates) {
            const pad2 = (n: number) => String(n).padStart(2, '0');
            const filename = `${prefix}-session-${d.year}-${pad2(d.month)}-${pad2(d.day)}_${pad2(d.hours)}-${pad2(d.minutes)}-${pad2(d.seconds)}utc.zip`;
            root.addFile(filename, '');
          }
          const result = await extractScenarioNamesFromZips(root);
          expect(result).toEqual([...new Set(result)]);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('never includes entries from timestamp-only filenames', async () => {
    // Property: ZIPs with "recording-" prefix or bare timestamp filenames
    // must never produce a scenario name.
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbDateComponents, { minLength: 1, maxLength: 5 }),
        async (dates) => {
          const root = new MockFSDirectoryHandle('root');
          for (const d of dates) {
            root.addFile(toSessionFilename(d), ''); // "recording-..." format
          }
          const result = await extractScenarioNamesFromZips(root);
          expect(result).toEqual([]);
        }
      ),
      { numRuns: 50 }
    );
  });
});
