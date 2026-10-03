/**
 * OsmDemo's pieces of the AR sun shadow prototype (plan
 * 2026-09-23-2343-ar-sun-shadow-prototype-plan, M3): the URL switch, which
 * objects cast, the test pole and the shadow-receiving plane. The light, the
 * rig and the map policy are the framework's (`visualization/sun-shadow`,
 * `visualization/sun-shadow-rig`), and so is the frame-time ring
 * (`utils/frame-times`, moved there on 2026-10-03, DEC-H3).
 *
 * @see ar-sun-shadow.ts.md
 */

import * as THREE from "three";

/** A URL switch: ON only for `1`, `on` or `true`; OFF by default (plan §7 item 17). */
function switchOn(search: string, param: string): boolean {
  const value = new URLSearchParams(search).get(param);
  if (value === null) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "on" || v === "true";
}

/** `?sunShadow=1`: the AR sun shadow prototype. */
export function sunShadowEnabled(search: string): boolean {
  return switchOn(search, "sunShadow");
}

/**
 * `?shadowCheck=1`: the desktop shadow COMPILE CHECK (plan §10 M3d), a
 * read-only diagnostic for the e2e (`BuildingView.enableShadowCheck`).
 */
export function shadowCheckEnabled(search: string): boolean {
  return switchOn(search, "shadowCheck");
}

/**
 * The userData flag of an object that casts the AR sun shadow. Set where the
 * object is BUILT (the ground POI pins, the quest beacons, the test pole), so
 * the rule never re-derives what an object is; everything untagged (the
 * X-ray shells, trees, roof-hosted pins, cells, plates, roads) never casts.
 */
export const AR_SHADOW_CASTER = "castsArShadow";

export function markArShadowCaster(object: THREE.Object3D): void {
  object.userData[AR_SHADOW_CASTER] = true;
}

/**
 * Casting on or off for every mesh under `root`: on only for tagged meshes.
 * Returns how many cast (a part of the map's caster signature).
 */
export function applyArShadowCasting(
  root: THREE.Object3D,
  on: boolean,
): number {
  let casters = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const cast = on && object.userData[AR_SHADOW_CASTER] === true;
    object.castShadow = cast;
    if (cast) casters += 1;
  });
  return casters;
}

/** The prototype's test caster (plan §7 finding 1): a 1.5 m × 5 cm pole. */
export const SHADOW_POLE = { heightM: 1.5, radiusM: 0.05 } as const;

export function createShadowPole(): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(
    SHADOW_POLE.radiusM,
    SHADOW_POLE.radiusM,
    SHADOW_POLE.heightM,
    12,
  );
  geometry.translate(0, SHADOW_POLE.heightM / 2, 0);
  const pole = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      name: "ar-shadow-pole",
      color: 0xf2f2f2,
      roughness: 0.6,
    }),
  );
  pole.name = "ar-shadow-pole";
  markArShadowCaster(pole);
  return pole;
}

/**
 * The shadow receiver over the camera image: a `ShadowMaterial` square of
 * half width `halfWidthM`, drawing only the shadow at `opacity` (the rig's
 * `shadowOpacity`). Never casts; no fog; a polygon offset keeps it in front
 * of the ground layers it lies on (plan §7 item 16).
 *
 * @throws RangeError for a size or opacity out of range.
 */
export function createShadowPlane(
  halfWidthM: number,
  opacity: number,
): THREE.Mesh {
  if (!(Number.isFinite(halfWidthM) && halfWidthM > 0)) {
    throw new RangeError(
      `the shadow plane half width must be positive, got ${halfWidthM}`,
    );
  }
  if (!(opacity >= 0 && opacity <= 1)) {
    throw new RangeError(
      `the shadow opacity must be in [0, 1], got ${opacity}`,
    );
  }
  const geometry = new THREE.PlaneGeometry(2 * halfWidthM, 2 * halfWidthM);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShadowMaterial({
    name: "ar-shadow-plane",
    opacity,
    fog: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.name = "ar-shadow-plane";
  plane.receiveShadow = true;
  plane.castShadow = false;
  return plane;
}
