/**
 * Step 4's scan-to-open policy (TourViewer scan-to-open plan §2, §9, §13):
 * the printed code carries the tour's link, so the first code the
 * creator's camera reads with no tour open opens the tour it names - no
 * pasted link. Once a tour is open there is no wrong code (§13, owner): a
 * code of another tour is one more reference for the open tour, measured
 * into it, never a switch. This module decides, per detection, whether to
 * open, and says what the panel should report; `archive-open` supplies the
 * open and `creator-setup` feeds detections and renders the status.
 *
 * What a code names is a fact, cached for the page (`resolveCodeTour`).
 * Everything else is derived live from the session on each detection; the
 * only state kept is a failed attempt, tagged with the AR session it
 * happened in.
 */

import type { RangeProbeRejectCause } from "gps-plus-slam-app-framework/storage";

import {
  resolveCodeTour,
  tourRelation,
  type CodeTour,
  type TourRelation,
} from "./code-tour.js";
import { tourLabel } from "./tour-session.js";
import type { TourViewerSession } from "./tour-viewer-session.js";

/** What `archive-open`'s open returned. */
export type OpenOutcome =
  | { kind: "opened" }
  /** A newer open replaced this one; not a failure of this link. */
  | { kind: "superseded" }
  /** The creator chose to stay with an unsaved rebuilt file (U2). */
  | { kind: "cancelled" }
  | { kind: "failed"; cause: RangeProbeRejectCause | "other" };

/** What the creator's panel says about the code in view. */
export type CodeTourStatus =
  /** Nothing to say: the open tour's code, a code naming no tour while a
   *  tour is open, or no code in view. */
  | { kind: "quiet" }
  /** The code's link is being read, or its tour is opening. */
  | { kind: "opening" }
  /** No tour is open and this code names none. */
  | { kind: "not-a-tour" }
  | {
      kind: "failed";
      cause: RangeProbeRejectCause | "other";
      /** True while a later detection will try again. */
      retrying: boolean;
    }
  /** No tour is open, and the level in hand was measured from `label`'s
   *  code: this code's tour does not open (it would take that level), but
   *  Save stays on - a new measurement replaces the level (§9 #4,
   *  milestone review #6). */
  | { kind: "measured-for-another"; label: string }
  /** A code of another tour while one is open: one more reference code for
   *  the open tour (§13). */
  | { kind: "added-to-open-tour" }
  /** A link that cannot be compared with the open tour's. */
  | { kind: "unknown" };

export interface ScanOpenDeps {
  ctx: TourViewerSession;
  /** Which tour a code names; `resolveCodeTour` with the proxy base. */
  resolve: (text: string) => Promise<CodeTour>;
  /** Open `url` as the tour (never rejects; the outcome says how it went). */
  open: (url: string, codeText: string) => Promise<OpenOutcome>;
  /** Any open in flight, from step 1 as much as from a scan. */
  isOpening: () => boolean;
  now: () => number;
  /** Re-render the panel: a resolution or an open settled. */
  render: () => void;
}

export interface ScanOpen {
  /** A detection of `text` in the creator's AR session. */
  onDetection(text: string): void;
  /** What the panel says about `text` (null: no code in view). */
  status(text: string | null): CodeTourStatus;
  /** The normalised link of the tour `text` names, once read; else null. */
  tourOf(text: string): string | null;
  /** How `text` relates to the open tour, once read; "resolving" before
   *  (UI round 1, U3: what the creator's panel may measure on its own). */
  relation(text: string): TourRelation | "resolving";
}

/** Causes a creator can fix while standing at the poster: a file uploaded
 *  or shared a moment later, a host that let the browser in on retry, a
 *  phone that is back online (tour kit plan K0 split `offline` out of
 *  `cors`). Anything else would fail the same way every time. */
const RETRIED_CAUSES: ReadonlySet<string> = new Set([
  "missing",
  "cors",
  "offline",
]);
const FIRST_RETRY_MS = 10_000;
/** A retry costs one small request; a creator who just fixed the upload
 *  should not wait minutes at the poster (milestone review #10). */
const MAX_RETRY_MS = 30_000;

interface Attempt {
  cause: RangeProbeRejectCause | "other";
  tries: number;
  /** When a detection may try again; null = not in this AR session. */
  retryAtMs: number | null;
  generation: number;
}

/** Wire the policy over a session. The `resolve` default is supplied by
 *  the caller, which knows the proxy base (`codeResolver`). */
export function createScanOpen(deps: ScanOpenDeps): ScanOpen {
  const { ctx } = deps;
  /** text -> what it names; "resolving" while the first read runs. */
  const codes = new Map<string, CodeTour | "resolving">();
  /** normalised link -> the last failed attempt at it. */
  const attempts = new Map<string, Attempt>();
  /** The link a scan-started open is opening (for the status line). */
  let inFlight: string | null = null;
  /** The most recent code in view: a read that lands later acts on its
   *  code only while it is still this one. */
  let lastText: string | null = null;

  function attemptFor(url: string): Attempt | null {
    const attempt = attempts.get(url);
    return attempt !== undefined &&
      attempt.generation === ctx.arSessionGeneration
      ? attempt
      : null;
  }

  /** With no tour open, a level measured from ANOTHER tour's code must
   *  wait for that tour (plan §9 #4). A code naming no tour binds nothing. */
  function measuredForAnother(code: CodeTour & { kind: "tour" }): boolean {
    const level = ctx.mintedLevel;
    const bound = ctx.mintedLevelTour;
    return (
      level !== null &&
      bound !== null &&
      bound.levelId === level.id &&
      bound.tourUrl !== null &&
      bound.tourUrl !== code.normalizedUrl
    );
  }

  function tryOpen(code: CodeTour & { kind: "tour" }, text: string): void {
    const previous = attemptFor(code.normalizedUrl);
    if (
      previous !== null &&
      (previous.retryAtMs === null || deps.now() < previous.retryAtMs)
    ) {
      return;
    }
    const target = code.normalizedUrl;
    const generation = ctx.arSessionGeneration;
    inFlight = target;
    deps.render();
    void deps
      .open(code.url, text)
      .catch((): OpenOutcome => ({ kind: "failed", cause: "other" }))
      .then((outcome) => {
        if (inFlight === target) inFlight = null;
        if (outcome.kind === "failed") {
          const tries = (previous?.tries ?? 0) + 1;
          attempts.set(target, {
            cause: outcome.cause,
            tries,
            retryAtMs: RETRIED_CAUSES.has(outcome.cause)
              ? deps.now() +
                Math.min(FIRST_RETRY_MS * 2 ** (tries - 1), MAX_RETRY_MS)
              : null,
            generation,
          });
        } else if (outcome.kind === "opened") {
          attempts.delete(target);
        }
        deps.render();
      });
  }

  /** Open the tour a read code names, when no tour is open and nothing
   *  measured is bound to another tour. */
  function act(text: string): void {
    const known = codes.get(text);
    if (known === undefined || known === "resolving") return;
    if (known.kind !== "tour" || deps.isOpening()) return;
    const relation = tourRelation(
      known,
      ctx.session?.archive.url ?? null,
      ctx.currentLevels,
    );
    if (relation === "no-tour-open" && !measuredForAnother(known)) {
      tryOpen(known, text);
    }
  }

  return {
    onDetection(text) {
      lastText = text;
      if (codes.get(text) === undefined) {
        // Marked BEFORE the await, so the next frame does not start a
        // second read of the same text (plan §9 #6).
        codes.set(text, "resolving");
        void deps
          .resolve(text)
          .catch((): CodeTour => ({ kind: "unreadable" }))
          .then((code) => {
            codes.set(text, code);
            // Acted on at once while it is still the code in view: waiting
            // for the next frame left "Opening…" on screen for a code seen
            // once (milestone review #9).
            if (lastText === text) act(text);
            deps.render();
          });
        return;
      }
      act(text);
    },

    status(text) {
      if (text === null) return { kind: "quiet" };
      const known = codes.get(text);
      const tourOpen = ctx.session !== null;
      if (known === undefined || known === "resolving") {
        return tourOpen ? { kind: "quiet" } : { kind: "opening" };
      }
      if (known.kind !== "tour") {
        return tourOpen ? { kind: "quiet" } : { kind: "not-a-tour" };
      }
      if (inFlight === known.normalizedUrl) return { kind: "opening" };
      const relation = tourRelation(
        known,
        ctx.session?.archive.url ?? null,
        ctx.currentLevels,
      );
      if (relation === "this-tour") return { kind: "quiet" };
      if (relation === "unknown") return { kind: "unknown" };
      if (relation === "other-tour") return { kind: "added-to-open-tour" };
      if (measuredForAnother(known)) {
        return {
          kind: "measured-for-another",
          label: tourLabel(ctx.mintedLevelTour?.tourUrl ?? ""),
        };
      }
      const failed = attemptFor(known.normalizedUrl);
      if (failed !== null) {
        return {
          kind: "failed",
          cause: failed.cause,
          retrying: failed.retryAtMs !== null,
        };
      }
      return { kind: "opening" };
    },

    tourOf(text) {
      const known = codes.get(text);
      return known !== undefined &&
        known !== "resolving" &&
        known.kind === "tour"
        ? known.normalizedUrl
        : null;
    },

    relation(text) {
      const known = codes.get(text);
      if (known === undefined || known === "resolving") return "resolving";
      return tourRelation(
        known,
        ctx.session?.archive.url ?? null,
        ctx.currentLevels,
      );
    },
  };
}

/** The resolver `createScanOpen` takes, bound to the open path's proxy. */
export function codeResolver(
  corsProxyBaseUrl: string,
): (text: string) => Promise<CodeTour> {
  return (text) => resolveCodeTour(text, corsProxyBaseUrl);
}
