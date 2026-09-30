/**
 * Tests for {@link loadRecording} — the version-transparent recording loader.
 *
 * These tests use real recording zips from `TestDataJs/` to cover the
 * format-evolution path end-to-end:
 *   - An old era-≤3 recording (`2026-03-05_06-47-31utc.zip`): no sidecar
 *     `refPoints/` subdir, payloads use the pre-migration `gpsPoint` shape.
 *     The loader must apply the migration and reconstruct `refPoints` from
 *     `gpsData/markReferencePoint` actions.
 *   - A new era-4+ recording (`2026-04-23_15-55-36utc.zip`): sidecar
 *     `refPoints/*.json` files present. The loader must surface them and
 *     prefer sidecar entries over action-derived ones when ids overlap.
 *
 * Tests skip themselves when the zips are not present (CI without TestDataJs).
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BlobWriter, ZipWriter, TextReader, Reader } from '@zip.js/zip.js';
import {
  loadRecording,
  isMarkRefPointAction,
  pickGpsPoint,
  type LoadedRecording,
} from './recording-loader';
import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { buildSessionMetadataRecord } from 'gps-plus-slam-app-framework/storage/session-metadata-record';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import { createRecorderStore } from '../state/recorder-store';

const RECORDINGS_DIR = path.resolve(__dirname, '../../../../TestDataJs');
const OLD_ZIP = path.join(RECORDINGS_DIR, '2026-03-05_06-47-31utc.zip');
const NEW_ZIP = path.join(RECORDINGS_DIR, '2026-04-23_15-55-36utc.zip');

function readZip(p: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(p));
}

let oldLoaded: LoadedRecording | null = null;
let newLoaded: LoadedRecording | null = null;
let dataAvailable = false;

describe('loadRecording — version-transparent loader', () => {
  beforeAll(async () => {
    if (!fs.existsSync(OLD_ZIP) || !fs.existsSync(NEW_ZIP)) {
      return;
    }
    oldLoaded = await loadRecording(readZip(OLD_ZIP));
    newLoaded = await loadRecording(readZip(NEW_ZIP));
    dataAvailable = true;
  });

  describe('legacy recording (era ≤ 3, no sidecar refPoints)', () => {
    it('applies migration and reports it', () => {
      if (!dataAvailable) return;
      // Old recording uses `gpsPoint` shape → migration rewrites payloads.
      expect(oldLoaded!.capabilities.migrationApplied).toBe(true);
    });

    it('reports no sidecar ref points', () => {
      if (!dataAvailable) return;
      expect(oldLoaded!.capabilities.hasSidecarRefPoints).toBe(false);
    });

    it('reconstructs refPoints from markReferencePoint actions', () => {
      if (!dataAvailable) return;
      // The old recording is known to contain ≥1 markReferencePoint action.
      expect(oldLoaded!.refPoints.length).toBeGreaterThan(0);
      for (const def of oldLoaded!.refPoints) {
        expect(typeof def.id).toBe('string');
        expect(typeof def.createdAt).toBe('number');
        expect(def.observations.length).toBeGreaterThan(0);
        for (const obs of def.observations) {
          // Lat/lon must be real numbers post-migration (era ≤ 3 used
          // `gpsPoint.latitude/longitude` which migration renames to
          // `rawGpsPoint.latitude/longitude`).
          expect(typeof obs.gpsPoint.latitude).toBe('number');
          expect(typeof obs.gpsPoint.longitude).toBe('number');
          expect(Number.isFinite(obs.gpsPoint.latitude)).toBe(true);
          expect(Number.isFinite(obs.gpsPoint.longitude)).toBe(true);
        }
      }
    });

    it('returns actions in chronological order with post-migration schema', () => {
      if (!dataAvailable) return;
      const actions = oldLoaded!.actions;
      expect(actions.length).toBeGreaterThan(0);
      for (let i = 1; i < actions.length; i++) {
        expect(actions[i]!.index).toBeGreaterThanOrEqual(actions[i - 1]!.index);
      }
    });
  });

  describe('modern recording (era ≥ 4, sidecar refPoints/)', () => {
    it('reports sidecar ref points present', () => {
      if (!dataAvailable) return;
      expect(newLoaded!.capabilities.hasSidecarRefPoints).toBe(true);
    });

    it('reports session.json present', () => {
      if (!dataAvailable) return;
      expect(newLoaded!.capabilities.hasSessionMeta).toBe(true);
      expect(newLoaded!.meta).not.toBeNull();
    });

    it('returns at least one refPoint with sidecar fields (name not equal to id)', () => {
      if (!dataAvailable) return;
      expect(newLoaded!.refPoints.length).toBeGreaterThan(0);
      // Sidecar defs carry curated names. Reconstruction from actions
      // falls back to `name === id`. So at least one def must have a
      // distinct human-readable name to prove sidecars won.
      const hasCuratedName = newLoaded!.refPoints.some(
        (d) => typeof d.name === 'string' && d.name !== d.id
      );
      expect(hasCuratedName).toBe(true);
    });
  });

  describe('finalState (lazy, memoized)', () => {
    it('replays actions into a recorder store and is memoized', () => {
      if (!dataAvailable) return;
      const first = newLoaded!.getFinalState();
      const second = newLoaded!.getFinalState();
      expect(first).toBe(second);
    });
  });
});

/**
 * Boundary-contract tests for {@link isMarkRefPointAction}.
 *
 * Why this matters: the guard is the only validation of the pose arrays on
 * the action-derived ref-point path (the migration layer validates GPS
 * coordinates but never `position`/`rotation`). `buildDefsFromActions`
 * unconditionally reads `position[0..2]` and `rotation[0..3]`, so a short
 * array that merely passes `Array.isArray` would inject `undefined` into the
 * typed number tuples (`Vector3` / `Quaternion`) and silently corrupt every
 * downstream consumer of the observation's `arPose`. The guard must reject
 * such payloads up front.
 */
describe('isMarkRefPointAction — pose-array length contract', () => {
  const baseAction = (
    position: number[],
    rotation: number[]
  ): RecordedAction => ({
    type: 'gpsData/markReferencePoint',
    payload: {
      id: 'h3-abc',
      position,
      rotation,
      timestamp: 1_700_000_000_000,
      rawGpsPoint: { latitude: 50.77, longitude: 6.08 },
    },
  });

  it('accepts a full-length position (3) and rotation (4)', () => {
    expect(isMarkRefPointAction(baseAction([1, 2, 3], [0, 0, 0, 1]))).toBe(
      true
    );
  });

  it('rejects a position with fewer than 3 elements', () => {
    expect(isMarkRefPointAction(baseAction([1, 2], [0, 0, 0, 1]))).toBe(false);
  });

  it('rejects a rotation with fewer than 4 elements', () => {
    expect(isMarkRefPointAction(baseAction([1, 2, 3], [0, 0, 1]))).toBe(false);
  });

  it('rejects empty pose arrays even though they are arrays', () => {
    expect(isMarkRefPointAction(baseAction([], []))).toBe(false);
  });
});

/**
 * Boundary-contract tests for {@link pickGpsPoint}.
 *
 * Why this matters: the migration layer drops non-finite GPS coordinates only
 * when it synthesizes `refPoints/addRefPointEntry` actions, but
 * `buildDefsFromActions` reconstructs ref points directly from the preserved
 * `gpsData/markReferencePoint` actions. `pickGpsPoint` is therefore the only
 * place on that path that validates the coordinates. A point with
 * `NaN`/`undefined` lat/lon that slipped through would produce a
 * `RefPointDefinition` whose observations carry non-finite coordinates,
 * feeding the H3 matcher and `selectKnownAnchorsByCell` garbage. The guard
 * must return `null` so the malformed action is skipped.
 */
describe('pickGpsPoint — finite-coordinate contract', () => {
  const payload = (
    gps: Record<string, unknown> | undefined
  ): Parameters<typeof pickGpsPoint>[0] =>
    ({
      id: 'h3-abc',
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      timestamp: 1_700_000_000_000,
      rawGpsPoint: gps,
    }) as unknown as Parameters<typeof pickGpsPoint>[0];

  it('returns the point when latitude and longitude are finite', () => {
    const gps = { latitude: 50.77, longitude: 6.08 };
    expect(pickGpsPoint(payload(gps))).toBe(gps);
  });

  it('returns null when no GPS point is present', () => {
    expect(pickGpsPoint(payload(undefined))).toBeNull();
  });

  it('returns null when latitude is NaN', () => {
    expect(
      pickGpsPoint(payload({ latitude: NaN, longitude: 6.08 }))
    ).toBeNull();
  });

  it('returns null when longitude is undefined', () => {
    expect(pickGpsPoint(payload({ latitude: 50.77 }))).toBeNull();
  });

  it('returns null when coordinates are Infinity', () => {
    expect(
      pickGpsPoint(payload({ latitude: Infinity, longitude: 6.08 }))
    ).toBeNull();
  });

  it('falls back to the legacy `gpsPoint` field when `rawGpsPoint` is absent', () => {
    const gps = { latitude: 50.77, longitude: 6.08 };
    const p = {
      id: 'h3-abc',
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      timestamp: 1_700_000_000_000,
      gpsPoint: gps,
    } as unknown as Parameters<typeof pickGpsPoint>[0];
    expect(pickGpsPoint(p)).toBe(gps);
  });
});

/**
 * Deep-validation contract for sidecar `refPoints/*.json`.
 *
 * Why this matters: `readSidecarRefPoints` must apply the same deep
 * validation as the OPFS loader (`isRefPointDefinition`), not the shape-only
 * `isRefPointDefinitionShape`. A sidecar whose top-level shape is valid but
 * whose observations are malformed (missing `arPose` / `gpsPoint` / their
 * nested fields) would otherwise be surfaced in `LoadedRecording.refPoints`
 * and later crash consumers such as `flattenRefPointsToMarks` when they read
 * `obs.arPose.position` / `obs.gpsPoint.latitude` off undefined.
 */
describe('readSidecarRefPoints — deep observation validation', () => {
  async function buildZip(
    sidecars: Record<string, unknown>
  ): Promise<Uint8Array> {
    const zipWriter = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await zipWriter.add(
      'session.json',
      new TextReader(
        JSON.stringify({
          version: 1,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          scenarioName: 'TestScenario',
          actionCount: 0,
          frameCount: 0,
          userAgent: 'test',
        })
      )
    );
    for (const [id, body] of Object.entries(sidecars)) {
      await zipWriter.add(
        `refPoints/${id}.json`,
        new TextReader(JSON.stringify(body))
      );
    }
    const blob = await zipWriter.close();
    return new Uint8Array(await blob.arrayBuffer());
  }

  const validDef = {
    id: 'pointGood',
    name: 'Good Point',
    createdAt: 1_700_000_000_000,
    observations: [
      {
        sessionId: 's1',
        timestamp: 1_700_000_000_000,
        arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        gpsPoint: { latitude: 50.77, longitude: 6.08 },
      },
    ],
  };

  // Top-level shape is valid (id/name/createdAt/observations[]) but the lone
  // observation lacks `arPose` and `gpsPoint`, so deep validation must reject
  // the whole sidecar.
  const malformedObsDef = {
    id: 'pointBad',
    name: 'Bad Point',
    createdAt: 1_700_000_000_000,
    observations: [{ sessionId: 's1', timestamp: 1_700_000_000_000 }],
  };

  it('keeps a sidecar whose observations are well-formed', async () => {
    const loaded = await loadRecording(await buildZip({ pointGood: validDef }));
    expect(loaded.refPoints.map((d) => d.id)).toContain('pointGood');
    expect(loaded.capabilities.hasSidecarRefPoints).toBe(true);
  });

  it('skips a sidecar with malformed observations while keeping valid ones', async () => {
    const loaded = await loadRecording(
      await buildZip({ pointGood: validDef, pointBad: malformedObsDef })
    );
    const ids = loaded.refPoints.map((d) => d.id);
    expect(ids).toContain('pointGood');
    expect(ids).not.toContain('pointBad');
  });
});

/**
 * Within-recording re-mark round trip (indoor-loop enablement follow-up,
 * 2026-07-12).
 *
 * Why this test matters: the loop-recording field protocol re-marks the
 * same corner on every pass, so one recording zip legitimately carries
 * SEVERAL `refPoints/addRefPointEntry` actions of the same id AND a
 * sidecar with several same-session observations. This is the read half
 * of the end-to-end promise (the write half is pinned in
 * recorder-store.test.ts / ref-points-zip-contributor.test.ts /
 * ref-point-loader.test.ts): `loadRecording` must surface ALL of them —
 * a first-wins dedupe in the action stream or an observation merge in the
 * sidecar path would silently destroy the re-observation ground truth the
 * investigations consume.
 */
describe('loadRecording — within-recording re-marks survive the zip round trip', () => {
  const CORNER_ID = '8b1fa0a4970afff';
  const SESSION = 'recording-2026-07-11_12-44-19utc';
  const TIMESTAMPS = [1_700_000_001_000, 1_700_000_016_000, 1_700_000_031_000];

  function markAction(timestamp: number): RecordedAction {
    return {
      type: 'refPoints/addRefPointEntry',
      payload: {
        id: CORNER_ID,
        timestamp,
        name: 'Corner A1',
        rawGpsPoint: {
          id: `gps-${timestamp}`,
          latitude: 50.776,
          longitude: 6.083,
          timestamp,
        },
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
      },
    };
  }

  async function buildLoopZip(): Promise<Uint8Array> {
    const zipWriter = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await zipWriter.add(
      'session.json',
      new TextReader(
        JSON.stringify({
          version: 1,
          startedAt: new Date(TIMESTAMPS[0]!).toISOString(),
          endedAt: new Date(TIMESTAMPS[2]!).toISOString(),
          scenarioName: 'LoopScenario',
          actionCount: 4,
          frameCount: 0,
          userAgent: 'test',
        })
      )
    );
    const actions: RecordedAction[] = [
      {
        type: 'recording/startSession',
        payload: { sessionName: SESSION, startTime: TIMESTAMPS[0] },
      },
      ...TIMESTAMPS.map(markAction),
    ];
    for (let i = 0; i < actions.length; i++) {
      await zipWriter.add(
        `actions/${String(i + 1).padStart(6, '0')}.json`,
        new TextReader(JSON.stringify(actions[i]))
      );
    }
    await zipWriter.add(
      `refPoints/${CORNER_ID}.json`,
      new TextReader(
        JSON.stringify({
          id: CORNER_ID,
          name: 'Corner A1',
          createdAt: TIMESTAMPS[0],
          observations: TIMESTAMPS.map((t) => ({
            sessionId: SESSION,
            timestamp: t,
            arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
            gpsPoint: { latitude: 50.776, longitude: 6.083 },
          })),
        })
      )
    );
    const blob = await zipWriter.close();
    return new Uint8Array(await blob.arrayBuffer());
  }

  it('surfaces all three same-id actions AND all three sidecar observations', async () => {
    const loaded = await loadRecording(await buildLoopZip());

    // Action stream: every re-mark survives, in order, none deduped.
    const marks = loaded.actions.filter(
      (e) => e.action.type === 'refPoints/addRefPointEntry'
    );
    expect(marks).toHaveLength(3);
    expect(
      marks.map((e) => (e.action.payload as { timestamp: number }).timestamp)
    ).toEqual(TIMESTAMPS);

    // Sidecar path: one definition carrying ALL observations.
    const def = loaded.refPoints.find((d) => d.id === CORNER_ID);
    expect(def).toBeDefined();
    expect(def!.observations).toHaveLength(3);
    expect(def!.observations.map((o) => o.timestamp)).toEqual(TIMESTAMPS);
  });
});

/**
 * Lazy ZipSource Reader input — full-chain equivalence.
 *
 * Why this test matters: the Investigation corpus gate validates 100+
 * recording zips (2.4 GB total) and must not read whole archives into memory
 * just to check a few KB of JSON — that breached its 60 s regression budget
 * (gps-plus-slam repo:
 * GpsPlusSlamJs_Investigation/docs/2026-07-09-1944-regression-gate-budget-breach-followup.md).
 * loadRecording therefore accepts any zip.js Reader. This test proves the
 * full lazy chain (fd-backed ranged Reader → framework zip helpers →
 * loadRecording) yields a LoadedRecording identical to the Uint8Array path,
 * including loadRecording's concurrent triple use of the ONE shared Reader
 * instance (Promise.all over actions + metadata + sidecar helpers). It runs
 * against the framework SOURCE (vitest alias), so it guards the lazy path
 * before the framework change is published to npm.
 */
describe('loadRecording — lazy ZipSource Reader input', () => {
  /** Ranged reader over an open fd; reads only the byte ranges zip.js asks for. */
  class NodeFdReader extends Reader<void> {
    private readonly fd: number;
    constructor(fd: number) {
      super(undefined);
      this.fd = fd;
    }
    override async init(): Promise<void> {
      await super.init?.();
      this.size = fs.fstatSync(this.fd).size;
    }
    readUint8Array(index: number, length: number): Promise<Uint8Array> {
      const clamped = Math.min(length, Math.max(0, this.size - index));
      const buf = Buffer.alloc(clamped);
      let offset = 0;
      while (offset < clamped) {
        const n = fs.readSync(
          this.fd,
          buf,
          offset,
          clamped - offset,
          index + offset
        );
        if (n === 0) break;
        offset += n;
      }
      return Promise.resolve(
        new Uint8Array(buf.buffer, buf.byteOffset, offset)
      );
    }
  }

  it('yields a LoadedRecording identical to the Uint8Array path (modern zip)', async () => {
    if (!fs.existsSync(NEW_ZIP)) return; // CI without TestDataJs
    const fd = fs.openSync(NEW_ZIP, 'r');
    try {
      const lazy = await loadRecording(new NodeFdReader(fd));
      const eager = await loadRecording(readZip(NEW_ZIP));
      expect(lazy.meta).toEqual(eager.meta);
      expect(lazy.actions).toEqual(eager.actions);
      expect(lazy.refPoints).toEqual(eager.refPoints);
      expect(lazy.capabilities).toEqual(eager.capabilities);
    } finally {
      fs.closeSync(fd);
    }
  });

  it('handles the migration path identically for a legacy (era ≤ 3) zip', async () => {
    if (!fs.existsSync(OLD_ZIP)) return; // CI without TestDataJs
    const fd = fs.openSync(OLD_ZIP, 'r');
    try {
      const lazy = await loadRecording(new NodeFdReader(fd));
      const eager = await loadRecording(readZip(OLD_ZIP));
      expect(lazy.capabilities.migrationApplied).toBe(true);
      expect(lazy.actions).toEqual(eager.actions);
      expect(lazy.refPoints).toEqual(eager.refPoints);
    } finally {
      fs.closeSync(fd);
    }
  });
});

/**
 * A Tour Viewer authoring recording in the Recorder's loader.
 *
 * Why this test matters: the owner's troubleshooting loop is "record the
 * authoring in the Tour Viewer, hand over the zip, replay it in the
 * Recorder's desktop replay" (plan 2026-09-28-0953, decision D6). The Tour
 * Viewer writes that zip with the SAME framework pieces the Recorder uses
 * (`session.json` from the shared `buildSessionMetadataRecord`, flat
 * `actions/NNNNNN.json`), but its content differs from anything the Recorder
 * records: several AR entries in one stream, each closed by the QR markers'
 * clear, `endSession` and `resetGpsSessionData`, QR locks, 1 Hz depth, and
 * `tourAuthoring/*` actions no Recorder slice knows. This pins that the
 * loader takes it as era 5 (no migration), keeps every action and payload,
 * and that a replay rebuilds each kind of state from it.
 *
 * THE FIXTURE FOLLOWS THE ORDER THE TOUR VIEWER WRITES, and does not guess
 * it (M1a review finding 7: an earlier fixture put `setZeroPos` before
 * `startSession` and carried no QR, depth or placement payloads, so it
 * proved the loader against a stream that never exists). The sequence is
 * the one the Tour Viewer's `authoring-recording.test.ts` ("the order the
 * page writes") pins by driving the page's own entry, GPS handler and exit:
 * the recording opens with `startSession` because it starts before the
 * session; the zero comes with the first fix; the cold-start flag is a
 * listener effect of the zero, so it lands after that fix. The loader
 * cannot be imported from the Tour Viewer's tests (no package imports
 * another app), which is why the zip is built here to that sequence.
 */
describe('loadRecording — a Tour Viewer authoring recording', () => {
  const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);
  const CODE = 'https://example.test/t?c=1';

  function gpsEvent(
    i: number,
    odom: [number, number, number],
    lat: number,
    lon: number
  ): RecordedAction {
    return {
      type: 'gpsData/recordGpsEvent',
      payload: {
        odomPosition: odom,
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: `tv-${i}`,
          latitude: lat,
          longitude: lon,
          altitude: 400,
          latLongAccuracy: 5,
          timestamp: T0 + i * 1000,
        },
      },
    };
  }

  function startSession(atMs: number): RecordedAction {
    return {
      type: 'recording/startSession',
      payload: {
        contextTag: 'tour-viewer',
        sessionName: 'live',
        startTime: atMs,
      },
    };
  }

  /** The exit, as the Tour Viewer's AR entry sequences it. */
  const EXIT: RecordedAction[] = [
    { type: 'qrDetected/clearAllQrMarkers' },
    { type: 'recording/endSession' },
    { type: 'gpsData/resetGpsSessionData' },
  ];

  const QR_LOCK: RecordedAction = {
    type: 'qrDetected/recordQrDetection',
    payload: {
      text: CODE,
      timestamp: T0 + 1500,
      qrPoseWorld: { position: [0, 1, -2], rotation: [0, 0, 0, 1] },
      qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
      reprojectionErrorPx: 0.4,
    },
  };

  /** A 16 x 16 grid without colour, as the recording samples it. */
  const DEPTH: RecordedAction = {
    type: 'recording/recordDepthSample',
    payload: {
      timestamp: T0 + 1600,
      cameraPos: [0, 1.4, 0],
      cameraRot: [0, 0, 0, 1],
      points: Array.from({ length: 256 }, (_, i) => ({
        screenX: ((i % 16) + 1) / 17,
        screenY: (Math.floor(i / 16) + 1) / 17,
        depthM: 1 + (i % 7) * 0.5,
      })),
    },
  };

  const MEASURED: RecordedAction = {
    type: 'tourAuthoring/codeMeasured',
    payload: {
      levelId: 'lvl',
      text: CODE,
      fusedOdomPose: { position: [0, 1, -2], rotation: [0, 0, 0, 1] },
      sizeM: 0.16,
      alignmentMatrix: null,
      alignment: {},
      levelJson: '{}',
      arVisitIndex: 0,
      atMs: T0 + 2000,
    },
  };

  const PLACED: RecordedAction = {
    type: 'tourAuthoring/objectPlaced',
    payload: {
      object: {
        id: 'p1',
        kind: 'pin',
        label: 'Gate',
        createdAtIso: '2026-09-28T10:00:03.000Z',
        geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
      },
      arVisitIndex: 0,
      atMs: T0 + 3000,
      reticleOdomNue: [0, 0, -2],
      cameraOdomPose: null,
      alignmentMatrix: null,
      arWorldGroupMatrix: null,
      code: null,
      codeSizeM: 0.16,
    },
  };

  const FINISHED: RecordedAction = {
    type: 'tourAuthoring/finished',
    payload: {
      levelId: 'lvl',
      manifest: { version: 1, objects: [] },
      atMs: T0 + 4000,
    },
  };

  const ACTIONS: RecordedAction[] = [
    startSession(T0),
    { type: 'gpsData/setZeroPos', payload: { lat: 47.5, lon: 8.7 } },
    gpsEvent(0, [0, 0, 0], 47.5, 8.7),
    { type: 'gpsData/setColdStartOverrideEnabled', payload: true },
    gpsEvent(1, [0, 0, -15], 47.500135, 8.7),
    QR_LOCK,
    DEPTH,
    MEASURED,
    gpsEvent(2, [15, 0, 0], 47.5, 8.7002),
    PLACED,
    FINISHED,
    ...EXIT,
    startSession(T0 + 10_000),
    gpsEvent(10, [0, 0, 0], 47.5, 8.7),
    ...EXIT,
  ];

  async function tourViewerZip(withSessionJson: boolean): Promise<Uint8Array> {
    const zipWriter = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    if (withSessionJson) {
      await zipWriter.add(
        'session.json',
        new TextReader(
          JSON.stringify(
            buildSessionMetadataRecord({
              endTime: T0 + 60_000,
              startTime: T0,
              contextTag: 'tour-authoring',
              gpsPositions: [{ latitude: 47.5, longitude: 8.7 }],
              frameCount: 0,
              userAgent: 'test',
              pageUrl: undefined,
            })
          )
        )
      );
    }
    for (let i = 0; i < ACTIONS.length; i++) {
      await zipWriter.add(
        `actions/${String(i + 1).padStart(6, '0')}.json`,
        // Pretty-printed, as the Tour Viewer writes each action file.
        new TextReader(JSON.stringify(ACTIONS[i], null, 2))
      );
    }
    const blob = await zipWriter.close();
    return new Uint8Array(await blob.arrayBuffer());
  }

  it('is read as era 5: no migration, every action and payload kept in order', async () => {
    const loaded = await loadRecording(await tourViewerZip(true));

    expect(loaded.capabilities.hasSessionMeta).toBe(true);
    expect(loaded.meta?.['contextTag']).toBe('tour-authoring');
    expect(loaded.capabilities.migrationApplied).toBe(false);
    // Deep, not just the types: era 5 means no coordinate is rewritten, so
    // the QR lock, the depth grid and the log actions come back as written.
    expect(loaded.actions.map((e) => e.action)).toEqual(ACTIONS);
  });

  it('replays each kind of state: the fixes, the QR lock and the depth sample inside the visit, and the zero across both', async () => {
    const loaded = await loadRecording(await tourViewerZip(true));
    const actions = loaded.actions.map((e) => e.action);

    // Stepped as the desktop replay steps: up to the first exit, the
    // visit's state is all there.
    const store = createRecorderStore({
      storageBackend: new NullStorageBackend(),
      enableDevChecks: false,
    });
    const firstExit = actions.findIndex(
      (a) => a.type === 'qrDetected/clearAllQrMarkers'
    );
    for (const action of actions.slice(0, firstExit)) store.dispatch(action);
    const inVisit = store.getState();
    expect(inVisit.gpsData?.gpsEvents.gpsPositions).toHaveLength(3);
    expect(inVisit.qrDetected.markers[CODE]?.detections).toHaveLength(1);
    expect(inVisit.recording.latestDepthSample?.points).toHaveLength(256);

    // The whole stream: the recorder store ignores `tourAuthoring/*` (it has
    // no slice for them), the exits clear the visit's state, and the zero
    // survives them.
    const final = loaded.getFinalState();
    expect(final.gpsData?.zero).toMatchObject({ lat: 47.5, lon: 8.7 });
    expect(final.qrDetected.markers[CODE]).toBeUndefined();
  });

  it('without session.json the same zip is taken for era 1 and run through the migration - the reason the Tour Viewer writes one', async () => {
    const loaded = await loadRecording(await tourViewerZip(false));

    expect(loaded.capabilities.migrationApplied).toBe(true);
  });
});

/**
 * A Tour Viewer VIEWING recording (the visitor's `?debug=1` recording) in the
 * Recorder's loader.
 *
 * Why this test matters (authoring recording plan 2026-09-28-0953, M1b): a
 * viewer session that placed a tour wrongly is replayed here, like an
 * authoring one. Its stream differs from the creator's: synthetic QR votes
 * (`gpsData/recordGpsEvent` at the viewer's accuracy) after each lock, the
 * `tourViewing/*` log actions no Recorder slice knows, and - when it was
 * saved once, recorded on, and saved again (or saved from the next page's
 * orphan offer) - the Tour Viewer's saved marker `saved.blob` at the zip's
 * root. This pins that the loader takes it as era 5 with its tag, keeps
 * every action in order, ignores the marker, and that a replay holds the
 * votes as fixes inside the visit.
 *
 * THE FIXTURE FOLLOWS THE ORDER THE TOUR VIEWER WRITES (as the authoring
 * fixture above): the viewer pipeline records the detection, then logs the
 * lock, then dispatches the lock's votes one by one, then logs them as one
 * batch (`GpsPlusSlamJs_TourViewer/src/viewer-placement-viewing-log.test.ts`
 * drives that order through the real controller config).
 */
describe('loadRecording - a Tour Viewer viewing recording', () => {
  const T0 = Date.UTC(2026, 8, 30, 10, 0, 0);
  const CODE = 'https://example.test/t?c=1';

  function fix(id: string, i: number, lat: number, lon: number, acc: number) {
    return {
      type: 'gpsData/recordGpsEvent',
      payload: {
        odomPosition: [i, 0, -2],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id,
          latitude: lat,
          longitude: lon,
          altitude: 400,
          latLongAccuracy: acc,
          timestamp: T0 + i * 1000,
        },
      },
    } satisfies RecordedAction;
  }

  const MATRIX = null;
  const ACTIONS: RecordedAction[] = [
    {
      type: 'recording/startSession',
      payload: {
        contextTag: 'tour-viewer',
        sessionName: 'live',
        startTime: T0,
      },
    },
    { type: 'gpsData/setZeroPos', payload: { lat: 47.5, lon: 8.7 } },
    fix('tv-0', 0, 47.5, 8.7, 5),
    { type: 'gpsData/setColdStartOverrideEnabled', payload: true },
    fix('tv-1', 1, 47.500135, 8.7, 5),
    {
      type: 'qrDetected/recordQrDetection',
      payload: {
        text: CODE,
        timestamp: T0 + 1500,
        qrPoseWorld: { position: [0, 1, -2], rotation: [0, 0, 0, 1] },
        qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
        reprojectionErrorPx: 0.4,
      },
    },
    {
      type: 'tourViewing/codeLocked',
      payload: {
        text: CODE,
        level: {
          physicalSizeM: 0.16,
          geo: { lat: 47.50002, lon: 8.7, alt: 401, headingDeg: 90 },
        },
        qrPoseWorld: { position: [0, 1, -2], rotation: [0, 0, 0, 1] },
        reprojectionErrorPx: 0.4,
        scanGate: 'scanning',
        alignmentMatrix: MATRIX,
        arVisitIndex: 0,
        atMs: T0 + 1500,
      },
    },
    fix('qr-vote-0', 2, 47.50002, 8.70001, 5),
    fix('qr-vote-1', 3, 47.50002, 8.69999, 5),
    {
      type: 'tourViewing/votesCast',
      payload: {
        text: CODE,
        votedLocks: 1,
        votes: [
          {
            latitude: 47.50002,
            longitude: 8.70001,
            altitude: 400,
            accuracyM: 5,
            odomPosition: [2, 0, -2],
          },
          {
            latitude: 47.50002,
            longitude: 8.69999,
            altitude: 400,
            accuracyM: 5,
            odomPosition: [3, 0, -2],
          },
        ],
        alignmentMatrix: MATRIX,
        arVisitIndex: 0,
        atMs: T0 + 1500,
      },
    },
    {
      type: 'tourViewing/placed',
      payload: {
        what: 'ring',
        basis: 'code',
        count: 3,
        zero: { lat: 47.5, lon: 8.7 },
        code: {
          text: CODE,
          geo: { lat: 47.50002, lon: 8.7, alt: 401, headingDeg: 90 },
          centerNue: [2.2, 1, 0],
        },
        alignmentMatrix: MATRIX,
        arVisitIndex: 0,
        atMs: T0 + 1600,
      },
    },
    { type: 'qrDetected/clearAllQrMarkers' },
    { type: 'recording/endSession' },
    { type: 'gpsData/resetGpsSessionData' },
  ];

  async function viewingZip(): Promise<Uint8Array> {
    const zipWriter = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await zipWriter.add(
      'session.json',
      new TextReader(
        JSON.stringify(
          buildSessionMetadataRecord({
            endTime: T0 + 60_000,
            startTime: T0,
            contextTag: 'tour-viewing',
            gpsPositions: [{ latitude: 47.5, longitude: 8.7 }],
            frameCount: 0,
            userAgent: 'test',
            pageUrl: undefined,
          })
        )
      )
    );
    // An earlier save's marker, as a re-saved folder carries it.
    await zipWriter.add(
      'saved.blob',
      new TextReader(JSON.stringify({ savedAtMs: T0, actionFiles: 3 }))
    );
    for (let i = 0; i < ACTIONS.length; i++) {
      await zipWriter.add(
        `actions/${String(i + 1).padStart(6, '0')}.json`,
        new TextReader(JSON.stringify(ACTIONS[i], null, 2))
      );
    }
    const blob = await zipWriter.close();
    return new Uint8Array(await blob.arrayBuffer());
  }

  it('is read as era 5 with its tag, every action kept in order, the saved marker ignored', async () => {
    const loaded = await loadRecording(await viewingZip());

    expect(loaded.capabilities.hasSessionMeta).toBe(true);
    expect(loaded.meta?.['contextTag']).toBe('tour-viewing');
    expect(loaded.capabilities.migrationApplied).toBe(false);
    expect(loaded.actions.map((e) => e.action)).toEqual(ACTIONS);
  });

  it('replays the votes as fixes inside the visit, and the exit clears it', async () => {
    const loaded = await loadRecording(await viewingZip());
    const actions = loaded.actions.map((e) => e.action);
    const store = createRecorderStore({
      storageBackend: new NullStorageBackend(),
      enableDevChecks: false,
    });
    const exit = actions.findIndex(
      (a) => a.type === 'qrDetected/clearAllQrMarkers'
    );
    for (const action of actions.slice(0, exit)) store.dispatch(action);
    // Two fixes and the lock's two votes.
    expect(store.getState().gpsData?.gpsEvents.gpsPositions).toHaveLength(4);
    expect(store.getState().qrDetected.markers[CODE]?.detections).toHaveLength(
      1
    );
    const final = loaded.getFinalState();
    expect(final.gpsData?.zero).toMatchObject({ lat: 47.5, lon: 8.7 });
    expect(final.qrDetected.markers[CODE]).toBeUndefined();
  });
});
