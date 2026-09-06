/**
 * The wayfinding HUD's `circleEntrance` option: the diamond builds itself up
 * when a target appears or comes back through the distance gate.
 *
 * Why these tests matter: the entrance is the first thing in the HUD that
 * is a CLOCK rather than a placement, and a clock has failure modes a
 * placement does not — restarting on the wrong transition (every head
 * turn), redrawing every frame on a device with an 11 ms budget, keeping
 * uploading after it settled, or leaking a texture per target. Each of
 * those is pinned here through the seams the HUD exposes: the per-canvas
 * drawing calls (jsdom has no canvas backend, so a recording context stands
 * in), `entranceStats()` and the handle's lifecycle. DEC-E3 of the plan
 * (replay ONLY on `hidden → circle`) is the one a reviewer would otherwise
 * have to take on faith.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_CIRCLE_ENTRANCE,
  createWayfindingHud,
  validateWayfindingHudOptions,
  type WayfindingHudOptions,
  type WayfindingTarget,
} from './wayfinding-hud.js';
import { DIAMOND_ENTRANCE } from './diamond-entrance.js';
import { clearFrameUpdates } from '../ar/frame-loop.js';
import { clearSessionDisposers } from '../ar/session-disposers.js';

/** A recording 2D context: the dash offset is the one number the HUD's clock becomes. */
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

/**
 * Every canvas the HUD creates gets its own recorder, in creation order.
 * Per target the order is: the marker's texture canvas, its scratch canvas,
 * then the label (text sprite) — so the scratch recorder, where the dash
 * offset lands, is the SECOND of each triple.
 */
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

const scratchOf = (contexts: RecordingContext[], target: number) =>
  contexts[target * 3 + 1] as RecordingContext;
/** The texture canvas: the ONE `drawImage` per redraw (the composite) lands here. */
const textureOf = (contexts: RecordingContext[], target: number) =>
  contexts[target * 3] as RecordingContext;

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  return camera;
}

const entrance = { ink: '#fff', accent: '#f2971f' };

function makeHud(
  targets: WayfindingTarget[],
  overrides: Partial<WayfindingHudOptions> = {}
) {
  const camera = makeCamera();
  const hud = createWayfindingHud({
    camera,
    getTargets: () => targets,
    distanceMin: 1.5,
    distanceMax: 3.0,
    autoRegisterFrameUpdate: false,
    circleEntrance: entrance,
    ...overrides,
  });
  return { hud, camera };
}

/** A visible, on-screen, far target — the circle case. */
const onScreenFar = (): WayfindingTarget => ({
  id: 'a',
  position: new THREE.Vector3(0, 0, -5),
});

afterEach(() => {
  vi.restoreAllMocks();
  clearFrameUpdates();
  clearSessionDisposers();
});

describe('circleEntrance — validation', () => {
  const base = {
    camera: makeCamera(),
    getTargets: () => [],
    distanceMin: 1,
    distanceMax: 2,
  };

  it('accepts the documented shape and exposes the defaults', () => {
    expect(() =>
      validateWayfindingHudOptions({
        ...base,
        circleEntrance: {
          ...entrance,
          halo: 'rgba(0,0,0,0.8)',
          redrawHz: 30,
          staggerMs: 60,
          reducedMotion: false,
        },
      })
    ).not.toThrow();
    expect(DEFAULT_CIRCLE_ENTRANCE).toEqual({ redrawHz: 30, staggerMs: 60 });
  });

  it('rejects an empty colour, a non-positive cap or stagger, and a non-boolean reducedMotion', () => {
    expect(() =>
      validateWayfindingHudOptions({
        ...base,
        circleEntrance: { ink: '', accent: '#f2971f' },
      })
    ).toThrow(TypeError);
    expect(() =>
      validateWayfindingHudOptions({
        ...base,
        circleEntrance: { ...entrance, halo: '' },
      })
    ).toThrow(TypeError);
    expect(() =>
      validateWayfindingHudOptions({
        ...base,
        circleEntrance: { ...entrance, redrawHz: 0 },
      })
    ).toThrow(RangeError);
    expect(() =>
      validateWayfindingHudOptions({
        ...base,
        circleEntrance: { ...entrance, staggerMs: -1 },
      })
    ).toThrow(RangeError);
    expect(() =>
      validateWayfindingHudOptions({
        ...base,
        circleEntrance: {
          ...entrance,
          reducedMotion: 'yes' as unknown as boolean,
        },
      })
    ).toThrow(TypeError);
  });

  it('is mutually exclusive with circleSprite', () => {
    expect(() =>
      validateWayfindingHudOptions({
        ...base,
        circleEntrance: entrance,
        circleSprite: 'wayfinding-diamond.svg',
      })
    ).toThrow(/mutually exclusive/);
  });
});

describe('circleEntrance — the entrance runs on appearance and on hidden → circle only', () => {
  it('draws the empty marker on the first visible frame and the dash offset falls as time passes', () => {
    const contexts = injectContexts();
    const { hud } = makeHud([onScreenFar()]);
    hud.update(1 / 90);
    const scratch = scratchOf(contexts, 0);
    // The first frame draws t = 0: the whole dash undrawn.
    expect(scratch.lineDashOffset).toBe(DIAMOND_ENTRANCE.dashLength);
    for (let i = 0; i < 30; i += 1) hud.update(1 / 90);
    expect(scratch.lineDashOffset).toBeLessThan(DIAMOND_ENTRANCE.dashLength);
    expect(scratch.lineDashOffset).toBeGreaterThan(0);
    hud.dispose();
  });

  it('settles: after 850 ms the offset is 0, the dot is drawn, and no further redraw happens', () => {
    const contexts = injectContexts();
    const { hud } = makeHud([onScreenFar()]);
    for (let i = 0; i < 90; i += 1) hud.update(1 / 90); // 1 s
    const scratch = scratchOf(contexts, 0);
    expect(scratch.lineDashOffset).toBe(0);
    expect(scratch.arc).toHaveBeenCalled();
    expect(hud.entranceStats().animating).toBe(0);
    // The composite is the one drawImage per redraw, on the TEXTURE canvas.
    const texture = textureOf(contexts, 0);
    const drawsAtSettle = texture.drawImage.mock.calls.length;
    expect(drawsAtSettle).toBeGreaterThan(1);
    for (let i = 0; i < 30; i += 1) hud.update(1 / 90);
    expect(hud.entranceStats().redraws).toBe(0);
    expect(texture.drawImage.mock.calls.length).toBe(drawsAtSettle);
    hud.dispose();
  });

  it('a target whose FIRST placement is an edge arrow gets its entrance when it first becomes a circle', () => {
    // Why (milestone review, 2026-09-06): the start condition was
    // `previous === null || previous === 'hidden'`, and `null` is only the
    // very first frame. A target spawned in range but off-screen reaches its
    // first circle with `previous === 'arrow'`; without the `started` flag
    // its marker was never drawn at all — a transparent canvas for life.
    const contexts = injectContexts();
    // Off to the side and behind the camera's gaze: in range, off-screen.
    const target: WayfindingTarget = {
      id: 'side',
      position: new THREE.Vector3(6, 0, 0),
    };
    const { hud, camera } = makeHud([target]);
    hud.update(1 / 90); // first frame: an edge arrow, no entrance yet
    expect(hud.entranceStats().animating).toBe(0);
    expect(textureOf(contexts, 0).drawImage).not.toHaveBeenCalled();
    // Turn to face it: arrow → circle, the target's first circle ever.
    camera.lookAt(6, 0, 0);
    camera.updateMatrixWorld(true);
    hud.update(1 / 90);
    expect(hud.entranceStats().animating).toBe(1);
    expect(scratchOf(contexts, 0).lineDashOffset).toBe(
      DIAMOND_ENTRANCE.dashLength
    );
    hud.dispose();
  });

  it('a non-finite dt does not throw inside the frame loop; the entrance waits for a real frame', () => {
    // The pure seam rejects a non-finite time with a RangeError; the HUD's
    // documented boundary is "never a per-frame throw", so it skips the
    // advance instead (milestone review, 2026-09-06).
    const contexts = injectContexts();
    const { hud } = makeHud([onScreenFar()]);
    hud.update(1 / 90);
    expect(() => hud.update(Number.NaN)).not.toThrow();
    expect(() => hud.update(Number.POSITIVE_INFINITY)).not.toThrow();
    // A NEGATIVE dt neither throws nor rewinds: a clock stepping back would
    // otherwise keep an entrance animating forever (PR #422 CodeRabbit).
    expect(() => hud.update(-1)).not.toThrow();
    expect(scratchOf(contexts, 0).lineDashOffset).toBe(
      DIAMOND_ENTRANCE.dashLength
    );
    hud.update(1 / 90);
    hud.update(1 / 90);
    hud.update(1 / 90);
    expect(scratchOf(contexts, 0).lineDashOffset).toBeLessThan(
      DIAMOND_ENTRANCE.dashLength
    );
    hud.dispose();
  });

  it('does NOT restart when the target goes off-screen (arrow) and comes back (circle)', () => {
    const contexts = injectContexts();
    const target = onScreenFar();
    const { hud, camera } = makeHud([target]);
    for (let i = 0; i < 90; i += 1) hud.update(1 / 90); // settled
    // Look away: the target leaves the frustum → arrow.
    camera.lookAt(10, 0, 0);
    camera.updateMatrixWorld(true);
    hud.update(1 / 90);
    // Look back → circle again, with `previous === 'arrow'`.
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);
    hud.update(1 / 90);
    hud.update(1 / 90);
    const scratch = scratchOf(contexts, 0);
    expect(scratch.lineDashOffset).toBe(0); // still the complete marker
    expect(hud.entranceStats().animating).toBe(0);
    hud.dispose();
  });

  it('DOES restart when the target comes back through the distance gate (hidden → circle)', () => {
    const contexts = injectContexts();
    const target = onScreenFar();
    const { hud, camera } = makeHud([target]);
    for (let i = 0; i < 90; i += 1) hud.update(1 / 90); // settled
    // Walk into the target: below distanceMin → hidden ("arrived").
    camera.position.set(0, 0, -4.5);
    camera.updateMatrixWorld(true);
    hud.update(1 / 90);
    // Walk away past distanceMax → reactivates as a circle.
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld(true);
    hud.update(1 / 90);
    const scratch = scratchOf(contexts, 0);
    expect(scratch.lineDashOffset).toBe(DIAMOND_ENTRANCE.dashLength);
    expect(hud.entranceStats().animating).toBe(1);
    hud.dispose();
  });
});

describe('circleEntrance — cost bounds', () => {
  it('the redraw cap: 850 ms at 30 Hz is ~26 redraws when ticked at 90 Hz, not one per frame', () => {
    injectContexts();
    const { hud } = makeHud([onScreenFar()]);
    let redraws = 0;
    for (let i = 0; i < 90; i += 1) {
      hud.update(1 / 90);
      redraws += hud.entranceStats().redraws;
    }
    expect(redraws).toBeGreaterThanOrEqual(25);
    expect(redraws).toBeLessThanOrEqual(29);
    hud.dispose();
  });

  it('a higher cap redraws more often, up to once per frame', () => {
    injectContexts();
    const { hud } = makeHud([onScreenFar()], {
      circleEntrance: { ...entrance, redrawHz: 1000 },
    });
    let redraws = 0;
    for (let i = 0; i < 90; i += 1) {
      hud.update(1 / 90);
      redraws += hud.entranceStats().redraws;
    }
    // t = 0 plus one per frame until settled at frame 77.
    expect(redraws).toBeGreaterThanOrEqual(76);
    expect(redraws).toBeLessThanOrEqual(78);
    hud.dispose();
  });

  it('three targets spawning in one frame are staggered 0 / 60 / 120 ms apart', () => {
    const contexts = injectContexts();
    const targets: WayfindingTarget[] = [
      { id: 'a', position: new THREE.Vector3(-0.5, 0, -5) },
      { id: 'b', position: new THREE.Vector3(0, 0, -5) },
      { id: 'c', position: new THREE.Vector3(0.5, 0, -5) },
    ];
    const { hud } = makeHud(targets);
    // Advance to 100 ms: the first is well under way, the second just
    // started (40 ms in), the third has not started yet.
    for (let i = 0; i < 9; i += 1) hud.update(1 / 90);
    const [a, b, c] = [0, 1, 2].map(
      (i) => scratchOf(contexts, i).lineDashOffset
    ) as [number, number, number];
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBe(DIAMOND_ENTRANCE.dashLength);
    hud.dispose();
  });

  it('accumulates the costliest entrance: entranceMs sums its redraws, peakDrawMs is the largest, both reset on a restart', () => {
    // Why (owner decision, 2026-09-06): a single frame's draw sits under the
    // browser clock's 100 µs floor on a desktop and reads 0.00; the sum of
    // an entrance's ~27 redraws and its peak frame are the numbers the
    // headset reading needs. jsdom has no `performance.now()` resolution to
    // rely on, so the marker's draw time is stubbed through the recorder:
    // every `drawImage` costs a fixed 0.5 ms by advancing a fake clock.
    let fakeNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => fakeNow);
    const contexts = injectContexts();
    const { hud, camera } = makeHud([onScreenFar()]);
    // Each composite advances the fake clock by 0.5 ms while it "draws".
    const textureCanvas = () => textureOf(contexts, 0);
    hud.update(1 / 90);
    textureCanvas().drawImage.mockImplementation(() => {
      fakeNow += 0.5;
    });
    for (let i = 0; i < 90; i += 1) hud.update(1 / 90);
    const settled = hud.entranceStats();
    expect(settled.animating).toBe(0);
    // The t = 0 draw happened before the stub (0 ms); every later redraw
    // cost 0.5 ms: ~26 of them.
    expect(settled.entranceMs).toBeGreaterThanOrEqual(12);
    expect(settled.entranceMs).toBeLessThanOrEqual(14.5);
    expect(settled.peakDrawMs).toBeCloseTo(0.5, 6);
    // Holds its value once settled …
    hud.update(1 / 90);
    expect(hud.entranceStats().entranceMs).toBe(settled.entranceMs);
    // … and resets when the entrance restarts through the distance gate.
    camera.position.set(0, 0, -4.5);
    camera.updateMatrixWorld(true);
    hud.update(1 / 90);
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld(true);
    hud.update(1 / 90);
    expect(hud.entranceStats().animating).toBe(1);
    expect(hud.entranceStats().entranceMs).toBeLessThan(1);
    hud.dispose();
  });

  it('entranceStats reports the last update: redraws, their wall-clock cost, and how many are animating', () => {
    injectContexts();
    const { hud } = makeHud([onScreenFar()]);
    hud.update(1 / 90);
    const first = hud.entranceStats();
    expect(first.redraws).toBe(1);
    expect(first.animating).toBe(1);
    expect(first.drawMs).toBeGreaterThanOrEqual(0);
    hud.dispose();
    expect(hud.entranceStats()).toEqual({
      redraws: 0,
      drawMs: 0,
      animating: 0,
      entranceMs: 0,
      peakDrawMs: 0,
    });
  });
});

describe('circleEntrance — reduced motion and lifecycle', () => {
  it('reducedMotion: true shows the complete marker on the first frame and never animates', () => {
    const contexts = injectContexts();
    const { hud } = makeHud([onScreenFar()], {
      circleEntrance: { ...entrance, reducedMotion: true },
    });
    hud.update(1 / 90);
    const scratch = scratchOf(contexts, 0);
    expect(scratch.lineDashOffset).toBe(0);
    expect(scratch.arc).toHaveBeenCalled();
    expect(hud.entranceStats().animating).toBe(0);
    hud.dispose();
  });

  it('the circle indicator is a sprite carrying the marker texture, and per-target teardown disposes it', () => {
    injectContexts();
    const targets = [onScreenFar()];
    const { hud, camera } = makeHud(targets);
    hud.update(1 / 90);
    const circle = camera.children.find(
      (c) => c.name === 'wayfinding-circle'
    ) as THREE.Sprite;
    expect(circle.isSprite).toBe(true);
    const texture = circle.material.map as THREE.CanvasTexture;
    expect(texture.isCanvasTexture).toBe(true);
    const disposeSpy = vi.spyOn(texture, 'dispose');
    targets.length = 0; // the key vanishes → per-target teardown
    hud.update(1 / 90);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    hud.dispose();
  });

  it('without the option nothing changes: the circle is the procedural ring and entranceStats stays zero', () => {
    const { hud, camera } = makeHud([onScreenFar()], {
      circleEntrance: undefined,
    });
    hud.update(1 / 90);
    const circle = camera.children.find(
      (c) => c.name === 'wayfinding-circle'
    ) as THREE.Mesh;
    expect(circle.isMesh).toBe(true);
    expect(hud.entranceStats()).toEqual({
      redraws: 0,
      drawMs: 0,
      animating: 0,
      entranceMs: 0,
      peakDrawMs: 0,
    });
    hud.dispose();
  });
});
