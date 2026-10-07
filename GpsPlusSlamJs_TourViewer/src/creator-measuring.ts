/**
 * The creator's measuring of the code (code book refactor plan M2, split
 * out of `creator-setup.ts` unchanged): the QR pipeline an AR entry
 * starts, the print-size offer, each detection's sighting, and the
 * automatic measurement of the code in view (UI round 1, U3) with the
 * classification the panel's line and the measurement share. M4 replaces
 * its one code in hand with the code book.
 *
 * @see creator-measuring.ts.md
 */

import { createFusedQrPoseSource } from "gps-plus-slam-app-framework/ar/qr/qr-fused-pose-source";
import {
  mintQrLevel,
  type MintAlignmentInfo,
} from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { createQrTrackingController } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import {
  clearQrMarker,
  recordQrDetection,
  selectAlignmentMatrix,
  selectQrFusedEntries,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import type { CreatorAlignmentPicks } from "./creator-alignment-picks.js";
import type { CreatorCodes } from "./creator-codes.js";
import { hostedLevelJson, type CreatorDraft } from "./creator-draft.js";
import { tallyEvaluation, type FusedTallies } from "./qr-debug-readout.js";
import {
  adoptedSizeNote,
  autoMeasureAllowed,
  buildAuthorControllerConfig,
  MISSING_SIZE_MESSAGE,
  sizeOfferView,
  type CodeReadyState,
} from "./qr-author-mode.js";
import type { ScanOpen } from "./scan-open.js";
import type { TourViewerSeams } from "./seams.js";
import { codeMeasured } from "./tour-authoring-actions.js";
import {
  endQrPipeline,
  type TourViewerSession,
  type TourViewerStore,
} from "./tour-viewer-session.js";
import {
  measurementRole,
  storedSizeM,
  type CodeMeasurement,
} from "./visit-settle.js";
import type { Wizard } from "./wizard.js";

/** Why a measurement found no stable pose: the gate closed since the
 *  render, so it is tried again. */
const STEADY_LOST = "the code is not measured steadily";

/** What a measurement became (`measureCode`). */
type MeasureOutcome =
  | { readonly kind: "measured" | "kept" | "superseded" }
  | { readonly kind: "failed"; readonly reason: string };

/** The elements measuring reads and owns: the size field, Finish (held
 *  while a measurement is in flight) and the size offer. */
export interface CreatorMeasuringDom {
  sizeInput: HTMLInputElement;
  finishButton: HTMLButtonElement;
  sizeOffer: HTMLElement;
  sizeOfferText: HTMLElement;
  sizeOfferUse: HTMLButtonElement;
  sizeOfferKeep: HTMLButtonElement;
}

export interface CreatorMeasuring {
  /** Validate the printed size and start the QR pipeline for this AR
   *  entry; false (with the reason in the panel) keeps AR unstarted. */
  start(): boolean;
  /** The print-size offer, or the confirmation after adopting one. */
  renderSizeOffer(): void;
  /** What becomes of the code in view, and whether to measure it now. */
  outcome(text: string): { ready: CodeReadyState; measure: boolean };
  /** Measure the code in view on its own when `outcome` said so. */
  maybeMeasure(canMint: boolean, measure: boolean): void;
  /** A measurement is in flight (Finish waits for it). */
  inFlight(): boolean;
  /** A visit ended: its tries go. */
  endVisit(): void;
  /** A tour closed: the sizes adopted for its codes go. */
  reset(): void;
  /** The printed size `text` is solved at (M4c-3): adopted, else stored,
   *  else the field's. */
  sizeOf(text: string | null): number;
}

export function wireCreatorMeasuring(deps: {
  ctx: TourViewerSession;
  arStore: Pick<TourViewerStore, "getState" | "dispatch">;
  seams: Pick<
    TourViewerSeams,
    "createQrFrontEnd" | "solveQrPose" | "getIntrinsics"
  >;
  dom: CreatorMeasuringDom;
  wizard: Pick<Wizard, "revealStep">;
  /** Step 4's scan-to-open (`scan-open.ts`). */
  codeTour: Pick<ScanOpen, "onDetection" | "tourOf" | "relation">;
  alignmentPicks: Pick<
    CreatorAlignmentPicks,
    "setSighting" | "sync" | "noteMeasurement" | "noteSighting"
  >;
  draft: Pick<CreatorDraft, "saveMeta">;
  /** The codes: the code in hand, the stored ones, what Finish wrote. */
  codes: Pick<
    CreatorCodes,
    | "inHand"
    | "measurement"
    | "setInHand"
    | "clearInHand"
    | "hasStoredPose"
    | "savedText"
    | "noteStoredSighting"
    | "inBook"
    | "measuredIn"
    | "dropMeasurement"
  >;
  sessionLive: () => boolean;
  alignmentInfo: () => MintAlignmentInfo;
  /** Re-place the earlier visits' objects after a sighting. */
  placeEarlierObjects: () => void;
  render: () => void;
}): CreatorMeasuring {
  const { ctx, arStore, seams, dom } = deps;
  /** Each decoded code text's level id (`qrCodeId`, a hash - async), so a
   *  detection can be matched to the level in hand synchronously. */
  const codeIds = new Map<string, string>();
  /** Measurements in flight: Finish waits for them (`measureCode`). */
  let inFlight = 0;
  /** The codes measured on their own in this visit, by visit and text:
   *  each once per visit (UI round 1, U3; plan review #1; `maybeMeasure`). */
  const autoMeasured = new Set<string>();

  /** The confirmation after adopting a size, until the code is stable again. */
  let adoptedNote: string | null = null;

  /** The print-size offer, or the confirmation after adopting one. */
  function renderSizeOffer(): void {
    const live = deps.sessionLive();
    if (!live) adoptedNote = null;
    const offer = live ? (ctx.printSizeCheck?.offer() ?? null) : null;
    dom.sizeOfferUse.hidden = offer === null;
    dom.sizeOfferKeep.hidden = offer === null;
    if (offer !== null) {
      const view = sizeOfferView(offer.sizeM, sizeOf(offer.text));
      dom.sizeOffer.hidden = false;
      dom.sizeOfferText.textContent = view.text;
      dom.sizeOfferUse.textContent = view.useLabel;
      dom.sizeOfferKeep.textContent = view.keepLabel;
      return;
    }
    dom.sizeOffer.hidden = adoptedNote === null;
    dom.sizeOfferText.textContent = adoptedNote ?? "";
  }

  /**
   * Each code's printed size for the running pipeline (code book refactor
   * plan M4c-3): the size adopted for it from the print-size offer, else
   * the size the tour stores for it, else the size field's. Filled when the
   * controller fetches the code's level, which it does before it solves the
   * code, so the fused source and the mint read it afterwards.
   */
  const sizeByText = new Map<string, number>();
  /** Sizes adopted from the print-size offer, per code text (the tour's). */
  const adoptedSizes = new Map<string, number>();

  /**
   * The size stored for code `id`: the book's saved level first - a code
   * this page measured or restored keeps the size it was measured at when
   * the field later changes (M4 milestone review #3) - then the hosted one.
   */
  function storedSize(id: string | undefined): number | undefined {
    if (id === undefined) return undefined;
    const saved = deps.codes.savedText(id);
    const fromBook = saved === null ? null : storedSizeM(saved);
    if (fromBook !== null) return fromBook;
    const hosted = ctx.currentLevels?.get(id)?.qr.physicalSizeM;
    return typeof hosted === "number" && Number.isFinite(hosted) && hosted > 0
      ? hosted
      : undefined;
  }

  /** The size `text` is solved at: as `sizeFor` resolved it for the
   *  controller, else by the same rule from what is known now (the
   *  settle's re-mint asks before any fetch, M4 milestone review #2); the
   *  field's for a code not known yet. */
  function sizeOf(text: string | null): number {
    if (text === null) return ctx.activeSizeM;
    return (
      adoptedSizes.get(text) ??
      sizeByText.get(text) ??
      storedSize(codeIds.get(text)) ??
      ctx.activeSizeM
    );
  }

  async function sizeFor(text: string, fieldSizeM: number): Promise<number> {
    const id =
      codeIds.get(text) ?? (await qrCodeId(text).catch(() => undefined));
    const size = adoptedSizes.get(text) ?? storedSize(id) ?? fieldSizeM;
    sizeByText.set(text, size);
    return size;
  }

  function startAuthorPipeline(): boolean {
    ctx.authorErrorText = null;
    // Validate BEFORE starting anything: a cleared number input yields 0, the
    // min attribute never fires outside a form, and the resulting RangeError
    // used to unwind into the generic error box - the surface the creator is
    // not looking at (PR #360 review).
    const parsedSize = Number(dom.sizeInput.value);
    if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
      ctx.authorErrorText = MISSING_SIZE_MESSAGE;
      // REVEAL, not open (M3 milestone review #2): the message lands in
      // step 4's status line, and openStep would collapse step 4 a task
      // later - taking the explanation with it and leaving a Start button
      // that does nothing. Both steps stay open: the reason in one, the
      // field that fixes it in the other.
      deps.wizard.revealStep("print");
      deps.render();
      return false;
    }
    ctx.activeSizeM = parsedSize;
    const frontEnd = seams.createQrFrontEnd();
    if (frontEnd === null) {
      ctx.authorErrorText =
        "This browser has no QR detector (BarcodeDetector) — use Android Chrome to set up a tour.";
      deps.render();
      return false;
    }
    // The code's FUSED pose (QR near-frontal pose plan §60), one source per
    // pipeline start (per AR session), at the size the author entered.
    // Its counts feed the ?debug=1 readout (plan §66).
    const sizeM = ctx.activeSizeM;
    // A new controller fetches every code's level again.
    sizeByText.clear();
    const tallies: FusedTallies = new Map();
    const fusedPose = createFusedQrPoseSource({
      entriesOf: (text) => selectQrFusedEntries(arStore.getState(), text),
      optionsFor: (text) => ({ sizeM: sizeByText.get(text) ?? sizeM }),
      onEvaluated: (result, _ms, text) => {
        tallyEvaluation(tallies, text, result);
      },
    });
    ctx.fusedPose = fusedPose;
    ctx.fusedTallies = tallies;
    ctx.qrController = createQrTrackingController(
      buildAuthorControllerConfig(ctx.activeSizeM, {
        frontEnd,
        solvePose: (input) => seams.solveQrPose(input),
        getIntrinsics: (image) => seams.getIntrinsics(image),
        sizeFor: (text) => sizeFor(text, sizeM),
        recordDetection: (event) => {
          ctx.authorErrorText = null; // a live detection supersedes a stale error
          ctx.lastDetectedText = event.text;
          arStore.dispatch(recordQrDetection(event));
          // Step 4's scan-to-open: the code names its tour (plan §9).
          deps.codeTour.onDetection(event.text);
          // Evaluated after EVERY detection, not on render: the motion
          // detector counts detections, and the render path returns early
          // in several states (plan §61 #7). The readout and the mint read
          // this result.
          fusedPose.evaluate(event.text);
          const fused = fusedPose.last(event.text);
          noteSighting(event.text, fused);
          ctx.printSizeCheck?.onDetection(
            event.text,
            fused,
            sizeOf(event.text),
          );
          if (fused?.status === "stable") adoptedNote = null;
          ctx.qrDebugView?.update(event.qrPoseWorld, sizeOf(event.text));
          deps.render();
        },
        onError: (message) => {
          ctx.authorErrorText = `QR tracking failed: ${message}`;
          deps.render();
        },
      }),
    );
    deps.render();
    return true;
  }

  /**
   * Adopt the measured print size (QR size consensus plan §11-§12): the size
   * field takes it, a position saved at the old size stops counting (a mint
   * hash still in flight lands on nothing), and measuring starts over at the
   * new size - the old detections were solved at the old one.
   */
  function adoptMeasuredSize(): void {
    const offer = ctx.printSizeCheck?.offer() ?? null;
    if (offer === null || !deps.sessionLive()) return;
    const sizeM = Math.round(offer.sizeM * 1000) / 1000;
    ctx.printSizeCheck?.answer(offer.text, "adopted");
    // For ITS code (M4c-3); the field too, the size new codes are solved
    // at - a code the tour stores at its own size keeps that.
    adoptedSizes.set(offer.text, sizeM);
    dom.sizeInput.value = String(sizeM);
    ctx.mintGeneration += 1;
    // That code's measurement no longer counts; another code in hand keeps
    // its own.
    const offeredId = codeIds.get(offer.text);
    if (offeredId === undefined || offeredId === deps.codes.inHand()?.id) {
      deps.codes.clearInHand();
    } else {
      deps.codes.dropMeasurement(offeredId);
    }
    // The code is measured again at the new size.
    autoMeasured.clear();
    endQrPipeline(ctx);
    arStore.dispatch(clearQrMarker({ text: offer.text }));
    startAuthorPipeline();
    adoptedNote = adoptedSizeNote(sizeM);
    void deps.draft.saveMeta();
    deps.render();
  }
  dom.sizeOfferUse.addEventListener("click", adoptMeasuredSize);
  dom.sizeOfferKeep.addEventListener("click", () => {
    const offer = ctx.printSizeCheck?.offer() ?? null;
    if (offer === null) return;
    ctx.printSizeCheck?.answer(offer.text, "kept");
    deps.render();
  });

  /** Texts whose level id is being derived (`qrCodeId` is async). */
  const identifying = new Set<string>();

  /**
   * Keep the anchor code's latest STABLE pose in this visit (plan §3.2,
   * D10b; the entry hint §3.2a): the code whose level is in hand, or - with
   * none measured yet - any code, since that is the one about to be
   * measured. "Seen" is the fused pose's own `stable`, the gate the mint
   * uses: a merely detected code gives a single-frame pose whose yaw error
   * (several degrees) would swing every corrected note by a metre at 20 m.
   * Any code with a stored pose is also kept for the visit log
   * (`creator-codes.ts`), whichever code is in hand.
   */
  function noteSighting(
    text: string,
    fused: ReturnType<NonNullable<typeof ctx.fusedPose>["last"]>,
  ): void {
    if (fused?.status !== "stable" || fused.pose === null) return;
    const id = codeIds.get(text);
    if (id === undefined) {
      identify(text);
      return;
    }
    const sighting = { text, levelId: id, odomPose: fused.pose };
    if (deps.codes.hasStoredPose(id)) {
      deps.codes.noteStoredSighting(id, ctx.arSessionGeneration, sighting);
    }
    const inHand = deps.codes.inHand();
    if (inHand !== null && inHand.id !== id) {
      // Another code of the visit (M4c-2): measured here, or stored. Its
      // sighting is a code event the settle can tie notes to, never the
      // code in hand's sighting.
      if (deps.codes.inBook(id) || deps.codes.hasStoredPose(id)) {
        deps.alignmentPicks.noteSighting(sighting);
      }
      return;
    }
    deps.alignmentPicks.setSighting(sighting);
    deps.placeEarlierObjects();
  }

  /** Derive a text's level id once, then take the sighting it waited for. */
  function identify(text: string): void {
    if (identifying.has(text)) return;
    identifying.add(text);
    const visit = ctx.arSessionGeneration;
    qrCodeId(text).then(
      (id) => {
        identifying.delete(text);
        codeIds.set(text, id);
        if (visit !== ctx.arSessionGeneration) return;
        noteSighting(text, ctx.fusedPose?.last(text) ?? null);
        deps.render();
      },
      () => {
        // No Web Crypto (an insecure context): no sighting, no correction -
        // the plain visit alignment, as without a code in view.
        identifying.delete(text);
      },
    );
  }

  /**
   * The stored level file for `levelId` when the code is not in hand
   * (then the hand's level is the candidate): the book's saved text - a
   * code this page measured or kept is a stored code (M4 review #1) - else
   * the hosted zip's; null too when another tour was opened since the tap -
   * that is not the tour the code was read from.
   */
  async function storedCandidate(
    levelId: string,
    inHand: { id: string } | null,
    openAtTap: number,
  ): Promise<string | null> {
    if (inHand?.id === levelId) return null;
    const saved = deps.codes.savedText(levelId);
    if (saved !== null) return saved;
    const json = await hostedLevelJson(ctx.session, levelId);
    return ctx.openGeneration === openAtTap ? json : null;
  }

  /**
   * Install what a measurement became (`measurementRole`, D10b): the new
   * level with its raw inputs, or the stored reference kept - the
   * measurement is then only this visit's sighting, and the panel says so.
   */
  function adoptMeasurement(
    role: ReturnType<typeof measurementRole>,
    priorMeasurement: CodeMeasurement | null,
    fresh: {
      level: { id: string; json: string };
      measurement: CodeMeasurement;
    },
  ): void {
    if (role.kept === "measurement") {
      deps.codes.setInHand(fresh.level, fresh.measurement);
      return;
    }
    deps.codes.setInHand(
      role.reference,
      priorMeasurement?.levelId === fresh.level.id ? priorMeasurement : null,
    );
  }

  /**
   * Measure the code in view (on its own since U3: `maybeMeasure`). A measurement
   * of a code whose pose is already stored is a correction sighting for
   * this visit (`measurementRole`, D10b); whether this visit's view then
   * REPLACES the stored pose is decided at the visit's settle (UI round 1,
   * U3, `code-position-settle.ts`), never by a tap.
   *
   * Resolves with what it became: a no-op is `failed` with the reason.
   */
  function measureCode(): Promise<MeasureOutcome> {
    if (ctx.lastDetectedText === null) {
      return Promise.resolve({ kind: "failed", reason: "no code in view" });
    }
    const state = arStore.getState();
    // The readout's result, re-read so a tracking restart since then counts
    // (a cache hit otherwise; milestone review of b4b #1).
    const fused = ctx.fusedPose?.evaluate(ctx.lastDetectedText) ?? null;
    const stablePose = fused?.status === "stable" ? fused.pose : null;
    if (stablePose === null) {
      // The gate lost stability since render.
      return Promise.resolve({ kind: "failed", reason: STEADY_LOST });
    }
    const result = mintQrLevel({
      odomPose: stablePose,
      alignmentMatrix: selectAlignmentMatrix(state),
      zero: selectZeroReference(state),
      alignment: deps.alignmentInfo(),
      sizeM: sizeOf(ctx.lastDetectedText),
      nowIso: new Date().toISOString(),
    });
    if (!result.ok) {
      // In the panel (errorBox is a sibling of #ar-root and therefore
      // INVISIBLE during the AR session, milestone review #4), as a note
      // that stands until the next one.
      ctx.placementNote = result.error;
      return Promise.resolve({ kind: "failed", reason: result.error });
    }
    // Automatic since U3, so it changes no note and no failed Finish's
    // line (plan review #1): nothing the creator did asked for it.
    // The file name IS the code's identity, derived from the exact text this
    // poster carries - so the creator never matches a number by hand. The
    // hash is async; until it lands the finish button stays off (the level
    // is not addressable yet), and a second mint before it lands is
    // superseded by the newest.
    const mintedText = ctx.lastDetectedText;
    const mintGeneration = ++ctx.mintGeneration;
    // The raw inputs, captured at the tap: the level's id lands later.
    const measured = {
      text: mintedText,
      fusedOdomPose: stablePose,
      sizeM: sizeOf(mintedText),
      alignmentMatrix: selectAlignmentMatrix(state),
      alignment: deps.alignmentInfo(),
      levelJson: result.json,
      arVisitIndex: ctx.arSessionGeneration,
      atMs: Date.now(),
    };
    // The level in hand before this tap. When it - or the open tour's zip
    // - already stores THIS code's pose, that pose stays the reference and
    // the new measurement only corrects this visit (D10b, M2c review #5).
    const prior = {
      level: deps.codes.inHand(),
      measurement: deps.codes.measurement(),
    };
    const openAtTap = ctx.openGeneration;
    // The level in hand STAYS while the identity is derived (UI round 1,
    // U3): the measurement is automatic, and an emptied hand refused every
    // placement in that window. Finish waits for it instead (`inFlight`).
    inFlight += 1;
    dom.finishButton.disabled = true;
    return (async (): Promise<MeasureOutcome> => {
      let id: string;
      try {
        id = await qrCodeId(mintedText);
      } catch {
        if (mintGeneration !== ctx.mintGeneration) {
          return { kind: "superseded" };
        }
        // A failed identity must not lose the reference in hand.
        deps.codes.setInHand(prior.level, prior.measurement);
        ctx.placementNote =
          "Could not derive the code's identity on this device, so it was not measured.";
        return { kind: "failed", reason: "no code identity" };
      }
      if (mintGeneration !== ctx.mintGeneration) return { kind: "superseded" };
      const hostedJson = await storedCandidate(id, prior.level, openAtTap);
      if (mintGeneration !== ctx.mintGeneration) return { kind: "superseded" };
      const role = measurementRole({
        levelId: id,
        visit: measured.arVisitIndex,
        inHand: prior.level,
        inHandMeasurement: prior.measurement,
        hostedJson,
      });
      adoptMeasurement(role, prior.measurement, {
        level: { id, json: result.json },
        // What the settle re-mints the code from at the visit's end, and
        // a sighting of it in this visit (plan §3.2, M2c).
        measurement: {
          levelId: id,
          text: mintedText,
          odomPose: stablePose,
          sizeM: measured.sizeM,
          visit: measured.arVisitIndex,
        },
      });
      codeIds.set(mintedText, id);
      if (measured.arVisitIndex === ctx.arSessionGeneration) {
        deps.alignmentPicks.setSighting({
          text: mintedText,
          levelId: id,
          odomPose: stablePose,
        });
        // The code measured in this visit: its pick opens NOW, when the
        // level's identity has resolved (milliseconds, at most seconds after
        // the tap), at the alignment current now; `atMs` stays the tap's.
        if (role.kept === "measurement") {
          deps.alignmentPicks.sync();
          deps.alignmentPicks.noteMeasurement(measured.atMs, id);
        }
        deps.placeEarlierObjects();
      }
      ctx.mintedLevelTour = {
        levelId: id,
        tourUrl: deps.codeTour.tourOf(mintedText),
      };
      arStore.dispatch(
        codeMeasured({
          levelId: id,
          ...measured,
          kept: role.kept,
        }),
      );
      void deps.draft.saveMeta().catch(() => false);
      return { kind: role.kept === "measurement" ? "measured" : "kept" };
    })().finally(() => {
      inFlight -= 1;
      deps.render();
    });
  }

  /**
   * What becomes of the code in view once the gate is open (UI round 1,
   * U3: no "Save the measured position" button), and whether to measure it
   * now - one classification for the panel's line and the measurement, so
   * the line never claims a measurement that does not happen:
   * - the code in hand, or one measured earlier in this visit (M4c-2):
   *   `measured`;
   * - a measurement in flight, or a code still being read: `measuring`;
   * - with a code in hand, another STORED code (or one not identified
   *   yet): `seen` - it stays a sighting for the visit log (M3a/M3b review
   *   #6); taking it in hand would change the code this visit's objects
   *   are corrected through (per code in M5). A code with no saved
   *   position yet is measured then, even past an unsaved code in hand: a
   *   Finish writes every code of the book since M4c-1;
   * - no tour open: `seen` (scan-to-open opens the code's tour first);
   * - a code the open tour may not take: `not-measured`. Since M4c-2
   *   (`autoMeasureAllowed`, the owner's extended D5: every code seen while
   *   a tour is open is measured) nothing reaches it; the state goes with
   *   M5's slot remnants;
   * - otherwise `measuring`, measured now unless this visit already tried
   *   (once per visit and code, plan review #1).
   */
  function codeOutcome(text: string): {
    ready: CodeReadyState;
    measure: boolean;
  } {
    const id = codeIds.get(text);
    const inHand = deps.codes.inHand();
    if (
      id !== undefined &&
      (id === inHand?.id || deps.codes.measuredIn(id, ctx.arSessionGeneration))
    ) {
      return { ready: "measured", measure: false };
    }
    if (inFlight > 0) return { ready: "measuring", measure: false };
    if (inHand !== null && (id === undefined || deps.codes.hasStoredPose(id))) {
      return { ready: "seen", measure: false };
    }
    // A new code takes the hand even while the code in hand is unsaved:
    // since M4c-1 a Finish writes every code of the book, so nothing is
    // dropped (the U3 milestone review's #7 "Finish first" is gone).
    const relation = deps.codeTour.relation(text);
    if (relation === "resolving") return { ready: "measuring", measure: false };
    if (relation === "no-tour-open") return { ready: "seen", measure: false };
    if (!autoMeasureAllowed(relation)) {
      return { ready: "not-measured", measure: false };
    }
    const tried = autoMeasured.has(visitKeyOf(text));
    return { ready: tried ? "seen" : "measuring", measure: !tried };
  }

  /** `autoMeasured`'s key: the visit and the code's text. */
  function visitKeyOf(text: string): string {
    return `${String(ctx.arSessionGeneration)}|${text}`;
  }

  /**
   * Measure the code in view on its own when `codeOutcome` says so and the
   * gate is open: never during a Finish. A measurement that lost the gate
   * before it ran is tried again; one the mint or the identity refused is
   * not, until the next visit (its reason stands as the panel's note).
   */
  function maybeMeasure(canMint: boolean, measure: boolean): void {
    const text = ctx.lastDetectedText;
    if (!canMint || !measure || text === null) return;
    if (ctx.finishing || !deps.sessionLive()) return;
    const key = visitKeyOf(text);
    autoMeasured.add(key);
    void measureCode().then((outcome) => {
      if (outcome.kind === "failed" && outcome.reason === STEADY_LOST) {
        autoMeasured.delete(key);
      }
    });
  }

  return {
    start: startAuthorPipeline,
    renderSizeOffer,
    outcome: codeOutcome,
    maybeMeasure,
    inFlight: () => inFlight > 0,
    endVisit: () => {
      autoMeasured.clear();
    },
    reset: () => {
      adoptedSizes.clear();
    },
    sizeOf,
  };
}
