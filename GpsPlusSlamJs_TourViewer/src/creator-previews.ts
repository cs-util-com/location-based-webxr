/**
 * The creator's previews of the tour's objects (code book refactor plan M2,
 * split out of `creator-setup.ts` unchanged): each object rendered by id,
 * rigid in AR when placed in this visit and from geo otherwise, inside the
 * earlier visits' frame that a sighting of the code moves; and the bytes of
 * photos a Finish took out of the placed list.
 *
 * @see creator-previews.ts.md
 */

import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import type { LatLong } from "gps-plus-slam-app-framework/core";
import { selectZeroReference } from "gps-plus-slam-app-framework/state";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";
import { Group, type Object3D } from "three";
import {
  renderTourObjects,
  type TourObjectRendererDeps,
} from "./content-placement.js";
import type { AuthoringObject } from "./object-editing.js";
import type { TourViewerSeams } from "./seams.js";
import type {
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";

/** What a settle chose, as far as the earlier visits' frame cares. */
type EarlierChoice = {
  readonly basis: string;
  readonly alignment: readonly number[];
} | null;

export interface CreatorPreviews {
  /** Bring the previews in line with the tour's objects now. */
  sync(): void;
  /** The last sync found no zero: sync again once it lands. */
  waitingForZero(): boolean;
  /** A creator's AR visit began (`scene` is the session's). */
  beginVisit(scene: Object3D): void;
  /** A visit ended: what the previews were made from, and the frame, go
   *  (the previews themselves are disposed by the entry's teardown). */
  endVisit(): void;
  /** A visit is running (its earlier-visits frame exists). */
  inVisit(): boolean;
  /** Move the earlier visits' frame for this visit's choice. */
  placeEarlier(choice: EarlierChoice): void;
  /** Keep a finished photo's bytes for its preview. */
  keepFinishedPhoto(id: string, blob: Blob): void;
  /** A tour closed: its previews and kept photo bytes go. */
  reset(): void;
}

export function wireCreatorPreviews(deps: {
  ctx: TourViewerSession;
  arStore: Pick<TourViewerStore, "getState">;
  seams: Pick<TourViewerSeams, "getScene" | "getArWorldGroup" | "createLabel">;
  /** A visitor renders no previews. */
  creator: boolean;
  /** The tour's objects now (`object-editing.ts`'s `objects`). */
  objects: () => readonly AuthoringObject[];
  /** Decodes a photo's bytes into a texture; `decodeFrameTexture` unless a
   *  test injects one (node cannot decode). */
  decodePhoto?: typeof decodeFrameTexture;
}): CreatorPreviews {
  const { ctx, arStore, seams, creator } = deps;
  const decodePhoto = deps.decodePhoto ?? decodeFrameTexture;
  /** A preview sync found no zero yet (see `syncPreviews`): the store
   *  subscription runs it again once the zero lands. */
  let previewsWaitForZero = false;

  /**
   * The frame the earlier visits' objects are shown in during this AR visit
   * (plan §3.2 "Earlier visits' objects on re-entry"): at the scene root
   * with the identity while they can only be placed from geo, under the AR
   * world group with the corrected alignment's inverse once the code has
   * been seen - which puts each where the code says, rigid in AR, because
   * the corrected alignment does not depend on the visit's GPS alignment
   * (`visit-anchoring.ts`). Null outside a visit.
   */
  let earlierFrame: Group | null = null;

  /** Where `earlierFrame` is attached. Tracked, not read from `parent`:
   *  the e2e fakes' scene nodes do not set it. */
  let earlierFrameUnderGroup = false;

  /**
   * Where a preview goes. An object placed in THIS visit is RIGID in AR
   * (decision D2): under the world group at its odometry pose, where GPS
   * re-solves move it together with the camera. Anything else has only its
   * geo and is placed from it in `fromGeo` - the earlier visits' frame, or
   * the scene root outside a visit (plan §3.2).
   */
  function previewFrame(
    placement: (typeof ctx.placedObjects)[number]["placement"],
    fromGeo: Object3D,
  ): Pick<TourObjectRendererDeps, "scene" | "poseOf"> {
    const group = seams.getArWorldGroup();
    if (
      placement === undefined ||
      placement.visit !== ctx.arSessionGeneration ||
      group === null
    ) {
      return { scene: fromGeo };
    }
    const { position, rotation } = placement.local;
    return {
      scene: group,
      poseOf: () => ({ positionNue: position, rotationNue: rotation }),
    };
  }

  /**
   * What each preview was rendered from, by object id (authoring plan
   * 2026-09-28-0953 §3.4, M4): its look and where its pose comes from. A
   * preview whose key no longer matches is replaced; one whose object is
   * gone (deleted, or its tour closed) is disposed. Emptied with the
   * previews at each visit's end - the next visit renders everything again.
   */
  const previewKeys = new Map<string, string>();
  /**
   * The bytes of photos a Finish took out of `placedObjects`: the hosted
   * zip does not carry them until the creator uploads the rebuilt one, so
   * their preview reads them from here. Emptied when the tour closes.
   */
  const finishedPhotoBlobs = new Map<string, Blob>();

  function previewKey(entry: AuthoringObject): string {
    const { object } = entry;
    const placement = entry.placed?.placement;
    const rigid =
      placement !== undefined && placement.visit === ctx.arSessionGeneration;
    return JSON.stringify([
      object.kind,
      object.kind === "pin" ? object.label : object.image,
      rigid ? placement.local : object.geo,
    ]);
  }

  /** Dispose every preview and forget what they were made from. */
  function clearPreviews(): void {
    previewKeys.clear();
    for (const preview of ctx.placedPreviews.values()) preview.dispose();
    ctx.placedPreviews.clear();
  }

  /**
   * Bring the previews in line with the tour's objects now - this device's
   * AND the hosted zip's (M4: an author reopening a tour used to see none
   * of what was already there), keyed by id. Incremental: an object whose
   * preview still matches is left alone, so each placement decodes only
   * its own photo and two placements cannot race each other's disposal
   * (M4 review #7 of the guided-setup plan).
   */
  function syncPreviews(): void {
    const scene = seams.getScene();
    if (!creator || scene === null) return;
    const desired = new Map(
      deps.objects().map((entry) => [entry.object.id, entry]),
    );
    dropStalePreviews(desired);
    const zero = selectZeroReference(arStore.getState());
    // Placed from geo, which needs the zero - and on the first visit of a
    // page load (a restored draft) the zero comes with the first GPS fix,
    // after the visit began. Rendered when it lands (M2c review #4).
    previewsWaitForZero = zero === null;
    if (zero === null) return;
    for (const entry of desired.values()) {
      if (!previewKeys.has(entry.object.id)) {
        renderPreview(entry, zero, earlierFrame ?? scene);
      }
    }
  }

  /** Dispose each preview whose object is gone or no longer looks or sits
   *  as it was rendered. */
  function dropStalePreviews(
    desired: ReadonlyMap<string, AuthoringObject>,
  ): void {
    for (const [id, key] of previewKeys) {
      const entry = desired.get(id);
      if (entry !== undefined && previewKey(entry) === key) continue;
      previewKeys.delete(id);
      ctx.placedPreviews.get(id)?.dispose();
      ctx.placedPreviews.delete(id);
    }
  }

  function renderPreview(
    entry: AuthoringObject,
    zero: LatLong,
    fromGeo: Object3D,
  ): void {
    const id = entry.object.id;
    const key = previewKey(entry);
    previewKeys.set(id, key);
    const generation = ctx.arSessionGeneration;
    const blob = entry.placed?.blob ?? finishedPhotoBlobs.get(id);
    const session = ctx.session;
    void renderTourObjects([entry.object], {
      ...previewFrame(entry.placed?.placement, fromGeo),
      zero,
      makeLabel: (text) => seams.createLabel(text),
      loadPhotoTexture: async (image) => {
        // This device's bytes first; a hosted photo's come from the zip,
        // through the session (it knows the folder the manifest sits in).
        if (blob !== undefined) return decodePhoto(blob, 2);
        if (session === null) return null;
        // A tour image is measured before it is decoded (K4 review R2).
        return decodePhoto(await session.loadContentEntry(image), 2, {
          maxPixels: TOUR_MAX_IMAGE_PIXELS,
        });
      },
    }).then(
      (rendered) => {
        // The session may have ended while the photo decoded, or the
        // object changed or went away meanwhile.
        if (
          generation !== ctx.arSessionGeneration ||
          previewKeys.get(id) !== key
        ) {
          rendered.dispose();
          return;
        }
        ctx.placedPreviews.get(id)?.dispose();
        ctx.placedPreviews.set(id, rendered);
      },
      () => {
        // A throwing label or plane: forget it, so a later sync may retry.
        if (previewKeys.get(id) === key) previewKeys.delete(id);
      },
    );
  }

  /** Move the earlier visits' frame to where this visit's knowledge of the
   *  code puts it (see `earlierFrame`): under the world group with the
   *  corrected alignment's inverse, else at the scene root. Cheap: one
   *  matrix. */
  function placeEarlier(choice: EarlierChoice): void {
    const frame = earlierFrame;
    const scene = seams.getScene();
    if (frame === null || scene === null) return;
    const group = seams.getArWorldGroup();
    if (choice?.basis === "code-corrected" && group !== null) {
      frame.matrix.fromArray(choice.alignment).invert();
      frame.matrixWorldNeedsUpdate = true;
      if (!earlierFrameUnderGroup) {
        scene.remove(frame);
        group.add(frame);
        earlierFrameUnderGroup = true;
      }
      return;
    }
    frame.matrix.identity();
    frame.matrixWorldNeedsUpdate = true;
    if (earlierFrameUnderGroup) {
      group?.remove(frame);
      scene.add(frame);
      earlierFrameUnderGroup = false;
    }
  }

  /** A creator's AR visit began: a fresh earlier-visits frame at the scene
   *  root, and every preview rendered afresh into this visit's frames. */
  function beginVisit(scene: Object3D): void {
    earlierFrame = new Group();
    earlierFrame.name = "earlier-visits";
    earlierFrame.matrixAutoUpdate = false;
    earlierFrameUnderGroup = false;
    scene.add(earlierFrame);
    // Everything is rendered afresh into this visit's frames - the
    // hosted zip's objects too (M4) - keyed by id.
    clearPreviews();
    syncPreviews();
  }

  return {
    sync: syncPreviews,
    waitingForZero: () => previewsWaitForZero,
    beginVisit,
    endVisit: () => {
      previewsWaitForZero = false;
      // The previews are disposed by the entry's teardown right after this
      // (`placedPreviews`); what they were made from goes now, so the next
      // visit renders everything again. The frame itself is this module's.
      previewKeys.clear();
      earlierFrame?.removeFromParent();
      earlierFrame = null;
    },
    inVisit: () => earlierFrame !== null,
    placeEarlier,
    keepFinishedPhoto: (id, blob) => {
      finishedPhotoBlobs.set(id, blob);
    },
    reset: () => {
      clearPreviews();
      finishedPhotoBlobs.clear();
    },
  };
}
