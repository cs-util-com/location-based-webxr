/**
 * Tests for the always-on Stats.js performance overlay (`createPerfStats`).
 *
 * Why these tests matter: the demo mounts this panel unconditionally so a
 * developer always sees FPS + memory (user feedback #4). If it mounts wrong
 * (missing panels, swallowed pointers, leaked DOM across AR sessions, or an
 * update() that throws into the render loop) the instrument it exists for is
 * broken. Both the Stats constructor AND the container factory are injected so
 * the suite runs in the demo's node environment with no jsdom (the workspace
 * knip flags jsdom as an unused dependency here).
 */

import { describe, it, expect, vi } from "vitest";
import { createPerfStats, type PerfStatsInstance } from "./perf-stats";

function makeFakeStats(): PerfStatsInstance & {
  shown: number[];
  update: ReturnType<typeof vi.fn<() => void>>;
} {
  const dom = { style: { position: "" } };
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
    className: "",
    style: { cssText: "", position: "" },
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
  const handle = createPerfStats(parent, {
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

describe("createPerfStats", () => {
  it("mounts FPS + MS + MB panels side-by-side when memory stats are supported", () => {
    const { handle, instances, container, appendChild } = setup(true);
    expect(handle.panelCount).toBe(3);
    // One Stats instance per metric, each pinned to its panel id (0=FPS, 1=MS,
    // 2=MB) — the always-visible layout (Stats.js otherwise cycles on tap).
    expect(instances.map((s) => s.shown)).toEqual([[0], [1], [2]]);
    // Each panel is re-anchored `relative` so the flex row lays them in a line.
    for (const s of instances) {
      expect(s.dom.style.position).toBe("relative");
    }
    // The container carries the class + is read-only (never swallows pointers).
    expect(container.className).toBe("perf-stats");
    expect(container.style.cssText).toContain("pointer-events:none");
    // The container is mounted into the parent.
    expect(appendChild).toHaveBeenCalledWith(container);
  });

  it("omits the MB panel when performance.memory is unavailable", () => {
    const { handle, instances } = setup(false);
    expect(handle.panelCount).toBe(2);
    expect(instances.map((s) => s.shown)).toEqual([[0], [1]]);
  });

  it("forwards update() to every panel instance", () => {
    const { handle, instances } = setup(true);
    handle.update();
    handle.update();
    for (const s of instances) {
      expect(s.update).toHaveBeenCalledTimes(2);
    }
  });

  it("a throwing panel update does not break the other panels or the caller", () => {
    // update() runs inside the render/XR frame loop — a Stats hiccup must never
    // kill the loop (defensive rule: isolate per-panel failures).
    const { handle, instances } = setup(true);
    instances[0]!.update.mockImplementation(() => {
      throw new Error("panel exploded");
    });
    expect(() => handle.update()).not.toThrow();
    expect(instances[1]!.update).toHaveBeenCalledTimes(1);
    expect(instances[2]!.update).toHaveBeenCalledTimes(1);
  });

  it("dispose() removes the DOM node and makes update() a no-op; both are idempotent", () => {
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

  it("rejects a detached/invalid parent", () => {
    expect(() =>
      createPerfStats(null as unknown as HTMLElement, {
        statsFactory: () => makeFakeStats(),
        createContainer: () => makeFakeContainer(),
      }),
    ).toThrow(TypeError);
  });
});
