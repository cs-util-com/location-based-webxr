import { describe, it, expect } from 'vitest';
import {
  SEGMENTING_ACTION_TYPES,
  isSegmentingActionType,
} from './segmenting-actions.js';

describe('segmenting actions', () => {
  it('names exactly the two actions that move the odometry frame', () => {
    // Why this test matters: two consumers act on this list in OPPOSITE ways
    // - the geo join declines such a recording, the QR fold segments it - so
    // an entry appearing in one copy and not the other would let one silently
    // accept what the other refuses. Pinning the contents is what makes the
    // single list load-bearing rather than decorative.
    expect([...SEGMENTING_ACTION_TYPES]).toEqual([
      'gpsData/odometryTrackingRestarted',
      'gpsData/arLoopClosureDetected',
    ]);
  });

  it('recognises those types and nothing else', () => {
    for (const type of SEGMENTING_ACTION_TYPES) {
      expect(isSegmentingActionType(type), type).toBe(true);
    }
    for (const type of [
      'gpsData/recordGpsEvent',
      'gpsData/setZeroPos',
      'qrDetected/recordQrDetection',
      '',
    ]) {
      expect(isSegmentingActionType(type), type).toBe(false);
    }
  });
});
