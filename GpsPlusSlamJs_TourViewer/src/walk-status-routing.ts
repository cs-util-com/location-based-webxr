/**
 * Where the visitor's sentence goes in AR (visitor walk W4 build plan
 * 2026-10-21-1105, M2, §1.4). W4 has no status line over the camera, so
 * each state of `visitor-status.ts` (kept as the one source of what is
 * said) is routed explicitly: to the coach (the centred card), the scan
 * card, a toast said once, the peek's tail line, or - where the sheet and
 * the radar already say it - nowhere. Pure; `ar-entry.ts` renders it.
 * `#ar-status` keeps the sentence for `data-state` and the tests, and
 * `#ar-status-live` keeps announcing it whole, whatever its route.
 *
 * @see walk-status-routing.ts.md
 */

import {
  FIND_CODE,
  GPS_PLACED,
  WALK,
  type VisitorStatusParts,
  type VisitorStatusState,
} from "./visitor-status.js";

/** The coach's look: a spinner for a short wait, the swaying phone for
 *  the tracking hints, plain words otherwise. */
type CoachLook = "spinner" | "sway" | "plain";

export interface StatusRoute {
  readonly coach: { readonly text: string; readonly look: CoachLook } | null;
  /** The scan card: the sentence under its title (`scan`, kept S1), or
   *  "Code found - placing the tour…" with the check (`found`, W4). */
  readonly scanCard: "scan" | "found" | null;
  /** News, each said once when it first applies (a toast). */
  readonly toasts: readonly string[];
  /** The peek's tail asks for the code ("Find the poster's code to line
   *  it up."). */
  readonly codeTail: boolean;
}

type Route =
  "page" | "spinner" | "sway" | "plain" | "code" | "found" | "news" | "walk";

/** Each state's route. A `Record`, so a state added to the sentence fails
 *  to compile until it is routed here. */
const ROUTE_OF: Record<VisitorStatusState, Route> = {
  // Before AR the start page speaks, with its own line (kept).
  "before-ar": "page",
  checking: "page",
  unsupported: "page",
  error: "page",
  // A short wait with nothing else on screen.
  starting: "spinner",
  stopping: "spinner",
  placing: "spinner",
  // The framework's readiness hints (§1.1).
  "warming-up": "sway",
  "tracking-lost": "sway",
  // In AR with no walk running (builder's: the coach is the one centred
  // card then), and the request for steps.
  "no-tour": "plain",
  unfinished: "plain",
  nothing: "plain",
  "finding-direction": "plain",
  // The code situations before placement: the scan card (S1, kept).
  scan: "code",
  "measuring-code": "code",
  "code-other-tour": "code",
  "code-unusable": "code",
  locking: "found",
  // News, said once.
  "code-moved": "news",
  "placed-gps": "news",
  // The peek and the radar say where the next station is.
  placed: "walk",
  "to-station": "walk",
  "needs-code": "walk",
};

/** The sentence without one of its added requests. */
function without(text: string, part: string): string {
  return text.replace(part, "").replace(/\s+/g, " ").trim();
}

/** A GPS placement's reason, as W4 shows it: its first sentence, with
 *  its reason clause where it has one ("Tour placed by GPS (less exact)",
 *  "...: this browser can't read codes"). */
function placedByGpsNews(text: string): string {
  const end = text.indexOf(". ");
  const first = end < 0 ? text : text.slice(0, end);
  return first.startsWith(GPS_PLACED) ? first.replace(/\.$/, "") : GPS_PLACED;
}

/**
 * The route of one sentence. `scanShown`: the scan card shows now
 * (`scan-gate.ts` `scanCardShown`: a visitor's session waiting at the
 * gate); it then carries whatever the sentence says, as today. (Once
 * the walk runs the sentence itself is a placed one, `walkRuns` in
 * `visitor-status.ts`, so no placement wait stands over the sheet.)
 */
export function walkStatusRouting(
  status: VisitorStatusParts,
  scanShown: boolean,
): StatusRoute {
  const toasts = [...status.notes];
  const codeTail = status.text.includes(FIND_CODE);
  const route = ROUTE_OF[status.state];
  if (scanShown) {
    return { coach: null, scanCard: "scan", toasts, codeTail: false };
  }
  switch (route) {
    case "page":
      return { coach: null, scanCard: null, toasts, codeTail: false };
    case "spinner":
    case "sway":
      return {
        coach: { text: status.text, look: route },
        scanCard: null,
        toasts,
        codeTail: false,
      };
    case "plain":
    case "code": {
      // A code situation without the card (no gate waits) is said here.
      const text = codeTail ? without(status.text, FIND_CODE) : status.text;
      return {
        coach: { text, look: "plain" },
        scanCard: null,
        toasts,
        codeTail,
      };
    }
    case "found":
      return { coach: null, scanCard: "found", toasts, codeTail: false };
    case "news": {
      const news =
        status.state === "placed-gps"
          ? placedByGpsNews(status.text)
          : status.text;
      return {
        coach: status.text.includes(WALK)
          ? { text: WALK, look: "plain" }
          : null,
        scanCard: null,
        toasts: [news, ...toasts],
        codeTail,
      };
    }
    case "walk":
      return { coach: null, scanCard: null, toasts, codeTail };
  }
}
