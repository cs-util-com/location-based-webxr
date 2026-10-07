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
import { horizontalM } from "./move-with-code.js";
import type { AuthoringObject } from "./object-editing.js";
import type { TourViewerSeams } from "./seams.js";
import type {
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";

/**
 * A code this visit sighted with an accepted correction (code book plan
 * M5b): the earlier visits' objects nearest it are drawn through it.
 */
interface EarlierCodeFrame {
  readonly levelId: string;
  /** The code's corrected alignment for this visit (GPS-world from
   *  odometry). */
  readonly alignment: readonly number[];
  /** The code's stored pose: which objects are nearest it. */
  readonly geo: LatLong;
}

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
  /** Draw the earlier visits' objects through the frames of the codes this
   *  visit sighted, each object through the code nearest it (M5b); none:
   *  from geo at the scene root. */
  placeEarlier(frames: readonly EarlierCodeFrame[]): void;
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

  /**
   * One frame per code this visit sighted with an accepted correction (code
   * book plan M5b), under the AR world group with that code's corrected
   * alignment's inverse. `earlierFrame` stays at the scene root for the
   * objects no such code is nearest to (none sighted yet).
   */
  const codeFrames = new Map<
    string,
    { readonly group: Group; geo: EarlierCodeFrame["geo"] }
  >();

  /** Where an object that is not rigid in AR is drawn: the frame of the
   *  sighted code nearest it, horizontally; "plain" without one. No reach
   *  limit: with one code every object stays in its frame, as before. */
  function frameKeyOf(geo: EarlierCodeFrame["geo"]): string {
    let best = "plain";
    let bestM = Number.POSITIVE_INFINITY;
    for (const [levelId, frame] of codeFrames) {
      const m = horizontalM(frame.geo, geo);
      if (m < bestM) {
        best = levelId;
        bestM = m;
      }
    }
    return best;
  }

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
      // The frame it is drawn in: a change re-renders it there (M5b).
      rigid ? "rigid" : frameKeyOf(object.geo),
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
        const frame = codeFrames.get(frameKeyOf(entry.object.geo))?.group;
        renderPreview(entry, zero, frame ?? earlierFrame ?? scene);
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

  /**
   * Draw the earlier visits' objects through the codes this visit sighted
   * (code book plan M5b): one frame per code, under the world group with
   * the code's corrected alignment's inverse - rigid in AR, where the code
   * says - and each object in the frame of the code nearest it. A code no
   * longer listed loses its frame; an object whose nearest code changed is
   * drawn again in its new frame (its preview key names the frame). Cheap
   * while nothing is reassigned: one matrix per code.
   */
  function placeEarlier(frames: readonly EarlierCodeFrame[]): void {
    if (earlierFrame === null || seams.getScene() === null) return;
    const group = seams.getArWorldGroup();
    const listed = group === null ? [] : frames;
    const keep = new Set(listed.map((f) => f.levelId));
    for (const [levelId, frame] of codeFrames) {
      if (keep.has(levelId)) continue;
      frame.group.removeFromParent();
      codeFrames.delete(levelId);
    }
    for (const f of listed) {
      let frame = codeFrames.get(f.levelId);
      if (frame === undefined) {
        const node = new Group();
        node.name = `earlier-visits-${f.levelId}`;
        node.matrixAutoUpdate = false;
        group?.add(node);
        frame = { group: node, geo: f.geo };
        codeFrames.set(f.levelId, frame);
      }
      frame.geo = f.geo;
      frame.group.matrix.fromArray(f.alignment).invert();
      frame.group.matrixWorldNeedsUpdate = true;
    }
    syncPreviews();
  }

  /** A creator's AR visit began: a fresh earlier-visits frame at the scene
   *  root, and every preview rendered afresh into this visit's frames. */
  function beginVisit(scene: Object3D): void {
    earlierFrame = new Group();
    earlierFrame.name = "earlier-visits";
    earlierFrame.matrixAutoUpdate = false;
    scene.add(earlierFrame);
    for (const frame of codeFrames.values()) frame.group.removeFromParent();
    codeFrames.clear();
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
      for (const frame of codeFrames.values()) frame.group.removeFromParent();
      codeFrames.clear();
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
