import { describe, expect, test, vi } from 'vitest';
import {
  updateConnectionLinePositions,
  updateMeasurementPointVisual,
  updateGpsDotPosition,
} from './measurement-point-view';
import type { MeasurementPointEntity } from '../storage/measurement-point-loader';

type Dot = {
  position: { set: (x: number, y: number, z: number) => void };
  visible: boolean;
  material: object;
};

function makeDot(): Dot {
  const set = vi.fn<(x: number, y: number, z: number) => void>();
  return {
    position: { set },
    visible: true,
    material: {},
  };
}

function makeEntity(): MeasurementPointEntity {
  return {
    schemaVersion: 1,
    id: 'view-point',
    createdAt: 1,
    updatedAt: 1,
    scenarioId: 'scenario',
    observations: [],
    arPosition: [1, 2, 3],
    gpsPositionSnapshot: null,
    uncertainty: 0.01,
    rmsError: 0.01,
    inlierIds: [],
    outlierIds: [],
  };
}

describe('measurement point view', () => {
  test('updates AR dot, live GPS dot, and connector endpoints', () => {
    const arDot = makeDot();
    const gpsDot = makeDot();
    const setFromPoints = vi.fn();
    const alignment = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1,
    ] as unknown as Parameters<typeof updateGpsDotPosition>[2];

    updateMeasurementPointVisual(
      arDot,
      gpsDot,
      { setFromPoints },
      makeEntity(),
      alignment
    );

    expect(arDot.position.set).toHaveBeenCalledWith(1, 2, 3);
    expect(gpsDot.position.set).toHaveBeenCalledWith(7, 22, 31);
    expect(gpsDot.visible).toBe(true);
    expect(setFromPoints).toHaveBeenCalledWith([
      { x: 1, y: 2, z: 3 },
      { x: 7, y: 22, z: 31 },
    ]);
  });

  test('hides GPS dot and leaves connector unchanged without alignment', () => {
    const gpsDot = makeDot();
    const setFromPoints = vi.fn();

    updateGpsDotPosition(gpsDot, [1, 2, 3], null);
    updateConnectionLinePositions({ setFromPoints }, [1, 2, 3], null);

    expect(gpsDot.visible).toBe(false);
    expect(setFromPoints).not.toHaveBeenCalled();
  });
});
