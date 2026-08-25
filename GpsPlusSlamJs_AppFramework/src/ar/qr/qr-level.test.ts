/**
 * QR level-file loader — unit tests.
 *
 * Why this test matters: the level file is external, user-authored data that
 * feeds the pose solve (`physicalSizeM`) and the synthetic GPS vote (`geo`). A
 * malformed field must be rejected at the boundary with a clear error rather
 * than silently producing a wrong-scale or wrong-place vote on a device.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseQrLevel,
  serializeQrLevel,
  fetchQrLevel,
  QrLevelValidationError,
  type FetchLike,
} from './qr-level';

const valid = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 },
  },
  content: [{ kind: 'box' }],
};

describe('parseQrLevel', () => {
  it('accepts a well-formed level file and preserves content', () => {
    const level = parseQrLevel(valid);
    expect(level.version).toBe(1);
    expect(level.qr.physicalSizeM).toBe(0.2);
    expect(level.qr.geo).toEqual({
      lat: 47.5,
      lon: 8.7,
      alt: 400,
      headingDeg: 30,
    });
    expect(level.content).toEqual([{ kind: 'box' }]);
  });

  it('normalizes heading into [0, 360)', () => {
    expect(
      parseQrLevel({
        ...valid,
        qr: { ...valid.qr, geo: { ...valid.qr.geo, headingDeg: -90 } },
      }).qr.geo?.headingDeg
    ).toBe(270);
    expect(
      parseQrLevel({
        ...valid,
        qr: { ...valid.qr, geo: { ...valid.qr.geo, headingDeg: 450 } },
      }).qr.geo?.headingDeg
    ).toBe(90);
  });

  it('rejects non-objects', () => {
    expect(() => parseQrLevel(null)).toThrow(QrLevelValidationError);
    expect(() => parseQrLevel('nope')).toThrow(QrLevelValidationError);
  });

  it('rejects a missing or invalid version', () => {
    expect(() => parseQrLevel({ ...valid, version: 'x' })).toThrow(/version/);
  });

  it('rejects a non-positive physical size', () => {
    expect(() =>
      parseQrLevel({ ...valid, qr: { ...valid.qr, physicalSizeM: 0 } })
    ).toThrow(/physicalSizeM/);
    expect(() =>
      parseQrLevel({ ...valid, qr: { ...valid.qr, physicalSizeM: -1 } })
    ).toThrow(/physicalSizeM/);
  });

  it('accepts a geo-less level (no vote) — geo omitted', () => {
    const level = parseQrLevel({ version: 1, qr: { physicalSizeM: 0.2 } });
    expect(level.qr.geo).toBeUndefined();
    expect(level.qr.physicalSizeM).toBe(0.2);
  });

  it('accepts a size-less level (size measured later) — physicalSizeM omitted', () => {
    const level = parseQrLevel({
      version: 1,
      qr: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 } },
    });
    expect(level.qr.physicalSizeM).toBeUndefined();
    expect(level.qr.geo?.headingDeg).toBe(30);
  });

  it('accepts a bare level with neither size nor geo (trigger/observe-only)', () => {
    const level = parseQrLevel({ version: 1, qr: {} });
    expect(level.qr.physicalSizeM).toBeUndefined();
    expect(level.qr.geo).toBeUndefined();
  });

  it('still rejects a present-but-invalid size or partial geo', () => {
    expect(() =>
      parseQrLevel({ version: 1, qr: { physicalSizeM: 0 } })
    ).toThrow(/physicalSizeM/);
    expect(() =>
      parseQrLevel({
        version: 1,
        qr: { geo: { lat: 47.5, lon: 8.7, alt: 400 } },
      })
    ).toThrow(/headingDeg/);
  });

  it('rejects out-of-range geo coordinates', () => {
    const bad = (geo: Record<string, number>) => () =>
      parseQrLevel({ ...valid, qr: { ...valid.qr, geo } });
    expect(bad({ lat: 91, lon: 0, alt: 0, headingDeg: 0 })).toThrow(/lat/);
    expect(bad({ lat: 0, lon: 200, alt: 0, headingDeg: 0 })).toThrow(/lon/);
    expect(bad({ lat: 0, lon: 0, alt: NaN, headingDeg: 0 })).toThrow(/alt/);
    expect(bad({ lat: 0, lon: 0, alt: 0, headingDeg: Infinity })).toThrow(
      /headingDeg/
    );
  });
});

describe('fetchQrLevel', () => {
  const okFetch = (body: unknown): FetchLike =>
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      })
    );

  it('fetches, parses, and validates', async () => {
    const level = await fetchQrLevel('https://lvl/1', {
      fetchImpl: okFetch(valid),
    });
    expect(level.qr.physicalSizeM).toBe(0.2);
  });

  it('rejects a non-OK response', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      });
    await expect(fetchQrLevel('https://lvl/x', { fetchImpl })).rejects.toThrow(
      /status 404/
    );
  });

  it('rejects a non-JSON body', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('bad json')),
      });
    await expect(fetchQrLevel('https://lvl/x', { fetchImpl })).rejects.toThrow(
      /not valid JSON/
    );
  });

  it('wraps a network failure', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('offline'));
    await expect(fetchQrLevel('https://lvl/x', { fetchImpl })).rejects.toThrow(
      /fetch failed/
    );
  });

  it('propagates a schema violation from the fetched body', async () => {
    await expect(
      fetchQrLevel('https://lvl/x', { fetchImpl: okFetch({ version: 1 }) })
    ).rejects.toThrow(QrLevelValidationError);
  });
});

// Why these tests matter (QR-pose plan 2026-08-25, QD-5): the schema gains an
// optional 6-DoF `rotation` quaternion (NUE GPS-world frame). The invariants
// that keep old and new files honest: rotation-only files are valid (a
// floor/ceiling code has no honest heading, and a filler heading read by a
// rotation-unaware consumer would silently mis-place it), garbage rotations
// reject loudly, and geo with NEITHER heading nor rotation rejects.
describe('parseQrLevel — 6-DoF rotation', () => {
  const base = {
    version: 1,
    qr: { physicalSizeM: 0.2 },
  };
  /** Identity quaternion — a valid unit rotation. */
  const IDENTITY = [0, 0, 0, 1];

  it('accepts geo with rotation only (no headingDeg)', () => {
    const level = parseQrLevel({
      ...base,
      qr: {
        ...base.qr,
        geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: IDENTITY },
      },
    });
    expect(level.qr.geo?.rotation).toEqual(IDENTITY);
    expect(level.qr.geo?.headingDeg).toBeUndefined();
  });

  it('accepts geo with both fields when they AGREE', () => {
    // Identity quaternion = a vertical poster at bearing 0.
    const level = parseQrLevel({
      ...base,
      qr: {
        ...base.qr,
        geo: {
          lat: 47.5,
          lon: 8.7,
          alt: 400,
          headingDeg: 0.5,
          rotation: IDENTITY,
        },
      },
    });
    expect(level.qr.geo?.headingDeg).toBe(0.5);
    expect(level.qr.geo?.rotation).toEqual(IDENTITY);
  });

  // Why this matters (M1 milestone review #5): the optional-heading change
  // exists because a WRONG heading read by a rotation-unaware consumer
  // mis-places the code silently — so a document whose two orientation
  // fields disagree must reject, not validate.
  it('rejects geo whose headingDeg contradicts its rotation', () => {
    expect(() =>
      parseQrLevel({
        ...base,
        qr: {
          ...base.qr,
          geo: {
            lat: 47.5,
            lon: 8.7,
            alt: 400,
            headingDeg: 30, // identity rotation implies bearing 0
            rotation: IDENTITY,
          },
        },
      })
    ).toThrow(QrLevelValidationError);
  });

  it('rejects a headingDeg paired with a non-vertical rotation', () => {
    // −90° about North: face-up table code — no heading is honest.
    const half = (-90 * Math.PI) / 180 / 2;
    const faceUp = [Math.sin(half), 0, 0, Math.cos(half)];
    expect(() =>
      parseQrLevel({
        ...base,
        qr: {
          ...base.qr,
          geo: {
            lat: 47.5,
            lon: 8.7,
            alt: 400,
            headingDeg: 30,
            rotation: faceUp,
          },
        },
      })
    ).toThrow(QrLevelValidationError);
  });

  it('rejects geo with neither headingDeg nor rotation', () => {
    expect(() =>
      parseQrLevel({
        ...base,
        qr: { ...base.qr, geo: { lat: 47.5, lon: 8.7, alt: 400 } },
      })
    ).toThrow(QrLevelValidationError);
  });

  it.each([
    [[0, 0, 0, 1, 0], 'wrong length'],
    [[0, 0, 0, Number.NaN], 'NaN component'],
    [[0, 0, 0, 0.5], 'non-unit norm'],
    ['not-an-array', 'not an array'],
  ] as [unknown, string][])('rejects rotation %j (%s)', (rotation) => {
    expect(() =>
      parseQrLevel({
        ...base,
        qr: { ...base.qr, geo: { lat: 47.5, lon: 8.7, alt: 400, rotation } },
      })
    ).toThrow(QrLevelValidationError);
  });
});

// Why these tests matter: the writer did not exist before the QR-pose plan
// (the schema was reader-only), and the authoring loop stands on the exported
// JSON being re-readable byte-for-semantics by parseQrLevel.
describe('serializeQrLevel', () => {
  it('round-trips a rotation-carrying level through parseQrLevel', () => {
    const level = parseQrLevel({
      version: 1,
      qr: {
        physicalSizeM: 0.18,
        geo: { lat: 47.5, lon: 8.7, alt: 401.5, rotation: [0, 0, 0, 1] },
        mintQuality: { gpsAccuracyM: 3.4, alignmentSampleCount: 120 },
      },
      content: { note: 'opaque payload' },
    });

    const reparsed = parseQrLevel(JSON.parse(serializeQrLevel(level)));
    expect(reparsed).toEqual(level);
  });

  it('refuses to serialize an invalid level (fail loud, not a broken file)', () => {
    expect(() => serializeQrLevel({ version: Number.NaN, qr: {} })).toThrow(
      QrLevelValidationError
    );
  });
});

// Why these tests matter (M1 milestone review #6): the mint-quality block
// was an unpinned convention buried in opaque content — M4's placement
// readout and M5's attributable error numbers read these exact fields, so
// they need a schema and loud validation, not a guess.
describe('parseQrLevel — mintQuality', () => {
  const base = { version: 1, qr: {} };

  it('accepts a full quality block and round-trips it', () => {
    const level = parseQrLevel({
      ...base,
      qr: {
        mintQuality: {
          gpsAccuracyM: 3.4,
          alignmentSampleCount: 120,
          alignmentRmseM: 0.8,
          mintedAtIso: '2026-08-25T12:00:00Z',
        },
      },
    });
    expect(level.qr.mintQuality?.alignmentSampleCount).toBe(120);
    const reparsed = parseQrLevel(JSON.parse(serializeQrLevel(level)));
    expect(reparsed).toEqual(level);
  });

  it.each([
    [{ gpsAccuracyM: 0 }, 'zero accuracy'],
    [{ gpsAccuracyM: Number.NaN }, 'NaN accuracy'],
    [{ alignmentSampleCount: 2.5 }, 'fractional sample count'],
    [{ alignmentRmseM: -1 }, 'negative RMSE'],
    [{ mintedAtIso: '' }, 'empty timestamp'],
    ['not-an-object', 'not an object'],
  ] as [unknown, string][])('rejects mintQuality %j (%s)', (mintQuality) => {
    expect(() => parseQrLevel({ ...base, qr: { mintQuality } })).toThrow(
      QrLevelValidationError
    );
  });
});
