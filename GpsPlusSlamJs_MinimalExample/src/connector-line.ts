/**
 * Connector line for the Step 4 contrast demo.
 *
 * The demo spawns pairs of a GPS-anchored **sphere** (under `arWorldGroup`) and
 * a deliberate floater **cube** (under the GPS-aligned `scene` root). Over time
 * the cube drifts away from the sphere — that drift is the whole teaching point.
 * With multiple pairs on screen it becomes hard to tell which cube belongs to
 * which sphere, so this module draws a red line from each sphere to its own cube
 * and stretches it live as the pair separates.
 *
 * Design (the simplest thing that works): the line is a **child of the sphere**.
 * One vertex is therefore permanently the sphere origin (local `0,0,0`) and only
 * the *other* vertex is updated each frame to the cube's current world pose,
 * expressed in the sphere's local frame via `sphere.worldToLocal`. So per frame
 * we only recompute and write a single endpoint; the line rides the sphere's
 * own transform (the GPS alignment applied to `arWorldGroup`) for free.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  type Object3D,
  Vector3,
} from 'three';

/** Red — visually distinct from the orange cube and green sphere. */
export const CONNECTOR_LINE_COLOR = 0xff0000;

export interface ConnectorLine {
  /** The `THREE.Line`, already added as a child of the sphere. */
  readonly line: Line<BufferGeometry, LineBasicMaterial>;
  /**
   * Refresh the moving endpoint (the cube end) to the cube's current world
   * pose. Call once per frame. End A (the sphere origin) never moves.
   */
  update(): void;
}

/**
 * Create a red line connecting a GPS-anchored `sphere` to its floater `cube`.
 *
 * The line is parented to `sphere`; endpoint 0 stays at the sphere origin and
 * endpoint 1 follows the cube. Returns the line plus an `update()` to drive
 * from the frame loop.
 */
export function createConnectorLine(opts: {
  sphere: Object3D;
  cube: Object3D;
}): ConnectorLine {
  const { sphere, cube } = opts;

  const geometry = new BufferGeometry();
  // Two vertices: [sphere origin, cube end]. Both start at the origin; the cube
  // end is set on the first `update()`.
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)
  );
  const material = new LineBasicMaterial({ color: CONNECTOR_LINE_COLOR });
  const line = new Line(geometry, material);
  line.frustumCulled = false;
  sphere.add(line);

  const scratch = new Vector3();
  const update = (): void => {
    // Refresh the sphere's world matrix so `worldToLocal` uses its current
    // transform (the GPS alignment on arWorldGroup moves the sphere).
    sphere.updateWorldMatrix(true, false);
    cube.getWorldPosition(scratch);
    sphere.worldToLocal(scratch);
    const position = geometry.getAttribute('position');
    position.setXYZ(1, scratch.x, scratch.y, scratch.z);
    position.needsUpdate = true;
  };

  // Place the cube end correctly from the start so a single-frame render (or a
  // test) sees a connected line without waiting for the next frame tick.
  update();

  return { line, update };
}
