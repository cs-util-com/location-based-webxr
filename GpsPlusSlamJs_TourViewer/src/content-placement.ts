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
 * A tour is played one station at a time by `renderTourStation`: a group
 * at the station's geo pose, its FREE blocks (pins, pictures' planes,
 * placed models when the caller can load one) children at their LOCAL
 * poses, so a station moves them all. A block a
 * story step shows is the story's, never drawn here. The visitor's page
 * renders a station only while its content shows (visitor plan
 * 2026-10-18-2349 M2, `station-content.ts`).
 *
 * A pin is a short text in the `pin` view; a captured photo is a picture
 * in the `plane` view plus an image asset of the picture's own id (its
 * bytes at `content/<id>.jpg`), carried inline until a tour lists it.
 */

import { qrWorldPoseFromOdom } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { mintQrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { tourContentEntryName } from "gps-plus-slam-app-framework/ar/tour-archive";
import type {
  TourAsset,
  TourBlock,
  TourObject,
  TourPicture,
  TourPin,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import type { LatLong, Matrix4 } from "gps-plus-slam-app-framework/core";
import { disposeObject3D } from "gps-plus-slam-app-framework/visualization/three-dispose";
import { Group, type Object3D, type Texture } from "three";

import { placeCapturedImagePlanes } from "./image-planes.js";
import { modelScale } from "./model-scale.js";

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

/** A captured photo's width in the world: the photo plane's own
 *  (`image-planes.ts`), so a capture looks as it always did. */
const CAPTURED_PICTURE_WIDTH_M = 1;

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
 * A pin (a short text in the `pin` view, `label` its caption) from the
 * reticle's GPS-world NUE position.
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
      kind: "shortText",
      view: "pin",
      geo,
      createdAtIso: input.nowIso,
      caption: input.label,
    };
  } catch {
    return null;
  }
}

/**
 * A captured photo from the camera's RAW odometry pose at the capture: a
 * picture in the `plane` view, `CAPTURED_PICTURE_WIDTH_M` wide, whose
 * image asset (inline, `imageAsset`) has the picture's own id and the
 * JPEG's entry `content/<id>.jpg`.
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
}): TourPicture | null {
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
      kind: "picture",
      view: "plane",
      geo,
      createdAtIso: input.nowIso,
      image: input.id,
      widthM: CAPTURED_PICTURE_WIDTH_M,
      imageAsset: {
        id: input.id,
        path: tourContentEntryName(input.id, "jpg"),
        kind: "image",
        width: input.imageWidth,
        height: input.imageHeight,
      },
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
  return renderContent(
    objects.map((object) => ({
      drawn: drawnObject(object),
      pose: poseOf?.(object) ?? objectPoseNue(object.geo, deps.zero),
    })),
    deps,
  );
}

/** What `renderTourStation` needs: the renderer's, without a pose rule
 *  (a station's blocks carry their own), the tour's assets (a picture
 *  names its image asset), and whether the result is still wanted: once
 *  `alive()` turns false the pictures left are not decoded (the caller
 *  disposes what came back). */
export type TourStationRendererDeps = Omit<TourObjectRendererDeps, "poseOf"> & {
  readonly assets: readonly TourAsset[];
  readonly alive?: () => boolean;
  /**
   * A placed model's `.glb` by its archive entry, as a three scene (the
   * visitor: the open tour's read and `loadGlbModel`, station blocks plan
   * B2b). Absent: a placed model is left out quietly, as before (the 3D
   * editor draws its own models on the group).
   */
  readonly loadModel?: (entryName: string) => Promise<Object3D | null>;
};

/**
 * Play one station of a tour: a group at the station's geo pose in the
 * session's NUE (`objectPoseNue`), its free blocks (pins and pictures) as
 * children at their local poses, added to `deps.scene` once every picture
 * decoded (M5 review #6's rule). The result's `root` is that group; a
 * station without free blocks gives an empty one. A picture whose asset
 * the tour lacks is named in `skipped`, as one whose file fails.
 *
 * The station's group stands in the session's tangent plane, the blocks
 * in the station's: for a zero within a kilometre the two agree to well
 * under a centimetre (`content-placement.test.ts`, swept).
 */
export function renderTourStation(
  station: Pick<TourStation, "geo" | "blocks" | "steps">,
  deps: TourStationRendererDeps,
): Promise<RenderedTourObjects> {
  return renderStationBlocks(station, tourFreeBlocks(station), deps);
}

/**
 * `blocks` of `station` as `renderTourStation` draws its free blocks: a
 * group at the station's geo pose, each block at its local pose. The
 * visitor draws a story block its story reached this way (station blocks
 * plan B2b, `shown-blocks.ts`).
 */
export async function renderStationBlocks(
  station: Pick<TourStation, "geo">,
  blocks: readonly TourBlock[],
  deps: TourStationRendererDeps,
): Promise<RenderedTourObjects> {
  const frame = new Group();
  const at = objectPoseNue(station.geo, deps.zero);
  frame.position.set(...at.positionNue);
  frame.quaternion.set(...at.rotationNue);
  const paths = new Map(deps.assets.map((a) => [a.id, a.path]));
  const part = await renderContent(
    blocks.map((block) => ({
      drawn: drawnBlock(block, paths),
      pose: {
        positionNue: block.pose.position,
        rotationNue: block.pose.rotation,
      },
    })),
    { ...deps, scene: frame },
  );
  deps.scene.add(frame);
  return {
    count: part.count,
    skipped: part.skipped,
    root: frame,
    dispose: () => {
      frame.removeFromParent();
      deps.scene.remove(frame);
      part.dispose();
    },
  };
}

/** What the renderer draws of one free block: a label with its text, a
 *  plane with its picture's archive entry, a placed model with its file's
 *  entry and its size (null entry: the tour lacks its asset), or nothing. */
type Drawn =
  | { readonly id: string; readonly as: "label"; readonly text: string }
  | { readonly id: string; readonly as: "plane"; readonly entry: string | null }
  | {
      readonly id: string;
      readonly as: "model";
      readonly entry: string | null;
      readonly sizeM: number;
    }
  | { readonly id: string; readonly as: "none" };

/** A world-view object as drawn: a picture's file is its inline asset. */
function drawnObject(object: TourObject): Drawn {
  switch (object.kind) {
    case "shortText":
      return { id: object.id, as: "label", text: object.caption };
    case "picture":
      return { id: object.id, as: "plane", entry: object.imageAsset.path };
    case "model":
      return { id: object.id, as: "none" };
  }
}

/** A station's free block as drawn: a picture's file is the tour's asset
 *  of its `image`. A block in a view no world drawing has is nothing. */
function drawnBlock(
  block: TourBlock,
  paths: ReadonlyMap<string, string>,
): Drawn {
  if (block.kind === "shortText" && block.view === "pin") {
    return { id: block.id, as: "label", text: block.caption };
  }
  if (block.kind === "picture" && block.view === "plane") {
    return { id: block.id, as: "plane", entry: paths.get(block.image) ?? null };
  }
  if (
    block.kind === "model" &&
    block.view === "placed" &&
    block.sizeM !== undefined
  ) {
    return {
      id: block.id,
      as: "model",
      entry: paths.get(block.asset) ?? null,
      sizeM: block.sizeM,
    };
  }
  return { id: block.id, as: "none" };
}

/** The one renderer: pins as labels, pictures as planes, placed models at
 *  their size (`modelScale`), each at its pose in `scene`'s frame, under
 *  one group added once everything decoded. */
async function renderContent(
  objects: readonly { readonly drawn: Drawn; readonly pose: ObjectPoseNue }[],
  deps: Omit<TourObjectRendererDeps, "poseOf"> & {
    alive?: () => boolean;
    loadModel?: TourStationRendererDeps["loadModel"];
  },
): Promise<RenderedTourObjects> {
  const labels: { object: Object3D; dispose(): void }[] = [];
  const models: Object3D[] = [];
  const photoPoses: ObjectPoseNue[] = [];
  const photoIds: string[] = [];
  const textures: Texture[] = [];
  const skipped: string[] = [];
  // One group, added to the scene only once everything decoded (M5 review
  // #6): pins used to land one by one while photos trickled in, and a
  // session ending mid-run left them in the scene with no owner. Photos
  // decode one at a time on purpose - a long tour's textures are a
  // GPU-memory hazard, and decoding them all at once doubles the peak.
  const group = new Group();
  let planes: ReturnType<typeof placeCapturedImagePlanes>;
  try {
    for (const { drawn, pose } of objects) {
      // Dropped meanwhile (the station's content no longer shows): decode
      // nothing more; the caller disposes what came back.
      if (deps.alive?.() === false) break;
      if (drawn.as === "label") {
        const label = deps.makeLabel(drawn.text);
        label.object.position.set(...pose.positionNue);
        // Names its block: the 3D editor picks and previews by it.
        label.object.userData["objectId"] = drawn.id;
        group.add(label.object);
        labels.push(label);
        continue;
      }
      if (drawn.as === "none" || (drawn.as === "model" && !deps.loadModel)) {
        // Nothing this renderer draws (or a model with no loader: the 3D
        // editor draws its own): left out quietly, as a lenient read
        // leaves out what it cannot show. Not in `skipped`: "could not
        // load" would claim a download failed.
        continue;
      }
      if (drawn.as === "model") {
        const model =
          drawn.entry === null
            ? null
            : await deps
                .loadModel?.(drawn.entry)
                .catch((): Object3D | null => null);
        if (model === null || model === undefined) {
          skipped.push(drawn.id);
          continue;
        }
        // The size the tour names, by the one rule every page shares.
        model.scale.setScalar(modelScale(model, drawn.sizeM));
        model.position.set(...pose.positionNue);
        model.quaternion.set(...pose.rotationNue);
        model.userData["objectId"] = drawn.id;
        models.push(model);
        continue;
      }
      const texture =
        drawn.entry === null
          ? null
          : await deps
              .loadPhotoTexture(drawn.entry)
              .catch((): Texture | null => null);
      if (texture === null) {
        skipped.push(drawn.id);
        continue;
      }
      photoPoses.push(pose);
      photoIds.push(drawn.id);
      textures.push(texture);
    }
    planes = placeCapturedImagePlanes({
      scene: group,
      poses: photoPoses,
      textures,
    });
    // The planes follow the labels, one per photo in order.
    group.children.slice(labels.length).forEach((plane, i) => {
      const id = photoIds[i];
      if (id !== undefined) plane.userData["objectId"] = id;
    });
    // The models after the planes, so the planes' order above holds.
    for (const model of models) group.add(model);
  } catch (error) {
    // A constructor that throws half way (a label without a canvas) must
    // not strand what was made before it: a station is drawn and freed
    // again as the visitor walks.
    for (const label of labels) label.dispose();
    for (const texture of textures) texture.dispose();
    for (const model of models) disposeObject3D(model);
    throw error;
  }
  deps.scene.add(group);
  return {
    count: labels.length + planes.count + models.length,
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
      for (const model of models) disposeObject3D(model);
    },
  };
}
