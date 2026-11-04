/**
 * What the editor's two 3D views share (the OrbitControls view,
 * `editor3d-scene.ts`, and the globe view, `editor3d-globe.ts`): the
 * failure the view switch reads the reason of, the renderer made or
 * refused, and what it drew (the credits are `editor3d-credits.ts`).
 *
 * @see editor3d-view-parts.ts.md
 */
import * as THREE from "three";

/** What `renderer` drew in its last frame: its draw calls and triangles
 *  (the one place both views read them, for the Performance tab). */
export function drawnCounts(renderer: THREE.WebGLRenderer): {
  readonly drawCalls: number;
  readonly triangles: number;
} {
  const { calls, triangles } = renderer.info.render;
  return { drawCalls: calls, triangles };
}

/** Why a view did not open (the view switch says it). */
export type ViewFailureReason = "empty" | "webgl" | "chunk" | "context-lost";

/** A failure with the reason the view switch says. */
export function viewFailure(reason: ViewFailureReason, message: string): Error {
  return Object.assign(new Error(message), { reason });
}

/**
 * A renderer with `parameters` (antialiased by default), or a `webgl`
 * failure when WebGL is not there: the constructor threw, or the context
 * is null (the renderer is then disposed).
 */
export function createViewRenderer(
  parameters: THREE.WebGLRendererParameters = { antialias: true },
): THREE.WebGLRenderer {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer(parameters);
  } catch (error) {
    throw viewFailure(
      "webgl",
      `no WebGL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (renderer.getContext() === null) {
    renderer.dispose();
    throw viewFailure("webgl", "no WebGL context");
  }
  return renderer;
}
