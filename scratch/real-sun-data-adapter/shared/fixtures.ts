// SYNTHETIC fixtures. These are not Task 1 outdoor recordings.
import type { GpsPosition, Inputs } from './contracts.ts';
export const startMs = Date.parse('2026-06-21T00:00:00Z');
export const pairs = [
  { latitudeDeg: 52.52, longitudeDeg: 13.405, ms: startMs + 6 * 3600000 },
  { latitudeDeg: 50.94, longitudeDeg: 6.96, ms: startMs + 12 * 3600000 },
  { latitudeDeg: 0, longitudeDeg: 0, ms: startMs + 23 * 3600000 },
];
export function recordedPair(index: number): Inputs {
  const pair = pairs[index]!;
  return { location: { mode: 'fixed', latitudeDeg: pair.latitudeDeg,
    longitudeDeg: pair.longitudeDeg, recordedAtMs: pair.ms - 5000 },
  time: { mode: 'fixed', instant: new Date(pair.ms) } };
}
export function syntheticFix(index = 0): GpsPosition {
  const pair = pairs[index]!;
  return { lat: pair.latitudeDeg, lon: pair.longitudeDeg, timestamp: pair.ms,
    accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
}
