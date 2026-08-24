import { smoothstep } from "./easing.js";
import * as THREE from "three";

import {
  DESCENT_FALL_S,
  DESCENT_HOLD_S,
  DESCENT_MAX_START_M,
  type DescentInput,
} from "./ar-descent.js";

/**
 * The layer between the camera feed and the city during the AR entry (J1).
 *
 * "Ich möchte, dass du wirklich eine Schicht einbaust, die zwischen dem
 * Kamerahintergrundbild und den 3D-OpenStreetMap-Szenendaten ist, die quasi den
 * kompletten Viewport ausfüllt ... erst komplett sichtbar ist und eine komplette
 * solide Farbe zeigt, und dann später, wenn die OpenStreetMap-Daten angeflogen
 * kommen, entsprechend herausgefadet wird."
 *
 * **THIS REPLACES `renderer.setClearAlpha`, WHICH IS DEAD IN AR (DEC-J1).** The
 * previous mechanism (DEC-Y3) reasoned correctly that `scene.background === null`
 * makes the clear use the renderer's own `clearColor`/`clearAlpha`, and that the
 * framework's renderer is built `alpha: true`. Both premises are true and the
 * conclusion is still false, because `WebGLBackground.render()` has a third
 * branch that runs LAST:
 *
 * ```js
 * const environmentBlendMode = renderer.xr.getEnvironmentBlendMode();
 * if (environmentBlendMode === 'additive') state.buffers.color.setClear(0,0,0,1, …);
 * else if (environmentBlendMode === 'alpha-blend') state.buffers.color.setClear(0,0,0,0, …);
 * ```
 *
 * Every video-passthrough session reports `alpha-blend`, so the clear is forced
 * transparent and the camera is visible from the first frame — exactly what the
 * fifteenth field session reported. **No test here could have caught it**:
 * `getEnvironmentBlendMode()` returns `'opaque'` outside a session, so the
 * override never fires in vitest or in headless Chromium.
 *
 * **IT MUST NOT SURVIVE THE ENTRY.** An opaque surface left in an AR scene is a
 * lid over the passthrough — strictly worse than having no veil at all. Every
 * choice below follows from that: the alpha is driven from the same clock as the
 * descent, it reaches exactly 0 on landing, every degenerate input resolves to
 * "no veil", and the caller disposes it twice over.
 *
 * @see ar-entry-veil.ts.md
 */

/**
 * The 3D view's own background colour, so AR entry dissolves out of the view it
 * came from rather than out of an unrelated flat colour (DEC-J3).
 *
 * **Dark on purpose, and that is a correctness constraint rather than taste.**
 * `ar-building-material.ts` draws the AR city with `AdditiveBlending`, so this
 * colour is ADDED to every building drawn over it. At (17, 19, 26) the wash is
 * invisible; a light veil would bleach the city for the whole entry.
 *
 * Kept as a literal rather than imported from `building-view.ts`: that module
 * pulls in the whole desktop scene and this one is loaded inside an XR session.
 */
export const ENTRY_VEIL_COLOUR = 0x11131a;

/**
 * Radius of the sphere, metres.
 *
 * **A RANGE, NOT A DERIVED NUMBER.** It has to clear the AR camera's 0.5 m near
 * plane by a wide margin and stay well inside its 1000 m far plane
 * (`ar-scene-environment.ts`); anywhere in roughly 10–200 m satisfies both. 50 m
 * is the middle of that range. Stated so the next reader does not go looking for
 * arithmetic that was never done.
 */
export const ENTRY_VEIL_RADIUS_M = 50;

/** Below every rung in `layer-order.ts`, and below three's default 0. */
const ENTRY_VEIL_RENDER_ORDER = -1000;

/**
 * How long the veil takes to fade once the city has landed (DEC-M3).
 *
 * The eighteenth field session: *"Die sollte erst bei 100 % Transparency sein,
 * wenn wirklich die Kamerafahrt auch zu Ende ist … oder sogar vielleicht nochmal
 * zwei Sekunden später … weil vorher das Kamerabild noch keinen Sinn macht, weil
 * es noch kein wirkliches AR-Overlay ist, bis die Gebäude auf der Höhe von der
 * Kamera sind."*
 */
export const ENTRY_VEIL_FADE_S = 2;

/**
 * How opaque the veil is, `[0,1]`.
 *
 * **1 FOR THE WHOLE FLY-IN, then a {@link ENTRY_VEIL_FADE_S} fade (DEC-M3).**
 *
 * **THIS REPLACES `1 − cameraFadeAlpha`, AND THE ARGUMENT IT REPLACES WAS NOT
 * WRONG SO MUCH AS AIMED AT THE WRONG EVENT.** The old derivation reasoned that
 * the camera coming in and the veil going out are one visual event, so a second
 * curve could only drift from the first — true, and it produced a veil whose
 * opacity was the exact inverse of how far the city had travelled: ~0.5 with the
 * city still 30 m overhead. The field session's objection is that the event the
 * camera should fade in FOR is the fly-in's **completion**, not its progress:
 * passthrough behind a city that has not arrived is two unrelated pictures
 * rather than an overlay.
 *
 * **One clock survives, which is what mattered about the old rule.** This is
 * still a pure function of the descent's own `elapsedS`, so the two halves
 * cannot drift; only the curve on that clock changed.
 *
 * **`startM ≤ 0` still answers 0**, i.e. "no veil". That used to fall out of
 * `cameraFadeAlpha` returning 1 for a zero start, and two call sites in
 * `ar-mode.ts` depend on it: a ground-level entry builds no veil at all, and
 * building one that never lifted would be the lid this module exists to make
 * impossible. It is now an explicit guard rather than an inherited one.
 *
 * **Every other degenerate input collapses to 0** for the same reason — the
 * failure worth designing against is a veil that outlives the entry.
 */
export function entryVeilAlpha(input: DescentInput): number {
  const { elapsedS, startM } = input;
  if (!Number.isFinite(elapsedS) || !Number.isFinite(startM)) return 0;
  const start = Math.min(DESCENT_MAX_START_M, Math.max(0, startM));
  if (start <= 0) return 0;
  const landedAtS = DESCENT_HOLD_S + DESCENT_FALL_S;
  if (elapsedS <= landedAtS) return 1;
  const t = (elapsedS - landedAtS) / ENTRY_VEIL_FADE_S;
  if (t >= 1) return 0;
  return 1 - smoothstep(t);
}

export interface ArEntryVeil {
  /** The mesh, for the caller to add to the AR scene root. */
  readonly mesh: THREE.Mesh;
  /** Re-centre on the camera. A non-finite component is ignored. */
  follow(cameraWorldPosition: THREE.Vector3): void;
  /** Fade it, `[0,1]`. Clamped; anything unusable collapses to 0. */
  setAlpha(alpha: number): void;
  /** Remove it from its parent and free its GPU resources. Idempotent. */
  dispose(): void;
}

/**
 * Build the entry veil.
 *
 * **AN INSIDE-OUT SPHERE, NOT A CAMERA-LOCKED QUAD (DEC-J2).** A sphere centred
 * on the camera covers every direction by construction: no field-of-view
 * arithmetic and no stereo off-axis arithmetic, so there is no way to leave a rim
 * of live camera around the screen edge. That failure mode is what decided it —
 * **no test in this repo could catch it**, because headless Chromium never
 * renders a stereo pair against a camera feed, and a design that cannot produce
 * an uncatchable defect beats a cheaper one that can.
 *
 * **`MeshBasicMaterial`, not `MeshStandardMaterial`.** A lit material would
 * depend on the framework's lights being present and correctly oriented, and
 * `ar-scene-environment.ts` records what happens when an AR material's lighting
 * assumption turns out to be wrong: every affected shader silently fails to
 * compile and the geometry vanishes with no error. An unlit surface cannot fail
 * that way.
 *
 * **`depthTest: false` and a render order below every layer.** The veil is
 * `transparent`, so it sits in three's TRANSPARENT list and is drawn after the
 * whole opaque list — `renderOrder` only sorts within a list. That is enough for
 * what it must beat: the AR city is transparent-additive at the default order 0.
 * It is NOT enough to get under the layers that keep their opaque desktop
 * materials — trees, POI plates and ribbons, because `setArShellMaterial` swaps
 * only geometry carrying `aHeight01`. `depthTest: false` is what makes the veil
 * immune to the depth those wrote, and the visible consequence is deliberate and
 * recorded: **those layers are hidden behind the veil for the whole entry and
 * appear as it fades**, while the buildings are visible throughout.
 */
export function createArEntryVeil(): ArEntryVeil {
  const geometry = new THREE.SphereGeometry(ENTRY_VEIL_RADIUS_M, 16, 12);
  const material = new THREE.MeshBasicMaterial({
    color: ENTRY_VEIL_COLOUR,
    transparent: true,
    opacity: 1,
    // WE ARE INSIDE IT. A front-sided sphere is invisible from within, which
    // would look identical to the bug this module replaces.
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    // NEITHER FOGGED NOR TONE-MAPPED: `ar-scene-environment.ts` installs a fog
    // over 0-1000 m and a renderer tone mapping, and a veil subject to either
    // would drift off the colour it was asked for.
    fog: false,
    toneMapped: false,
  });
  // LEFT AT ITS `false` DEFAULT, EXPLICITLY (DEC-J4). `WebGLState.setBlending`
  // is driven by THIS flag rather than by the renderer's context attribute, and
  // the non-premultiplied `NormalBlending` branch already produces a
  // premultiplied framebuffer. Flipping it would make `setAlpha` premultiply
  // twice, fading the veil at roughly double speed.
  material.premultipliedAlpha = false;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = ENTRY_VEIL_RENDER_ORDER;
  // The camera sits inside this sphere, and although its bounding sphere passes
  // every frustum plane anyway, culling a screen-filling veil is the one
  // outcome that cannot be recovered from mid-entry. Insurance, not a fix.
  mesh.frustumCulled = false;

  return {
    mesh,
    follow(cameraWorldPosition: THREE.Vector3): void {
      // IGNORED RATHER THAN PROPAGATED. A NaN component puts the mesh at an
      // undefined position, which three renders as nothing — i.e. the camera
      // would reappear mid-entry, indistinguishable from the defect this module
      // fixes. Keeping the last good centre fails towards "slightly stale",
      // which the next frame corrects.
      const { x, y, z } = cameraWorldPosition;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return;
      }
      mesh.position.set(x, y, z);
    },
    setAlpha(alpha: number): void {
      // NON-FINITE COLLAPSES TO 0, never to 1: three renders a NaN opacity as
      // fully opaque, so failing the other way produces exactly the lid.
      // `Infinity` is the one exception and is clamped UP, because unlike a NaN
      // or a negative it is a real request for "as opaque as possible".
      const safe = Number.isNaN(alpha)
        ? 0
        : Math.min(
            1,
            Math.max(0, alpha === Number.NEGATIVE_INFINITY ? 0 : alpha),
          );
      material.opacity = safe;
      // THE COLOUR IS NOT TOUCHED (DEC-J4). See the constructor comment.
      //
      // HIDDEN AT ZERO rather than merely fully transparent: a transparent mesh
      // is still submitted, sorted and blended every frame, and this one covers
      // the whole screen.
      mesh.visible = safe > 0;
    },
    dispose(): void {
      // IDEMPOTENT, because `ar-mode.ts` calls it twice over — on landing and
      // again in `release()`. A session ended mid-descent never reaches the
      // landing branch, and that is the common case when someone backs out
      // because the entry looked wrong.
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
