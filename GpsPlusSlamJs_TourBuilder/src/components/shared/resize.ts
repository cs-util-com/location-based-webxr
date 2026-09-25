/**
 * Keep a perspective camera and renderer in sync with their container's size.
 *
 * Tiny view-layer helper shared by the component demos (all three wire the
 * same `resize` handler), so the boilerplate lives once. Framework-free.
 */
import type { PerspectiveCamera, WebGLRenderer } from "three";

/**
 * Attach a window `resize` listener that keeps `camera`/`renderer` sized to
 * `container` (the `#canvas-root` element) — not the full window, since the
 * canvas now shares the viewport with the demo's `.page-header`.
 */
export function attachResize(
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
  container: HTMLElement,
): void {
  window.addEventListener("resize", () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}
