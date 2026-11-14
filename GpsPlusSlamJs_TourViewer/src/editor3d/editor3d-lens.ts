/**
 * The lens "Look from the viewpoint" lends the editor's camera: while it
 * holds, the camera sees through the viewpoint's horizontal field of view
 * (worked into the vertical one three's camera takes, at the view's
 * aspect now), so what the picture's camera framed is what the view
 * frames; released, the camera has its own field of view back.
 *
 * @see editor3d-lens.ts.md
 */

/** The camera parts a lens hold reads and writes (three's
 *  `PerspectiveCamera`: `fov` is vertical, in degrees). */
export interface LensCamera {
  fov: number;
  readonly aspect: number;
  updateProjectionMatrix(): void;
}

const DEG = Math.PI / 180;

/** The vertical field of view (degrees) of a lens `hfovDeg` wide at
 *  `aspect` (width over height); null for a lens outside (0, 180) or an
 *  aspect that is not a positive number. */
export function verticalFovDeg(hfovDeg: number, aspect: number): number | null {
  if (!Number.isFinite(hfovDeg) || hfovDeg <= 0 || hfovDeg >= 180) return null;
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  return (2 * Math.atan(Math.tan((hfovDeg * DEG) / 2) / aspect)) / DEG;
}

export interface LensHold {
  /** See through a lens `hfovDeg` wide for the picture `selection`;
   *  false (and the hold released) for a lens `verticalFovDeg` refuses. */
  lookThrough(selection: string, hfovDeg: number): boolean;
  /** The camera's own field of view back; nothing when no lens holds. */
  release(): void;
  /** The picture whose lens holds, or null. */
  selection(): string | null;
  /** Each frame: the lens again at the aspect now (a resize changes the
   *  vertical field of a fixed horizontal one); nothing when none holds. */
  apply(): void;
  /** The vertical field of view (degrees) the camera sees through now:
   *  the lens's at the aspect it last took while one holds, else the own.
   *  Whatever is sized on screen (billboards, code squares, the globe's
   *  hiding rules) takes this, never the own field alone. */
  fovDeg(): number;
}

/** A lens hold over `camera`, whose own field of view is `ownFovDeg`
 *  (vertical, degrees; throws outside (0, 180)). */
export function createLensHold(
  camera: LensCamera,
  ownFovDeg: number,
): LensHold {
  if (!Number.isFinite(ownFovDeg) || ownFovDeg <= 0 || ownFovDeg >= 180) {
    throw new RangeError(
      `the camera's own field of view must be in (0, 180), got ${ownFovDeg}`,
    );
  }
  let held: { readonly selection: string; readonly hfovDeg: number } | null =
    null;
  let heldFovDeg = ownFovDeg;
  const set = (fovDeg: number) => {
    if (camera.fov === fovDeg) return;
    camera.fov = fovDeg;
    camera.updateProjectionMatrix();
  };
  const release = () => {
    if (held === null) return;
    held = null;
    set(ownFovDeg);
  };
  return {
    lookThrough(selection, hfovDeg) {
      const fovDeg = verticalFovDeg(hfovDeg, camera.aspect);
      if (fovDeg === null) {
        release();
        return false;
      }
      held = { selection, hfovDeg };
      heldFovDeg = fovDeg;
      set(fovDeg);
      return true;
    },
    release,
    selection: () => held?.selection ?? null,
    apply() {
      if (held === null) return;
      const fovDeg = verticalFovDeg(held.hfovDeg, camera.aspect);
      if (fovDeg === null) return;
      heldFovDeg = fovDeg;
      set(fovDeg);
    },
    fovDeg: () => (held === null ? ownFovDeg : heldFovDeg),
  };
}
