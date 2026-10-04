/**
 * Breadcrumbs as a guide (tour kit plan K4, §8 P2; the community PR idea,
 * K-D4: the idea, not its implementation): a short line of dots on the
 * ground from the visitor towards the next station, so the way reads at a
 * glance where the HUD's arrow only points. At the scene root in the
 * session's GPS-world NUE, like the tour's content.
 *
 * The dots run straight towards the station (the tour carries no paths),
 * start one spacing ahead of the visitor, and stop short of the station's
 * found radius - inside it the station itself is the guide. They are laid
 * again only when the visitor moved or the station changed, never per frame.
 *
 * The look is the K4 build agent's choice, not the owner's: 6 dots, 4 m
 * apart (24 m of way ahead), 0.25 m across, at the ground 1.5 m below the
 * phone.
 */

import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from "three";

export const BREADCRUMB_SPACING_M = 4;
export const BREADCRUMB_COUNT = 6;
/** The phone's usual height above the ground while walking. */
export const EYE_HEIGHT_M = 1.5;
/** Laid again once the visitor moved this far (or the target changed). */
export const BREADCRUMB_RELAY_M = 1;
const DOT_RADIUS_M = 0.125;
/** The design system's accent, as the HUD's indicators use it. */
const DOT_COLOR = "#f2971f";

type Nue = readonly [number, number, number];

/** The dots' positions (NUE) from the visitor towards `to`, stopping
 *  `stopM` short of it; none when the visitor is already that close. */
export function breadcrumbPoints(input: {
  readonly from: Nue;
  readonly to: Nue;
  readonly stopM: number;
}): [number, number, number][] {
  const dn = input.to[0] - input.from[0];
  const de = input.to[2] - input.from[2];
  const d = Math.hypot(dn, de);
  if (!Number.isFinite(d) || d === 0) return [];
  const ground = input.from[1] - EYE_HEIGHT_M;
  const points: [number, number, number][] = [];
  for (let i = 1; i <= BREADCRUMB_COUNT; i += 1) {
    const s = i * BREADCRUMB_SPACING_M;
    if (s > d - input.stopM) break;
    points.push([
      input.from[0] + (dn / d) * s,
      ground,
      input.from[2] + (de / d) * s,
    ]);
  }
  return points;
}

export interface BreadcrumbTrail {
  /** Lead from the visitor to the target (either null: no trail). The
   *  dots' one geometry and material live as long as the page. */
  update(
    visitor: Nue | null,
    target: {
      readonly id: string;
      readonly to: Nue;
      readonly stopM: number;
    } | null,
  ): void;
}

export function createBreadcrumbTrail(deps: {
  getScene(): Object3D | null;
}): BreadcrumbTrail {
  let group: Group | null = null;
  let scene: Object3D | null = null;
  let laid: { id: string; from: Nue } | null = null;
  const geometry = new CircleGeometry(DOT_RADIUS_M, 16);
  // Flat on the ground: the circle lies in XY, the ground plane is XZ.
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    color: DOT_COLOR,
    side: DoubleSide,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  function clear(): void {
    if (group !== null) scene?.remove(group);
    group = null;
    scene = null;
    laid = null;
  }

  return {
    update(visitor, target) {
      if (visitor === null || target === null) {
        clear();
        return;
      }
      if (
        laid !== null &&
        laid.id === target.id &&
        Math.hypot(visitor[0] - laid.from[0], visitor[2] - laid.from[2]) <
          BREADCRUMB_RELAY_M
      ) {
        return;
      }
      const root = deps.getScene();
      if (root === null) return;
      clear();
      const points = breadcrumbPoints({
        from: visitor,
        to: target.to,
        stopM: target.stopM,
      });
      group = new Group();
      group.name = "station-breadcrumbs";
      for (const p of points) {
        const dot = new Mesh(geometry, material);
        dot.position.set(...p);
        group.add(dot);
      }
      root.add(group);
      scene = root;
      laid = { id: target.id, from: visitor };
    },
  };
}
