/**
 * The creator's AR visit settle (code book refactor plan M2, split out of
 * `creator-setup.ts` unchanged; authoring plan 2026-09-28-0953 §3.2, M2c;
 * UI round 1, U3): at a visit's end or a Finish, the code's saved position
 * decided and every object placed in the visit given its geo; the refused
 * correction's line, the earlier objects' frame choice, the page-side
 * visit log and the summary after Finish.
 *
 * @see creator-settle.ts.md
 */

import type { MintAlignmentInfo } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type {
  TourObject,
  TourPhoto,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { LatLong } from "gps-plus-slam-app-framework/core";
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import {
  answerAtSpot,
  isSecondCopySpot,
  savedPoseKey,
} from "./code-move-prompt.js";
import {
  codePositionSentence,
  type CodePositionOutcome,
} from "./code-position-rule.js";
import {
  planCodePosition,
  type CodePositionPlan,
} from "./code-position-settle.js";
import type { CreatorAlignmentPicks } from "./creator-alignment-picks.js";
import type { CreatorDraft } from "./creator-draft.js";
import type { CreatorCodes } from "./creator-codes.js";
import type { CreatorMovePrompt } from "./creator-move-prompt.js";
import type { CreatorPreviews } from "./creator-previews.js";
import { moveWithCode, takesAlong } from "./move-with-code.js";
import { authoringObjects, upsertPlaced } from "./object-editing.js";
import { correctionRefusedLine } from "./qr-author-mode.js";
import type { TourViewerSeams } from "./seams.js";
import { buildSummaryModel } from "./summary-model.js";
import type { SummaryPanel } from "./summary-panel.js";
import { visitSettled } from "./tour-authoring-actions.js";
import type {
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";
import { buildVisitLogEntry, newVisitId, type VisitLog } from "./visit-log.js";
import {
  planVisitSettle,
  settleAlignment,
  visitEndChoice,
  sightedCodeOffset,
  storedGeo,
  type CodeSighting,
  type CorrectionRefusal,
  type SettleBasis,
  type SettleChoice,
} from "./visit-settle.js";

/** What a visit settled through (`visitSettles`). */
interface VisitSettleRecord {
  readonly basis: SettleBasis;
  readonly alignment: number[];
  /** The store's alignment when the settle ran. */
  readonly visitAlignment: ReturnType<typeof selectAlignmentMatrix>;
  readonly zero: LatLong;
  /** The sighting a code correction used; null otherwise. */
  readonly sighting: CodeSighting | null;
  /** The level in hand when the settle ran, before any re-mint. */
  readonly referenceLevel: {
    readonly id: string;
    readonly json: string;
  } | null;
  /** A code correction the plausibility bound refused; null otherwise. */
  readonly refused: CorrectionRefusal | null;
}

export interface CreatorSettle {
  /** Settle the running visit (at its end, or at a Finish tapped in it). */
  settleVisit(trigger: "visit-end" | "finish"): void;
  /** What `visit` settled through, once it settled. */
  record(visit: number): VisitSettleRecord | undefined;
  /** A photo minted through its settled visit's record: logged as that
   *  settle's late arrival. */
  lateArrival(visit: number, photo: TourPhoto): void;
  /** Forget the running visit's settle (a Finish that wrote nothing). */
  unsettle(visit: number | null): void;
  /** The refused correction's line as the live line's lead, or "". */
  refusalLead(): string;
  /** Re-judge the latest sighting's refusal, moving nothing. */
  judgeRefusal(): void;
  /** Move the earlier visits' frame for this visit's choice. */
  placeEarlierObjects(): void;
  /** The result screen's line about the code's position. */
  positionSentence(): string;
  /** A Finish wrote the tour: its line was said. */
  afterFinish(): void;
  /** The summary after Finish. */
  showSummary(): void;
  /** A visit ended: its refusal goes. */
  endVisit(): void;
  /** A tour closed: its move boundaries and decisions go. */
  reset(): void;
}

export function wireCreatorSettle(deps: {
  ctx: TourViewerSession;
  arStore: Pick<TourViewerStore, "getState" | "dispatch">;
  seams: Pick<TourViewerSeams, "getScene">;
  previews: Pick<CreatorPreviews, "inVisit" | "placeEarlier" | "sync">;
  alignmentPicks: Pick<CreatorAlignmentPicks, "sync" | "picks" | "gpsExtent">;
  draft: Pick<
    CreatorDraft,
    | "moveAnswers"
    | "setMoveAnswers"
    | "saveMeta"
    | "recordPlacement"
    | "recordVisit"
  >;
  movePrompt: Pick<CreatorMovePrompt, "settling">;
  /** The codes: in hand, its measurement and sightings, every stored
   *  pose, the visit's stored-code sightings. */
  codes: Pick<
    CreatorCodes,
    | "inHand"
    | "measurement"
    | "sighting"
    | "remint"
    | "saveLevel"
    | "visitCodes"
    | "references"
    | "storedSightings"
  >;
  /** The page-side visit log (`creator-setup.ts` owns it). */
  visitLog: Pick<VisitLog, "entries">;
  /** This page load's id, a visit id's prefix. */
  pageId: string;
  summary?: Pick<SummaryPanel, "show" | "hide">;
  alignmentInfo: () => MintAlignmentInfo;
  /** The printed size a code's text is solved at (`creator-measuring`'s
   *  `sizeOf`, M4c-3). */
  sizeOf: (text: string) => number;
}): CreatorSettle {
  const { ctx, arStore, seams } = deps;
  /** Codes moved to the poster's new spot (a "Yes, it moved" the settle
   *  applied), by the visit that moved them: the visit log's move boundary
   *  (§7j #12). An improved position of the same poster is no boundary:
   *  every visit saw that one poster. */
  const movedInVisit = new Map<string, number>();
  /** What each settle since the last Finish decided for the code in hand:
   *  the result screen's line (`codePositionSentence`). */
  let codePositionOutcomes: CodePositionOutcome[] = [];
  /** The visit whose settle CHANGED the code's saved position, and the
   *  plan it applied - re-applied when a failed Finish settles it again. */
  let appliedCode: { visit: number; plan: CodePositionPlan } | null = null;

  /** The code correction this visit's latest sighting would make, when
   *  the plausibility bound refused it (M2c review #2): the panel says so
   *  until the visit ends or a sighting is accepted. */
  let liveRefusal: CorrectionRefusal | null = null;

  /** A refused correction's line, as the live line's lead. */
  function refusalLead(): string {
    return liveRefusal === null
      ? ""
      : `${correctionRefusedLine(liveRefusal)} · `;
  }

  function refusalOf(
    choice: ReturnType<typeof settleAlignment>,
  ): CorrectionRefusal | null {
    return choice === null ? null : choice.refused;
  }

  /**
   * Re-judge this visit's latest sighting through the CURRENT alignment -
   * the settle's choice - and update `liveRefusal` from it, WITHOUT moving
   * the earlier objects: the move prompt calls this on every new fix, and
   * the objects' frame changes only in `placeEarlierObjects` (a sighting
   * of the code or an explicit action; §7m #8, the owner's drift
   * complaint). Null, with `liveRefusal` left as it was, outside a visit
   * (no frame) or before the scene exists.
   */
  function judgeRefusal(): ReturnType<typeof settleAlignment> {
    // Nothing to judge outside a visit - and nothing to read either.
    if (!deps.previews.inVisit() || seams.getScene() === null) return null;
    const state = arStore.getState();
    const choice = settleAlignment({
      visit: ctx.arSessionGeneration,
      alignment: selectAlignmentMatrix(state),
      zero: selectZeroReference(state),
      mintedLevel: deps.codes.inHand(),
      measurement: deps.codes.measurement(),
      sighting: deps.codes.sighting(),
      gpsAccuracyM: deps.alignmentInfo().gpsAccuracyM,
    });
    liveRefusal = refusalOf(choice);
    return choice;
  }

  /** Move the earlier visits' frame to where this visit's knowledge of the
   *  code puts it (`creator-previews.ts`). Cheap: one matrix. */
  function placeEarlierObjects(): void {
    deps.previews.placeEarlier(judgeRefusal());
  }

  /**
   * What each settled visit settled through, by `arSessionGeneration`
   * (authoring plan 2026-09-28-0953 §3.2; M2c review #1 and #6). Two jobs:
   *
   * - A visit settles ONCE. A Finish tapped during a visit settles it at
   *   the tap, and the session end the Finish then causes finds it here and
   *   does nothing - a second settle would re-mint the code a moment after
   *   the zip was written. Keyed by the visit a settle actually RAN for:
   *   the generation read at any other moment is not that visit, because
   *   between visits it already names the NEXT one (a page-side Finish once
   *   marked the next visit settled that way, so it never settled).
   * - A photo of the visit that lands AFTER its settle (the encode is
   *   async) is minted through the same record when it lands: the visit's
   *   END choice. The visit's other objects went through their own picks
   *   (D33), so a late photo can differ from them by the drift between its
   *   capture and the visit's end.
   *
   * Recorded even for a visit with nothing to settle yet, for that photo.
   */
  const visitSettles = new Map<number, VisitSettleRecord>();

  /**
   * Settle the running AR visit (authoring plan 2026-09-28-0953 §3.2, M2c):
   * the code measured in it and every object placed in it get their geo
   * recomputed from its odometry pose (`visit-settle.ts` decides through
   * which alignment: each object's own pick, near a code event the
   * code's, D33 and its review R1 and R3), the
   * draft is rewritten so a reload keeps it, and the troubleshooting
   * recording gets a `tourAuthoring/settled` action.
   *
   * READS THE STORE, SO IT MUST RUN BEFORE THE SESSION'S TEARDOWN:
   * `teardownArSessionState` resets the alignment (`ar-entry.ts` calls
   * `endAuthorVisit` first; a test pins the order).
   */
  function settleVisit(trigger: "visit-end" | "finish"): void {
    const visit = ctx.arSessionGeneration;
    if (visitSettles.has(visit)) return;
    // The settle applies a "Yes, it moved" or not: after it there is
    // nothing to take back, even if a failed Finish settles again (U3
    // milestone review #4).
    deps.movePrompt.settling(visit);
    // The picks see the alignment as it stands at the end (the fallback).
    deps.alignmentPicks.sync();
    const state = arStore.getState();
    const visitAlignment = selectAlignmentMatrix(state);
    const zero = selectZeroReference(state);
    const picks = deps.alignmentPicks.picks();
    // The end alignment's extent: the D31 marker of a code re-minted
    // through it (R7 of D33).
    const alignmentGpsExtentM = deps.alignmentPicks.gpsExtent(
      selectGpsPositions(state),
    );
    const gpsAccuracyM = deps.alignmentInfo().gpsAccuracyM;
    // A STORED code this visit saw: keep its saved position, or replace it
    // with this visit's view of it (UI round 1, U3). A change is made by
    // handing the settle a measurement of the code, so it is re-minted as
    // if measured here - through the sighting's own pick.
    const level = deps.codes.inHand();
    // A settle redone after a failed Finish re-applies the decision it
    // already made: the code is in hand at its new spot, the objects near
    // it have moved once, and the visit log keeps the saved pose (U3
    // milestone review #8).
    const reapplied =
      appliedCode !== null && appliedCode.visit === visit
        ? appliedCode.plan
        : null;
    const position =
      reapplied ??
      planCodePosition({
        visit,
        mintedLevel: level,
        measurement: deps.codes.measurement(),
        sighting: deps.codes.sighting(),
        picks,
        alignment: visitAlignment,
        zero,
        endQuality: {
          extentM: alignmentGpsExtentM ?? null,
          accuracyM: gpsAccuracyM ?? null,
        },
        // The size the code was solved at in this visit: its measurement's,
        // else its sighting's - a stored code is solved at the size the
        // tour stores for it, not the field's (M4 milestone review #2).
        sizeM:
          deps.codes.measurement()?.sizeM ??
          sizeOfSighting(deps.codes.sighting()),
        answerAt: (offset) =>
          level === null
            ? null
            : answerAtSpot(deps.draft.moveAnswers(), {
                levelId: level.id,
                savedKey: savedPoseKey(level.json),
                offset,
              }),
      });
    const remint = position?.measurement ?? null;
    const input = {
      visit,
      placed: ctx.placedObjects,
      alignment: visitAlignment,
      zero,
      mintedLevel: level,
      measurement: remint ?? deps.codes.measurement(),
      sighting: deps.codes.sighting(),
      alignmentInfo: deps.alignmentInfo(),
      alignmentGpsExtentM,
      gpsAccuracyM,
      nowIso: new Date().toISOString(),
      // Each object at its own moment (D33); a re-minted stored code at its
      // sighting's.
      picks:
        remint === null || position === null
          ? picks
          : { ...picks, measurement: position.pick },
    };
    // The visit's codes (M4c-2): the code in hand first - with this
    // settle's re-mint when its position changed - then every other code
    // the visit measured, or sighted with a stored pose. One code: the
    // legacy fields decide, exactly as before. An EMPTY hand (a size
    // adoption for it) still settles the others (webxr PR #556 review).
    const others = deps.codes
      .visitCodes(visit)
      .filter((c) => c.level.id !== level?.id)
      .map((c) => ({
        ...c,
        measurementPick: picks.measurements?.get(c.level.id) ?? null,
      }));
    const codes =
      others.length === 0
        ? undefined
        : level === null
          ? others
          : [
              {
                level,
                measurement: input.measurement,
                measurementPick:
                  remint !== null && position !== null
                    ? position.pick
                    : (picks.measurements?.get(level.id) ?? null),
              },
              ...others,
            ];
    const settleInput = codes === undefined ? input : { ...input, codes };
    // The visit's END choice - late photos, the visit log's path, the
    // settled log's basis - through the code seen last (code book plan
    // M5a); it exists whenever the alignment and the zero read, also for a
    // visit that settles nothing else (M5 design review #1).
    const choice = visitEndChoice(settleInput);
    // Pure, so planned before the log: the log marks the pose this settle
    // saves for the code, which is how the summary grades what visitors
    // get (M3a/M3b review #2).
    const plan =
      choice === null || zero === null ? null : planVisitSettle(settleInput);
    const applied =
      position !== null &&
      remint !== null &&
      plan !== null &&
      plan.level !== null;
    // A real move is the visit log's boundary (§7j #12), set before the
    // log is written.
    if (applied && position.decision.kind === "move") {
      movedInVisit.set(position.levelId, visit);
    }
    if (applied) appliedCode = { visit, plan: position };
    if (position !== null && reapplied === null) {
      codePositionOutcomes.push({ decision: position.decision, applied });
    }
    // A "Yes, it moved" holds for its visit only: applied now, or asked
    // again next time - never applied later, out of Undo's reach (U3
    // milestone review #5).
    if (
      level !== null &&
      deps.draft.moveAnswers().some((a) => a.answer === "moved")
    ) {
      deps.draft.setMoveAnswers(
        deps.draft
          .moveAnswers()
          .filter((a) => !(a.answer === "moved" && a.levelId === level.id)),
      );
      void deps.draft.saveMeta();
    }
    logVisit(visit, state, choice?.alignment ?? null, plan?.levels ?? []);
    if (choice === null || zero === null) return;
    const record: VisitSettleRecord = {
      basis: choice.basis,
      alignment: choice.alignment,
      visitAlignment,
      zero,
      sighting: choice.basis === "code-corrected" ? choice.sighting : null,
      referenceLevel: choice.level,
      refused: choice.refused,
    };
    visitSettles.set(visit, record);
    const decided =
      position === null
        ? undefined
        : {
            levelId: position.levelId,
            decision: position.decision,
            offsetM: position.offsetM,
            candidate: position.candidate,
            stored: position.stored,
            applied,
            movedWithCode: [] as {
              id: string;
              before: QrGeoPose;
              after: QrGeoPose;
            }[],
          };
    if (plan === null) {
      // Nothing to recompute, but a decision about the code is still the
      // recording's to keep.
      if (decided !== undefined) {
        logSettle(visit, trigger, record, [], null, null, [], decided);
      }
      return;
    }
    for (const { index, object } of plan.objects) {
      const entry = ctx.placedObjects[index];
      if (entry === undefined) continue;
      ctx.placedObjects[index] = { ...entry, object };
      // The record only: a photo's bytes did not change.
      deps.draft.recordPlacement(object);
    }
    // The code in hand, re-minted; with an empty hand `plan.level` is
    // another code's, which must not take the hand.
    const inHandLevel =
      plan.level !== null && plan.level.id === level?.id ? plan.level : null;
    if (inHandLevel !== null) deps.codes.remint(inHandLevel);
    // The visit's other measured codes, re-minted too (M4c-2).
    for (const other of plan.levels) {
      if (other.id !== inHandLevel?.id) deps.codes.saveLevel(other);
    }
    if (plan.levels.length > 0) void deps.draft.saveMeta();
    // An IMPROVED position takes the pins and photos near it along, so
    // they keep their place next to the poster (owner decision
    // 2026-10-06); a real move leaves them where they are (D19).
    const movedWithCode =
      applied &&
      reapplied === null &&
      position.decision.kind === "replace" &&
      level !== null
        ? moveEarlierWithCode(visit, level.id, level.json, plan.level.json)
        : [];
    logSettle(
      visit,
      trigger,
      record,
      plan.objects,
      plan.level,
      plan.levelAlignment,
      plan.levels,
      decided === undefined ? undefined : { ...decided, movedWithCode },
    );
  }

  /**
   * Move the earlier objects within reach of an improved code with it
   * (`move-with-code.ts`): every object of the tour this visit did not
   * place - the hosted ones, a restored draft's, an earlier visit's -
   * within 40 m of the code's OLD position, as an edit by id (the Finish
   * writes it like any move). A pin keeps its orientation: it has none
   * (`mintPin` writes the identity).
   */
  function moveEarlierWithCode(
    visit: number,
    levelId: string,
    beforeJson: string,
    afterJson: string,
  ): { id: string; before: QrGeoPose; after: QrGeoPose }[] {
    const from = storedGeo(beforeJson);
    const to = storedGeo(afterJson);
    if (from === null || to === null) return [];
    // The tour's other codes: an object nearer one of them stays with it
    // (M4b, `takesAlong`).
    const others = deps.codes
      .references()
      .flatMap((r) => (r.levelId === levelId || r.geo === null ? [] : [r.geo]));
    const moved: { id: string; before: QrGeoPose; after: QrGeoPose }[] = [];
    for (const entry of authoringObjects(
      ctx.tourManifest?.objects ?? [],
      ctx.placedObjects,
      ctx.deletedObjectIds,
    )) {
      if (entry.placed?.placement?.visit === visit) continue;
      const before = entry.object.geo;
      if (!takesAlong(before, from, others)) continue;
      const turned = moveWithCode(before, from, to);
      const after: QrGeoPose =
        entry.object.kind === "pin"
          ? { ...before, lat: turned.lat, lon: turned.lon, alt: turned.alt }
          : turned;
      const object = { ...entry.object, geo: after };
      ctx.placedObjects = upsertPlaced(ctx.placedObjects, {
        ...(entry.placed ?? {}),
        object,
      });
      deps.draft.recordPlacement(object);
      moved.push({ id: object.id, before, after });
    }
    if (moved.length > 0) deps.previews.sync();
    return moved;
  }

  /** The size a sighting's code is solved at; the field's without one. */
  function sizeOfSighting(sighting: CodeSighting | null): number {
    return sighting === null ? ctx.activeSizeM : deps.sizeOf(sighting.text);
  }

  /**
   * Copy the settling visit into the page-side log (M3b) while the store
   * still holds it: its walk, and each code it saw through ITS OWN
   * alignment (`visit-log.ts`). The fused path goes through
   * `pathAlignment` - what the visit's objects settled through - so the
   * pins sit on it. A visit settled again (a failed Finish) replaces its
   * entry. `savedLevels` are the levels this settle re-mints from the
   * visit's measurements (every code measured in it, M4e): each pose is
   * marked on its code, so the summary can grade the stored pose by the
   * visit it came from.
   */
  function logVisit(
    visit: number,
    state: ReturnType<typeof arStore.getState>,
    pathAlignment: readonly number[] | null,
    savedLevels: readonly { id: string; json: string }[],
  ): void {
    const codes: { levelId: string; odomPose: CodeSighting["odomPose"] }[] = [];
    // Every code measured in this visit (M4e), not only the code in hand.
    for (const { measurement } of deps.codes.visitCodes(visit)) {
      if (measurement === null || measurement.visit !== visit) continue;
      codes.push({
        levelId: measurement.levelId,
        odomPose: measurement.odomPose,
      });
    }
    // The tour's other stored codes this visit saw (M3a/M3b review #6),
    // then the code in hand last: the log keeps each code's LAST look.
    // Never a print answered "It's a second copy" (M5b review #11).
    for (const seen of deps.codes.storedSightings()) {
      if (seen.visit !== visit || isSecondCopy(state, seen.sighting)) {
        continue;
      }
      codes.push({
        levelId: seen.sighting.levelId,
        odomPose: seen.sighting.odomPose,
      });
    }
    const sighting = deps.codes.sighting();
    if (sighting !== null && !isSecondCopy(state, sighting)) {
      codes.push({ levelId: sighting.levelId, odomPose: sighting.odomPose });
    }
    const entry = buildVisitLogEntry({
      visitId: newVisitId(deps.pageId, visit),
      atMs: Date.now(),
      gpsPositions: selectGpsPositions(state),
      odometryPositions: selectOdometryPositions(state),
      alignment: selectAlignmentMatrix(state),
      pathAlignment,
      zero: selectZeroReference(state),
      storeAccuracyM: deps.alignmentInfo().gpsAccuracyM ?? null,
      codes,
      saved: savedLevels.flatMap((level) => {
        const geo = storedGeo(level.json);
        return geo === null ? [] : [{ levelId: level.id, geo }];
      }),
      // The move boundary (M5b): the codes this visit moved to a new spot.
      moved: [...movedInVisit].flatMap(([levelId, v]) =>
        v === visit ? [levelId] : [],
      ),
    });
    // A visit with no fix and no code has nothing to show or to combine.
    if (entry.gps.length === 0 && entry.codes.length === 0) return;
    deps.draft.recordVisit(entry);
  }

  /**
   * Whether `sighting` - of the code in hand - lies, through this visit's
   * plain alignment (the move prompt's view of it), at a spot answered
   * "It's a second copy" for that level and its saved pose (M5b review
   * #11). Only the level in hand: the prompt asks about no other code, so
   * no other code has such an answer.
   */
  function isSecondCopy(
    state: ReturnType<typeof arStore.getState>,
    sighting: CodeSighting,
  ): boolean {
    const level = deps.codes.inHand();
    if (level === null || sighting.levelId !== level.id) return false;
    const offset = sightedCodeOffset({
      visit: ctx.arSessionGeneration,
      alignment: selectAlignmentMatrix(state),
      zero: selectZeroReference(state),
      mintedLevel: level,
      measurement: deps.codes.measurement(),
      sighting,
    });
    return (
      offset !== null &&
      isSecondCopySpot(deps.draft.moveAnswers(), {
        levelId: level.id,
        savedKey: savedPoseKey(level.json),
        offset,
      })
    );
  }

  /**
   * The summary after Finish (M3b): every visit of this tour in the log,
   * each code's stored pose (the level in hand, then the tour's others),
   * and the objects the zip now carries. A summary that cannot be built
   * hides rather than failing the Finish that already succeeded.
   */
  function showSummary(): void {
    const summary = deps.summary;
    if (summary === undefined) return;
    try {
      summary.show(
        buildSummaryModel({
          visits: deps.visitLog.entries(),
          references: deps.codes.references(),
          objects: ctx.tourManifest?.objects ?? [],
        }),
      );
    } catch {
      summary.hide();
    }
  }

  /** Forget the settle of `visit` if it is still the running visit, so
   *  its session end settles it again (with everything placed since). */
  function unsettleRunningVisit(visit: number | null): void {
    if (visit !== null && visit === ctx.arSessionGeneration) {
      visitSettles.delete(visit);
    }
  }

  /**
   * Log a settle into the troubleshooting recording: the visit's own, or
   * a late arrival's through its visit's record - so a replay finds every
   * settled geo, whenever it was settled.
   */
  function logSettle(
    visit: number,
    trigger: "visit-end" | "finish" | "late-arrival",
    record: VisitSettleRecord,
    objects: readonly ({ object: TourObject } & SettleChoice)[],
    level: { id: string; json: string } | null,
    levelAlignment: number[] | null,
    levels: readonly { id: string; json: string; alignment: number[] }[],
    codePosition?: Parameters<typeof visitSettled>[0]["codePosition"],
  ): void {
    arStore.dispatch(
      visitSettled({
        ...(codePosition === undefined ? {} : { codePosition }),
        arVisitIndex: visit,
        atMs: Date.now(),
        trigger,
        basis: record.basis,
        visitAlignment: record.visitAlignment,
        usedAlignment: record.alignment,
        sighting: record.sighting,
        // Each object's own choice (D33): its alignment, and why.
        objects: objects.map(({ object, basis, alignment, refused }) => ({
          id: object.id,
          geo: object.geo,
          basis,
          usedAlignment: alignment,
          refusedCorrection: refused,
        })),
        levelAlignment,
        level,
        ...(levels.length === 0 ? {} : { levels }),
        referenceLevel: record.referenceLevel,
        zero: record.zero,
        refusedCorrection: record.refused,
      }),
    );
  }

  return {
    settleVisit,
    record: (visit) => visitSettles.get(visit),
    lateArrival: (visit, photo) => {
      const settled = visitSettles.get(visit);
      if (settled === undefined) return;
      logSettle(
        visit,
        "late-arrival",
        settled,
        [
          {
            object: photo,
            basis: settled.basis,
            alignment: settled.alignment,
            refused: settled.refused,
          },
        ],
        null,
        null,
        [],
      );
    },
    unsettle: unsettleRunningVisit,
    refusalLead,
    judgeRefusal: () => {
      judgeRefusal();
    },
    placeEarlierObjects,
    positionSentence: () => codePositionSentence(codePositionOutcomes),
    afterFinish: () => {
      codePositionOutcomes = [];
    },
    showSummary,
    endVisit: () => {
      liveRefusal = null;
    },
    reset: () => {
      movedInVisit.clear();
      codePositionOutcomes = [];
      appliedCode = null;
    },
  };
}
