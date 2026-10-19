/**
 * Placed content (guided-setup plan M4, DEC-N7/N9): the pure half that
 * turns what the creator did in AR into `tour.json` records, and the
 * rendering both the creator's live preview and the visitor's session
 * share.
 *
 * FRAME CONTRACT. Every object stores an exact geo pose (lat, lon,
 * absolute altitude, a NUE unit quaternion) minted the way the printed
 * code's is:
 * - a PIN comes from the hit-test reticle, whose world position under the
 *   aligned world group is ALREADY GPS-world NUE (the framework's
 *   `startHitTestReticle` contract), so only `mintQrGeoPose` runs; its
 *   rotation is the identity (a sprite has no facing, but the record
 *   carries one so a later billboard type does);
 * - a PHOTO comes from the camera pose in RAW WebXR/odometry space, so it
 *   is composed through `alignment · WEBXR_TO_NUE · pose`
 *   (`qrWorldPoseFromOdom`, the leading-basis form that is right for a
 *   raw pose - the trailing form is for replayed state, and mixing them
 *   is the 90° yaw bug the geo-join review caught) and then minted. The
 *   plane's rotation is the camera's, so it faces back toward where the
 *   creator stood (`placeCapturedImagePlanes`'s window-back-in-time rule).
 *
 * Rendering places everything at the SCENE ROOT in the session's NUE
 * (`calcRelativeCoordsInMeters(zero, geo, alt, 0)`), the photo planes'
 * parenting rule - unless the caller hands its own parent and a pose per
 * object in that parent's frame (`poseOf`): the creator's previews of
 * THIS visit sit under the AR world group at their odometry pose, so they
 * stay rigid while GPS re-solves (authoring plan 2026-09-28-0953 §3.2, M2c).
 *
 * A version 3 tour (tour editor plan 2026-10-17-1816, W3) is played by
 * `renderTourStations`: one group per station at its geo pose, its pins
 * and photos children at their LOCAL poses, so a station moves them all.
 */

import { qrWorldPoseFromOdom } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { tourContentEntryName } from "gps-plus-slam-app-framework/ar/tour-archive";
import type { TourContentFields } from "gps-plus-slam-app-framework/ar/tour-items";
import type {
  TourObject,
  TourPhoto,
  TourPin,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import type { LatLong, Matrix4 } from "gps-plus-slam-app-framework/core";
import { Group, type Object3D, type Texture } from "three";

import { placeCapturedImagePlanes } from "./image-planes.js";

/** Ids are file stems (`content/<id>.jpg`) and must be unique in the
 *  manifest: 12 base-36 characters of randomness, path-safe by construction. */
export function newObjectId(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 12; i += 1) {
    id += alphabet[Math.floor(random() * alphabet.length)] ?? "a";
  }
  return id;
}

/** The identity: a pin has no facing of its own. */
const NO_ROTATION: readonly [number, number, number, number] = [0, 0, 0, 1];

/**
 * The NUE rotation of a vertical poster at compass heading `h`: the
 * rotation of -h about Up (the framework's `QrGeoOrientation` convention,
 * `qr-gps-vote.ts`). A hand-edited heading-only photo keeps its facing
 * instead of silently facing East (M4 review #9).
 */
export function rotationFromHeading(
  headingDeg: number,
): readonly [number, number, number, number] {
  const half = (-headingDeg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/**
 * A pin record from the reticle's GPS-world NUE position.
 *
 * @returns null when the zero is missing (no GPS fix yet) or the pose
 *   cannot be minted - the caller refuses the placement with a reason.
 */
export function mintPin(input: {
  id: string;
  label: string;
  worldNuePosition: { x: number; y: number; z: number };
  zero: LatLong | null;
  nowIso: string;
}): TourPin | null {
  if (input.zero === null) return null;
  try {
    const geo = mintQrGeoPose({
      worldNuePosition: input.worldNuePosition,
      worldNueRotation: [...NO_ROTATION],
      zero: input.zero,
    });
    return {
      id: input.id,
      kind: "pin",
      geo,
      createdAtIso: input.nowIso,
      label: input.label,
    };
  } catch {
    return null;
  }
}

/**
 * A photo record from the camera's RAW odometry pose at the capture.
 *
 * @returns null without an alignment or a zero, or when the pose cannot
 *   be minted.
 */
export function mintPhoto(input: {
  id: string;
  cameraPose: Pose;
  alignmentMatrix: Matrix4 | null;
  zero: LatLong | null;
  imageWidth: number;
  imageHeight: number;
  nowIso: string;
}): TourPhoto | null {
  if (input.zero === null || input.alignmentMatrix === null) return null;
  try {
    const world = qrWorldPoseFromOdom(input.cameraPose, input.alignmentMatrix);
    const geo = mintQrGeoPose({
      worldNuePosition: world.position,
      worldNueRotation: world.rotation,
      zero: input.zero,
    });
    return {
      id: input.id,
      kind: "photo",
      geo,
      createdAtIso: input.nowIso,
      image: tourContentEntryName(input.id, "jpg"),
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
    };
  } catch {
    return null;
  }
}

/** An object's pose in one NUE frame: the renderer's input shape. */
interface ObjectPoseNue {
  positionNue: readonly [number, number, number];
  rotationNue: readonly [number, number, number, number];
}

/** An object's pose in a session's NUE frame. */
export function objectPoseNue(geo: QrGeoPose, zero: LatLong): ObjectPoseNue {
  const nue = calcRelativeCoordsInMeters(
    zero,
    { lat: geo.lat, lon: geo.lon },
    geo.alt,
    0,
  );
  return {
    positionNue: [nue[0], nue[1], nue[2]],
    rotationNue:
      geo.rotation ??
      (geo.headingDeg === undefined
        ? NO_ROTATION
        : rotationFromHeading(geo.headingDeg)),
  };
}

/** What the renderer needs from the outside: a label object per pin (the
 *  framework's text sprite in production, a stub under test - node has no
 *  canvas) and a photo texture per photo entry name. */
export interface TourObjectRendererDeps {
  /** The parent the objects are added to (the scene root, unless
   *  `poseOf` says otherwise). */
  scene: Object3D;
  zero: LatLong;
  /**
   * An object's pose in `scene`'s own frame, overriding the geo-derived
   * one (`objectPoseNue`, which is right for the scene root only). The
   * creator's rigid previews pass the world-group-local odometry pose.
   */
  poseOf?: (object: TourObject) => ObjectPoseNue;
  makeLabel(text: string): { object: Object3D; dispose(): void };
  loadPhotoTexture(entryName: string): Promise<Texture | null>;
}

export interface RenderedTourObjects {
  /** Objects actually placed (a photo whose texture failed is left out). */
  count: number;
  /** Ids of objects that could not be rendered, for the status line. */
  skipped: string[];
  /** The one group every rendered object hangs under: what a tap in AR
   *  is cast against to name the object (`object-pick.ts`, authoring plan
   *  2026-09-28-0953 M4). */
  root: Object3D;
  dispose(): void;
}

/**
 * Place `objects` at the scene root in the session's NUE. Photos are
 * decoded first (async); a failed decode leaves that object out and names
 * it in `skipped` (the null-tolerance rule of the levels, made visible).
 */
export function renderTourObjects(
  objects: readonly TourObject[],
  deps: TourObjectRendererDeps,
): Promise<RenderedTourObjects> {
  const { poseOf } = deps;
  return renderContent(objects, {
    ...deps,
    poseOf: (object) =>
      poseOf?.(object) ?? objectPoseNue(object.geo, deps.zero),
  });
}

/** What `renderTourStations` needs: the renderer's, without a pose rule
 *  (a station's items carry their own). */
export type TourStationRendererDeps = Omit<TourObjectRendererDeps, "poseOf">;

/**
 * Play a version 3 tour's stations (tour editor plan W3): under ONE root
 * group, each station with items as a group at its geo pose in the
 * session's NUE (`objectPoseNue`), and its pins and photos as children at
 * their local poses. A station without items draws nothing. The root is
 * added to the scene once every photo decoded (M5 review #6's rule).
 *
 * The station's group stands in the session's tangent plane, the items in
 * the station's: for a zero within a kilometre the two agree to well under
 * a centimetre (`content-placement.test.ts`, swept).
 */
export async function renderTourStations(
  stations: readonly TourStation[],
  deps: TourStationRendererDeps,
): Promise<RenderedTourObjects> {
  const root = new Group();
  const parts: RenderedTourObjects[] = [];
  for (const station of stations) {
    if (station.items.length === 0) continue;
    const frame = new Group();
    const at = objectPoseNue(station.geo, deps.zero);
    frame.position.set(...at.positionNue);
    frame.quaternion.set(...at.rotationNue);
    root.add(frame);
    const poses = new Map(station.items.map((item) => [item.id, item.pose]));
    parts.push(
      await renderContent(station.items, {
        ...deps,
        scene: frame,
        poseOf: (item) => {
          const pose = poses.get(item.id)!;
          return { positionNue: pose.position, rotationNue: pose.rotation };
        },
      }),
    );
  }
  deps.scene.add(root);
  return {
    count: parts.reduce((sum, part) => sum + part.count, 0),
    skipped: parts.flatMap((part) => part.skipped),
    root,
    dispose: () => {
      root.removeFromParent();
      deps.scene.remove(root);
      for (const part of parts) part.dispose();
    },
  };
}

/** The one renderer: pins as labels, photos as planes, each at `poseOf`
 *  in `scene`'s frame, under one group added once everything decoded. */
async function renderContent<T extends TourContentFields>(
  objects: readonly T[],
  deps: Omit<TourObjectRendererDeps, "poseOf"> & {
    poseOf: (object: T) => ObjectPoseNue;
  },
): Promise<RenderedTourObjects> {
  const labels: { object: Object3D; dispose(): void }[] = [];
  const photoPoses: ObjectPoseNue[] = [];
  const textures: Texture[] = [];
  const skipped: string[] = [];
  // One group, added to the scene only once everything decoded (M5 review
  // #6): pins used to land one by one while photos trickled in, and a
  // session ending mid-run left them in the scene with no owner. Photos
  // decode one at a time on purpose - a long tour's textures are a
  // GPU-memory hazard, and decoding them all at once doubles the peak.
  const group = new Group();
  for (const object of objects) {
    const pose = deps.poseOf(object);
    if (object.kind === "pin") {
      const label = deps.makeLabel(object.label);
      label.object.position.set(...pose.positionNue);
      group.add(label.object);
      labels.push(label);
      continue;
    }
    if (object.kind === "model") {
      // No renderer draws a placed model yet (format minor 1): left out
      // quietly, as a lenient read leaves out what it cannot show. Not in
      // `skipped`: "could not load" would claim a download failed.
      continue;
    }
    const texture = await deps
      .loadPhotoTexture(object.image)
      .catch((): Texture | null => null);
    if (texture === null) {
      skipped.push(object.id);
      continue;
    }
    photoPoses.push(pose);
    textures.push(texture);
  }
  const planes = placeCapturedImagePlanes({
    scene: group,
    poses: photoPoses,
    textures,
  });
  deps.scene.add(group);
  return {
    count: labels.length + planes.count,
    root: group,
    skipped,
    dispose: () => {
      // From whatever holds it now - the creator's previews move a group
      // between frames (code book plan M5b) - and from the node it was
      // added to (the e2e fakes' nodes set no `parent`).
      group.removeFromParent();
      deps.scene.remove(group);
      for (const label of labels) label.dispose();
      planes.dispose();
    },
  };
}
