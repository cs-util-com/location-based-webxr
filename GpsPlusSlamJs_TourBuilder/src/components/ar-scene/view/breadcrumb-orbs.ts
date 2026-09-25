/**
 * The breadcrumb trail — a fixed pool of glowing orbs, recycled (plan A3).
 *
 * A recorded trail has hundreds to thousands of points, so an anchor per point
 * is out of the question: every `GpsAnchor` carries a bootstrap state machine
 * and a per-frame commit policy. Instead a constant number of orbs exist for the
 * whole tour and are **re-pointed** at whichever trail coordinates the pure
 * window selected, via the anchor's own `setGpsPoint` + `markMovedExternally`.
 *
 * Cost per frame is therefore O(pool), not O(trail), and geo→world conversion
 * stays entirely inside the framework (contract §2.5.1).
 *
 * Orbs pulse to read as "follow me" rather than as scenery; the pulse collapses
 * to a static glow under `prefers-reduced-motion`.
 */

import type { Object3D } from "three";
import {
  AdditiveBlending,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from "three";

import type { TourCoord } from "../../../store/types.js";

/** The anchor surface this pool needs — the framework's `GpsAnchor`, narrowed. */
export interface OrbAnchor {
  setGpsPoint(point: TourCoord): void;
  markMovedExternally(): void;
  dispose(): void;
}

type OrbAnchorFactory = (object3D: Object3D, coord: TourCoord) => OrbAnchor;

export interface BreadcrumbOrbsOptions {
  readonly parent: Object3D;
  readonly poolSize: number;
  readonly anchorFactory: OrbAnchorFactory;
  readonly radiusM?: number;
  /** Injected for tests; defaults to the media query when a DOM is present. */
  readonly reducedMotion?: boolean;
}

export interface BreadcrumbOrbs {
  /** One entry per pool slot; `null` hides that orb. */
  setCoords(coords: readonly (TourCoord | null)[]): void;
  update(dtSeconds: number): void;
  dispose(): void;
}

const DEFAULT_ORB_RADIUS_M = 0.12;
const ORB_HEIGHT_M = 0.35; // float just above the ground, not buried in it
const PULSE_HZ = 0.8;

function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;
  return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function createBreadcrumbOrbs(
  options: BreadcrumbOrbsOptions,
): BreadcrumbOrbs {
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  // Geometry and material are shared across the pool and disposed once, here —
  // the orbs are identical by construction.
  const geometry = new SphereGeometry(
    options.radiusM ?? DEFAULT_ORB_RADIUS_M,
    12,
    8,
  );
  const material = new MeshBasicMaterial({
    color: 0x8fd0ff,
    transparent: true,
    opacity: 0.85,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  interface Slot {
    readonly mesh: Mesh;
    anchor: OrbAnchor | null;
    coord: TourCoord | null;
  }

  const slots: Slot[] = [];
  for (let i = 0; i < options.poolSize; i++) {
    const mesh = new Mesh(geometry, material);
    mesh.visible = false;
    mesh.position.y = ORB_HEIGHT_M;
    options.parent.add(mesh);
    slots.push({ mesh, anchor: null, coord: null });
  }

  let elapsed = 0;

  return {
    setCoords(coords: readonly (TourCoord | null)[]): void {
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]!;
        const coord = coords[i] ?? null;
        if (coord === null) {
          slot.mesh.visible = false;
          slot.coord = null;
          continue;
        }
        if (slot.coord === coord) {
          slot.mesh.visible = true;
          continue; // already anchored here — the point of the slot assignment
        }
        slot.coord = coord;
        if (slot.anchor === null) {
          slot.anchor = options.anchorFactory(slot.mesh, coord);
        } else {
          slot.anchor.setGpsPoint(coord);
          slot.anchor.markMovedExternally();
        }
        slot.mesh.visible = true;
      }
    },

    update(dtSeconds: number): void {
      if (reduced) return; // static glow — the orbs are still fully visible
      elapsed += dtSeconds;
      const pulse = 0.7 + 0.3 * Math.sin(elapsed * PULSE_HZ * Math.PI * 2);
      material.opacity = pulse;
    },

    dispose(): void {
      for (const slot of slots) {
        slot.anchor?.dispose();
        slot.mesh.removeFromParent();
      }
      slots.length = 0;
      geometry.dispose();
      material.dispose();
    },
  };
}
