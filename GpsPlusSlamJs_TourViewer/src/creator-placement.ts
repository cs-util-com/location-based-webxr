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
  /** "New station here" (owner decision D8 of the editor round-2 plan):
   *  arms the next placement to start its own station. Absent in the node
   *  tests that do not need it. */
  newStationButton?: Pick<
    HTMLButtonElement,
    "hidden" | "disabled" | "setAttribute" | "addEventListener"
  >;
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
  /** An object is selected (object mode): the place buttons step aside
   *  (polish round M3). Absent: never. */
  objectSelected?: () => boolean;
  ctx: TourViewerSession;
  arStore: Pick<TourViewerStore, "getState" | "dispatch">;
  arController: Pick<ArController, "getState">;
  seams: Pick<TourViewerSeams, "getArWorldGroup" | "encodeFrameJpeg">;
  dom: CreatorPlacementDom;
  alignmentPicks: Pick<CreatorAlignmentPicks, "notePlaced">;
  draft: Pick<CreatorDraft, "warnNoBackup">;
  previews: Pick<CreatorPreviews, "sync">;
  alignmentInfo: () => MintAlignmentInfo;
  /** The printed size a code text is solved at (M4c-3). */
  sizeOf: (text: string | null) => number;
  /** The settle record of a visit that already settled, if any. */
  settledVisit: (
    visit: number,
  ) => { readonly alignment: number[]; readonly zero: LatLong } | undefined;
  /** A photo minted through a settled visit's record: log it as that
   *  settle's late arrival. */
  lateArrival: (visit: number, photo: TourPhoto) => void;
  /** Where object `id` went among the stations, for its note ("it starts
   *  Station 3", "in Station 2"; `creator-stations.ts`), or null. Absent:
   *  the note names no station. */
  stationOf?: (id: string) => string | null;
  /** The name of the station object `id` is in ("Station 3"), for a
   *  "New station here" placement's note (D8), or null. */
  stationNameOf?: (id: string) => string | null;
  render: () => void;
}): CreatorPlacement {
  const { ctx, arStore, arController, seams, dom } = deps;
  /**
   * Placement needs this session's GPS alignment (its fixes solved in - the
   * matrix alone is the identity from the first fix, M4 review #2), a live
   * session, and no rebuild in flight. Re-checked at every tap, not only at
   * render. Never a code: placing is GPS and tracking only, as in a tour
   * builder with no codes (field test 2, F5; a print size adopted mid-walk
   * used to grey the buttons for the rest of the loop).
   */
  function placementAllowed(): boolean {
    const alignment = deps.alignmentInfo();
    return (
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
    // Object mode (polish round M3, B5): placing while an object is
    // selected makes no sense - the object's own actions take the place.
    const objectMode = deps.objectSelected?.() ?? false;
    dom.pinButton.hidden = objectMode;
    dom.photoButton.hidden = objectMode;
    const chip = dom.newStationButton;
    if (chip !== undefined) {
      chip.disabled = !allowed;
      chip.hidden = objectMode;
      chip.setAttribute(
        "aria-pressed",
        String(ctx.tourDocument.newStationArmed()),
      );
    }
    if (!allowed || objectMode) hideLabelInput();
  }

  function hideLabelInput(): void {
    dom.pinLabel.hidden = true;
    dom.pinSave.hidden = true;
    dom.pinCancel.hidden = true;
  }

  /** Objects placed on this device that the zip does not carry yet - an
   *  edit or a move of a hosted object is an entry of the document too
   *  (M4), but it was not "placed". */
  function newlyPlaced(): number {
    return ctx.tourDocument.objects().filter((o) => !o.hosted).length;
  }

  /** Put `object` into the tour document; null (and said) when refused,
   *  else the object as the document took it and whether it started its
   *  own station ("New station here" was armed, D8: the document consumes
   *  the arm only when it takes the object, and the object then names
   *  that station - what the recording logs). Its draft write is the document's listener's; one that does
   *  not land is said once (`warnNoBackup`), as a placement's always was. */
  function placeInTour(
    object: TourObject,
    extras: Parameters<TourViewerSession["tourDocument"]["place"]>[1],
  ): { object: TourObject; ownStation: boolean } | null {
    const what =
      object.kind === "pin" ? `the pin "${object.label}"` : "a photo";
    const change = ctx.tourDocument.place(object, extras, what);
    if (change === null) {
      note("That spot is too far from its station - nothing was placed.");
      return null;
    }
    void change.backedUp.then((ok) => {
      if (!ok) deps.draft.warnNoBackup();
    });
    return { object: change.object, ownStation: change.ownStation };
  }

  function placed(count: number): string {
    return count === 1 ? "1 object placed" : `${String(count)} objects placed`;
  }

  function note(text: string): void {
    ctx.placementNote = text;
    deps.render();
  }

  /** " - it starts Station 3" / " - in Station 2" for a placement's note
   *  (tour editor plan W3, D20, D21), or "". */
  function stationPart(id: string, ownStation: boolean): string {
    if (ownStation) {
      // "New station here" (D8): the result in words, the station named.
      const name = deps.stationNameOf?.(id) ?? null;
      return ` - New station started${name === null ? "" : `: ${name}`}`;
    }
    const where = deps.stationOf?.(id) ?? null;
    return where === null ? "" : ` - ${where}`;
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
        codeSizeM: deps.sizeOf(ctx.lastDetectedText),
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
    const placedPin = placeInTour(
      pin,
      local === null
        ? {}
        : {
            placement: {
              visit: ctx.arSessionGeneration,
              local: {
                position: [local.x, local.y, local.z],
                rotation: [0, 0, 0, 1],
              },
            },
          },
    );
    if (placedPin === null) return;
    if (local !== null) deps.alignmentPicks.notePlaced(pin.id);
    logPlacement(placedPin.object, { reticleWorld: position });
    dom.pinLabel.value = "";
    hideLabelInput();
    deps.previews.sync();
    note(
      `Pin "${label}" placed${stationPart(pin.id, placedPin.ownStation)} · ${placed(newlyPlaced())}.`,
    );
  });

  // "New station here" (owner decision D8): a toggle, so a second tap
  // disarms it. The arm is the tour document's flag (`newStationArmed`),
  // read by the station line and consumed by the next placement taken.
  dom.newStationButton?.addEventListener("click", () => {
    const armed = !ctx.tourDocument.newStationArmed();
    ctx.tourDocument.armNewStation(armed);
    if (armed) {
      note("The next pin or photo starts a new station here.");
      return;
    }
    ctx.placementNote = null;
    deps.render();
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
              : // 16 finite numbers: `visitEndChoice` checked them.
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
        const placedPhoto = placeInTour(photo, {
          blob: jpeg.blob,
          // The capture pose is RAW WebXR: through the one conversion into
          // the world group's frame, never composed by hand (plan §3.2).
          placement: { visit, local: odomNueFromWebXr(cameraPose) },
        });
        if (placedPhoto === null) return;
        logPlacement(placedPhoto.object, { cameraOdomPose: cameraPose });
        // Logged as the settle's late arrival, through its record.
        if (settled !== undefined) deps.lateArrival(visit, photo);
        deps.previews.sync();
        // The plane sits at the capture spot, facing back at it: the
        // creator is standing on it and sees it once they step back.
        note(
          `Photo placed${stationPart(photo.id, placedPhoto.ownStation)}. Step back a metre to see it · ${placed(newlyPlaced())}.`,
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
