/**
 * The haze over the relief below the hand-over edge (globe F2 plan
 * 2026-10-03-1922, F2b): the framework's sky-matched aerial perspective
 * (`AtmosphereHaze`, an `onBeforeCompile` patch of three's fog chunks) on
 * the relief's tiles, its strength following the ground sky's weight.
 *
 * - **One `THREE.Fog` for the whole page**, its near and far planes so far
 *   out that three's stock fog never darkens anything: the fog's presence
 *   decides `USE_FOG` for every material in the scene, so adding or
 *   removing it at the edge would recompile them all (frame-hitch review
 *   2026-10-03-2017). The haze's own boundary fade is then 0 everywhere and
 *   the haze is the physical extinction alone.
 * - **The strength is the haze's density scale**: the weight times the
 *   scale chosen (`hazeScale`), 0 above the edge, so the look there is
 *   exactly as before.
 * - **The relief's tiles only** (the globe's own tiles are not drawn below
 *   the band but as the fill), each patched on load AFTER the relief's own
 *   hooks and the stencil writer, the haze's own rule: its patch chains the
 *   hooks before it.
 * - **It follows the ground sky** (`sync` after each of its reads), and
 *   waits in three's stock-fog mode until the first one.
 *
 * @see globe-haze.js.md
 */
import * as THREE from "three";

import { AtmosphereHaze } from "/fw/visualization/atmosphere/atmosphere-haze.js";

/** The fog's planes (m): far enough that the stock fog never starts. */
const FOG_OUT_OF_REACH_M = 1e12;

/**
 * The haze for `scene` (it sets `scene.fog` once, for the whole page). Call
 * `patch(tiles)` once per carrier it hazes, `sync(atmosphere)` after the
 * ground sky's read, and `setWeight(weight, scale)` every frame.
 */
export function createGlobeHaze(scene, { visibilityKm }) {
  const haze = new AtmosphereHaze({ visibilityKm, densityScale: 0 });
  scene.fog = new THREE.Fog(
    0x000000,
    FOG_OUT_OF_REACH_M,
    FOG_OUT_OF_REACH_M * 2,
  );
  haze.setMode("atmosphere");
  let synced = false;
  let density = 0;
  let patched = 0;
  return {
    /** Patches every mesh `tiles` loads from now on. */
    patch(tiles) {
      tiles.addEventListener("load-model", ({ scene: model }) => {
        patched += haze.applyToObject(model);
      });
    },
    /** Copies the ground sky's state in (its sun, scale and sky view). */
    sync(atmosphere) {
      haze.sync({
        sharedUniforms: atmosphere.sharedUniforms,
        visibilityKm: atmosphere.visibilityKm,
      });
      synced = true;
    },
    /**
     * The haze's strength: the ground sky's weight times `scale` (the
     * physical extinction's multiplier; 0 turns it off). RangeError as the
     * framework's for a negative or non-finite product.
     */
    setWeight(weight, scale) {
      const next = weight * scale;
      if (next !== density) {
        density = next;
        haze.setDensityScale(next);
      }
    },
    state() {
      return { synced, density, patched };
    },
    dispose() {
      haze.dispose();
      if (scene.fog?.isFog) scene.fog = null;
    },
  };
}
