// THROWAWAY comparison infrastructure, not a production adapter API.
import { createIsolatedRegistry } from '../../../GpsPlusSlamJs_AppFramework/src/utils/isolated-registry.ts';
export { calculateSunPosition } from '../../../GpsPlusSlamJs_AppFramework/src/geo/sun-position.ts';
import type { SunPositionResult } from '../../../GpsPlusSlamJs_AppFramework/src/geo/sun-position.ts';
export type { GpsPosition } from '../../../GpsPlusSlamJs_AppFramework/src/sensors/gps.ts';

export type Location = { mode: 'live' } | {
  mode: 'fixed'; latitudeDeg: number; longitudeDeg: number; recordedAtMs?: number;
};
export type Time = { mode: 'real' } | { mode: 'fixed'; instant: Date };
export interface Inputs { location: Location; time: Time }
export interface StoredInputs { location: Location; time: { mode: 'real' } | { mode: 'fixed'; ms: number } }
export interface Fix { lat: number; lon: number; timestamp: number }
export type State =
  | { readonly status: 'waiting-for-location' | 'disposed' }
  | { readonly status: 'invalid-input'; readonly reason: 'location' | 'time' }
  | { readonly status: 'ready'; readonly sample: {
    readonly latitudeDeg: number; readonly longitudeDeg: number;
    readonly locationSource: 'live' | 'fixed'; readonly timeSource: 'real' | 'fixed';
    readonly locationTimestampMs: number | null; readonly sunTimeMs: number;
    readonly sun: SunPositionResult;
  } };

// Shared only: boundary predicates, data copies and notification mechanics.
// Each variant owns its own source resolution, cache and update flow.
export const defaults = (): Inputs => ({ location: { mode: 'live' }, time: { mode: 'real' } });
export const epoch = (ms: number): boolean => Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime());
export const coordinates = (lat: number, lon: number): boolean =>
  Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180;
export const validFix = (fix: Fix): boolean => coordinates(fix.lat, fix.lon) && epoch(fix.timestamp);
export function storeInputs(inputs: Inputs): StoredInputs {
  return { location: { ...inputs.location }, time: inputs.time.mode === 'real'
    ? { mode: 'real' } : { mode: 'fixed', ms: inputs.time.instant.getTime() } };
}
export function copyInputs(inputs: StoredInputs): Inputs {
  return { location: { ...inputs.location }, time: inputs.time.mode === 'real'
    ? { mode: 'real' } : { mode: 'fixed', instant: new Date(inputs.time.ms) } };
}
export function freezeState(state: State): State {
  if (state.status === 'ready') {
    Object.freeze(state.sample.sun.directionNue);
    Object.freeze(state.sample.sun);
    Object.freeze(state.sample);
  }
  return Object.freeze(state);
}
export function notifications() {
  return createIsolatedRegistry<[State]>({ onError: (error) => console.warn('Throwaway listener failed', error) });
}
