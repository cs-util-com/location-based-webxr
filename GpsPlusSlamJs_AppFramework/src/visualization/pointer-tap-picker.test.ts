import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  type Intersection,
  type Object3D,
} from 'three';

import { createPointerTapPicker } from './pointer-tap-picker.js';

/**
 * Headless tests for the stateful half of tap picking. The pure `isTap`
 * predicate is tested in tap-gate.test.ts; everything that can actually go
 * wrong lives here — the single-pointer bookkeeping (a second finger or a
 * cancel must kill the gesture so a finger lifting mid-pinch never fires a
 * phantom tap), the client→NDC mapping against the element's rect, and the
 * nearest-hit selection. Real Raycaster + real meshes; only the DOM element and
 * `performance.now` are faked.
 */

/** Minimal stand-in for the renderer's canvas: records listeners, lets a test
 *  fire synthetic pointer events, and reports a fixed 100×100 rect at (0,0). */
function fakeElement() {
  const listeners = new Map<string, (event: PointerEvent) => void>();
  const element = {
    addEventListener: (type: string, fn: (event: PointerEvent) => void) => {
      listeners.set(type, fn);
    },
    removeEventListener: (type: string, fn: (event: PointerEvent) => void) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  } as unknown as HTMLElement;
  const fire = (
    type: 'pointerdown' | 'pointerup' | 'pointercancel',
    event: { pointerId: number; clientX: number; clientY: number }
  ): void => {
    listeners.get(type)?.(event as PointerEvent);
  };
  return { element, fire, listeners };
}

/** Camera on +Z looking at the origin; a centre click (50,50 → NDC 0,0) rays
 *  straight down −Z through any plane on the axis. */
function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld();
  return camera;
}

function planeAt(z: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial());
  mesh.position.set(0, 0, z);
  mesh.updateMatrixWorld();
  return mesh;
}

function makePicker(targets: readonly Object3D[]) {
  const dom = fakeElement();
  const onTap = vi.fn<(hit: Intersection<Object3D>) => void>();
  const picker = createPointerTapPicker({
    domElement: dom.element,
    camera: makeCamera(),
    getPickTargets: () => targets,
    onTap,
  });
  return { ...dom, onTap, picker };
}

const centre = { pointerId: 1, clientX: 50, clientY: 50 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPointerTapPicker — tap → raycast', () => {
  it('fires onTap with the hit for a clean tap on a mesh', () => {
    const mesh = planeAt(0);
    const { fire, onTap } = makePicker([mesh]);

    fire('pointerdown', centre);
    fire('pointerup', centre);

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap.mock.calls[0]![0].object).toBe(mesh);
  });

  it('reports the nearest hit when the ray crosses several meshes', () => {
    const far = planeAt(0);
    const near = planeAt(2); // closer to the camera at z=5
    const { fire, onTap } = makePicker([far, near]);

    fire('pointerdown', centre);
    fire('pointerup', centre);

    expect(onTap.mock.calls[0]![0].object).toBe(near);
  });

  it('stays silent when the tap hits nothing', () => {
    const { fire, onTap } = makePicker([planeAt(0)]);
    const corner = { pointerId: 1, clientX: 2, clientY: 2 }; // off the plane

    fire('pointerdown', corner);
    fire('pointerup', corner);

    expect(onTap).not.toHaveBeenCalled();
  });
});

describe('createPointerTapPicker — tap-vs-drag gate', () => {
  it('suppresses a drag (moved beyond the tolerance)', () => {
    const { fire, onTap } = makePicker([planeAt(0)]);

    fire('pointerdown', centre);
    fire('pointerup', { pointerId: 1, clientX: 70, clientY: 50 });

    expect(onTap).not.toHaveBeenCalled();
  });

  it('suppresses a long press (released after the tap window)', () => {
    let nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const { fire, onTap } = makePicker([planeAt(0)]);

    fire('pointerdown', centre);
    nowMs = 500; // > 400 ms
    fire('pointerup', centre);

    expect(onTap).not.toHaveBeenCalled();
  });
});

describe('createPointerTapPicker — multi-touch bookkeeping', () => {
  it('a second finger invalidates the gesture: lifting either finger fires nothing', () => {
    const { fire, onTap } = makePicker([planeAt(0)]);

    fire('pointerdown', centre); // finger 1
    fire('pointerdown', { pointerId: 2, clientX: 50, clientY: 50 }); // pinch
    fire('pointerup', centre); // finger 1 lifts mid-pinch
    fire('pointerup', { pointerId: 2, clientX: 50, clientY: 50 });

    expect(onTap).not.toHaveBeenCalled();
  });

  it("does not re-base the gesture on the second finger's down-coordinates", () => {
    const { fire, onTap } = makePicker([planeAt(0)]);

    fire('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
    fire('pointerdown', { pointerId: 2, clientX: 50, clientY: 50 });
    // If finger 2 had been adopted as pending, this up would look like a tap.
    fire('pointerup', { pointerId: 2, clientX: 50, clientY: 50 });

    expect(onTap).not.toHaveBeenCalled();
  });

  it('ignores an up for a pointer it is not tracking', () => {
    const { fire, onTap } = makePicker([planeAt(0)]);

    fire('pointerdown', centre);
    fire('pointerup', { pointerId: 99, clientX: 50, clientY: 50 });

    expect(onTap).not.toHaveBeenCalled();
    // The tracked finger can still complete its tap afterwards.
    fire('pointerup', centre);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('pointercancel kills the pending gesture', () => {
    const { fire, onTap } = makePicker([planeAt(0)]);

    fire('pointerdown', centre);
    fire('pointercancel', centre);
    fire('pointerup', centre);

    expect(onTap).not.toHaveBeenCalled();
  });

  it('recovers after an invalidated gesture: the next tap fires normally', () => {
    const { fire, onTap } = makePicker([planeAt(0)]);

    fire('pointerdown', centre);
    fire('pointerdown', { pointerId: 2, clientX: 50, clientY: 50 });
    fire('pointerup', centre);

    fire('pointerdown', centre);
    fire('pointerup', centre);
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});

describe('createPointerTapPicker — NDC mapping', () => {
  it('maps a client position through the element rect to the right mesh', () => {
    // Two planes side by side; a click in the left half must hit the left one.
    const left = planeAt(0);
    left.position.set(-1.5, 0, 0);
    left.updateMatrixWorld();
    const right = planeAt(0);
    right.position.set(1.5, 0, 0);
    right.updateMatrixWorld();
    const { fire, onTap } = makePicker([left, right]);
    const leftClick = { pointerId: 1, clientX: 30, clientY: 50 };

    fire('pointerdown', leftClick);
    fire('pointerup', leftClick);

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap.mock.calls[0]![0].object).toBe(left);
  });
});

describe('createPointerTapPicker — dispose', () => {
  it('removes all three listeners', () => {
    const { listeners, picker } = makePicker([planeAt(0)]);
    expect(listeners.size).toBe(3);

    picker.dispose();

    expect(listeners.size).toBe(0);
  });
});
