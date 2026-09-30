// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest';
import { createMeasurementUI } from './measurement-ui';
import {
  addMeasurementRay,
  confirmMeasurementSuccess,
  measurementPointsReducer,
} from '../state/measurement-points-slice';
import type { MeasurementPointHandlers } from '../measurement-points/measurement-point-handlers';
import type { CombinedRootState, RecorderStore } from '../state/recorder-store';

function makeStore() {
  let state = {
    measurementPoints: measurementPointsReducer(undefined, { type: '@@INIT' }),
  } as unknown as CombinedRootState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    dispatch: vi.fn(),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMeasurementState(next: CombinedRootState['measurementPoints']) {
      state = { ...state, measurementPoints: next };
      for (const listener of listeners) listener();
    },
  } as unknown as RecorderStore & {
    setMeasurementState: (next: CombinedRootState['measurementPoints']) => void;
  };
}

function makeHandlers(): MeasurementPointHandlers {
  return {
    handleShootRay: vi.fn(),
    handleConfirmPoint: vi.fn(async () => {}),
    handleDeletePoint: vi.fn(async () => {}),
    handleUndoRay: vi.fn(),
    getProvisionalResult: vi.fn(() => null),
    reset: vi.fn(),
  };
}

describe('measurement UI aiming modes', () => {
  test('shows aiming controls before the first ray', () => {
    document.body.innerHTML = '<div id="root"></div><div id="ar"></div>';
    const container = document.getElementById('root')!;
    const ui = createMeasurementUI({
      container,
      arCanvas: document.getElementById('ar')!,
      handlers: makeHandlers(),
      store: makeStore(),
      getScenarioId: () => 'scenario',
    });
    ui.show();

    expect(
      (container.querySelector('#measurement-panel') as HTMLElement).style
        .display
    ).toBe('flex');
    expect(container.querySelector('#measurement-aim-mode-btn')).not.toBeNull();
    ui.dispose();
  });

  test('shows the error threshold and stays visible after a confirmed point', () => {
    document.body.innerHTML = '<div id="root"></div><div id="ar"></div>';
    const container = document.getElementById('root')!;
    const store = makeStore();
    const ui = createMeasurementUI({
      container,
      arCanvas: document.getElementById('ar')!,
      handlers: makeHandlers(),
      store,
      getScenarioId: () => 'scenario',
    });
    ui.show();
    const base = measurementPointsReducer(undefined, { type: '@@INIT' });
    const confirmed = measurementPointsReducer(
      base,
      confirmMeasurementSuccess({
        schemaVersion: 1,
        id: 'confirmed',
        createdAt: 1,
        updatedAt: 1,
        scenarioId: 'scenario',
        observations: [],
        arPosition: [0, 0, 0],
        gpsPositionSnapshot: null,
        uncertainty: 0.01,
        rmsError: 0.01,
        inlierIds: [],
        outlierIds: [],
      })
    );
    store.setMeasurementState(confirmed);
    expect(
      (container.querySelector('#measurement-panel') as HTMLElement).style
        .display
    ).toBe('flex');

    const next = measurementPointsReducer(
      confirmed,
      addMeasurementRay({
        id: 'new-ray',
        timestamp: 1000,
        arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        rayOrigin: [0, 0, 0],
        rayDirection: [0, 0, -1],
        rayWeight: 1,
        depthPoint: [0, 0, -1],
        depthWeight: 1,
      })
    );
    store.setMeasurementState(next);
    const button = container.querySelector(
      '#measurement-confirm-btn'
    ) as HTMLButtonElement;
    expect(button.textContent).toContain('threshold');
    expect(button.textContent).toContain('20.0 cm');
    ui.dispose();
  });

  test('crosshair shoots center and tap mode forwards normalized coordinates', () => {
    document.body.innerHTML = '<div id="root"></div><div id="ar"></div>';
    const container = document.getElementById('root')!;
    const arCanvas = document.getElementById('ar')!;
    vi.spyOn(arCanvas, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 200,
      height: 100,
      right: 210,
      bottom: 120,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    const handlers = makeHandlers();
    const store = makeStore();
    const ui = createMeasurementUI({
      container,
      arCanvas,
      handlers,
      store,
      getScenarioId: () => 'scenario',
    });

    arCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 100, clientY: 70 })
    );
    expect(handlers.handleShootRay).toHaveBeenLastCalledWith(0.5, 0.5);

    const modeButton = container.querySelector(
      '#measurement-aim-mode-btn'
    ) as HTMLButtonElement;
    modeButton.click();
    arCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 110, clientY: 45 })
    );
    expect(handlers.handleShootRay).toHaveBeenLastCalledWith(0.5, 0.25);

    ui.dispose();
  });
});
