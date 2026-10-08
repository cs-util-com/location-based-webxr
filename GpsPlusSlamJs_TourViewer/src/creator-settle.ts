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
  codePositionSentence,
  type CodePositionOutcome,
} from "./code-position-rule.js";
import {
  planCodePosition,
  type CodePositionPlan,
} from "./code-position-settle.js";
import { isReliable } from "./code-position-rule.js";
import {
  displacementSamples,
  MOVED_CODE_FLOOR_M,
  type DisplacementSample,
} from "./code-displacement.js";
import {
  judgeCodeSpots,
  spotByAlignment,
  type SpotSighting,
} from "./code-spot-settle.js";
import {
  applyCodeSpotDecision,
  MOVE_CONFIRM_AFTER_MS,
  type CodeSpotDecision,
  type CodeSpotMemory,
  type SpotRef,
} from "./code-spots.js";
import { objectPoseNue } from "./content-placement.js";
import {
  readCodeSpots,
  writeCodeSpots,
  type StoredSpot,
} from "./level-spots.js";
import {
  odomNueFromWebXr,
  throughAlignment,
  type NuePose,
} from "./visit-anchoring.js";
import type { CreatorAlignmentPicks } from "./creator-alignment-picks.js";
import type { CreatorDraft } from "./creator-draft.js";
import type { CreatorCodes } from "./creator-codes.js";
import type { CreatorPreviews } from "./creator-previews.js";
import { moveWithCode, takesAlong } from "./move-with-code.js";
import { authoringObjects, upsertPlaced } from "./object-editing.js";
import { correctionRefusedLine } from "./qr-author-mode.js";
import type { TourViewerSeams } from "./seams.js";
import { buildSummaryModel, codeLabel } from "./summary-model.js";
import type { SummaryPanel } from "./summary-panel.js";
import { visitSettled } from "./tour-authoring-actions.js";
import type {
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";
import { buildVisitLogEntry, newVisitId, type VisitLog } from "./visit-log.js";
import {
  planVisitSettle,
  visitEndChoice,
  liveCodeChoices,
  type CodeMeasurement,
  type LiveCodeChoices,
  type VisitSettleInput,
  storedGeo,
  type CodeSighting,
  type CorrectionRefusal,
  type SettleBasis,
  type SettleChoice,
  readAlignment,
  type VisitAlignmentPicks,
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
  /** The code the end choice went through - the code seen last (M5a) -
   *  before any re-mint; null without one. */
  readonly referenceLevel: {
    readonly id: string;
    readonly json: string;
  } | null;
  /** A code correction the plausibility bound refused; null otherwise. */
  readonly refused: CorrectionRefusal | null;
}

/** One code's automatic code-spot result in a visit (M6 v5.1). */
interface CodeSpotResult {
  readonly decision: CodeSpotDecision;
  readonly memoryBefore: CodeSpotMemory<StoredSpot>;
  /** Sightings at a second print: they correct nothing. */
  readonly excluded: readonly CodeSighting[];
  /** No keep-or-replace for the code in this visit. */
  readonly skipU3: boolean;
}

/** The visit's automatic code-spot results, as the settle uses them. */
interface VisitSpots {
  /** Codes to move, with the memory before the move. */
  readonly moves: Map<string, CodeSpotMemory<StoredSpot>>;
  readonly skip: Set<string>;
  readonly excluded: Set<CodeSighting>;
  /** Codes undone in this settle (said once). */
  readonly undone: string[];
  /** Codes the rule could not judge (too short a walk, no gated fit, a
   *  frame change): a far one says so on the result screen. */
  readonly unjudged: Set<string>;
  readonly logged: { levelId: string; decision: CodeSpotDecision }[];
}

/** What every stored code's spot judgement in one visit shares. */
interface SpotVisit {
  readonly visit: number;
  readonly picks: VisitAlignmentPicks;
  readonly zero: LatLong;
  readonly visitAlignment: ReturnType<typeof selectAlignmentMatrix>;
  /** The visit's end alignment, read: where it saw each sighting. */
  readonly end: number[] | null;
  readonly endQuality: { extentM: number | null; accuracyM: number | null };
  readonly inHandId: string | null;
  /** THIS visit's device fixes: sliced at the visit's start, defensively
   *  (the store resets its lists at every session end, after the settle). */
  readonly samples: readonly DisplacementSample[];
  readonly frameChanged: boolean;
}

/** One kept sighting as the fit reads it: its time, its odometry pose, and
 *  where the visit's end alignment saw it. */
function spotSightingOf(
  s: { atMs: number; sighting: CodeSighting },
  end: readonly number[] | null,
): SpotSighting {
  const codeOdomNue = odomNueFromWebXr(s.sighting.odomPose);
  const through = end === null ? null : throughAlignment(codeOdomNue, end);
  return through === null
    ? { atMs: s.atMs, codeOdomNue }
    : {
        atMs: s.atMs,
        codeOdomNue,
        seenNue: [through.position[0], through.position[2]],
      };
}

const atOther = (c: SpotRef | "new" | null | undefined): boolean =>
  c !== null && c !== undefined && c !== "new" && c.kind !== "current";
const atHome = (c: SpotRef | "new" | null | undefined): boolean =>
  c !== null && c !== undefined && c !== "new" && c.kind === "current";

/** A code's spot decision as the settle applies it: the sightings that
 *  correct nothing, and whether the keep-or-replace rule runs. */
function spotResult(
  decision: CodeSpotDecision,
  classes: readonly (SpotRef | "new" | null)[],
  sightings: readonly CodeSighting[],
  memoryBefore: CodeSpotMemory<StoredSpot>,
): CodeSpotResult {
  // After an undo every sighting at a known spot other than the one it
  // restores is at a second print: the old current one, and any copy (M6
  // milestone review #1).
  const second =
    decision.kind === "undo"
      ? (c: SpotRef | "new" | null | undefined) =>
          atHome(c) ||
          (atOther(c) &&
            c !== undefined &&
            c !== null &&
            c !== "new" &&
            c.kind !== "previous")
      : atOther;
  return {
    decision,
    memoryBefore,
    excluded: sightings.filter((_, i) => second(classes[i])),
    skipU3:
      decision.kind === "undo" ||
      decision.kind === "copy" ||
      (decision.kind === "none" && atOther(classes.at(-1))),
  };
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
  /** Re-judge the refusal when a GPS fix landed since the last look (the
   *  new alignment may admit or refuse the correction), moving nothing;
   *  called on every render (M5b: it used to ride the move prompt, which
   *  M6 removes). */
  judgeOnNewFix(): void;
  /** Draw the earlier visits' objects through the codes this visit saw. */
  placeEarlierObjects(): void;
  /** The result screen's line about the codes' positions (per code). */
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
  draft: Pick<CreatorDraft, "saveMeta" | "recordPlacement" | "recordVisit">;
  /** The codes: in hand, its measurement and sightings, every stored
   *  pose, the visit's stored-code sightings. */
  codes: Pick<
    CreatorCodes,
    | "inHand"
    | "measurement"
    | "sighting"
    | "saveLevel"
    | "visitCodes"
    | "references"
    | "numbering"
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
  /** Codes moved to a new spot, or back by an undo (the automatic
   *  code-spot rule, M6), by the visit that did it: the visit log's move
   *  boundary (§7j #12). An improved position of the same poster is no
   *  boundary: every visit saw that one poster. */
  const movedInVisit = new Map<string, number>();
  /** What each settle since the last Finish decided, per code (M5c): the
   *  result screen's line (`positionSentence`). */
  let codePositionOutcomes: (CodePositionOutcome & { levelId: string })[] = [];
  /** By level: the visit whose settle CHANGED that code's saved position,
   *  and the plan it applied - re-applied when a failed Finish settles it
   *  again (M5c: one per code). */
  const appliedCodes = new Map<
    string,
    { visit: number; plan: CodePositionPlan }
  >();
  /** By level: the automatic code-spot decision a settle made in its visit
   *  (code book plan M6 v5.1), re-applied AS MADE when a failed Finish
   *  settles the visit again - never judged a second time against the level
   *  it already changed (M6 v5 review #4). */
  const spotDecisions = new Map<
    string,
    { visit: number; result: CodeSpotResult }
  >();

  /** The code correction this visit's latest sighting would make, when
   *  the plausibility bound refused it (M2c review #2): the panel says so
   *  until the visit ends or a sighting is accepted. */
  let liveRefusal: CorrectionRefusal | null = null;

  /** A refused correction's line, as the live line's lead. */
  function refusalLead(): string {
    if (liveRefusal === null) return "";
    // With several codes the line names its code, by the one numbering the
    // summary uses too (M5b).
    const numbering = deps.codes.numbering();
    const index =
      liveRefusalCode === null ? -1 : numbering.indexOf(liveRefusalCode);
    const name =
      numbering.length > 1 && index >= 0
        ? `${codeLabel(index, numbering.length)}: `
        : "";
    return `${name}${correctionRefusedLine(liveRefusal)} · `;
  }

  /**
   * The visit's codes for the settle and the live judge (M4c-2; one builder
   * since M5a's review): the code in hand first - with `inHandPick` as its
   * measurement pick when a changed position is re-minted through a
   * sighting's pick - then every other code the visit measured, or sighted
   * with a stored pose. Undefined with one code: the legacy fields decide.
   * An EMPTY hand still lists the others (webxr PR #556 review).
   */
  function visitCodeList(
    visit: number,
    level: { id: string; json: string } | null,
    measurement: CodeMeasurement | null,
    picks: ReturnType<typeof deps.alignmentPicks.picks>,
    inHandPick?: ReturnType<typeof deps.alignmentPicks.picks>["measurement"],
    /** Other stored codes whose position this settle changes (M5c): each
     *  is re-minted from its measurement through its pick. */
    otherRemints: ReadonlyMap<
      string,
      {
        measurement: CodeMeasurement;
        pick: ReturnType<typeof deps.alignmentPicks.picks>["measurement"];
      }
    > = new Map(),
  ): VisitSettleInput["codes"] {
    const others = deps.codes
      .visitCodes(visit)
      .filter((c) => c.level.id !== level?.id)
      .map((c) => {
        const remint = otherRemints.get(c.level.id);
        return remint === undefined
          ? {
              ...c,
              measurementPick: picks.measurements?.get(c.level.id) ?? null,
            }
          : {
              ...c,
              measurement: remint.measurement,
              measurementPick: remint.pick,
            };
      });
    if (others.length === 0) return undefined;
    if (level === null) return others;
    return [
      {
        level,
        measurement,
        // An explicit null pick is a pick (M5b review #10); only an absent
        // one falls back to the measurement's.
        measurementPick:
          inHandPick !== undefined
            ? inHandPick
            : (picks.measurements?.get(level.id) ?? null),
      },
      ...others,
    ];
  }

  /** This visit's live choices (M5b): each code's, and the code seen last.
   *  Null outside a visit, before the scene exists, or without an
   *  alignment and a zero. */
  function liveChoices(): LiveCodeChoices | null {
    if (!deps.previews.inVisit() || seams.getScene() === null) return null;
    const state = arStore.getState();
    const visit = ctx.arSessionGeneration;
    const level = deps.codes.inHand();
    const measurement = deps.codes.measurement();
    const alignment = selectAlignmentMatrix(state);
    const zero = selectZeroReference(state);
    // A sighting at a second print corrects nothing live either (M6 v5
    // review #3): no fit yet, so judged by where the alignment sees it.
    const all = deps.alignmentPicks.picks();
    const second = secondPrintSightings(all, visit, alignment, zero);
    const picks =
      second.size === 0
        ? all
        : {
            ...all,
            sightings: all.sightings.filter((s) => !second.has(s.sighting)),
          };
    const handSighting = deps.codes.sighting();
    const codes = visitCodeList(visit, level, measurement, picks);
    const input: VisitSettleInput = {
      visit,
      placed: [],
      alignment,
      zero,
      mintedLevel: level,
      measurement,
      sighting:
        handSighting !== null && second.has(handSighting) ? null : handSighting,
      gpsAccuracyM: deps.alignmentInfo().gpsAccuracyM,
      alignmentInfo: deps.alignmentInfo(),
      nowIso: new Date().toISOString(),
      picks,
      ...(codes === undefined ? {} : { codes }),
    };
    return liveCodeChoices(input);
  }

  /**
   * The visit's sightings that lie at a known spot of their code OTHER than
   * its current one - a second print, or the spot an automatic move left -
   * by where `alignment` sees them, within the floor (code book plan M6
   * v5.1). The live view has no fit; the settle's own judgement uses one.
   */
  function secondPrintSightings(
    picks: VisitAlignmentPicks,
    visit: number,
    alignment: ReturnType<typeof selectAlignmentMatrix>,
    zero: LatLong | null,
  ): Set<CodeSighting> {
    const out = new Set<CodeSighting>();
    const end = readAlignment(alignment);
    if (end === null || zero === null) return out;
    const hand = deps.codes.inHand();
    // Each level read once per call: this runs on every detection (M6
    // milestone review #7).
    const memoryById = new Map(
      [
        ...(hand === null ? [] : [hand]),
        ...deps.codes.visitCodes(visit).map((c) => c.level),
      ].map((l) => [l.id, readCodeSpots(l.json)]),
    );
    for (const s of picks.sightings) {
      const memory = memoryById.get(s.sighting.levelId) ?? null;
      if (memory !== null && atSecondPrint(memory, s, end, zero)) {
        out.add(s.sighting);
      }
    }
    return out;
  }

  /** `s` lies, as `end` sees it, at a known spot of its code other than
   *  the current one - by the settle's own rule without a fit, with its
   *  margin (`spotByAlignment`, M6 milestone review #6). */
  function atSecondPrint(
    memory: CodeSpotMemory<StoredSpot>,
    s: { atMs: number; sighting: CodeSighting },
    end: readonly number[],
    zero: LatLong,
  ): boolean {
    if (memory.previous === null && memory.copies.length === 0) return false;
    const seen = spotSightingOf(s, end).seenNue;
    if (seen === undefined) return false;
    return atOther(spotByAlignment(seen, knownSpotsNue(memory, zero)));
  }

  /** The code the live refusal was judged for (the code seen last). */
  let liveRefusalCode: string | null = null;
  /** The visit and fix count of the last per-fix re-judge. */
  let judgedAt: { visit: number; count: number } | null = null;

  /**
   * Re-judge the refusal through the CURRENT alignment - for the code seen
   * last (M5b) - and update `liveRefusal` from it, WITHOUT moving the
   * earlier objects: `judgeOnNewFix` calls it on every new fix, and the
   * objects' frames change only in `placeEarlierObjects` (a sighting of a
   * code or an explicit action; §7m #8, the owner's drift complaint). Null,
   * with `liveRefusal` left as it was, outside a visit (no frame) or before
   * the scene exists.
   */
  function judgeRefusal(): LiveCodeChoices | null {
    // Nothing to judge outside a visit - and nothing to read either.
    const live = liveChoices();
    if (live === null) return null;
    // The line is judged for the code seen last (M5b).
    const last = live.last === null ? undefined : live.byCode.get(live.last);
    liveRefusal = last?.refused ?? null;
    liveRefusalCode = live.last;
    return live;
  }

  /** Draw the earlier visits' objects through the codes this visit sighted
   *  (`creator-previews.ts`, M5b): one frame per code whose correction was
   *  accepted, at that code's stored pose. Cheap: one matrix per code. */
  function placeEarlierObjects(): void {
    const live = judgeRefusal();
    if (live === null) return;
    const geoById = new Map(
      deps.codes.references().map((r) => [r.levelId, r.geo] as const),
    );
    // A corrected code draws its nearest objects through its correction; a
    // code measured here draws them plainly (no stored pose to correct
    // through, M5 design review #6); a refused or unsighted one not at all.
    type Frame = {
      levelId: string;
      alignment: readonly number[] | null;
      geo: QrGeoPose;
    };
    const frames = [...live.byCode].flatMap(([levelId, choice]): Frame[] => {
      const geo = geoById.get(levelId) ?? null;
      if (geo === null) return [];
      if (choice.basis === "code-corrected") {
        return [{ levelId, alignment: choice.alignment, geo }];
      }
      return choice.basis === "measured-here"
        ? [{ levelId, alignment: null, geo }]
        : [];
    });
    deps.previews.placeEarlier(frames);
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
    // The picks see the alignment as it stands at the end (the fallback).
    deps.alignmentPicks.sync();
    const state = arStore.getState();
    const visitAlignment = selectAlignmentMatrix(state);
    const zero = selectZeroReference(state);
    const allPicks = deps.alignmentPicks.picks();
    // The end alignment's extent: the D31 marker of a code re-minted
    // through it (R7 of D33).
    const alignmentGpsExtentM = deps.alignmentPicks.gpsExtent(
      selectGpsPositions(state),
    );
    const gpsAccuracyM = deps.alignmentInfo().gpsAccuracyM;
    const endQuality = {
      extentM: alignmentGpsExtentM ?? null,
      accuracyM: gpsAccuracyM ?? null,
    };
    // The automatic code spots (code book plan M6 v5.1) come FIRST: an undo
    // rewrites a code's level, which everything below reads.
    const spots = settleCodeSpots(
      visit,
      state,
      allPicks,
      zero,
      visitAlignment,
      endQuality,
    );
    // A sighting of a second print corrects nothing in this settle.
    const picks =
      spots.excluded.size === 0
        ? allPicks
        : {
            ...allPicks,
            sightings: allPicks.sightings.filter(
              (s) => !spots.excluded.has(s.sighting),
            ),
          };
    const handSighting = deps.codes.sighting();
    const inHandSighting =
      handSighting !== null && spots.excluded.has(handSighting)
        ? null
        : handSighting;
    // A STORED code this visit saw: keep its saved position, or replace it
    // with this visit's view of it (UI round 1, U3). A change is made by
    // handing the settle a measurement of the code, so it is re-minted as
    // if measured here - through the sighting's own pick.
    const level = deps.codes.inHand();
    // U3 per code (code book plan M5c): every STORED code the visit saw
    // gets its own decision - the code in hand, and each other code it
    // sighted - each through its own latest sighting and pick
    // (`planCodePosition` filters the picks by level). A settle redone after
    // a failed Finish re-applies the decision it already made for a code:
    // the code is at its new spot, the objects near it have moved once,
    // and the visit log keeps the saved pose (U3 milestone review #8).
    const decide = (
      code: { id: string; json: string },
      measurement: CodeMeasurement | null,
      sighting: CodeSighting | null,
    ): { plan: CodePositionPlan | null; reapplied: boolean } => {
      const done = appliedCodes.get(code.id);
      if (done !== undefined && done.visit === visit) {
        return { plan: done.plan, reapplied: true };
      }
      // Undone, or seen at a second print: no keep-or-replace this visit.
      if (spots.skip.has(code.id)) return { plan: null, reapplied: false };
      const seen =
        sighting ??
        picks.sightings.filter((s) => s.sighting.levelId === code.id).at(-1)
          ?.sighting ??
        null;
      return {
        plan: planCodePosition({
          visit,
          mintedLevel: code,
          measurement,
          sighting,
          picks,
          alignment: visitAlignment,
          zero,
          endQuality,
          // The size the code was solved at in this visit: its
          // measurement's, else its sighting's - a stored code is solved at
          // the size the tour stores for it, not the field's (M4 milestone
          // review #2).
          sizeM: measurement?.sizeM ?? sizeOfSighting(seen),
          // The automatic code-spot rule's move (M6), re-minted here.
          automaticMove: spots.moves.has(code.id),
        }),
        reapplied: false,
      };
    };
    /** The keep-or-replace plan as the code's known spots allow it (M6
     *  milestone review #2, #3): an improvement or a move that would land
     *  within the floor of another known spot is kept instead, so two
     *  spots never sit closer than the floor; a far code the visit could
     *  not judge says so. A move needs the check too (PR #566 review): its
     *  floor clearance was judged on the visit's unfiltered sightings, but
     *  it is minted from the filtered ones, which can be another sighting
     *  and so another pose. */
    const withinSpots = (
      code: { id: string; json: string },
      plan: CodePositionPlan | null,
    ): CodePositionPlan | null => {
      if (plan === null || zero === null) return plan;
      if (
        (plan.decision.kind === "replace" || plan.decision.kind === "move") &&
        nearAnotherSpot(code, plan)
      ) {
        return {
          ...plan,
          decision: { kind: "keep", reason: "far" },
          measurement: null,
          pick: null,
        };
      }
      if (
        spots.unjudged.has(code.id) &&
        plan.decision.kind === "keep" &&
        plan.decision.reason === "far"
      ) {
        return {
          ...plan,
          decision: {
            kind: "keep",
            reason: "far-unjudged",
            offsetM: plan.offsetM,
          },
        };
      }
      return plan;
    };
    /** A decision as the spots allow it; a re-applied one stays as made. */
    const adjusted = (
      code: { id: string; json: string },
      d: { plan: CodePositionPlan | null; reapplied: boolean },
    ) => (d.reapplied ? d : { ...d, plan: withinSpots(code, d.plan) });
    /** The pose a replace or a move would mint lies within the floor of a
     *  known spot of the code other than its current one. */
    const nearAnotherSpot = (
      code: { id: string; json: string },
      plan: CodePositionPlan,
    ): boolean => {
      const memory = readCodeSpots(code.json);
      if (memory === null || zero === null) return false;
      const known = knownSpotsNue(memory, zero);
      const home = known[0]!.pose.position;
      const n = home[0] + plan.offsetNorthM;
      const e = home[2] + plan.offsetEastM;
      return known.some(
        ({ spot, pose }) =>
          spot.kind !== "current" &&
          Math.hypot(pose.position[0] - n, pose.position[2] - e) <
            MOVED_CODE_FLOOR_M,
      );
    };
    const inHandDecision =
      level === null
        ? { plan: null, reapplied: false }
        : adjusted(
            level,
            decide(level, deps.codes.measurement(), inHandSighting),
          );
    const position = inHandDecision.plan;
    // The other stored codes the visit sighted (not measured here): each
    // with its own decision, folded into ITS entry of the code list.
    const otherDecisions = new Map<
      string,
      {
        code: { id: string; json: string };
        plan: CodePositionPlan;
        reapplied: boolean;
      }
    >();
    for (const c of deps.codes.visitCodes(visit)) {
      if (c.level.id === level?.id || c.measurement !== null) continue;
      const d = adjusted(c.level, decide(c.level, null, null));
      if (d.plan !== null) {
        otherDecisions.set(c.level.id, {
          code: c.level,
          plan: d.plan,
          reapplied: d.reapplied,
        });
      }
    }
    const remint = position?.measurement ?? null;
    const input = {
      visit,
      placed: ctx.placedObjects,
      alignment: visitAlignment,
      zero,
      mintedLevel: level,
      measurement: remint ?? deps.codes.measurement(),
      sighting: inHandSighting,
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
    // the visit measured, or sighted with a stored pose, each with its own
    // re-mint (M5c). One code: the legacy fields decide, exactly as before.
    // An EMPTY hand still settles the others (webxr PR #556 review).
    const otherRemints = new Map(
      [...otherDecisions].flatMap(([id, d]) =>
        d.plan.measurement === null
          ? []
          : [[id, { measurement: d.plan.measurement, pick: d.plan.pick }]],
      ),
    );
    const codes = visitCodeList(
      visit,
      level,
      input.measurement,
      picks,
      remint !== null && position !== null ? position.pick : undefined,
      otherRemints,
    );
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
    /** The settle re-minted `levelId`: its decision was applied. */
    const remintedHere = (levelId: string): boolean =>
      plan?.levels.some((l) => l.id === levelId) ?? false;
    const applied =
      position !== null &&
      remint !== null &&
      plan !== null &&
      level !== null &&
      remintedHere(level.id);
    // Every decision of this settle, the code in hand's first.
    const decisions = [
      ...(position === null || level === null
        ? []
        : [
            {
              code: level,
              plan: position,
              reapplied: inHandDecision.reapplied,
              applied,
            },
          ]),
      ...[...otherDecisions.values()].map((d) => ({
        ...d,
        applied: d.plan.measurement !== null && remintedHere(d.code.id),
      })),
    ];
    for (const levelId of spots.undone) {
      codePositionOutcomes.push({
        decision: { kind: "undo" },
        applied: true,
        levelId,
      });
    }
    for (const d of decisions) {
      // A real move is the visit log's boundary (§7j #12), set before the
      // log is written.
      if (d.applied && d.plan.decision.kind === "move") {
        movedInVisit.set(d.plan.levelId, visit);
      }
      if (d.applied) appliedCodes.set(d.code.id, { visit, plan: d.plan });
      if (!d.reapplied) {
        codePositionOutcomes.push({
          decision: d.plan.decision,
          applied: d.applied,
          levelId: d.code.id,
        });
      }
    }
    logVisit(
      visit,
      state,
      choice?.alignment ?? null,
      plan?.levels ?? [],
      spots.excluded,
    );
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
    const logged = decisions.map((d) => ({
      levelId: d.plan.levelId,
      decision: d.plan.decision,
      offsetM: d.plan.offsetM,
      candidate: d.plan.candidate,
      stored: d.plan.stored,
      applied: d.applied,
      movedWithCode: [] as {
        id: string;
        before: QrGeoPose;
        after: QrGeoPose;
      }[],
    }));
    if (plan === null) {
      // Nothing to recompute, but a decision about a code is still the
      // recording's to keep.
      if (logged.length > 0 || spots.logged.length > 0) {
        logSettle(
          visit,
          trigger,
          record,
          [],
          null,
          null,
          [],
          logged,
          spots.logged,
        );
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
    // Every code's pose BEFORE this settle re-mints any: each earlier
    // object belongs to one code, judged against these (M5 design review
    // #7 - two improved codes moved one object twice).
    const poseBefore = deps.codes.references();
    // The known spots other than the current one of every code this visit
    // saw - its own second prints included (M5c review #4, M6 v3 review
    // #12): an object nearer one of them belongs there, not to the code
    // being improved. Before the re-mint, so a memory written now counts.
    const elsewhere = [
      ...(level === null ? [] : [level]),
      ...deps.codes.visitCodes(visit).map((c) => c.level),
    ].flatMap((l) => {
      const memory = readCodeSpots(l.json);
      if (memory === null) return [];
      return [
        ...(memory.previous === null ? [] : [memory.previous.geo]),
        ...memory.copies.map((c) => c.geo),
      ];
    });
    // An automatic move's level remembers the spot it left (M6 v5.1); a
    // move re-applied after a failed Finish already does.
    const newlyMoved = new Set(
      decisions.flatMap((d) =>
        d.applied && !d.reapplied && d.plan.decision.kind === "move"
          ? [d.code.id]
          : [],
      ),
    );
    const levels = plan.levels.map((l) => {
      const before = spots.moves.get(l.id);
      const now = readCodeSpots(l.json);
      if (before === undefined || now === null || !newlyMoved.has(l.id)) {
        return l;
      }
      const memory = applyCodeSpotDecision(
        before,
        { kind: "move" },
        now.current,
      );
      return { ...l, json: writeCodeSpots(l.json, memory) };
    });
    // `plan.level` with the memory written: its own shape, the json swapped.
    const levelOf = (l: { id: string; json: string } | null) => {
      if (l === null) return null;
      const json = levels.find((x) => x.id === l.id)?.json ?? l.json;
      return json === l.json ? l : { ...l, json };
    };
    // The code in hand, re-minted; with an empty hand `plan.level` is
    // another code's, which must not take the hand.
    const inHandLevel =
      plan.level !== null && plan.level.id === level?.id
        ? levelOf(plan.level)
        : null;
    if (inHandLevel !== null) deps.codes.saveLevel(inHandLevel);
    // The visit's other measured codes, re-minted too (M4c-2).
    for (const other of levels) {
      if (other.id !== inHandLevel?.id) deps.codes.saveLevel(other);
    }
    if (levels.length > 0) void deps.draft.saveMeta();
    // An IMPROVED position takes the pins and photos near it along, so
    // they keep their place next to the poster (owner decision
    // 2026-10-06); a real move leaves them where they are (D19). Each
    // object goes with ONE code at most.
    const claimed = new Set<string>();
    decisions.forEach((d, i) => {
      if (!d.applied || d.reapplied || d.plan.decision.kind !== "replace") {
        return;
      }
      const after = levels.find((l) => l.id === d.code.id);
      if (after === undefined) return;
      const moved = moveEarlierWithCode(
        visit,
        d.code.id,
        d.code.json,
        after.json,
        poseBefore,
        claimed,
        elsewhere,
      );
      logged[i]?.movedWithCode.push(...moved);
    });
    logSettle(
      visit,
      trigger,
      record,
      plan.objects,
      levelOf(plan.level),
      plan.levelAlignment,
      levels,
      logged,
      spots.logged,
    );
  }

  /**
   * The automatic code spots of this visit (code book plan M6 v5.1): for
   * every STORED code it sighted, the viewer's rigid fit of each kept
   * sighting against each known spot of the code (`code-spot-settle.ts`),
   * and `code-spots.ts`'s decision, applied here as far as it rewrites the
   * code's level BEFORE the settle reads it:
   * - an undo restores the spot the move left (exactly) and remembers the
   *   moved-to spot as a second print; it is the visit log's boundary;
   * - a confirmation keeps the spot the move left as a copy;
   * - a move is handed to the keep-or-replace path (`moves`), which
   *   re-mints the code; the settle then writes the memory;
   * - a sighting at a known spot other than the current one (a second
   *   print, or the spot a move left while the visit also saw the code at
   *   home) corrects nothing (`excluded`), and its code gets no
   *   keep-or-replace in this visit (`skip`).
   * Only this visit's fixes are fitted, sliced at its start: defensive,
   * because the store resets its lists at every session end (after the
   * settle), and an earlier visit's odometry has another origin.
   */
  function settleCodeSpots(
    visit: number,
    state: ReturnType<typeof arStore.getState>,
    picks: ReturnType<typeof deps.alignmentPicks.picks>,
    zero: LatLong | null,
    visitAlignment: ReturnType<typeof selectAlignmentMatrix>,
    endQuality: { extentM: number | null; accuracyM: number | null },
  ): VisitSpots {
    const out: VisitSpots = {
      moves: new Map(),
      skip: new Set(),
      excluded: new Set(),
      undone: [],
      unjudged: new Set(),
      logged: [],
    };
    if (zero === null) return out;
    const inHand = deps.codes.inHand();
    const measured = deps.codes.measurement();
    const measuredHere = (id: string) =>
      measured !== null && measured.levelId === id && measured.visit === visit;
    const stored = [
      ...(inHand === null || measuredHere(inHand.id) ? [] : [inHand]),
      ...deps.codes
        .visitCodes(visit)
        .filter((c) => c.measurement === null && c.level.id !== inHand?.id)
        .map((c) => c.level),
    ];
    const start = ctx.gpsSamplesAtSessionStart;
    // Read defensively: a store without the QR slice has no frame changes.
    const qrSlice = (state as { qrDetected?: { frameEpoch?: number } })
      .qrDetected;
    const shared: SpotVisit = {
      visit,
      picks,
      zero,
      visitAlignment,
      end: readAlignment(visitAlignment),
      endQuality,
      inHandId: inHand?.id ?? null,
      samples: displacementSamples({
        gpsPositions: selectGpsPositions(state).slice(start),
        odometryPositions: selectOdometryPositions(state).slice(start),
        zero,
      }),
      frameChanged: (qrSlice?.frameEpoch ?? 0) !== ctx.frameEpochAtSessionStart,
    };
    for (const code of stored) {
      const done = spotDecisions.get(code.id);
      if (done !== undefined && done.visit === visit) {
        recordSpots(out, visit, code.id, done.result, true);
        continue;
      }
      const result = judgeCodeAtSpots(code, shared);
      if (result === null) continue;
      if (
        result.decision.kind === "undo" ||
        result.decision.kind === "confirm"
      ) {
        deps.codes.saveLevel({
          id: code.id,
          json: writeCodeSpots(
            code.json,
            applyCodeSpotDecision(
              result.memoryBefore,
              result.decision,
              result.memoryBefore.current,
            ),
          ),
        });
        void deps.draft.saveMeta();
      }
      spotDecisions.set(code.id, { visit, result });
      recordSpots(out, visit, code.id, result, false);
    }
    return out;
  }

  /** One stored code's spot judgement in the visit; null when the code has
   *  no saved pose or the visit kept no sighting of it. */
  function judgeCodeAtSpots(
    code: { id: string; json: string },
    v: SpotVisit,
  ): CodeSpotResult | null {
    const memory = readCodeSpots(code.json);
    const seen = v.picks.sightings.filter(
      (s) => s.sighting.levelId === code.id,
    );
    if (memory === null || seen.length === 0) return null;
    const known = knownSpotsNue(memory, v.zero);
    // Where a move would mint the code, and how reliable that walk is: the
    // keep-or-replace rule's own candidate (`planCodePosition`).
    const first = planCodePosition({
      visit: v.visit,
      mintedLevel: code,
      measurement: null,
      sighting: code.id === v.inHandId ? deps.codes.sighting() : null,
      picks: v.picks,
      alignment: v.visitAlignment,
      zero: v.zero,
      endQuality: v.endQuality,
      sizeM: sizeOfSighting(seen.at(-1)?.sighting ?? null),
    });
    const home = known[0]!.pose.position;
    // The clock runs from the current spot's mint. A re-mint at that spot
    // (an improvement) restamps it and so defers the confirmation by up to
    // a day each time (PR #566 review); bounded, as a reliably stored code
    // is kept, not improved. Whether the day should run from the move
    // itself is an owner question (code book M6 follow-ups, #3).
    const mintedAt = Date.parse(memory.current.mintQuality?.mintedAtIso ?? "");
    const { decision, classes } = judgeCodeSpots({
      spots: known,
      sightings: seen.map((s) => spotSightingOf(s, v.end)),
      samples: v.samples,
      candidate:
        first === null
          ? null
          : [home[0] + first.offsetNorthM, home[2] + first.offsetEastM],
      reliable: first !== null && isReliable(first.candidate),
      frameChanged: v.frameChanged,
      previousExpires:
        memory.previous !== null &&
        Number.isFinite(mintedAt) &&
        Date.now() - mintedAt >= MOVE_CONFIRM_AFTER_MS,
    });
    return spotResult(
      decision,
      classes,
      seen.map((s) => s.sighting),
      memory,
    );
  }

  /** Fold one code's spot result into the visit's; `reapplied`: from a
   *  settle redone after a failed Finish (said and logged once). */
  function recordSpots(
    out: VisitSpots,
    visit: number,
    levelId: string,
    result: CodeSpotResult,
    reapplied: boolean,
  ): void {
    for (const s of result.excluded) out.excluded.add(s);
    if (result.skipU3) out.skip.add(levelId);
    if (result.decision.kind === "move") {
      out.moves.set(levelId, result.memoryBefore);
    }
    if (
      result.decision.kind === "none" &&
      result.decision.reason === "not-judged"
    ) {
      out.unjudged.add(levelId);
    }
    // An undo is the visit log's boundary, as a move is.
    if (result.decision.kind === "undo") movedInVisit.set(levelId, visit);
    if (reapplied) return;
    if (result.decision.kind === "undo") out.undone.push(levelId);
    out.logged.push({ levelId, decision: result.decision });
  }

  /** A code's known spots as NUE poses about `zero`: current first. */
  function knownSpotsNue(
    memory: CodeSpotMemory<StoredSpot>,
    zero: LatLong,
  ): { spot: SpotRef; pose: NuePose }[] {
    const nue = (s: StoredSpot): NuePose => {
      const p = objectPoseNue(s.geo, zero);
      return { position: p.positionNue, rotation: p.rotationNue };
    };
    return [
      { spot: { kind: "current" }, pose: nue(memory.current) },
      ...(memory.previous === null
        ? []
        : [
            { spot: { kind: "previous" } as const, pose: nue(memory.previous) },
          ]),
      ...memory.copies.map((c, index) => ({
        spot: { kind: "copy", index } as const,
        pose: nue(c),
      })),
    ];
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
    /** Every code's pose before the settle re-minted any (M5c). */
    poseBefore: readonly { levelId: string; geo: QrGeoPose | null }[],
    /** Objects another improved code already took along: skipped, and
     *  this code's are added (one code per object, M5 design review #7). */
    claimed: Set<string>,
    /** Known spots other than the codes' current ones (M6 v5.1): second
     *  prints and the spots automatic moves left. */
    elsewhere: readonly QrGeoPose[] = [],
  ): { id: string; before: QrGeoPose; after: QrGeoPose }[] {
    const from = storedGeo(beforeJson);
    const to = storedGeo(afterJson);
    if (from === null || to === null) return [];
    // The tour's other codes, as they were before this settle: an object
    // nearer one of them stays with it (M4b, `takesAlong`).
    const others = [
      ...poseBefore.flatMap((r) =>
        r.levelId === levelId || r.geo === null ? [] : [r.geo],
      ),
      ...elsewhere,
    ];
    const moved: { id: string; before: QrGeoPose; after: QrGeoPose }[] = [];
    for (const entry of authoringObjects(
      ctx.tourManifest?.objects ?? [],
      ctx.placedObjects,
      ctx.deletedObjectIds,
    )) {
      if (entry.placed?.placement?.visit === visit) continue;
      if (claimed.has(entry.object.id)) continue;
      const before = entry.object.geo;
      if (!takesAlong(before, from, others)) continue;
      claimed.add(entry.object.id);
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

  /** The result screen's line about the codes' positions since the last
   *  Finish: one sentence per code, named by the numbering when the tour
   *  has several (M5c; my wording choice). */
  function positionSentence(): string {
    const numbering = deps.codes.numbering();
    const ids = [...new Set(codePositionOutcomes.map((o) => o.levelId))];
    // One code in the tour: the sentence as before. Several: named, even
    // when only one of them decided (M5c review #2).
    if (numbering.length <= 1) {
      return codePositionSentence(codePositionOutcomes);
    }
    return ids
      .map((id) => {
        const line = codePositionSentence(
          codePositionOutcomes.filter((o) => o.levelId === id),
        );
        const index = numbering.indexOf(id);
        return line === "" || index < 0
          ? line
          : `${codeLabel(index, numbering.length)}: ${line}`;
      })
      .filter((line) => line !== "")
      .join(" ");
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
    /** Sightings at a second print (M6 v5.1): never a pose of the code. */
    excluded: ReadonlySet<CodeSighting> = new Set(),
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
    // Never a sighting at a second print (M5b review #11; M6: the settle's
    // own judgement, `excluded`).
    for (const seen of deps.codes.storedSightings()) {
      if (seen.visit !== visit || excluded.has(seen.sighting)) continue;
      codes.push({
        levelId: seen.sighting.levelId,
        odomPose: seen.sighting.odomPose,
      });
    }
    const sighting = deps.codes.sighting();
    if (sighting !== null && !excluded.has(sighting)) {
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
          // One numbering for every label (M5b): the summary's "Code N".
          references: byNumbering(
            deps.codes.references(),
            deps.codes.numbering(),
          ),
          objects: ctx.tourManifest?.objects ?? [],
        }),
      );
    } catch {
      summary.hide();
    }
  }

  /** `references` in the numbering's order; one it does not list keeps
   *  its place after them. */
  function byNumbering<T extends { levelId: string }>(
    references: readonly T[],
    numbering: readonly string[],
  ): T[] {
    const rank = (id: string): number => {
      const i = numbering.indexOf(id);
      return i < 0 ? numbering.length : i;
    };
    return [...references].sort((a, b) => rank(a.levelId) - rank(b.levelId));
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
    /** Every code-position decision of this settle (M5c); the first is
     *  also logged as `codePosition` for older readers. */
    codePositions: readonly NonNullable<
      Parameters<typeof visitSettled>[0]["codePosition"]
    >[] = [],
    /** Every automatic code-spot decision of this settle (M6 v5.1). */
    codeSpots: NonNullable<
      Parameters<typeof visitSettled>[0]["codeSpots"]
    > = [],
  ): void {
    arStore.dispatch(
      visitSettled({
        ...(codeSpots.length === 0 ? {} : { codeSpots }),
        ...(codePositions.length === 0
          ? {}
          : { codePosition: codePositions[0], codePositions }),
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
    judgeOnNewFix: () => {
      const count = selectGpsPositions(arStore.getState()).length;
      const visit = ctx.arSessionGeneration;
      if (judgedAt?.visit === visit && judgedAt.count === count) return;
      judgedAt = { visit, count };
      judgeRefusal();
    },
    placeEarlierObjects,
    positionSentence,
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
      appliedCodes.clear();
      spotDecisions.clear();
    },
  };
}
