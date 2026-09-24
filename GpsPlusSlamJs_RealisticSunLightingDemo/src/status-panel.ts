import type {
  RealSunDataAdapter,
  RealSunDataState,
} from 'gps-plus-slam-app-framework/geo/real-sun-data-adapter';

export interface LocationPreset {
  readonly id: string;
  readonly name: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
}

export interface TimePreset {
  readonly id: string;
  readonly name: string;
  readonly minutes: number;
}

export const LOCATION_PRESETS: readonly LocationPreset[] = Object.freeze([
  { id: 'berlin', name: 'Berlin (52.5° N)', latitudeDeg: 52.52, longitudeDeg: 13.405 },
  { id: 'london', name: 'London (51.5° N)', latitudeDeg: 51.5074, longitudeDeg: -0.1278 },
  { id: 'tokyo', name: 'Tokyo (35.7° N)', latitudeDeg: 35.6762, longitudeDeg: 139.6503 },
  { id: 'sydney', name: 'Sydney (33.9° S)', latitudeDeg: -33.8688, longitudeDeg: 151.2093 },
  { id: 'equator', name: 'Equator (0°)', latitudeDeg: 0.0, longitudeDeg: 0.0 },
]);

export const TIME_PRESETS: readonly TimePreset[] = Object.freeze([
  { id: 'dawn', name: 'Dawn', minutes: 360 }, // 06:00
  { id: 'noon', name: 'Noon', minutes: 720 }, // 12:00
  { id: 'golden', name: 'Golden Hr', minutes: 1110 }, // 18:30
  { id: 'dusk', name: 'Dusk', minutes: 1200 }, // 20:00
  { id: 'night', name: 'Night', minutes: 0 }, // 00:00
]);

/**
 * Returns a descriptive human-readable label for the solar elevation.
 */
export function formatSolarPhase(altitudeRad: number): string {
  const deg = (altitudeRad * 180) / Math.PI;
  if (deg < -18) return 'Night';
  if (deg < -12) return 'Astronomical Twilight';
  if (deg < -6) return 'Nautical Twilight';
  if (deg < 0) return 'Civil Twilight / Dawn';
  if (deg < 6) return 'Golden Hour';
  return 'Daytime';
}

/**
 * Formats a minute-of-day integer (0..1439) as HH:MM.
 */
export function formatTimeMinutes(minutes: number): string {
  const normalized = Math.max(0, Math.min(1439, Math.floor(minutes)));
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Formats geographic latitude and longitude with cardinal indicators.
 */
export function formatCoordinates(lat: number, lon: number): string {
  const latCard = lat >= 0 ? 'N' : 'S';
  const lonCard = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latCard}, ${Math.abs(lon).toFixed(4)}° ${lonCard}`;
}

export interface StatusSummary {
  readonly status: RealSunDataState['status'];
  readonly gpsFixes: number;
  readonly phase: string;
  readonly coordinatesText: string;
  readonly azimuthDeg?: number;
  readonly altitudeDeg?: number;
  readonly timeText: string;
  readonly isLiveTime: boolean;
  readonly isLiveLocation: boolean;
}

export interface StatusPanelViewModel {
  isLiveTime(): boolean;
  isLiveLocation(): boolean;
  getTimeMinutes(): number;
  setTimeMinutes(minutes: number): void;
  setLiveTime(): void;
  selectLocationPreset(presetId: string): void;
  setLiveLocation(): void;
  getStatusSummary(gpsFixes: number): StatusSummary;
}

/**
 * View-model coordinating HUD state with the solar adapter.
 */
export function createStatusPanelViewModel(
  adapter: RealSunDataAdapter
): StatusPanelViewModel {
  let liveTime = true;
  let liveLocation = true;
  let currentMinutes = 720;
  let baseDate = new Date();

  function applyFixedTime(minutes: number): void {
    const d = new Date(baseDate);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    d.setHours(h, m, 0, 0);
    adapter.setTimeSource({
      mode: 'fixed',
      instant: d,
    });
  }

  return {
    isLiveTime(): boolean {
      return liveTime;
    },

    isLiveLocation(): boolean {
      return liveLocation;
    },

    getTimeMinutes(): number {
      return currentMinutes;
    },

    setTimeMinutes(minutes: number): void {
      liveTime = false;
      currentMinutes = minutes;
      applyFixedTime(minutes);
    },

    setLiveTime(): void {
      liveTime = true;
      adapter.setTimeSource({ mode: 'real' });
    },

    selectLocationPreset(presetId: string): void {
      const preset = LOCATION_PRESETS.find((p) => p.id === presetId);
      if (preset) {
        liveLocation = false;
        adapter.setLocationSource({
          mode: 'fixed',
          latitudeDeg: preset.latitudeDeg,
          longitudeDeg: preset.longitudeDeg,
        });
      }
    },

    setLiveLocation(): void {
      liveLocation = true;
      adapter.setLocationSource({ mode: 'live' });
    },

    getStatusSummary(gpsFixes: number): StatusSummary {
      const state = adapter.getState();
      if (state.status === 'ready') {
        const { sample } = state;
        const phase = formatSolarPhase(sample.sun.altitudeRad);
        const coordsText = formatCoordinates(sample.latitudeDeg, sample.longitudeDeg);
        const azimuthDeg = (sample.sun.azimuthRad * 180) / Math.PI;
        const altitudeDeg = (sample.sun.altitudeRad * 180) / Math.PI;
        const timeText = liveTime
          ? new Date(sample.sunTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : formatTimeMinutes(currentMinutes);

        return {
          status: state.status,
          gpsFixes,
          phase,
          coordinatesText: coordsText,
          azimuthDeg,
          altitudeDeg,
          timeText,
          isLiveTime: liveTime,
          isLiveLocation: liveLocation,
        };
      }

      return {
        status: state.status,
        gpsFixes,
        phase: state.status === 'waiting-for-location' ? 'Acquiring GPS…' : 'Standby',
        coordinatesText: 'Searching for GPS fix…',
        timeText: liveTime ? 'Live Clock' : formatTimeMinutes(currentMinutes),
        isLiveTime: liveTime,
        isLiveLocation: liveLocation,
      };
    },
  };
}
