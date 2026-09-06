/**
 * Why this property matters: the HUD's entrance clock is fed by whatever
 * `dt` the host passes — a WebXR frame, a clamped background-tab resume, a
 * simulator's fixed step — and under the redraw cap it draws only SOME of
 * the frames. Whatever the sequence, the outline it has drawn must never go
 * backwards between two redraws of one entrance: a dash offset that rose
 * would visibly erase drawn outline. The recorded dash offset is the seam's
 * `outline` made concrete, so the property is asserted on it.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { createWayfindingHud } from './wayfinding-hud.js';
import { clearFrameUpdates } from '../ar/frame-loop.js';
import { clearSessionDisposers } from '../ar/session-disposers.js';

function makeRecordingContext() {
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    lineDashOffset: 0,
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
}
type RecordingContext = ReturnType<typeof makeRecordingContext>;

/** Per-canvas recorders in creation order: texture canvas, scratch canvas, label. */
function injectContexts(): RecordingContext[] {
  const contexts: RecordingContext[] = [];
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (tagName: string): HTMLElement => {
      const el = original(tagName);
      if (tagName === 'canvas') {
        const ctx = makeRecordingContext();
        contexts.push(ctx);
        (el as HTMLCanvasElement).getContext = vi.fn(
          () => ctx
        ) as unknown as HTMLCanvasElement['getContext'];
      }
      return el;
    }
  );
  return contexts;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearFrameUpdates();
  clearSessionDisposers();
});

describe('circleEntrance (properties)', () => {
  it('the drawn outline never goes backwards over any sequence of frame deltas', () => {
    // Frame deltas from 1 ms to the simulator's 100 ms clamp, any length.
    const deltas = fc.array(fc.double({ min: 0.001, max: 0.1, noNaN: true }), {
      minLength: 1,
      maxLength: 120,
    });
    fc.assert(
      fc.property(deltas, (dts) => {
        const contexts = injectContexts();
        const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
        camera.lookAt(0, 0, -1);
        camera.updateMatrixWorld(true);
        const targets = [{ id: 'a', position: new THREE.Vector3(0, 0, -5) }];
        const hud = createWayfindingHud({
          camera,
          getTargets: () => targets,
          distanceMin: 1.5,
          distanceMax: 3.0,
          autoRegisterFrameUpdate: false,
          circleEntrance: { ink: '#fff', accent: '#f2971f' },
        });
        try {
          const offsets: number[] = [];
          let previousDraws = 0;
          for (const dt of dts) {
            hud.update(dt);
            // Canvases per target (created on the first update): texture
            // canvas, scratch canvas, label. A REDRAW is the one `drawImage`
            // of the composite on the TEXTURE canvas (the scratch canvas
            // never receives one — a first draft gated on it and asserted
            // nothing, milestone review 2026-09-06); the dash offset it
            // composited sits on the scratch recorder.
            const texture = contexts[0] as RecordingContext;
            const scratch = contexts[1] as RecordingContext;
            const draws = texture.drawImage.mock.calls.length;
            if (draws !== previousDraws) {
              offsets.push(scratch.lineDashOffset);
              previousDraws = draws;
            }
          }
          // The t = 0 frame is always drawn, so a property that sampled
          // nothing is a broken harness, not a passing one.
          expect(offsets.length).toBeGreaterThanOrEqual(1);
          const rises = offsets.filter(
            (offset, i) => i > 0 && offset > (offsets[i - 1] as number) + 1e-9
          );
          expect(rises).toEqual([]);
        } finally {
          hud.dispose();
          vi.restoreAllMocks();
          clearSessionDisposers();
        }
      }),
      { numRuns: 40 }
    );
  });
});
