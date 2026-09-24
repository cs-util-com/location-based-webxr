import { describe, it, expect } from 'vitest';
import { decideTapPlacement, type PlacementDecision, type TapInput } from './placement.js';

describe('placement', () => {
  describe('decideTapPlacement', () => {
    it('returns waiting-for-gps when no GPS fix is available', () => {
      const input: TapInput = {
        hasGpsFix: false,
        reticleVisible: true,
      };
      const decision: PlacementDecision = decideTapPlacement(input);
      expect(decision.kind).toBe('waiting-for-gps');
    });

    it('returns waiting-for-gps when GPS is missing regardless of reticle visibility', () => {
      const input: TapInput = {
        hasGpsFix: false,
        reticleVisible: false,
      };
      const decision: PlacementDecision = decideTapPlacement(input);
      expect(decision.kind).toBe('waiting-for-gps');
    });

    it('returns no-surface when GPS is ready but no surface detected', () => {
      const input: TapInput = {
        hasGpsFix: true,
        reticleVisible: false,
      };
      const decision: PlacementDecision = decideTapPlacement(input);
      expect(decision.kind).toBe('no-surface');
    });

    it('returns place when both GPS fix and surface are available', () => {
      const input: TapInput = {
        hasGpsFix: true,
        reticleVisible: true,
      };
      const decision: PlacementDecision = decideTapPlacement(input);
      expect(decision.kind).toBe('place');
    });
  });
});
