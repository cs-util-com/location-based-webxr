import { describe, it, expect } from 'vitest';
import {
  formatSolarPhase,
  formatTimeMinutes,
  formatCoordinates,
  LOCATION_PRESETS,
  TIME_PRESETS,
  createStatusPanelViewModel,
} from './status-panel.js';
import { createRealSunDataAdapter } from 'gps-plus-slam-app-framework/geo/real-sun-data-adapter';

describe('status-panel', () => {
  describe('formatSolarPhase', () => {
    it('identifies Night when altitude is below -18 degrees', () => {
      const rad = (-20 * Math.PI) / 180;
      expect(formatSolarPhase(rad)).toBe('Night');
    });

    it('identifies Twilight when altitude is between -18 and 0 degrees', () => {
      const rad = (-10 * Math.PI) / 180;
      expect(formatSolarPhase(rad)).toContain('Twilight');
    });

    it('identifies Golden Hour when altitude is between 0 and 6 degrees', () => {
      const rad = (3 * Math.PI) / 180;
      expect(formatSolarPhase(rad)).toBe('Golden Hour');
    });

    it('identifies Daytime when altitude is above 6 degrees', () => {
      const rad = (45 * Math.PI) / 180;
      expect(formatSolarPhase(rad)).toBe('Daytime');
    });
  });

  describe('formatTimeMinutes', () => {
    it('formats minutes into HH:MM zero-padded strings', () => {
      expect(formatTimeMinutes(0)).toBe('00:00');
      expect(formatTimeMinutes(360)).toBe('06:00');
      expect(formatTimeMinutes(754)).toBe('12:34');
      expect(formatTimeMinutes(1439)).toBe('23:59');
    });
  });

  describe('formatCoordinates', () => {
    it('formats latitude and longitude to 4 decimal places with hemisphere indicators', () => {
      expect(formatCoordinates(52.52, 13.405)).toBe('52.5200° N, 13.4050° E');
      expect(formatCoordinates(-33.8688, -70.6483)).toBe('33.8688° S, 70.6483° W');
    });
  });

  describe('createStatusPanelViewModel', () => {
    it('provides defaults and updates adapter when scrubbing time', () => {
      const adapter = createRealSunDataAdapter();
      const vm = createStatusPanelViewModel(adapter);

      expect(vm.isLiveTime()).toBe(true);

      // Scrub time to 14:30 (870 mins)
      vm.setTimeMinutes(870);
      expect(vm.isLiveTime()).toBe(false);
      expect(vm.getTimeMinutes()).toBe(870);

      // Restore live time
      vm.setLiveTime();
      expect(vm.isLiveTime()).toBe(true);
    });

    it('updates adapter when selecting a preset location', () => {
      const adapter = createRealSunDataAdapter();
      const vm = createStatusPanelViewModel(adapter);

      vm.selectLocationPreset('berlin');
      const state = adapter.getState();
      expect(state.status).not.toBe('disposed');

      vm.setLiveLocation();
    });

    it('produces formatted status summary string', () => {
      const adapter = createRealSunDataAdapter();
      const vm = createStatusPanelViewModel(adapter);

      adapter.setLocationSource({
        mode: 'fixed',
        latitudeDeg: 52.52,
        longitudeDeg: 13.405,
      });
      adapter.setTimeSource({
        mode: 'fixed',
        instant: new Date('2026-06-21T12:00:00Z'),
      });

      const summary = vm.getStatusSummary(3);
      expect(summary.gpsFixes).toBe(3);
      expect(summary.phase).toBe('Daytime');
      expect(summary.azimuthDeg).toBeDefined();
      expect(summary.altitudeDeg).toBeDefined();
    });
  });
});
