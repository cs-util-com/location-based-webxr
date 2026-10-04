// Why this test matters: the fixture this script writes is what the QR size
// estimator is checked against on every fast gate (gate-speed plan
// 2026-10-04, G3). Its binary search must find the oracle's boundary, never
// an off-by-one, or every later estimator check is against a wrong table.
// A fake oracle with known boundaries (10 characters per version) pins it
// without the real, slow `qrcode`.
import { describe, expect, it } from 'vitest';

import {
  EC_LEVELS,
  MIXED_PAYLOADS,
  MODE_CHARS,
  deriveOracleFixture,
} from './regenerate-qr-oracle-fixture.mjs';

/** Version = 10 characters per version; nothing past v40 fits. */
const fakeOracle = (payload) => {
  const v = Math.max(1, Math.ceil(payload.length / 10));
  return v > 40 ? Number.POSITIVE_INFINITY : v;
};

describe('deriveOracleFixture', () => {
  const fixture = deriveOracleFixture(fakeOracle, 'fake@1.0.0');

  it('records the oracle it came from', () => {
    expect(fixture.oracle).toBe('fake@1.0.0');
  });

  it("finds the oracle's exact boundary for every EC level, mode and version", () => {
    const expected = Array.from({ length: 25 }, (_, i) => 10 * (i + 1));
    for (const ec of EC_LEVELS) {
      for (const mode of Object.keys(MODE_CHARS)) {
        expect(fixture.boundaries[ec][mode], `${ec} ${mode}`).toEqual(expected);
      }
    }
  });

  it("stores the oracle's version for every mixed payload, in order", () => {
    expect(fixture.mixed.map((m) => m.payload)).toEqual(MIXED_PAYLOADS);
    for (const { payload, versions } of fixture.mixed) {
      for (const ec of EC_LEVELS) {
        expect(versions[ec]).toBe(fakeOracle(payload));
      }
    }
  });
});
