/**
 * Placing a pin or a photo in AR (code book refactor plan M2, split out of
 * `creator-setup.ts` unchanged; guided-setup plan M4, DEC-N9): the gate a
 * placement needs, the pin's label input, the photo's capture, and the
 * troubleshooting recording's record of each placement.
 *
 * @see creator-placement.ts.md
 */

import type { CapturedCameraFrame } from "gps-plus-slam-app-framework/ar/captured-camera-frame";
import {
  MIN_ALIGNMENT_SAMPLES,
  type MintAlignmentInfo,
} from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type {
  TourObject,
  TourPhoto,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { LatLong, Matrix4 } from "gps-plus-slam-app-framework/core";
import {
  selectAlignmentMatrix,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { Vector3 } from "three";
import { mintPhoto, mintPin, newObjectId } from "./content-placement.js";
import type { CreatorAlignmentPicks } from "./creator-alignment-picks.js";
import type { CreatorCodes } from "./creator-codes.js";
import type { CreatorDraft } from "./creator-draft.js";
import type { CreatorPreviews } from "./creator-previews.js";
import { usablePhotoFrame } from "./photo-frame.js";
import type { TourViewerSeams } from "./seams.js";
import { objectPlaced } from "./tour-authoring-actions.js";
import type {
  ArController,
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";
import { odomNueFromWebXr } from "./visit-anchoring.js";

/** The placement controls, inside `#setup-controls`. */
export interface CreatorPlacementDom {
  pinButton: HTMLButtonElement;
  pinLabel: HTMLInputElement;
  pinSave: HTMLButtonElement;
  pinCancel: HTMLButtonElement;
  photoButton: HTMLButtonElement;
}

export interface CreatorPlacement {
  /** Placement is allowed now (re-checked at every tap). */
  allowed(): boolean;
  /** Enable the pin and photo buttons, hiding the label input when not. */
  renderButtons(): void;
  /** " · N objects placed" for the readout, or "" with none. */
  countLine(): string;
}

export function wireCreatorPlacement(deps: {
  ctx: TourViewerSession;
  arStore: Pick<TourViewerStore, "getState" | "dispatch">;
  arController: Pick<ArController, "getState">;
  seams: Pick<TourViewerSeams, "getArWorldGroup" | "encodeFrameJpeg">;
  dom: CreatorPlacementDom;
  alignmentPicks: Pick<CreatorAlignmentPicks, "notePlaced">;
  draft: Pick<CreatorDraft, "recordPlacement">;
  previews: Pick<CreatorPreviews, "sync">;
  codes: Pick<CreatorCodes, "inHand">;
  alignmentInfo: () => MintAlignmentInfo;
  /** The settle record of a visit that already settled, if any. */
  settledVisit: (
    visit: number,
  ) => { readonly alignment: number[]; readonly zero: LatLong } | undefined;
  /** A photo minted through a settled visit's record: log it as that
   *  settle's late arrival. */
  lateArrival: (visit: number, photo: TourPhoto) => void;
  render: () => void;
}): CreatorPlacement {
  const { ctx, arStore, arController, seams, dom } = deps;
  /**
   * Placement needs the alignment the mint gate needs (a measured code,
   * and this session's fixes solved in - the matrix alone is the identity
   * from the first fix, M4 review #2), a live session, and no rebuild in
   * flight. Re-checked at every tap, not only at render.
   */
  function placementAllowed(): boolean {
    const alignment = deps.alignmentInfo();
    return (
      deps.codes.inHand() !== null &&
      alignment.hasMatrix &&
      alignment.sampleCount >= MIN_ALIGNMENT_SAMPLES &&
      arController.getState().status === "running" &&
      !ctx.finishing
    );
  }

  function renderPlacementButtons(): void {
    const allowed = placementAllowed();
    dom.pinButton.disabled = !allowed;
    dom.photoButton.disabled = !allowed || ctx.latestFrame === null;
    if (!allowed) hideLabelInput();
  }

  function hideLabelInput(): void {
    dom.pinLabel.hidden = true;
    dom.pinSave.hidden = true;
    dom.pinCancel.hidden = true;
  }

  /** Objects placed on this device that the zip does not carry yet - an
   *  edit or a move of a hosted object is in `placedObjects` too (M4),
   *  but it was not "placed". */
  function newlyPlaced(): number {
    const hosted = new Set((ctx.tourManifest?.objects ?? []).map((o) => o.id));
    return ctx.placedObjects.filter((p) => !hosted.has(p.object.id)).length;
  }

  function placed(count: number): string {
    return count === 1 ? "1 object placed" : `${String(count)} objects placed`;
  }

  function note(text: string): void {
    ctx.placementNote = text;
    deps.render();
  }

  /** The code in view as its last fused evaluation stood - read, never
   *  re-evaluated (an evaluation feeds the motion detector). */
  function codeInView() {
    const text = ctx.lastDetectedText;
    const fused = text === null ? null : (ctx.fusedPose?.last(text) ?? null);
    return text === null || fused === null
      ? null
      : { text, status: fused.status, pose: fused.pose };
  }

  /**
   * Record a placement into the troubleshooting recording, with the raw
   * inputs it was computed from (authoring recording plan 2026-09-28-0953,
   * M1a). Dispatched from the tap's own handler, never from inside another
   * dispatch, so its recorded position follows what it depends on. Without
   * a recording the store writes nothing, and no slice reads it.
   */
  function logPlacement(
    object: TourObject,
    raw: {
      reticleWorld?: Vector3;
      cameraOdomPose?: CapturedCameraFrame["cameraPose"];
    },
  ): void {
    const group = seams.getArWorldGroup();
    const reticleOdom =
      raw.reticleWorld === undefined || group === null
        ? null
        : group.worldToLocal(raw.reticleWorld.clone());
    arStore.dispatch(
      objectPlaced({
        object,
        arVisitIndex: ctx.arSessionGeneration,
        atMs: Date.now(),
        reticleOdomNue:
          reticleOdom === null
            ? null
            : [reticleOdom.x, reticleOdom.y, reticleOdom.z],
        cameraOdomPose: raw.cameraOdomPose ?? null,
        alignmentMatrix: selectAlignmentMatrix(arStore.getState()),
        arWorldGroupMatrix:
          raw.reticleWorld === undefined || group === null
            ? null
            : group.matrixWorld.toArray(),
        code: codeInView(),
        codeSizeM: ctx.activeSizeM,
      }),
    );
  }

  dom.pinButton.addEventListener("click", () => {
    ctx.placementNote = null;
    if (!placementAllowed()) {
      deps.render();
      return;
    }
    const reticle = ctx.reticle;
    if (reticle === null || !reticle.isVisible()) {
      note(
        "Point the phone at a surface until the ring appears, then tap again.",
      );
      return;
    }
    // The label input: an overlay input, not window.prompt (unavailable in
    // an XR session). The position is read at SAVE, not now - the creator
    // may still move the phone while typing.
    dom.pinLabel.hidden = false;
    dom.pinSave.hidden = false;
    dom.pinCancel.hidden = false;
    dom.pinLabel.focus();
    deps.render();
  });

  dom.pinCancel.addEventListener("click", () => {
    dom.pinLabel.value = "";
    hideLabelInput();
    ctx.placementNote = null;
    deps.render();
  });

  dom.pinSave.addEventListener("click", () => {
    const label = dom.pinLabel.value.trim();
    const reticle = ctx.reticle;
    if (!placementAllowed()) {
      hideLabelInput();
      deps.render();
      return;
    }
    if (label === "") {
      note("Type the pin's text first.");
      return;
    }
    if (reticle === null || !reticle.isVisible()) {
      note(
        "No surface under the ring - point the phone at the spot and tap Save again.",
      );
      return;
    }
    const position = reticle.getWorldPosition(new Vector3());
    // The reticle's place in the world group's own frame (odometry-NUE):
    // what the rigid preview and the settle work from (plan §3.2, M2c).
    const group = seams.getArWorldGroup();
    const local = group === null ? null : group.worldToLocal(position.clone());
    const pin = mintPin({
      id: newObjectId(),
      label,
      worldNuePosition: { x: position.x, y: position.y, z: position.z },
      zero: selectZeroReference(arStore.getState()),
      nowIso: new Date().toISOString(),
    });
    if (pin === null) {
      note("No GPS fix yet - the pin cannot be placed.");
      return;
    }
    ctx.placedObjects.push(
      local === null
        ? { object: pin }
        : {
            object: pin,
            placement: {
              visit: ctx.arSessionGeneration,
              local: {
                position: [local.x, local.y, local.z],
                rotation: [0, 0, 0, 1],
              },
            },
          },
    );
    if (local !== null) deps.alignmentPicks.notePlaced(pin.id);
    deps.draft.recordPlacement(pin);
    logPlacement(pin, { reticleWorld: position });
    dom.pinLabel.value = "";
    hideLabelInput();
    deps.previews.sync();
    note(`Pin "${label}" placed · ${placed(newlyPlaced())}.`);
  });

  dom.photoButton.addEventListener("click", () => {
    ctx.placementNote = null;
    const frame = usablePhotoFrame(
      ctx.latestFrame,
      performance.timeOrigin + performance.now(),
    );
    if (!placementAllowed() || frame === null) {
      note("No camera frame yet - try again in a moment.");
      return;
    }
    dom.photoButton.disabled = true;
    note("Capturing…");
    // The pose of the frame being encoded, not the pose at tap time; the
    // frame is at most PHOTO_FRAME_MAX_AGE_MS old (QR perf plan M4).
    const { cameraPose } = frame;
    // The visit the frame's odometry belongs to, taken at the tap: the
    // encode is async and the session may end meanwhile.
    const visit = ctx.arSessionGeneration;
    // Its id now, so its pick opens at the capture (D33), not when the
    // encode lands.
    const photoId = newObjectId();
    deps.alignmentPicks.notePlaced(photoId);
    seams.encodeFrameJpeg(frame.image).then(
      (jpeg) => {
        // A visit that settled while this encoded (its session ended, or a
        // Finish ran) has its alignment on record: minted through that, the
        // photo IS settled - and the store's alignment may already belong
        // to no visit at all (the teardown resets it).
        const settled = deps.settledVisit(visit);
        const photo = mintPhoto({
          id: photoId,
          cameraPose,
          alignmentMatrix:
            settled === undefined
              ? selectAlignmentMatrix(arStore.getState())
              : // 16 finite numbers: `settleAlignment` checked them.
                (settled.alignment as unknown as Matrix4),
          zero: settled?.zero ?? selectZeroReference(arStore.getState()),
          imageWidth: jpeg.width,
          imageHeight: jpeg.height,
          nowIso: new Date().toISOString(),
        });
        if (photo === null) {
          note("No usable GPS alignment yet - the photo cannot be placed.");
          return;
        }
        ctx.placedObjects.push({
          object: photo,
          blob: jpeg.blob,
          // The capture pose is RAW WebXR: through the one conversion into
          // the world group's frame, never composed by hand (plan §3.2).
          placement: { visit, local: odomNueFromWebXr(cameraPose) },
        });
        deps.draft.recordPlacement(photo, jpeg.blob);
        logPlacement(photo, { cameraOdomPose: cameraPose });
        // Logged as the settle's late arrival, through its record.
        if (settled !== undefined) deps.lateArrival(visit, photo);
        deps.previews.sync();
        // The plane sits at the capture spot, facing back at it: the
        // creator is standing on it and sees it once they step back.
        note(
          `Photo placed - step back a metre to see it · ${placed(newlyPlaced())}.`,
        );
      },
      (err: unknown) => {
        note(
          `Capturing failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
  });

  return {
    allowed: placementAllowed,
    renderButtons: renderPlacementButtons,
    countLine: () => (newlyPlaced() > 0 ? ` · ${placed(newlyPlaced())}` : ""),
  };
}
