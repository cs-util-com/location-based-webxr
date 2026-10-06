/**
 * The drawn relief's depth, once a frame, for the passes that must end at
 * it: the cloud volume's march (volume-cloud plan 2026-10-05-0016, C2) and
 * the space pass's rays below the hand-over (§17; the F2 plan's accepted
 * "no scene depth" limit, M1 R3 minor 10, which drew a hard edge at the
 * ellipsoid's limb on the owner's phone, 2026-10-06).
 *
 * - **The relief's own meshes**, their colour writes off: the displacement
 *   is in their vertex shader, so an override material would draw them
 *   flat.
 * - **Its own near plane** (at most 10 m): the camera's is fitted to the
 *   ground (0.3 x the clearance), and a pass that ends at the depth must see
 *   everything nearer than that too. A reader reconstructs a point through
 *   `camera`'s inverse projection, never the view camera's.
 *
 * @see globe-scene-depth.js.md
 */
import * as THREE from "three";

/**
 * The depth's near plane at most (m): small against any distance the
 * passes march, while the depth texture (24 bits or more) still resolves
 * the relief to about 2.5 m at 20 km (z^2 / (near x 2^24)).
 */
const SCENE_DEPTH_NEAR_M = 10;

/** The scene depth for `renderer`, sized to its drawing buffer. */
export function createGlobeSceneDepth(renderer) {
  const texture = new THREE.DepthTexture(1, 1);
  const target = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    depthTexture: texture,
  });
  const camera = new THREE.PerspectiveCamera();
  const size = new THREE.Vector2();
  let frames = 0;
  let fresh = false;

  return {
    /** The depth (1 where nothing was drawn). */
    texture,
    /** The camera it was drawn with: the view camera, its near plane small. */
    camera,
    /**
     * Draws the depth of `relief` (an Object3D), and of each object in
     * `extra` (the city, globe city plan 2026-10-05-0040 §12.5 C4), as
     * `viewCamera` sees them, into the depth texture; restores the render
     * target, the renderer's auto-clear and every colour write it turned off.
     */
    render(viewCamera, relief, extra = []) {
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) {
        target.setSize(size.x, size.y);
      }
      camera.copy(viewCamera);
      camera.near = Math.min(viewCamera.near, SCENE_DEPTH_NEAR_M);
      camera.updateProjectionMatrix();
      const drawn = [relief, ...extra];
      const written = [];
      for (const root of drawn) {
        root.traverse((o) => {
          if (o.isMesh && o.material?.colorWrite) {
            o.material.colorWrite = false;
            written.push(o.material);
          }
        });
      }
      const previous = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.clear(false, true, false);
      for (const root of drawn) renderer.render(root, camera);
      for (const m of written) m.colorWrite = true;
      renderer.setRenderTarget(previous);
      renderer.autoClear = autoClear;
      frames += 1;
      fresh = true;
    },
    /** Marks the depth as not drawn this frame (call at the frame's start). */
    beginFrame() {
      fresh = false;
    },
    /** Whether the depth was drawn this frame. */
    get fresh() {
      return fresh;
    },
    state() {
      return { frames, fresh, near: camera.near };
    },
    dispose() {
      target.dispose();
      texture.dispose();
    },
  };
}
