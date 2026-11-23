import { describe, test } from 'vitest';
import { createTrackerCaptureGate } from './tracker-capture-gate.js';
import {
  createNearbyPositionSource,
  type NearbyGpsEvents,
  type NearbyGpsPoint,
} from './nearby-position.js';
import { DEFAULT_NEARBY_PARAMS, type Target } from './nearby-targets.js';

/**
 * Opt-in benchmark of `wantsFrame` (`pnpm bench`): the camera asks it at
 * about 60 Hz while captures are vetoed, so its median is read against
 * 0.1 ms. Asserts nothing (the repo forbids wall-clock bars in gate tests).
 *
 * Parameters: 100 QR targets on a 1 km square, a 1 h session of 1 Hz device
 * fixes (3 600, odometry through an identity alignment), the live pose
 * walking through the square, the default kernel params (H 60 s), a 125 ms
 * capture interval and one QR registration at 8 / 1 / 1 / 8 Hz.
 */

const NOW = 1_800_000_000_000;
const ZERO = { lat: 47, lon: 8 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const gpsPositions: NearbyGpsPoint[] = [];
const odometryPositions: number[][] = [];
for (let i = 0; i < 3_600; i += 1) {
  gpsPositions.push({
    latitude: 47,
    longitude: 8,
    latLongAccuracy: 4,
    timestamp: NOW - 3_600_000 + (i + 1) * 1_000,
  });
  odometryPositions.push([(i * 0.3) % 1_000, 0, (i * 0.7) % 1_000]);
}
const events: NearbyGpsEvents = { gpsPositions, odometryPositions };

const targets: Target[] = [];
for (let i = 0; i < 100; i += 1) {
  targets.push({
    key: `code-${String(i)}`,
    kind: 'qr',
    north: (i % 10) * 100,
    east: Math.floor(i / 10) * 100,
    accM: 3,
    reachM: 6.5,
  });
}

let tick = 0;
const source = createNearbyPositionSource({
  gpsEvents: () => events,
  alignment: () => IDENTITY,
  zero: () => ZERO,
  live: () => {
    tick += 1;
    const d = (tick * 0.02) % 1_000;
    return { t: NOW, north: d, east: d, ar: [d, 0, d], accM: 4 };
  },
  lookBackMs: DEFAULT_NEARBY_PARAMS.H,
});
const gate = createTrackerCaptureGate({
  position: (nowMs) => source.position(nowMs),
  captureIntervalMs: 125,
});
gate.register({
  kind: 'qr',
  targets: () => targets,
  cadence: {
    inGateHz: 8,
    outsideHz: 1,
    unknownHz: 1,
    burstHz: 8,
    burstMs: 10_000,
  },
  isBusy: () => false,
  lastHitAtMs: () => null,
  forceOn: () => false,
});

describe('tracker capture gate', () => {
  // The clock stays within 4 s of the newest fix, so the state is 'gps'
  // and the GPS gate scans every target on every call (the costly case).
  let t = NOW;
  test('wantsFrame: 100 targets, 1 h session', async ({ bench }) => {
    const result = await bench('wantsFrame: 100 targets, 1 h session', () => {
      t = NOW + ((t - NOW + 16) % 4_000);
      gate.wantsFrame(t);
    }).run();
    // Printed, never asserted: read against 0.1 ms.
    const { latency } = result as {
      latency?: { p50?: number; p99?: number };
    };
    // eslint-disable-next-line no-console -- a bench prints its figure for a person to read.
    console.info(
      `wantsFrame median ${String(latency?.p50)} ms, p99 ${String(latency?.p99)} ms`
    );
  });
});
