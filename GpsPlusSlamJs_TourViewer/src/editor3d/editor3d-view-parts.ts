/**
 * What the editor's two 3D views share (the OrbitControls view,
 * `editor3d-scene.ts`, and the globe view, `editor3d-globe.ts`): the
 * failure the view switch reads the reason of, the renderer made or
 * refused, and the credits line.
 *
 * @see editor3d-view-parts.ts.md
 */
import * as THREE from "three";

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

/** The credits' line: each credit's short name, linked, between dots. */
export function fillCredits(
  box: HTMLElement,
  credits: readonly { short: string; href: string }[],
): void {
  const parts: Node[] = [];
  credits.forEach((credit, i) => {
    if (i > 0) parts.push(document.createTextNode(" · "));
    const a = document.createElement("a");
    a.href = credit.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = credit.short;
    parts.push(a);
  });
  box.replaceChildren(...parts);
}
