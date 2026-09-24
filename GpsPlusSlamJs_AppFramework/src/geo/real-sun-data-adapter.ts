import type { GpsPosition } from '../sensors/gps.js';
import { createIsolatedRegistry } from '../utils/isolated-registry.js';
import { createLogger } from '../utils/logger.js';
import {
  calculateSunPosition,
  type SunPositionResult,
} from './sun-position.js';

export type SunLocationSource =
  | { readonly mode: 'live' }
  | {
      readonly mode: 'fixed';
      readonly latitudeDeg: number;
      readonly longitudeDeg: number;
      readonly recordedAtMs?: number;
    };

export type SunTimeSource =
  | { readonly mode: 'real' }
  | { readonly mode: 'fixed'; readonly instant: Date };

export interface SunInputSelection {
  readonly location: SunLocationSource;
  readonly time: SunTimeSource;
}

export interface RealSunSample {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly locationSource: 'live' | 'fixed';
  readonly timeSource: 'real' | 'fixed';
  /** Location sample time; null for manual coordinates without recorded metadata. */
  readonly locationTimestampMs: number | null;
  /** Absolute instant used by the core, not the wall time of publication. */
  readonly sunTimeMs: number;
  readonly sun: SunPositionResult;
}

export type RealSunDataState =
  | { readonly status: 'waiting-for-location' }
  | { readonly status: 'ready'; readonly sample: RealSunSample }
  | { readonly status: 'invalid-input'; readonly reason: 'location' | 'time' }
  | { readonly status: 'disposed' };

export interface RealSunDataAdapterOptions {
  /** Epoch milliseconds. Defaults to the device wall clock; unused in fixed mode. */
  readonly now?: () => number;
}

export interface RealSunDataAdapter {
  /** Receive the host's existing framework GPS callback; never starts a watch. */
  setGpsPosition(position: GpsPosition): RealSunDataState;
  /** Replace both sources before one evaluation/publication, including for replay. */
  setInputs(selection: SunInputSelection): RealSunDataState;
  setLocationSource(source: SunLocationSource): RealSunDataState;
  setTimeSource(source: SunTimeSource): RealSunDataState;
  /** The host owns refresh scheduling. Fixed time remains fixed. */
  refresh(): RealSunDataState;
  getState(): RealSunDataState;
  /** Returns defensive copies, including a fresh Date for fixed time. */
  getInputs(): SunInputSelection;
  /** Future publications only; returns an idempotent unsubscribe function. */
  subscribe(listener: (state: RealSunDataState) => void): () => void;
  /** Clear only live GPS and its error, preserving both source selections. */
  clearLiveLocation(): void;
  /** Idempotent; preserves the last selection for inspection. */
  dispose(): void;
}

type StoredTime = { mode: 'real' } | { mode: 'fixed'; instantMs: number };
type LocationReading =
  | { status: 'waiting-for-location' }
  | { status: 'invalid-input'; reason: 'location' }
  | {
      status: 'available';
      latitudeDeg: number;
      longitudeDeg: number;
      timestampMs: number | null;
    };

const log = createLogger('RealSunDataAdapter');

function isEpoch(ms: number): boolean {
  return Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime());
}

function readLocation(
  latitudeDeg: number,
  longitudeDeg: number,
  timestampMs?: number
): LocationReading {
  if (
    !Number.isFinite(latitudeDeg) ||
    Math.abs(latitudeDeg) > 90 ||
    !Number.isFinite(longitudeDeg) ||
    Math.abs(longitudeDeg) > 180 ||
    (timestampMs !== undefined && !isEpoch(timestampMs))
  ) {
    return { status: 'invalid-input', reason: 'location' };
  }
  return {
    status: 'available',
    latitudeDeg,
    longitudeDeg,
    timestampMs: timestampMs ?? null,
  };
}

function captureTime(source: SunTimeSource): StoredTime {
  // Date objects remain mutable even when frozen; keep only their absolute value.
  return source.mode === 'real'
    ? { mode: 'real' }
    : {
        mode: 'fixed',
        instantMs:
          source.instant instanceof Date ? source.instant.getTime() : NaN,
      };
}

/** Per-instance state; all public callbacks are bound so hosts can forward them directly. */
class SunDataAdapter implements RealSunDataAdapter {
  private location: SunLocationSource = { mode: 'live' };
  private time: StoredTime = { mode: 'real' };
  private live: LocationReading = { status: 'waiting-for-location' };
  private state: RealSunDataState = Object.freeze({
    status: 'waiting-for-location',
  });
  private readonly listeners = createIsolatedRegistry<[RealSunDataState]>({
    onError: (error) => log.error('Sun state subscriber failed:', error),
  });

  constructor(private readonly now: () => number) {}

  private calculate(): RealSunDataState {
    const point =
      this.location.mode === 'live'
        ? this.live
        : readLocation(
            this.location.latitudeDeg,
            this.location.longitudeDeg,
            this.location.recordedAtMs
          );
    // Location availability has precedence and avoids unnecessary clock reads.
    if (point.status !== 'available') {
      return Object.freeze({ ...point });
    }
    const instantMs =
      this.time.mode === 'fixed' ? this.time.instantMs : this.now();
    if (!isEpoch(instantMs)) {
      return Object.freeze({ status: 'invalid-input', reason: 'time' });
    }
    const date = new Date(instantMs);
    const sun = calculateSunPosition(
      date,
      point.latitudeDeg,
      point.longitudeDeg
    );
    // Own the published snapshot without freezing an object owned by the core.
    return Object.freeze({
      status: 'ready',
      sample: Object.freeze({
        latitudeDeg: point.latitudeDeg,
        longitudeDeg: point.longitudeDeg,
        locationSource: this.location.mode,
        timeSource: this.time.mode,
        locationTimestampMs: point.timestampMs,
        sunTimeMs: date.getTime(),
        sun: Object.freeze({
          ...sun,
          directionNue: Object.freeze({ ...sun.directionNue }),
        }),
      }),
    });
  }

  refresh = (): RealSunDataState => {
    if (this.state.status === 'disposed') {
      return this.state;
    }
    const next = this.calculate();
    this.state = next;
    this.listeners.run(next);
    return next;
  };

  setInputs = (selection: SunInputSelection): RealSunDataState => {
    if (this.state.status === 'disposed') {
      return this.state;
    }
    const location = { ...selection.location };
    const time = captureTime(selection.time);
    this.location = location;
    this.time = time;
    return this.refresh();
  };

  setLocationSource = (source: SunLocationSource): RealSunDataState => {
    if (this.state.status === 'disposed') {
      return this.state;
    }
    this.location = { ...source };
    return this.refresh();
  };

  setTimeSource = (source: SunTimeSource): RealSunDataState => {
    if (this.state.status === 'disposed') {
      return this.state;
    }
    this.time = captureTime(source);
    return this.refresh();
  };

  setGpsPosition = (position: GpsPosition): RealSunDataState => {
    if (this.state.status === 'disposed') {
      return this.state;
    }
    // GPS timestamps are required, unlike optional recorded/manual metadata.
    this.live = isEpoch(position.timestamp)
      ? readLocation(position.lat, position.lon, position.timestamp)
      : { status: 'invalid-input', reason: 'location' };
    return this.location.mode === 'live' ? this.refresh() : this.state;
  };

  getState = (): RealSunDataState => this.state;

  getInputs = (): SunInputSelection => ({
    location: { ...this.location },
    time:
      this.time.mode === 'real'
        ? { mode: 'real' }
        : { mode: 'fixed', instant: new Date(this.time.instantMs) },
  });

  subscribe = (listener: (state: RealSunDataState) => void): (() => void) =>
    this.state.status === 'disposed'
      ? () => {}
      : this.listeners.register(listener);

  clearLiveLocation = (): void => {
    if (this.state.status === 'disposed') {
      return;
    }
    this.live = { status: 'waiting-for-location' };
    if (this.location.mode === 'live') {
      this.refresh();
    }
  };

  dispose = (): void => {
    if (this.state.status === 'disposed') {
      return;
    }
    this.live = { status: 'waiting-for-location' };
    this.state = Object.freeze({ status: 'disposed' });
    this.listeners.runOnce(this.state);
  };
}

/** Connect host-supplied geographic inputs and absolute time to Sun Position Core. */
export function createRealSunDataAdapter(
  options: RealSunDataAdapterOptions = {}
): RealSunDataAdapter {
  return new SunDataAdapter(options.now ?? (() => Date.now()));
}
