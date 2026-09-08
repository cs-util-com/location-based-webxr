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
 * parenting rule.
 */

import { qrWorldPoseFromOdom } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { tourContentEntryName } from "gps-plus-slam-app-framework/ar/tour-archive";
import type {
  TourObject,
  TourPhoto,
  TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import type { LatLong, Matrix4 } from "gps-plus-slam-app-framework/core";
import type { Object3D, Texture } from "three";

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

/** An object's pose in a session's NUE frame. */
export function objectPoseNue(
  geo: QrGeoPose,
  zero: LatLong,
): {
  positionNue: readonly [number, number, number];
  rotationNue: readonly [number, number, number, number];
} {
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
  scene: Object3D;
  zero: LatLong;
  makeLabel(text: string): { object: Object3D; dispose(): void };
  loadPhotoTexture(entryName: string): Promise<Texture | null>;
}

export interface RenderedTourObjects {
  /** Objects actually placed (a photo whose texture failed is left out). */
  count: number;
  /** Ids of objects that could not be rendered, for the status line. */
  skipped: string[];
  dispose(): void;
}

/**
 * Place `objects` at the scene root in the session's NUE. Photos are
 * decoded first (async); a failed decode leaves that object out and names
 * it in `skipped` (the null-tolerance rule of the levels, made visible).
 */
export async function renderTourObjects(
  objects: readonly TourObject[],
  deps: TourObjectRendererDeps,
): Promise<RenderedTourObjects> {
  const labels: { object: Object3D; dispose(): void }[] = [];
  const photoPoses: ReturnType<typeof objectPoseNue>[] = [];
  const textures: Texture[] = [];
  const skipped: string[] = [];
  for (const object of objects) {
    const pose = objectPoseNue(object.geo, deps.zero);
    if (object.kind === "pin") {
      const label = deps.makeLabel(object.label);
      label.object.position.set(...pose.positionNue);
      deps.scene.add(label.object);
      labels.push(label);
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
    scene: deps.scene,
    poses: photoPoses,
    textures,
  });
  return {
    count: labels.length + planes.count,
    skipped,
    dispose: () => {
      for (const label of labels) {
        deps.scene.remove(label.object);
        label.dispose();
      }
      planes.dispose();
    },
  };
}
