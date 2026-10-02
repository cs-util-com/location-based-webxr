import { describe, it, expect, vi } from 'vitest';
import { createQrSightingAccumulator } from 'gps-plus-slam-app-framework/ar/qr/qr-sighting-accumulator';
import { qrCodeId } from 'gps-plus-slam-app-framework/utils/qr-payload/qr-code-id';
import { createQrLevelZipContributor } from './qr-level-zip-contributor';
import { createQrSightingFeeder } from './qr-sighting-feeder';
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';
import type { Matrix4 } from 'gps-plus-slam-app-framework/core';
import type { QrAnchorOutcome } from './qr-level-zip-contributor';

// The mint reaches a licence-gated core API. Creating a store is the
// documented activation path, and it is what production does at boot before
// any recording can be saved.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Capture the outcomes with a real type, so the assertions below are
 *  checked rather than reaching through `any`. */
function outcomeSink(): {
  onOutcomes: (o: readonly QrAnchorOutcome[]) => void;
  seen: () => readonly QrAnchorOutcome[];
} {
  let captured: readonly QrAnchorOutcome[] = [];
  return {
    onOutcomes: (o) => {
      captured = o;
    },
    seen: () => captured,
  };
}
const HOSTS = ['gps.csutil.com'];
const OURS = 'https://gps.csutil.com/?qr=tour';
const NOW = '2026-08-28T10:00:00.000Z';

function feederWith(
  entries: { text: string; visits: number; yawDeg?: number }[]
) {
  const accumulator = createQrSightingAccumulator();
  for (const { text, visits, yawDeg = 0 } of entries) {
    for (let visit = 0; visit < visits; visit += 1) {
      const angle = ((visit === 0 ? 0 : yawDeg) * Math.PI) / 360;
      for (let i = 0; i < 4; i += 1) {
        accumulator.observe({
          text,
          timestamp: visit * 60_000 + i * 125,
          odomPose: {
            position: [0, 0, 0],
            rotation: [0, Math.sin(angle), 0, Math.cos(angle)],
          },
          sizeM: 0.16,
          alignmentMatrix: IDENTITY,
          zero: { lat: 48, lon: 11 },
          alignmentSampleCount: 8,
        });
      }
    }
  }
  return {
    accumulator,
    onPlacement: vi.fn(),
    noteFrameChange: vi.fn(),
    noteAlignment: vi.fn(),
    reset: vi.fn(),
    alignmentFor: () => ({
      alignmentMatrix: IDENTITY,
      zero: { lat: 48, lon: 11 },
      alignmentSampleCount: 8,
      segment: accumulator.currentSegment(),
    }),
  };
}

describe('createQrLevelZipContributor', () => {
  it('owns the qr/ folder', () => {
    const contributor = createQrLevelZipContributor({
      getFeeder: () => null,
      allowedHosts: HOSTS,
      nowIso: () => NOW,
    });
    expect(contributor.subdir).toBe('qr');
  });

  it('writes nothing, without throwing, when QR recording was off', async () => {
    // The contributor contract: tolerate an empty source by returning 0.
    const addFile = vi.fn();
    const contributor = createQrLevelZipContributor({
      getFeeder: () => null,
      allowedHosts: HOSTS,
      nowIso: () => NOW,
    });
    await expect(contributor.contribute(addFile)).resolves.toBe(0);
    expect(addFile).not.toHaveBeenCalled();
  });

  it('writes one level per fixed code, named by its identity', async () => {
    const addFile = vi.fn();
    const feeder = feederWith([{ text: OURS, visits: 3 }]);
    const contributor = createQrLevelZipContributor({
      getFeeder: () => feeder,
      allowedHosts: HOSTS,
      nowIso: () => NOW,
    });
    await expect(contributor.contribute(addFile)).resolves.toBe(1);
    expect(addFile).toHaveBeenCalledTimes(1);
    // The framework prepends the subdir, so the contributor passes a name
    // RELATIVE to it - `<id>.json`, not `qr/<id>.json`.
    const firstCall = addFile.mock.calls[0] as [string, Blob] | undefined;
    expect(firstCall?.[0]).toBe(`${await qrCodeId(OURS)}.json`);
  });

  it('closes the visit in progress before minting', async () => {
    // Why this test matters (cold review finding 11): under recency weighting
    // the LAST visit counts most, and stopping a recording right after a final
    // scan leaves that burst open. Without the flush it would be discarded -
    // the best evidence in the session, silently dropped.
    const accumulator = createQrSightingAccumulator();
    accumulator.observe({
      text: OURS,
      timestamp: 0,
      odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      sizeM: 0.16,
      alignmentMatrix: IDENTITY,
      zero: { lat: 48, lon: 11 },
      alignmentSampleCount: 8,
    });
    expect(accumulator.sightings(OURS)).toHaveLength(0); // still open

    const addFile = vi.fn();
    const contributor = createQrLevelZipContributor({
      getFeeder: () => ({
        accumulator,
        onPlacement: vi.fn(),
        noteFrameChange: vi.fn(),
        noteAlignment: vi.fn(),
        reset: vi.fn(),
        alignmentFor: () => ({
          alignmentMatrix: IDENTITY,
          zero: { lat: 48, lon: 11 },
          alignmentSampleCount: 8,
          segment: 0,
        }),
      }),
      allowedHosts: HOSTS,
      nowIso: () => NOW,
    });
    await expect(contributor.contribute(addFile)).resolves.toBe(1);
  });

  it('never mints a foreign code, and says why', async () => {
    // Why this test matters: without the gate the recorder would write a real
    // latitude and longitude for a shop's WiFi code into a zip the author then
    // publishes.
    const addFile = vi.fn();
    const sink = outcomeSink();
    const feeder = feederWith([
      { text: 'WIFI:S:CoffeeShop;T:WPA;P:hunter2;;', visits: 3 },
    ]);
    const contributor = createQrLevelZipContributor({
      getFeeder: () => feeder,
      allowedHosts: HOSTS,
      nowIso: () => NOW,
      onOutcomes: sink.onOutcomes,
    });
    await expect(contributor.contribute(addFile)).resolves.toBe(0);
    expect(addFile).not.toHaveBeenCalled();
    expect(sink.seen()[0]?.detail).toMatch(/not one of our/i);
  });

  it('writes nothing for a code that moved, and reports the reason', async () => {
    const addFile = vi.fn();
    const sink = outcomeSink();
    const feeder = feederWith([{ text: OURS, visits: 3, yawDeg: 40 }]);
    const contributor = createQrLevelZipContributor({
      getFeeder: () => feeder,
      allowedHosts: HOSTS,
      nowIso: () => NOW,
      onOutcomes: sink.onOutcomes,
    });
    await expect(contributor.contribute(addFile)).resolves.toBe(0);
    expect(sink.seen()[0]?.detail).toMatch(/moved/i);
  });

  it('reports both the written position and the unweighted comparison', async () => {
    // The recency half-life is a guess until the field probe measures it, so
    // the summary screen shows both and the author can see the difference.
    const sink = outcomeSink();
    const feeder = feederWith([{ text: OURS, visits: 2 }]);
    const contributor = createQrLevelZipContributor({
      getFeeder: () => feeder,
      allowedHosts: HOSTS,
      nowIso: () => NOW,
      onOutcomes: sink.onOutcomes,
    });
    await contributor.contribute(vi.fn());
    const outcome = sink.seen()[0];
    expect(outcome?.written).toBe(true);
    expect(outcome?.lat).toBeTypeOf('number');
    expect(outcome?.unweightedLat).toBeTypeOf('number');
    expect(outcome?.sizeM).toBeCloseTo(0.16, 6);
  });
});

describe('createQrLevelZipContributor — one bad code must not lose the recording', () => {
  it('reports the failure and still writes the other codes', async () => {
    // Why this test matters: `contribute` is documented in zip-export.ts as
    // having to tolerate a bad source by RETURNING rather than throwing, and
    // this module's header says the mint "never throws ... both want a verdict
    // rather than an exception". But the per-code body can still throw -
    // `addFile` can reject, `qrCodeId` throws without `crypto.subtle`, and
    // `qrLevelFileName` throws on an unsafe id. An escaping rejection fails
    // `exportSessionAsZip`, which takes down the crash-safety sync and the
    // whole session save with it: the frames and the depth stream are lost
    // because a QR anchor could not be named. The blast radius has to stop at
    // the anchor.
    const other = 'https://gps.csutil.com/?qr=tour&n=2';
    const feeder = feederWith([
      { text: OURS, visits: 3 },
      { text: other, visits: 3 },
    ]);
    const badId = await qrCodeId(OURS);
    const addFile = vi.fn((name: string) =>
      name.startsWith(badId)
        ? Promise.reject(new Error('disk full'))
        : Promise.resolve()
    );
    const sink = outcomeSink();

    const contributor = createQrLevelZipContributor({
      getFeeder: () => feeder,
      allowedHosts: HOSTS,
      nowIso: () => NOW,
      onOutcomes: sink.onOutcomes,
    });

    // It resolves rather than rejecting, and the healthy code is written.
    await expect(contributor.contribute(addFile)).resolves.toBe(1);

    const outcomes = sink.seen();
    expect(outcomes).toHaveLength(2);
    const failed = outcomes.find((o) => o.text === OURS);
    expect(failed?.written).toBe(false);
    // The author sees WHY on the summary screen, rather than the save simply
    // vanishing.
    expect(failed?.detail).toContain('disk full');
    expect(outcomes.find((o) => o.text === other)?.written).toBe(true);
  });
});

describe('createQrLevelZipContributor - the heading of a code seen as the recording started', () => {
  it('turns the sightings through the alignment at save, not the one they were seen with', async () => {
    // Why this test matters: this is the Recorder half of the start-at-code
    // heading fix. Start Recording swaps the store, so a code scanned right
    // away is seen through an alignment with no walk behind it - its yaw is
    // arbitrary (here 90 degrees off). The contributor runs at save, when the
    // session's alignment has seen the whole walk, and must hand THAT one to
    // the mint, or the written qr/<id>.json carries the arbitrary heading.
    const quarterTurn: Matrix4 = [
      0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1,
    ];
    const headingOf = async (
      seenWith: Matrix4
    ): Promise<number | undefined> => {
      const accumulator = createQrSightingAccumulator();
      for (let i = 0; i < 4; i += 1) {
        accumulator.observe({
          text: OURS,
          timestamp: i * 125,
          odomPose: { position: [0, 0, -2], rotation: [0, 0, 0, 1] },
          sizeM: 0.16,
          alignmentMatrix: seenWith,
          zero: { lat: 48, lon: 11 },
          alignmentSampleCount: 4,
        });
      }
      const addFile = vi.fn();
      const contributor = createQrLevelZipContributor({
        getFeeder: () => ({
          accumulator,
          onPlacement: vi.fn(),
          noteFrameChange: vi.fn(),
          noteAlignment: vi.fn(),
          reset: vi.fn(),
          alignmentFor: () => ({
            alignmentMatrix: IDENTITY,
            zero: { lat: 48, lon: 11 },
            alignmentSampleCount: 90,
            segment: accumulator.currentSegment(),
          }),
        }),
        allowedHosts: HOSTS,
        nowIso: () => NOW,
      });
      await contributor.contribute(addFile);
      const blob = (addFile.mock.calls[0] as [string, Blob] | undefined)?.[1];
      if (blob === undefined) return undefined;
      const level = JSON.parse(await blob.text()) as {
        qr: { geo?: { headingDeg?: number } };
      };
      return level.qr.geo?.headingDeg;
    };

    const mature = await headingOf(IDENTITY);
    expect(mature).toBeDefined();
    expect(await headingOf(quarterTurn)).toBeCloseTo(mature!, 6);
  });
});

describe('createQrLevelZipContributor - a code seen before a tracking restart', () => {
  it('places it through the alignment its segment closed with, not the immature one it was seen with', async () => {
    // Why this test matters (milestone review M1, 2026-10-02): a code scanned
    // as the recording started is seen through an alignment with no walk
    // behind it. If tracking then restarts, the session alignment at save
    // describes another odometry frame, so the mint falls back for that
    // code; the newest snapshot of its OWN is the immature one, and the
    // start-at-code defect comes back. The feeder must keep the alignment
    // its segment closed with - read BEFORE the restart reaches the store,
    // whose reducer wipes the alignment - and hand that to the mint.
    const immature: Matrix4 = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
    const walked: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 0, -7, 1];
    const zero = { lat: 48, lon: 11 };
    let live: { alignmentMatrix: Matrix4 | null; count: number } = {
      alignmentMatrix: immature,
      count: 3,
    };
    const feeder = createQrSightingFeeder({
      readAlignment: () => ({
        alignmentMatrix: live.alignmentMatrix,
        zero,
        alignmentSampleCount: live.count,
      }),
    });
    const placement = {
      pose: {
        position: [0, 0, -2] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
      sizeM: 0.16,
    };
    for (let i = 0; i < 4; i += 1) feeder.onPlacement(OURS, placement, i * 125);
    // The walk matures the alignment; then tracking restarts. The order is
    // the Recorder's: the feeder hears of it before the store does.
    live = { alignmentMatrix: walked, count: 60 };
    feeder.noteFrameChange();
    live = { alignmentMatrix: IDENTITY, count: 4 };

    const addFile = vi.fn();
    const contributor = createQrLevelZipContributor({
      getFeeder: () => feeder,
      allowedHosts: HOSTS,
      nowIso: () => NOW,
    });
    await expect(contributor.contribute(addFile)).resolves.toBe(1);
    const blob = (addFile.mock.calls[0] as [string, Blob] | undefined)?.[1];
    const level = JSON.parse(await blob!.text()) as {
      qr: { mintQuality?: { alignmentSampleCount?: number } };
    };
    expect(level.qr.mintQuality?.alignmentSampleCount).toBe(60);
  });
});

describe('createQrLevelZipContributor - a code left behind (D28 revised)', () => {
  it('mints it through the first mature alignment after its sighting, not the one at save', async () => {
    // Why this test matters (milestone review H1): through the alignment at
    // save, a code seen after the walk matured and then walked away from
    // inherits all SLAM drift of the walk after it (8.6 m p50 at 500 m with
    // 1 % and 1 degree per 100 m). The save must hand the mint the alignment
    // the feeder froze at the first mature one at or after the sighting.
    const atSighting: Matrix4 = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 5, 1,
    ];
    const zero = { lat: 48, lon: 11 };
    let live = { alignmentMatrix: atSighting, count: 120, extentM: 150 };
    const feeder = createQrSightingFeeder({
      readAlignment: () => ({
        alignmentMatrix: live.alignmentMatrix,
        zero,
        alignmentSampleCount: live.count,
        gpsExtentM: live.extentM,
      }),
    });
    const placement = {
      pose: {
        position: [0, 0, -2] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
      sizeM: 0.16,
    };
    for (let i = 0; i < 4; i += 1) feeder.onPlacement(OURS, placement, i * 125);
    // The author walks 500 m on; the alignment keeps changing.
    live = { alignmentMatrix: IDENTITY, count: 640, extentM: 560 };
    feeder.noteAlignment();

    const addFile = vi.fn();
    const contributor = createQrLevelZipContributor({
      getFeeder: () => feeder,
      allowedHosts: HOSTS,
      nowIso: () => NOW,
    });
    await expect(contributor.contribute(addFile)).resolves.toBe(1);
    const blob = (addFile.mock.calls[0] as [string, Blob] | undefined)?.[1];
    const level = JSON.parse(await blob!.text()) as {
      qr: { mintQuality?: { alignmentSampleCount?: number } };
    };
    expect(level.qr.mintQuality?.alignmentSampleCount).toBe(120);
  });
});
