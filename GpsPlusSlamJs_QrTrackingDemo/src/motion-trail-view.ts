/**
 * The motion trail's three.js view (QR near-frontal pose plan §26): a line
 * through the trail's points, in the motion mode's colour. The points are
 * raw-WebXR positions like the QR pose, so the line rides the same
 * WEBXR_TO_NUE basis node the shared QR debug view uses under
 * `arWorldGroup`. See motion-trail-view.ts.md.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
} from "three";
import type { Object3D } from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import type { TrailPoint } from "./motion-trail.js";

/** The line's colour when no mode colour is given. */
const NEUTRAL = "#ffffff";

export interface MotionTrailView {
  /** Draw `points` (oldest first) in `color`; hidden below two points. */
  update(points: readonly TrailPoint[], color: string | null): void;
  /** Remove it from the parent and free its GPU objects. */
  dispose(): void;
}

export function createMotionTrailView(parent: Object3D): MotionTrailView {
  const basis = new Group();
  basis.name = "qr-motion-trail-basis";
  basis.matrix.copy(WEBXR_TO_NUE);
  basis.matrixAutoUpdate = false;
  parent.add(basis);

  const geometry = new BufferGeometry();
  const material = new LineBasicMaterial({ color: NEUTRAL });
  const line = new Line(geometry, material);
  line.visible = false;
  // The points move every detection; the bounds are not worth recomputing.
  line.frustumCulled = false;
  basis.add(line);

  return {
    update(points, color) {
      material.color.set(color ?? NEUTRAL);
      if (points.length < 2) {
        line.visible = false;
        return;
      }
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(points.flat(), 3),
      );
      line.visible = true;
    },
    dispose() {
      parent.remove(basis);
      geometry.dispose();
      material.dispose();
    },
  };
}
