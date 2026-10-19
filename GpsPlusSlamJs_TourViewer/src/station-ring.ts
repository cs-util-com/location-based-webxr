/**
 * The open station's radius in the creator's AR view (tour editor plan
 * 2026-10-17-1816, W3 "AR authoring": "the open station shows its
 * radius"): a thin band lying on the ground around the station's anchor,
 * R metres out, so the creator sees where the station ends and where the
 * next pin would start a new one.
 *
 * At the scene root in the session's GPS-world NUE, like the breadcrumbs
 * and the content. The ground is the phone's height less `EYE_HEIGHT_M`,
 * as the breadcrumbs read it: a station's anchor may stand on a wall, and
 * a ring at its height would float.
 *
 * @see station-ring.ts.md
 */

import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Object3D,
} from "three";

/** The ring's name, how a test finds it in the scene. */
export const STATION_RING_NAME = "station-ring";

/** The band's width (m): wide enough to read at the near edge of a 25 m
 *  ring (about 4-6 px on a phone), narrow enough not to cover the ground.
 *  The look is the builder's choice, not the owner's. */
const BAND_M = 0.3;
/** Segments around: at R = 40 m a chord sags by 40 * (1 - cos(pi/128)),
 *  about 1.2 cm - invisible on the ground. */
const SEGMENTS = 128;
/** The design system's accent, as the breadcrumbs and the HUD use it. */
const RING_COLOUR = "#f2971f";

type Nue = readonly [number, number, number];

export interface StationRing {
  /** Lay the ring at `centre` (NUE; its up part is the ground) with
   *  radius `radiusM`, under `parent`. Cheap when nothing changed. */
  show(parent: Object3D, centre: Nue, radiusM: number): void;
  /** Take the ring away (kept for the next `show`). */
  hide(): void;
}

/**
 * One ring per page wiring (`creator-stations.ts`), kept for the page's
 * life: every AR session shows and hides the same mesh and material, so
 * there is no teardown - a session's end only hides it, and nothing frees
 * the material a later session reuses.
 */
export function createStationRing(): StationRing {
  const material = new MeshBasicMaterial({
    color: RING_COLOUR,
    side: DoubleSide,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  let mesh: Mesh | null = null;
  let builtFor = Number.NaN;
  /** What the ring was added to: it is removed through it (the e2e fakes'
   *  scene sets no `parent`). */
  let holder: Object3D | null = null;

  function geometryFor(radiusM: number): Mesh {
    if (mesh !== null && builtFor === radiusM) return mesh;
    const old = mesh;
    const geometry = new RingGeometry(
      Math.max(0, radiusM - BAND_M / 2),
      radiusM + BAND_M / 2,
      SEGMENTS,
    );
    // Flat on the ground: the ring lies in XY, the ground plane is XZ.
    geometry.rotateX(-Math.PI / 2);
    const next = new Mesh(geometry, material);
    next.name = STATION_RING_NAME;
    // Never what a tap picks: taps select the objects inside the ring.
    next.raycast = () => undefined;
    if (old !== null) {
      if (holder !== null) holder.remove(old);
      old.removeFromParent();
      old.geometry.dispose();
      if (holder !== null) holder.add(next);
    }
    mesh = next;
    builtFor = radiusM;
    return next;
  }

  function hide(): void {
    if (mesh === null) return;
    holder?.remove(mesh);
    mesh.removeFromParent();
    holder = null;
  }

  return {
    show(parent, centre, radiusM) {
      if (
        !Number.isFinite(radiusM) ||
        radiusM <= 0 ||
        !centre.every(Number.isFinite)
      ) {
        hide();
        return;
      }
      const ring = geometryFor(radiusM);
      if (holder !== parent) {
        hide();
        parent.add(ring);
        holder = parent;
      }
      ring.position.set(centre[0], centre[1], centre[2]);
    },
    hide,
  };
}
