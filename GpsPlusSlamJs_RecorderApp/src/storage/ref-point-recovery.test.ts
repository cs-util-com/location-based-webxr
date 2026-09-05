/**
 * Tests for ref-point-recovery.ts
 *
 * Indexing module: extracts full RefPointDefinition objects from recording
 * ZIPs, grouped per scenario with observations merged by H3 cell ID
 * (`indexRefPointDefinitionsFromFolder` — 2026-07-05 folder-import plan).
 * This module preserves complete observation data (AR poses, GPS,
 * timestamps) needed for 3D display and OPFS restoration after browser data
 * loss.
 *
 * @module ref-point-recovery.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlobWriter, ZipWriter, TextReader } from '@zip.js/zip.js';
import { gpsToH3 } from 'gps-plus-slam-app-framework/geo/h3-proximity';
import type {
  RefPointDefinition,
  RefPointObservation,
} from './ref-point-loader';
import type { GpsPoint } from 'gps-plus-slam-app-framework/core';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock FileSystemDirectoryHandle for testing.
 * Same pattern as ref-point-importer.test.ts.
 */
function createMockFolderHandle(
  entries: Array<{
    name: string;
    kind: 'file' | 'directory';
    getFile?: () => Promise<File>;
  }>
): FileSystemDirectoryHandle {
  return {
    kind: 'directory' as const,
    name: 'test-folder',
    values: vi.fn(() => {
      let index = 0;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          if (index < entries.length) {
            return Promise.resolve({
              value: entries[index++],
              done: false as const,
            });
          }
          return Promise.resolve({ value: undefined, done: true as const });
        },
      };
    }),
    getFileHandle: vi.fn((name: string) => {
      const entry = entries.find((e) => e.name === name && e.kind === 'file');
      if (!entry) {
        return Promise.reject(new Error(`File not found: ${name}`));
      }
      return Promise.resolve(entry);
    }),
  } as unknown as FileSystemDirectoryHandle;
}

/** Build a realistic GpsPoint with all required fields. */
function makeGpsPoint(lat: number, lon: number, alt: number = 100): GpsPoint {
  return {
    id: `gps-${Date.now()}`,
    zeroRef: { lat, lon },
    latitude: lat,
    longitude: lon,
    altitude: alt,
    latLongAccuracy: 5,
    coordinates: [0, 0, 0],
    weight: 1,
    timestamp: Date.now(),
  };
}

/** Build a RefPointObservation with all required nested fields. */
function makeObservation(
  sessionId: string,
  timestamp: number,
  lat: number = 50.0,
  lon: number = 8.0
): RefPointObservation {
  return {
    sessionId,
    timestamp,
    arPose: {
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
    },
    gpsPoint: makeGpsPoint(lat, lon),
  };
}

// Distinct physical spots (~1.1 km apart) with their REAL H3 cell ids.
// Since the per-bucket merge (D6(a)) clusters definitions spatially and
// re-mints legacy ids, fixtures for DISTINCT logical points must carry
// distinct positions and H3-shaped ids or they would (correctly) merge.
const POS_A = { lat: 50.0, lon: 8.0 };
const POS_B = { lat: 50.01, lon: 8.0 };
const POS_C = { lat: 50.02, lon: 8.0 };
const CELL_A = gpsToH3(POS_A.lat, POS_A.lon);
const CELL_B = gpsToH3(POS_B.lat, POS_B.lon);
const CELL_C = gpsToH3(POS_C.lat, POS_C.lon);

/** Build a RefPointDefinition with the given observations. */
function makeRefPointDef(
  id: string,
  name: string,
  observations: RefPointObservation[]
): RefPointDefinition {
  return {
    id,
    name,
    createdAt: observations.length > 0 ? observations[0].timestamp : Date.now(),
    observations,
  };
}

/**
 * Create a ZIP blob containing ref point definitions and an optional session.json.
 *
 * `metadataField` controls how the scenario name is carried (mirrors the
 * production zips): `'scenarioName'` (legacy field, default — matches the
 * older tests), `'contextTag'` (current framework field), or `'none'`
 * (no session.json at all → indexing must fall back to DEFAULT_SCENARIO).
 */
async function createTestZipBlob(
  refPoints: RefPointDefinition[],
  scenarioName: string = 'TestScenario',
  metadataField: 'scenarioName' | 'contextTag' | 'none' = 'scenarioName'
): Promise<Blob> {
  const blobWriter = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(blobWriter, { level: 0 });

  if (metadataField !== 'none') {
    await zipWriter.add(
      'session.json',
      new TextReader(
        JSON.stringify({
          version: 1,
          startedAt: new Date().toISOString(),
          ...(metadataField === 'contextTag'
            ? { contextTag: scenarioName }
            : { scenarioName }),
          actionCount: 0,
          frameCount: 0,
          userAgent: 'test',
        })
      )
    );
  }

  for (const rp of refPoints) {
    await zipWriter.add(
      `refPoints/${rp.id}.json`,
      new TextReader(JSON.stringify(rp))
    );
  }

  return zipWriter.close();
}

/** Create a mock file entry (matching the pattern from importer tests). */
function createMockFileEntry(
  name: string,
  blob: Blob
): { name: string; kind: 'file'; getFile: () => Promise<File> } {
  return {
    name,
    kind: 'file' as const,
    getFile: () =>
      Promise.resolve(new File([blob], name, { type: 'application/zip' })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ref-point-recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // indexRefPointDefinitionsFromFolder — the scenario-aware, observable,
  // abortable full-folder pass (2026-07-05 folder-import plan, Slice 1).
  // ==========================================================================
  describe('indexRefPointDefinitionsFromFolder', () => {
    /**
     * Why this test matters:
     * D4a (strict per-scenario routing) depends on resolving each ZIP's
     * scenario from its session.json with the same precedence as the replay
     * discovery: contextTag (current) → scenarioName (legacy) → the
     * canonical Default Scenario for zips with no metadata.
     */
    it('groups definitions per scenario (contextTag primary, legacy scenarioName fallback, missing metadata → Default Scenario)', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');
      const { DEFAULT_SCENARIO } = await import('./session-zip-naming');

      const zipParis = await createTestZipBlob(
        [
          makeRefPointDef(CELL_A, 'Paris point', [
            makeObservation('s1', 1000, POS_A.lat, POS_A.lon),
          ]),
        ],
        'Paris',
        'contextTag'
      );
      const zipBerlin = await createTestZipBlob(
        [
          makeRefPointDef(CELL_B, 'Berlin point', [
            makeObservation('s2', 2000, POS_B.lat, POS_B.lon),
          ]),
        ],
        'Berlin',
        'scenarioName'
      );
      const zipNoMeta = await createTestZipBlob(
        [
          makeRefPointDef(CELL_C, 'Orphan point', [
            makeObservation('s3', 3000, POS_C.lat, POS_C.lon),
          ]),
        ],
        'ignored',
        'none'
      );

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', zipParis),
        createMockFileEntry('recording-2026-01-02_10-00-00utc.zip', zipBerlin),
        createMockFileEntry('recording-2026-01-03_10-00-00utc.zip', zipNoMeta),
      ]);

      const result = await indexRefPointDefinitionsFromFolder(folderHandle);

      expect(result.zipFilesScanned).toBe(3);
      expect(result.errors).toEqual([]);
      expect([...result.definitionsByScenario.keys()].sort()).toEqual(
        ['Berlin', DEFAULT_SCENARIO, 'Paris'].sort()
      );
      expect(
        result.definitionsByScenario.get('Paris')!.map((d) => d.id)
      ).toEqual([CELL_A]);
      expect(
        result.definitionsByScenario.get('Berlin')!.map((d) => d.id)
      ).toEqual([CELL_B]);
      expect(
        result.definitionsByScenario.get(DEFAULT_SCENARIO)!.map((d) => d.id)
      ).toEqual([CELL_C]);
    });

    /**
     * Why this test matters:
     * The literal "Default Scenario" written into metadata must land in the
     * same canonical bucket as missing metadata (UX feedback 2026-03-23
     * Issue 2) — otherwise the same recordings split into two groups.
     */
    it('canonicalizes an explicit "Default Scenario" metadata value into the same bucket as missing metadata', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');
      const { DEFAULT_SCENARIO } = await import('./session-zip-naming');

      const zipExplicit = await createTestZipBlob(
        [
          makeRefPointDef(CELL_A, 'A', [
            makeObservation('s1', 1000, POS_A.lat, POS_A.lon),
          ]),
        ],
        DEFAULT_SCENARIO,
        'contextTag'
      );
      const zipNone = await createTestZipBlob(
        [
          makeRefPointDef(CELL_B, 'B', [
            makeObservation('s2', 2000, POS_B.lat, POS_B.lon),
          ]),
        ],
        'ignored',
        'none'
      );

      const folderHandle = createMockFolderHandle([
        createMockFileEntry(
          'recording-2026-01-01_10-00-00utc.zip',
          zipExplicit
        ),
        createMockFileEntry('recording-2026-01-02_10-00-00utc.zip', zipNone),
      ]);

      const result = await indexRefPointDefinitionsFromFolder(folderHandle);

      expect([...result.definitionsByScenario.keys()]).toEqual([
        DEFAULT_SCENARIO,
      ]);
      expect(
        result.definitionsByScenario
          .get(DEFAULT_SCENARIO)!
          .map((d) => d.id)
          .sort()
      ).toEqual([CELL_A, CELL_B].sort());
    });

    /**
     * Why this test matters:
     * The start-screen progress bar (D2) renders directly from these
     * callbacks: an initial 0/total event (so the bar appears before the
     * first ZIP finishes) and one event per processed ZIP. Non-zip files
     * must not inflate the total.
     */
    it('reports an initial 0/total progress event and one event per ZIP, excluding non-zip entries from the total', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const zip1 = await createTestZipBlob(
        [makeRefPointDef('cell-1', 'One', [makeObservation('s1', 1000)])],
        'Paris',
        'contextTag'
      );
      const zip2 = await createTestZipBlob(
        [makeRefPointDef('cell-2', 'Two', [makeObservation('s2', 2000)])],
        'Paris',
        'contextTag'
      );

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', zip1),
        { name: 'notes.txt', kind: 'file' as const },
        { name: 'subdir', kind: 'directory' as const },
        createMockFileEntry('recording-2026-01-02_10-00-00utc.zip', zip2),
      ]);

      const events: Array<{ done: number; total: number }> = [];
      await indexRefPointDefinitionsFromFolder(folderHandle, {
        onProgress: (p) => events.push({ ...p }),
      });

      expect(events).toEqual([
        { done: 0, total: 2 },
        { done: 1, total: 2 },
        { done: 2, total: 2 },
      ]);
    });

    /**
     * Why this test matters:
     * A corrupt ZIP must not stall the bar (progress still advances past it)
     * nor abort the pass — its failure is reported via `errors` while the
     * remaining ZIPs are still indexed (async-UX failure path).
     */
    it('advances progress past a corrupt ZIP, records an error, and still indexes the remaining ZIPs', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const corrupt = new Blob(['this is not a zip archive']);
      const good = await createTestZipBlob(
        [
          makeRefPointDef(CELL_A, 'Good', [
            makeObservation('s1', 1000, POS_A.lat, POS_A.lon),
          ]),
        ],
        'Paris',
        'contextTag'
      );

      const folderHandle = createMockFolderHandle([
        // Newer timestamp → processed first, so the corrupt zip leads.
        createMockFileEntry('recording-2026-06-01_10-00-00utc.zip', corrupt),
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', good),
      ]);

      const events: Array<{ done: number; total: number }> = [];
      const result = await indexRefPointDefinitionsFromFolder(folderHandle, {
        onProgress: (p) => events.push({ ...p }),
      });

      expect(events).toEqual([
        { done: 0, total: 2 },
        { done: 1, total: 2 },
        { done: 2, total: 2 },
      ]);
      expect(result.zipFilesScanned).toBe(1);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(
        result.definitionsByScenario.get('Paris')!.map((d) => d.id)
      ).toEqual([CELL_A]);
    });

    /**
     * Why this test matters:
     * D3 requires the pass to be abortable (teardown / new folder pick). An
     * already-aborted signal must prevent any file reads; a mid-pass abort
     * must stop before the next ZIP and surface as a DOMException AbortError.
     */
    it('throws AbortError without reading any file when the signal is already aborted', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const zip = await createTestZipBlob(
        [makeRefPointDef('cell-1', 'One', [makeObservation('s1', 1000)])],
        'Paris',
        'contextTag'
      );
      const entry = createMockFileEntry(
        'recording-2026-01-01_10-00-00utc.zip',
        zip
      );
      const getFileSpy = vi.spyOn(entry, 'getFile');
      const folderHandle = createMockFolderHandle([entry]);

      const controller = new AbortController();
      controller.abort();

      const events: unknown[] = [];
      await expect(
        indexRefPointDefinitionsFromFolder(folderHandle, {
          signal: controller.signal,
          onProgress: (p) => events.push(p),
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(getFileSpy).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    it('stops before the next ZIP when the signal aborts mid-pass', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const mkZip = async (id: string) =>
        createTestZipBlob(
          [makeRefPointDef(id, id, [makeObservation('s1', 1000)])],
          'Paris',
          'contextTag'
        );
      const entries = [
        createMockFileEntry(
          'recording-2026-06-03_10-00-00utc.zip',
          await mkZip('cell-1')
        ),
        createMockFileEntry(
          'recording-2026-06-02_10-00-00utc.zip',
          await mkZip('cell-2')
        ),
        createMockFileEntry(
          'recording-2026-06-01_10-00-00utc.zip',
          await mkZip('cell-3')
        ),
      ];
      const spies = entries.map((e) => vi.spyOn(e, 'getFile'));
      const folderHandle = createMockFolderHandle(entries);

      const controller = new AbortController();
      await expect(
        indexRefPointDefinitionsFromFolder(folderHandle, {
          signal: controller.signal,
          onProgress: ({ done }) => {
            if (done === 1) controller.abort();
          },
        })
      ).rejects.toMatchObject({ name: 'AbortError' });

      // Newest-first: only the newest ZIP (entries[0]) was read before abort.
      expect(spies[0]).toHaveBeenCalledTimes(1);
      expect(spies[1]).not.toHaveBeenCalled();
      expect(spies[2]).not.toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * D4b-ii — ZIPs are processed newest-first (filename timestamp) so
     * bucket order keeps the newest recording's definitions first (the
     * gap-fill acceptance loop walks in order). Name conflicts resolve by
     * the D6(a) most-observations-wins policy; with an equal observation
     * count the tie goes to the name with the newest backing observation.
     * The entries are handed to the mock folder oldest-first to prove the
     * sort (directory order is arbitrary in real folders).
     */
    it('processes ZIPs newest-first; equal-count name conflicts resolve to the newest backing observation (D4b-ii + D6a tie-break)', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const oldObs = makeObservation('session-old', 1000, POS_A.lat, POS_A.lon);
      const newObs = makeObservation('session-new', 2000, POS_A.lat, POS_A.lon);
      const zipOld = await createTestZipBlob(
        [
          makeRefPointDef(CELL_A, 'Old Name', [oldObs]),
          // Unique to the old zip, with the earliest createdAt (500) — pins
          // that buckets keep FIRST-ENCOUNTER order (newest recording first),
          // not createdAt order: the Slice-2 gap-fill acceptance loop walks
          // the bucket in order and must see the newest definitions first.
          makeRefPointDef(CELL_B, 'Only Old', [
            makeObservation('session-old', 500, POS_B.lat, POS_B.lon),
          ]),
        ],
        'Paris',
        'contextTag'
      );
      const zipNew = await createTestZipBlob(
        [makeRefPointDef(CELL_A, 'New Name', [newObs])],
        'Paris',
        'contextTag'
      );

      const folderHandle = createMockFolderHandle([
        // Oldest handed over first on purpose — the sort must reorder.
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', zipOld),
        createMockFileEntry('recording-2026-06-01_10-00-00utc.zip', zipNew),
      ]);

      const result = await indexRefPointDefinitionsFromFolder(folderHandle);

      const paris = result.definitionsByScenario.get('Paris')!;
      expect(paris.map((d) => d.id)).toEqual([CELL_A, CELL_B]);
      expect(paris[0]!.name).toBe('New Name');
      expect(paris[0]!.createdAt).toBe(1000);
      expect(paris[0]!.observations).toHaveLength(2);
    });

    /**
     * Why this test matters:
     * D6(a) — a name backed by MORE observations must beat a newer name
     * backed by fewer (the rename-artifact fix: one throwaway name in the
     * newest recording cannot override a long consistent naming history),
     * and sibling definitions of the same physical spot (here: same cell)
     * collapse into ONE definition on a clean import.
     */
    it('resolves name conflicts by most observations across ZIPs (D6a name policy)', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const zipOld = await createTestZipBlob(
        [
          makeRefPointDef(CELL_A, 'Haustüre', [
            makeObservation('session-1', 1000, POS_A.lat, POS_A.lon),
            makeObservation('session-2', 2000, POS_A.lat, POS_A.lon),
          ]),
        ],
        'Paris',
        'contextTag'
      );
      const zipNew = await createTestZipBlob(
        [
          makeRefPointDef(CELL_A, 'Trz4', [
            makeObservation('session-3', 9000, POS_A.lat, POS_A.lon),
          ]),
        ],
        'Paris',
        'contextTag'
      );

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', zipOld),
        createMockFileEntry('recording-2026-06-01_10-00-00utc.zip', zipNew),
      ]);

      const result = await indexRefPointDefinitionsFromFolder(folderHandle);

      const paris = result.definitionsByScenario.get('Paris')!;
      expect(paris).toHaveLength(1);
      expect(paris[0]!.name).toBe('Haustüre');
      expect(paris[0]!.observations).toHaveLength(3);
    });

    /**
     * Why this test matters:
     * D6(a) — a legacy user-typed id at the same physical spot as an H3
     * definition is the same anchor; a clean import must persist ONE merged
     * definition under the H3 identity instead of resurrecting the split.
     */
    it('merges a legacy-id definition into the H3 definition of the same spot (D6a sibling merge)', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const zipLegacy = await createTestZipBlob(
        [
          makeRefPointDef('Treppe', 'Treppe', [
            makeObservation('s-legacy', 500, POS_A.lat, POS_A.lon),
          ]),
        ],
        'Paris',
        'contextTag'
      );
      const zipH3 = await createTestZipBlob(
        [
          makeRefPointDef(CELL_A, 'Treppe', [
            makeObservation('s-h3', 1000, POS_A.lat, POS_A.lon),
            makeObservation('s-h3b', 2000, POS_A.lat, POS_A.lon),
          ]),
        ],
        'Paris',
        'contextTag'
      );

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', zipLegacy),
        createMockFileEntry('recording-2026-06-01_10-00-00utc.zip', zipH3),
      ]);

      const result = await indexRefPointDefinitionsFromFolder(folderHandle);

      const paris = result.definitionsByScenario.get('Paris')!;
      expect(paris).toHaveLength(1);
      expect(paris[0]!.id).toBe(CELL_A);
      expect(paris[0]!.observations).toHaveLength(3);
    });

    /**
     * Why this test matters:
     * D4a — the same H3 id observed under two different scenarios must stay
     * in both scenario buckets (strict routing, no cross-scenario merge).
     */
    it('keeps the same ref-point id in separate scenario buckets without cross-scenario merging', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const zipParis = await createTestZipBlob(
        [
          makeRefPointDef(CELL_A, 'Paris view', [
            makeObservation('s1', 1000, POS_A.lat, POS_A.lon),
          ]),
        ],
        'Paris',
        'contextTag'
      );
      const zipBerlin = await createTestZipBlob(
        [
          makeRefPointDef(CELL_A, 'Berlin view', [
            makeObservation('s2', 2000, POS_A.lat, POS_A.lon),
          ]),
        ],
        'Berlin',
        'contextTag'
      );

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', zipParis),
        createMockFileEntry('recording-2026-01-02_10-00-00utc.zip', zipBerlin),
      ]);

      const result = await indexRefPointDefinitionsFromFolder(folderHandle);

      expect(
        result.definitionsByScenario.get('Paris')!.map((d) => ({
          id: d.id,
          obs: d.observations.length,
        }))
      ).toEqual([{ id: CELL_A, obs: 1 }]);
      expect(
        result.definitionsByScenario.get('Berlin')!.map((d) => ({
          id: d.id,
          obs: d.observations.length,
        }))
      ).toEqual([{ id: CELL_A, obs: 1 }]);
    });
  });
});
