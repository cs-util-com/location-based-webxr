/**
 * What the AR button's press should do, and when to offer entry.
 *
 * Pure decisions, no DOM and no session — the same split `locate-state.ts` has
 * from `locate-control.ts`, and for the same reason: this is the part worth
 * testing exhaustively, and none of it needs a browser.
 *
 * WHY THE PRESS DECIDES RATHER THAN THE BUTTON DISABLING ITSELF (DEC-W2). The
 * thirteenth session reported that the AR button "does nothing" before Location
 * has been pressed. It was modelled correctly — `arButtonState` returns
 * `disabled` with the hint "Waiting for a GPS fix" — but a hint that reaches
 * only `title` and `aria-label` reaches nobody on a phone, so what a user meets
 * is a faint square that ignores them. Making the press DO the thing that had
 * to happen first removes the state instead of explaining it.
 *
 * WHY NOT ENTER AR AND LOCATE AT ONCE, which was the first plan. Three recorded
 * invariants forbid re-anchoring a live session: `setZeroPos` is a no-op once
 * set (DEC-R11-6, enforced in the reducer), the scene anchor is `frozen` while
 * a session runs, and the horizontal placement is computed once at session
 * start — only height is re-applied live. `startArMode` also refuses outright
 * without an origin, and `main.ts` gates the whole entry sequence on a non-null
 * `zero`, so a session started without one would get no GPS registration and no
 * entry pass — i.e. the ~98 m datum error the entry pass exists to remove.
 * Deciding here, BEFORE anything starts, leaves every one of those untouched.
 *
 * @see ar-entry.ts.md
 */

import { greatCircleDistance, UNITS } from "h3-js";

import type { LatLng } from "gps-plus-slam-osm";

import { AR_REFRESH_DISTANCE_M } from "./ar-walking.js";

export type ArPressAction =
  /** A session is running: leave it. */
  | { readonly kind: "exit" }
  /** The view is at the user: start AR. */
  | { readonly kind: "enter" }
  /** The app does not currently show where the user is: find them first. */
  | { readonly kind: "locate" };

export interface ArPressInputs {
  readonly sessionRunning: boolean;
  /**
   * Whether the framework has a `zero` yet — i.e. `canEnterAr(origin)`.
   *
   * A BOOLEAN RATHER THAN THE ORIGIN ITSELF, and deliberately so: the only
   * question asked of it here is whether a fix has ever arrived, `ar-origin.ts`
   * already owns that predicate, and the framework's own type spells its
   * longitude `lon` while everything measured in this file uses `lng`. Taking
   * the answer instead of the value keeps one place knowing what an origin is.
   */
  readonly hasOrigin: boolean;
  /** The most recent fix, `undefined` if none has arrived this session. */
  readonly lastFix: LatLng | undefined;
  /** Where the demo is currently centred — moved by a map click or the picker. */
  readonly viewPosition: LatLng;
}

/**
 * Whether the app is currently showing the user where they are.
 *
 * MEASURED AGAINST THE EXISTING 100 m GATE rather than a new threshold. That
 * number is `ar-walking.ts`'s refetch distance, chosen against a 90 s worst-case
 * fetch, and reusing it means the demo has ONE notion of "far enough to matter".
 * A second constant here would be a second thing to keep in step, and the two
 * questions really are the same one: past this distance the data in the scene
 * is not the data for where you are.
 *
 * A non-finite coordinate answers `false`, and the explicit guard for that is
 * BELT-AND-BRACES RATHER THAN LOAD-BEARING — stated plainly because mutation
 * testing proved it: deleting both finite checks leaves every test here green.
 * `greatCircleDistance` returns NaN rather than throwing, and `NaN <= x` is
 * false, so the safe answer already falls out of asking "is it WITHIN the gate"
 * rather than "is it beyond it". The guard stays for the reason
 * `ar-walking.ts` gives about the same pair of functions: it makes the closed
 * direction the deliberate answer rather than an accident of operator choice.
 */
function isShowingUser(view: LatLng, fix: LatLng | undefined): boolean {
  if (fix === undefined) return false;
  if (!isFinitePosition(view) || !isFinitePosition(fix)) return false;
  const away = greatCircleDistance(
    [fix.lat, fix.lng],
    [view.lat, view.lng],
    UNITS.m,
  );
  return Number.isFinite(away) && away <= AR_REFRESH_DISTANCE_M;
}

function isFinitePosition(position: LatLng): boolean {
  return Number.isFinite(position.lat) && Number.isFinite(position.lng);
}

/**
 * What a press of the AR button should do right now.
 *
 * ORDER MATTERS. `exit` wins over everything for the reason `arButtonState`
 * gives: a running session must always offer a way out, and a full-screen view
 * with no exit reads as being trapped.
 */
export function arPressAction(inputs: ArPressInputs): ArPressAction {
  if (inputs.sessionRunning) return { kind: "exit" };
  // No fix has ever arrived — the case the feedback names first. The press
  // becomes the GPS button.
  if (!inputs.hasOrigin) return { kind: "locate" };
  // The same answer for a view that has been moved away from the user, which is
  // the second half of the same report: AR used to be enterable while the scene
  // was anchored somewhere they are not.
  if (!isShowingUser(inputs.viewPosition, inputs.lastFix)) {
    return { kind: "locate" };
  }
  return { kind: "enter" };
}

export interface ArOfferInputs extends ArPressInputs {
  /**
   * Whether an AR press is still waiting for the fix it asked for.
   *
   * THE OFFER BELONGS TO THE AR PRESS, and this flag is what says so. The
   * locate control is used on its own constantly — by a desktop user finding
   * themselves on the map, and by every AR session's own ~1 Hz watch — so an
   * offer keyed on "a fix arrived" would fire at all of them. The caller owns
   * the flag and must clear it on anything that supersedes the intent.
   */
  readonly awaitingFix: boolean;
}

/**
 * Whether a just-arrived fix should offer to enter AR.
 *
 * DEFINED IN TERMS OF `arPressAction`, not in parallel with it. The prompt's
 * promise is "pressing AR now works", so it must be unreachable in any state
 * where the press would do something else — and the cheapest way to guarantee
 * that is to ask the press.
 */
export function shouldOfferAr(inputs: ArOfferInputs): boolean {
  if (!inputs.awaitingFix) return false;
  return arPressAction(inputs).kind === "enter";
}
