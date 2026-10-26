/**
 * Why these tests matter: the film shares the phone's GPU with AR. When
 * an AR session starts the film releases its renderer on purpose, and
 * the browser reports that as a lost context; read as a real loss, every
 * AR session would leave the creator with the flat drawing for good. A
 * REAL loss (or no WebGL at all, or a renderer that fails to start) must
 * fall back to the drawing once and say why, and nothing must ever try to
 * build a scene again after it.
 */
import { describe, expect, it } from "vitest";

import { createGpuLifecycle } from "./film-gpu.js";

describe("film GPU lifecycle", () => {
  it("draws flat from the start without WebGL, and says so once", () => {
    const g = createGpuLifecycle({ webgl: false });
    expect(g.kind()).toBe("floor");
    expect(g.initialFallback).toBe("no-webgl");
    expect(g.wantsScene()).toBe(false);
  });

  it("wants a scene with WebGL, until one is live", () => {
    const g = createGpuLifecycle({ webgl: true });
    expect(g.initialFallback).toBeNull();
    expect(g.wantsScene()).toBe(true);
    g.created();
    expect(g.wantsScene()).toBe(false);
    expect(g.kind()).toBe("3d");
  });

  it("treats a deliberate release as no loss, and builds the scene again afterwards", () => {
    const g = createGpuLifecycle({ webgl: true });
    const first = g.created();
    g.released();
    expect(g.contextLost(first)).toBeNull();
    expect(g.kind()).toBe("3d");
    expect(g.wantsScene()).toBe(true);
    const second = g.created();
    expect(second).not.toBe(first);
    // a late event of the released scene never touches the new one
    expect(g.contextLost(first)).toBeNull();
    expect(g.wantsScene()).toBe(false);
  });

  it("falls back to the drawing on a real loss, reports it once, and never builds again", () => {
    const g = createGpuLifecycle({ webgl: true });
    const live = g.created();
    expect(g.contextLost(live)).toBe("context-lost");
    expect(g.kind()).toBe("floor");
    expect(g.wantsScene()).toBe(false);
    expect(g.contextLost(live)).toBeNull();
  });

  it("falls back when the renderer fails to start", () => {
    const g = createGpuLifecycle({ webgl: true });
    expect(g.createFailed()).toBe("no-webgl");
    expect(g.kind()).toBe("floor");
    expect(g.wantsScene()).toBe(false);
    expect(g.createFailed()).toBeNull();
  });

  it("ignores a release while no scene is live", () => {
    const g = createGpuLifecycle({ webgl: true });
    g.released();
    expect(g.wantsScene()).toBe(true);
    const f = createGpuLifecycle({ webgl: false });
    f.released();
    expect(f.kind()).toBe("floor");
  });
});
