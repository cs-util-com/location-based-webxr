// @vitest-environment jsdom
/**
 * Why these tests matter: a browser keeps only a handful of WebGL contexts
 * alive and `dispose()` alone does not give one back, so a check page that
 * builds walk after walk would lose its oldest context (and print warnings)
 * unless every build drops its own context when done, failed builds too.
 */
import type * as Three from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let failSetSize = false;

vi.mock("three", async (importOriginal) => {
  const three = await importOriginal<typeof Three>();
  class FakeRenderer {
    setPixelRatio(): void {}
    setSize(): void {
      if (failSetSize) throw new Error("no WebGL here");
    }
    render(): void {}
    forceContextLoss(): void {
      calls.push("forceContextLoss");
    }
    dispose(): void {
      calls.push("dispose");
    }
  }
  return { ...three, WebGLRenderer: FakeRenderer };
});

const { renderSceneFrames } = await import("./splat-scene-render.js");
const { sceneProjection } = await import("./splat-scene.js");

afterEach(() => {
  calls.length = 0;
  failSetSize = false;
});

describe("renderSceneFrames", () => {
  it("gives its WebGL context back before freeing the renderer", async () => {
    await renderSceneFrames([], 32, 24, sceneProjection(32, 24));
    expect(calls).toEqual(["forceContextLoss", "dispose"]);
  });

  it("gives its WebGL context back when rendering fails", async () => {
    failSetSize = true;
    await expect(
      renderSceneFrames([], 32, 24, sceneProjection(32, 24)),
    ).rejects.toThrow("no WebGL here");
    expect(calls).toEqual(["forceContextLoss", "dispose"]);
  });
});
