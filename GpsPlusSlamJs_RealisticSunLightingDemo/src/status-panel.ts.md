# `src/status-panel.ts`

## Purpose

Provides view-model logic and solar formatting helpers for the HUD status display, live GPS coordination, 24-hour time scrubbing, and geographic location presets.

## Public API

```ts
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

export const LOCATION_PRESETS: readonly LocationPreset[];
export const TIME_PRESETS: readonly TimePreset[];

export function formatSolarPhase(altitudeRad: number): string;
export function formatTimeMinutes(minutes: number): string;
export function formatCoordinates(lat: number, lon: number): string;

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

export function createStatusPanelViewModel(
  adapter: RealSunDataAdapter
): StatusPanelViewModel;
```

## Invariants

- Translates altitude angles into standard solar phase names (Night, Astronomical Twilight, Nautical Twilight, Civil Twilight / Dawn, Golden Hour, Daytime).
- Formats time slider values into valid 24-hour "HH:MM" strings.
- Encapsulates adapter mode switching between live sensors and simulation overrides.

## Examples

```ts
const vm = createStatusPanelViewModel(adapter);
vm.setTimeMinutes(720); // 12:00
const summary = vm.getStatusSummary(5);
```

## Tests

Covered by unit tests in `src/status-panel.test.ts`.
