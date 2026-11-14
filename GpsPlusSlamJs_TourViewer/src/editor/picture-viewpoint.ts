/**
 * A picture's viewpoint as the editor makes and types it (pure): the first
 * one a picture gets when it is switched to a view seen from a viewpoint
 * (`mintViewpoint`: standing in front of the picture, facing it), what the
 * inspector shows of one (`viewpointFacts`: where it stands, its facing,
 * its pitch, its lens and its depth), and one typed field written into it
 * (`viewpointWithField`), and the pose of its handle in the 3D view and
 * back (`viewpointPose`, `viewpointAt`). The frame is the station's:
 * x north, y up, z east; the camera looks along its local -Z, up its
 * local +Y.
 *
 * @see picture-viewpoint.ts.md
 */
import {
  TOUR_PICTURE_MAX_DISTANCE_M,
  TOUR_PICTURE_MAX_HFOV_DEG,
  TOUR_PICTURE_MIN_DISTANCE_M,
  TOUR_PICTURE_MIN_HFOV_DEG,
  type TourPictureViewpoint,
} from "gps-plus-slam-app-framework/ar/tour-kinds";

/** A pose in the station's frame, as the editor knows a picture's. */
interface StationPose {
  readonly position: readonly number[];
  readonly rotation: readonly number[];
}

/** How far in front of its picture a first viewpoint stands (m): also
 *  its depth, so the picture lines up where it stood. */
export const VIEWPOINT_STAND_BACK_M = 6;
/** A first viewpoint's eye height above the station's anchor (m). */
export const VIEWPOINT_EYE_M = 1.6;
/** A first viewpoint's lens (degrees across): a phone's main camera. */
export const VIEWPOINT_LENS_DEG = 56;
/** How far a viewpoint may look up or down (degrees). */
const VIEWPOINT_MAX_PITCH_DEG = 80;

const DEG = Math.PI / 180;

/** The fields the inspector types, in its order: the field's name
 *  (`data-field`), its label and its unit. */
export const VIEWPOINT_FIELDS = [
  { field: "vp-north", label: "North", unit: "m" },
  { field: "vp-up", label: "Eye height", unit: "m" },
  { field: "vp-east", label: "East", unit: "m" },
  { field: "vp-facing", label: "Facing", unit: "deg" },
  { field: "vp-pitch", label: "Pitch", unit: "deg" },
  { field: "vp-lens", label: "Lens", unit: "deg" },
  { field: "vp-distance", label: "Depth", unit: "m" },
] as const;

/** What the inspector shows of a viewpoint. */
export interface ViewpointFacts {
  readonly northM: number;
  readonly upM: number;
  readonly eastM: number;
  /** Degrees clockwise from the station's north, 0 to 360. */
  readonly facingDeg: number;
  /** Degrees above the horizon (below: negative). */
  readonly pitchDeg: number;
  readonly lensDeg: number;
  readonly distanceM: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `deg` in 0 to 360. */
function wrap(deg: number): number {
  const turned = ((deg % 360) + 360) % 360;
  return 360 - turned < 1e-9 ? 0 : turned;
}

/** The turn that faces `facingDeg` (clockwise from north) and looks up by
 *  `pitchDeg`: a turn about up, then about the camera's own right. */
export function viewpointRotation(
  facingDeg: number,
  pitchDeg: number,
): [number, number, number, number] {
  // A turn about up by `yaw` takes the camera's -Z to the heading
  // `-(yaw) - 90`; so the heading `facing` is the yaw `-(facing + 90)`.
  const yaw = -(facingDeg + 90) * DEG;
  const pitch = pitchDeg * DEG;
  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  const sx = Math.sin(pitch / 2);
  const cx = Math.cos(pitch / 2);
  return [cy * sx, sy * cx, -sy * sx, cy * cx];
}

/** Where the camera with the turn `q` looks, in the station's frame. */
function forwardOf(q: readonly number[]): [number, number, number] {
  const [x = 0, y = 0, z = 0, w = 1] = q;
  return [
    -2 * (x * z + w * y),
    -2 * (y * z - w * x),
    -(1 - 2 * (x * x + y * y)),
  ];
}

/** What the inspector shows of `vp`. */
export function viewpointFacts(vp: TourPictureViewpoint): ViewpointFacts {
  const [north, up, east] = forwardOf(vp.rotation);
  const ground = Math.hypot(north, east);
  return {
    northM: vp.position[0],
    upM: vp.position[1],
    eastM: vp.position[2],
    facingDeg: ground < 1e-9 ? 0 : wrap(Math.atan2(east, north) / DEG),
    pitchDeg: Math.atan2(up, ground) / DEG,
    lensDeg: vp.hfovDeg,
    distanceM: vp.distanceM,
  };
}

/**
 * A first viewpoint for a picture standing at `pose` (in the station's
 * frame): `VIEWPOINT_STAND_BACK_M` in front of it on the ground, at eye
 * height, facing it level, its depth the way back, so the picture seen
 * from it hangs where the picture stood. A picture lying flat (its front
 * up or down) is stood in front of from the south, facing north.
 */
export function mintViewpoint(pose: StationPose): TourPictureViewpoint {
  const [px = 0, , pz = 0] = pose.position;
  const [x = 0, y = 0, z = 0, w = 1] = pose.rotation;
  // The picture's front, its local +Z turned.
  let north = 2 * (x * z + w * y);
  let east = 1 - 2 * (x * x + y * y);
  const ground = Math.hypot(north, east);
  if (!(ground > 1e-6) || !Number.isFinite(ground)) {
    north = -1;
    east = 0;
  } else {
    north /= ground;
    east /= ground;
  }
  const back = VIEWPOINT_STAND_BACK_M;
  const at: [number, number, number] = [
    (Number.isFinite(px) ? px : 0) + north * back,
    VIEWPOINT_EYE_M,
    (Number.isFinite(pz) ? pz : 0) + east * back,
  ];
  const facingDeg = wrap(Math.atan2(-east, -north) / DEG);
  return {
    position: at,
    rotation: viewpointRotation(facingDeg, 0),
    hfovDeg: VIEWPOINT_LENS_DEG,
    distanceM: back,
  };
}

/**
 * The pose of `vp`'s handle in the 3D view, in the station's frame: where
 * it stands, turned level so that its heading (its x axis, clockwise from
 * north, as every pose's heading is read) is the viewpoint's facing. The
 * handle's turn ring then turns the facing; its pitch is typed.
 */
export function viewpointPose(vp: TourPictureViewpoint): {
  readonly position: [number, number, number];
  readonly rotation: [number, number, number, number];
} {
  const half = (-viewpointFacts(vp).facingDeg * DEG) / 2;
  return {
    position: [vp.position[0], vp.position[1], vp.position[2]],
    rotation: [0, Math.sin(half), 0, Math.cos(half)],
  };
}

/**
 * `vp` stood where its handle was let go: at `pose`'s place (the
 * station's frame), facing `pose`'s heading, its pitch, lens and depth
 * kept. A pose whose heading cannot be read (its x axis straight up or
 * down) keeps the facing.
 */
export function viewpointAt(
  vp: TourPictureViewpoint,
  pose: StationPose,
): TourPictureViewpoint {
  const [n = 0, u = 0, e = 0] = pose.position;
  const [x = 0, y = 0, z = 0, w = 1] = pose.rotation;
  const north = 1 - 2 * (y * y + z * z);
  const east = 2 * (x * z - w * y);
  const facts = viewpointFacts(vp);
  const facingDeg =
    Math.hypot(north, east) < 1e-9
      ? facts.facingDeg
      : wrap(Math.atan2(east, north) / DEG);
  return {
    ...vp,
    position: [n, u, e],
    rotation: viewpointRotation(facingDeg, facts.pitchDeg),
  };
}

/**
 * `vp` with `field` typed as `value`: its place moved on one axis, turned
 * to a facing, tilted (within `VIEWPOINT_MAX_PITCH_DEG`), its lens or its
 * depth (within the format's bounds). Null for a field that is none of
 * them and a value that is no finite number.
 */
export function viewpointWithField(
  vp: TourPictureViewpoint,
  field: string,
  value: number,
): TourPictureViewpoint | null {
  if (!Number.isFinite(value)) return null;
  const facts = viewpointFacts(vp);
  const [n, u, e] = vp.position;
  switch (field) {
    case "vp-north":
      return { ...vp, position: [value, u, e] };
    case "vp-up":
      return { ...vp, position: [n, value, e] };
    case "vp-east":
      return { ...vp, position: [n, u, value] };
    case "vp-facing":
      return { ...vp, rotation: viewpointRotation(value, facts.pitchDeg) };
    case "vp-pitch": {
      const pitch = clamp(
        value,
        -VIEWPOINT_MAX_PITCH_DEG,
        VIEWPOINT_MAX_PITCH_DEG,
      );
      return { ...vp, rotation: viewpointRotation(facts.facingDeg, pitch) };
    }
    case "vp-lens":
      return {
        ...vp,
        hfovDeg: clamp(
          value,
          TOUR_PICTURE_MIN_HFOV_DEG,
          TOUR_PICTURE_MAX_HFOV_DEG,
        ),
      };
    case "vp-distance":
      return {
        ...vp,
        distanceM: clamp(
          value,
          TOUR_PICTURE_MIN_DISTANCE_M,
          TOUR_PICTURE_MAX_DISTANCE_M,
        ),
      };
    default:
      return null;
  }
}
