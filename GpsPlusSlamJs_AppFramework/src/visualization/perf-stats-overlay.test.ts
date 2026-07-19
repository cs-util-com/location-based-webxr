/**
 * Tests for the shared Stats.js performance overlay (`createPerfStatsOverlay`).
 *
 * Why these tests matter: the overlay is a measurement instrument — if it
 * mounts wrong (missing panels, swallowed pointers, leaked DOM nodes across AR
 * sessions, or an update() that throws into the render loop) it silently
 * corrupts the framerate reading it exists to show. Both the Stats constructor
 * AND the container factory are injected so the suite runs in the framework's
 * default node environment with no jsdom (the real Stats builds a `<canvas>` 2D
 * context and the container needs `document`).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createPerfStatsOverlay,
  type PerfStatsInstance,
} from './perf-stats-overlay';

function makeFakeStats(): PerfStatsInstance & {
  shown: number[];
  update: ReturnType<typeof vi.fn<() => void>>;
} {
  const dom = { style: { position: '' } };
  const shown: number[] = [];
  return {
    dom: dom as unknown as HTMLElement,
    shown,
    showPanel: (id: number) => {
      shown.push(id);
    },
    update: vi.fn<() => void>(),
  };
}

function makeFakeContainer(): HTMLElement & {
  appended: unknown[];
  remove: ReturnType<typeof vi.fn<() => void>>;
} {
  const appended: unknown[] = [];
  return {
    className: '',
    style: { cssText: '', position: '' },
    appendChild: (child: unknown) => {
      appended.push(child);
      return child;
    },
    remove: vi.fn<() => void>(),
    appended,
  } as unknown as HTMLElement & {
    appended: unknown[];
    remove: ReturnType<typeof vi.fn<() => void>>;
  };
}

function setup(memorySupported: boolean) {
  const instances: ReturnType<typeof makeFakeStats>[] = [];
  const container = makeFakeContainer();
  const appendChild = vi.fn((child: unknown) => child);
  const parent = { appendChild } as unknown as HTMLElement;
  const handle = createPerfStatsOverlay(parent, {
    memorySupported,
    statsFactory: () => {
      const fake = makeFakeStats();
      instances.push(fake);
      return fake;
    },
    createContainer: () => container,
  });
  return { handle, instances, container, parent, appendChild };
}

describe('createPerfStatsOverlay', () => {
  it('mounts FPS + MS + MB panels side-by-side when memory stats are supported', () => {
    const { handle, instances, container, appendChild } = setup(true);
    expect(handle.panelCount).toBe(3);
    // One Stats instance per metric, each pinned to its panel id (0=FPS, 1=MS,
    // 2=MB) — the always-visible layout (Stats.js otherwise cycles on tap).
    expect(instances.map((s) => s.shown)).toEqual([[0], [1], [2]]);
    // Each panel is re-anchored `relative` so the flex row lays them in a line.
    for (const s of instances) {
      expect(s.dom.style.position).toBe('relative');
    }
    // The container carries the class + is read-only (never swallows pointers).
    expect(container.className).toBe('perf-stats-overlay');
    expect(container.style.cssText).toContain('pointer-events:none');
    // The container is mounted into the parent.
    expect(appendChild).toHaveBeenCalledWith(container);
  });

  it('omits the MB panel when performance.memory is unavailable', () => {
    const { handle, instances } = setup(false);
    expect(handle.panelCount).toBe(2);
    expect(instances.map((s) => s.shown)).toEqual([[0], [1]]);
  });

  it('forwards update() to every panel instance', () => {
    const { handle, instances } = setup(true);
    handle.update();
    handle.update();
    for (const s of instances) {
      expect(s.update).toHaveBeenCalledTimes(2);
    }
  });

  it('a throwing panel update does not break the other panels or the caller', () => {
    // update() runs inside the render/XR frame loop — a Stats hiccup must never
    // kill the loop (defensive rule: isolate per-panel failures).
    const { handle, instances } = setup(true);
    instances[0]!.update.mockImplementation(() => {
      throw new Error('panel exploded');
    });
    expect(() => handle.update()).not.toThrow();
    expect(instances[1]!.update).toHaveBeenCalledTimes(1);
    expect(instances[2]!.update).toHaveBeenCalledTimes(1);
  });

  it('dispose() removes the DOM node and makes update() a no-op; both are idempotent', () => {
    // A leaked overlay across Enter-AR cycles would stack duplicate panels.
    const { handle, instances, container } = setup(true);
    handle.dispose();
    expect(container.remove).toHaveBeenCalledTimes(1);
    handle.update();
    for (const s of instances) {
      expect(s.update).not.toHaveBeenCalled();
    }
    expect(() => handle.dispose()).not.toThrow();
    expect(container.remove).toHaveBeenCalledTimes(1); // idempotent
  });

  it('rejects a detached/invalid parent', () => {
    expect(() =>
      createPerfStatsOverlay(null as unknown as HTMLElement, {
        statsFactory: () => makeFakeStats(),
        createContainer: () => makeFakeContainer(),
      })
    ).toThrow(TypeError);
  });
});
