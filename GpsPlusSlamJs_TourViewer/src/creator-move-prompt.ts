/**
 * The moved-code prompt and its undo (code book refactor plan M2, split out
 * of `creator-setup.ts` unchanged; authoring plan 2026-09-28-0953 §3.6
 * "Authoring (D20 ask once)", milestone M5b; UI round 1, U3: "Did the
 * poster move here?"). WHEN it asks is `code-move-prompt.ts`'s; WHAT a
 * "Yes" does is the settle's (`code-position-settle.ts`): the new spot is
 * saved at the visit's end once the visit walked enough. This is the state
 * and the DOM.
 *
 * @see creator-move-prompt.ts.md
 */

import {
  MIN_ALIGNMENT_SAMPLES,
  type MintAlignmentInfo,
} from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import {
  MOVE_PROMPT_LABELS,
  movePromptText,
  rememberMoveAnswer,
  savedPoseKey,
  trackMovePrompt,
  type MoveAnswer,
  type MovePrompt,
  type MovePromptOnset,
} from "./code-move-prompt.js";
import type { CreatorCodes } from "./creator-codes.js";
import type { CreatorDraft } from "./creator-draft.js";
import {
  codeMoveAnswered,
  codeMovePrompted,
} from "./tour-authoring-actions.js";
import type {
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";
import { sightedCodeOffset } from "./visit-settle.js";

/** The prompt's and the undo's elements, inside `#setup-controls`. */
export interface CreatorMovePromptDom {
  movePrompt: HTMLElement;
  movePromptText: HTMLElement;
  movePromptUse: HTMLButtonElement;
  movePromptCopy: HTMLButtonElement;
  movePromptLater: HTMLButtonElement;
  moveUndo: HTMLElement;
  moveUndoText: HTMLElement;
  moveUndoButton: HTMLButtonElement;
}

export interface CreatorMovePrompt {
  /** Re-run the tracker and draw the prompt and the undo. */
  render(): void;
  /** A visit settles: its "Yes, it moved" is applied and cannot be undone. */
  settling(visit: number): void;
  /** A Finish wrote the tour: nothing is left to take back. */
  clearUndo(): void;
  /** A visit ended: the running ask goes. */
  endVisit(): void;
  /** A tour closed: the ask and the undo go. */
  reset(): void;
}

export function wireCreatorMovePrompt(deps: {
  ctx: TourViewerSession;
  arStore: Pick<TourViewerStore, "getState" | "dispatch">;
  dom: CreatorMovePromptDom;
  /** Where the answers are remembered (`creator-draft.ts`). */
  draft: Pick<
    CreatorDraft,
    "moveAnswers" | "setMoveAnswers" | "saveMeta" | "warnNoBackup"
  >;
  codes: Pick<CreatorCodes, "inHand" | "measurement" | "sighting">;
  sessionLive: () => boolean;
  /** The level in hand is a stored one (only those are asked about). */
  levelInHandIsStored: () => boolean;
  /** Re-judge the latest sighting's refusal for the panel line. */
  judgeRefusal: () => void;
  /** The visit has settled (`visitSettles`). */
  settled: (visit: number) => boolean;
  alignmentInfo: () => MintAlignmentInfo;
  render: () => void;
}): CreatorMovePrompt {
  const { ctx, arStore, dom, draft } = deps;
  /** Where the running offset beyond the prompt's trigger began (the
   *  tracker's state). */
  let moveOnset: MovePromptOnset | null = null;
  /** The prompt on screen. */
  let shown: MovePrompt | null = null;
  /** The onset the shown prompt was logged for: one log per ask. */
  let movePromptLogged: MovePromptOnset | null = null;
  /** The store's fix count at the last refusal re-evaluation: a new fix
   *  re-judges the latest sighting through the new alignment - the
   *  refusal only, never the earlier objects' frame (§7m #8). */
  let moveFixCount = -1;
  /** The latest "Yes, it moved", undoable while its visit runs - the settle
   *  at the visit's end applies it, and nothing before that has changed. */
  let undoable: { prompt: MovePrompt; visit: number } | null = null;

  /** The store's GPS fix count and the latest fix's own time. */
  function fixClock(): { count: number; lastMs: number | null } {
    const positions = selectGpsPositions(arStore.getState());
    const last = positions.at(-1) as { timestamp?: unknown } | undefined;
    const t = last?.timestamp;
    return {
      count: positions.length,
      lastMs: typeof t === "number" && Number.isFinite(t) ? t : null,
    };
  }

  /**
   * Re-run the tracker on the latest sighting's offset (its own trigger,
   * D26), re-judge the refusal for the panel line when a fix landed since
   * the last look, and log a new ask once.
   */
  function updateMovePrompt(): void {
    const level = deps.codes.inHand();
    const clock = fixClock();
    if (deps.sessionLive() && clock.count !== moveFixCount) {
      moveFixCount = clock.count;
      deps.judgeRefusal();
    }
    const live =
      deps.sessionLive() && !ctx.finishing && deps.levelInHandIsStored();
    // Its own trigger (D26): the sighting's offset, whether or not the
    // settle refuses the correction.
    const offset =
      !live || level === null
        ? null
        : (() => {
            const state = arStore.getState();
            return sightedCodeOffset({
              visit: ctx.arSessionGeneration,
              alignment: selectAlignmentMatrix(state),
              zero: selectZeroReference(state),
              mintedLevel: level,
              measurement: deps.codes.measurement(),
              sighting: deps.codes.sighting(),
            });
          })();
    const alignment = deps.alignmentInfo();
    const tracked = trackMovePrompt(moveOnset, {
      levelId: level?.id ?? null,
      offset,
      gateOpen:
        alignment.hasMatrix && alignment.sampleCount >= MIN_ALIGNMENT_SAMPLES,
      fixCount: clock.count,
      lastFixMs: clock.lastMs,
      savedKey: level === null ? null : savedPoseKey(level.json),
      answers: draft.moveAnswers(),
    });
    moveOnset = tracked.onset;
    shown = tracked.prompt;
    if (shown !== null && movePromptLogged !== moveOnset) {
      movePromptLogged = moveOnset;
      arStore.dispatch(
        codeMovePrompted({
          levelId: shown.levelId,
          arVisitIndex: ctx.arSessionGeneration,
          atMs: Date.now(),
          horizontalM: shown.horizontalM,
          northM: shown.northM,
          eastM: shown.eastM,
          yawDeg: shown.yawDeg,
          maxHorizontalM: shown.triggerM,
          fixes: shown.fixes,
          seconds: shown.seconds,
        }),
      );
    }
  }

  /** The prompt and the undo on screen. */
  function renderMovePrompt(): void {
    updateMovePrompt();
    dom.movePrompt.hidden = shown === null;
    if (shown !== null) {
      dom.movePromptText.textContent = movePromptText(shown.horizontalM);
    }
    dom.movePromptUse.textContent = MOVE_PROMPT_LABELS.use;
    dom.movePromptCopy.textContent = MOVE_PROMPT_LABELS.secondCopy;
    dom.movePromptLater.textContent = MOVE_PROMPT_LABELS.notNow;
    dom.movePromptUse.disabled = false;
    // Only while the answer's visit runs and has not settled: the settle
    // applies it, and after that there is nothing left to take back.
    const live =
      undoable !== null &&
      undoable.visit === ctx.arSessionGeneration &&
      !deps.settled(undoable.visit) &&
      deps.sessionLive();
    dom.moveUndo.hidden = !live || ctx.finishing;
    dom.moveUndoText.textContent = MOVE_PROMPT_LABELS.movedHint;
    dom.moveUndoButton.textContent = MOVE_PROMPT_LABELS.undo;
  }

  function logMoveAnswer(prompt: MovePrompt, answer: MoveAnswer): void {
    arStore.dispatch(
      codeMoveAnswered({
        levelId: prompt.levelId,
        arVisitIndex: ctx.arSessionGeneration,
        atMs: Date.now(),
        answer,
        horizontalM: prompt.horizontalM,
        northM: prompt.northM,
        eastM: prompt.eastM,
        // Nothing is replaced at an answer since U3: the settle decides.
        replaced: false,
        error: null,
      }),
    );
  }

  /** Remember an answer for the prompt's spot, in memory and in the
   *  draft's meta (a refused write is the one backup notice). */
  function rememberAnswer(prompt: MovePrompt, answer: MoveAnswer): void {
    draft.setMoveAnswers(
      rememberMoveAnswer(draft.moveAnswers(), {
        levelId: prompt.levelId,
        northM: prompt.northM,
        eastM: prompt.eastM,
        answer,
        savedKey: prompt.savedKey,
      }),
    );
    void draft.saveMeta().then((ok) => {
      if (!ok) draft.warnNoBackup();
    });
  }

  for (const [button, answer] of [
    [dom.movePromptUse, "moved"],
    [dom.movePromptCopy, "second-copy"],
    [dom.movePromptLater, "not-now"],
  ] as const) {
    button.addEventListener("click", () => {
      const prompt = shown;
      if (prompt === null) return;
      rememberAnswer(prompt, answer);
      logMoveAnswer(prompt, answer);
      shown = null;
      if (answer === "moved") {
        undoable = { prompt, visit: ctx.arSessionGeneration };
        ctx.placementNote = MOVE_PROMPT_LABELS.moved;
      }
      deps.render();
    });
  }

  /** Undo a "Yes, it moved" before its visit settles: the spot is answered
   *  "Not now" instead (the newest answer for a spot is the one that
   *  counts), so the prompt does not ask again at once. */
  dom.moveUndoButton.addEventListener("click", () => {
    const u = undoable;
    if (u === null || ctx.finishing || deps.settled(u.visit)) return;
    undoable = null;
    rememberAnswer(u.prompt, "not-now");
    logMoveAnswer(u.prompt, "not-now");
    ctx.placementNote = MOVE_PROMPT_LABELS.undone;
    deps.render();
  });

  return {
    render: renderMovePrompt,
    settling: (visit) => {
      if (undoable?.visit === visit) undoable = null;
    },
    clearUndo: () => {
      undoable = null;
    },
    endVisit: () => {
      moveOnset = null;
      shown = null;
      moveFixCount = -1;
    },
    reset: () => {
      undoable = null;
      moveOnset = null;
      shown = null;
    },
  };
}
