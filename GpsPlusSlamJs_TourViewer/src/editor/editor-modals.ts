/**
 * The editor page's two modal rules, page-free: what Escape closes first
 * when several of the page's layers show, and the hold that keeps the
 * focus inside a backdrop dialog (Tour details, Share and publish) by
 * making the rest of the page inert. The characters panel and its maker
 * are native `<dialog>` elements and close on their own Escape.
 *
 * @see editor-modals.ts.md
 */

import { holdPageInert } from "gps-plus-slam-editor-kit/chrome";

/** What shows when Escape is pressed. */
export interface EscapeState {
  /** The characters panel or its maker (a native dialog). */
  readonly charactersOpen: boolean;
  readonly detailsOpen: boolean;
  readonly doneOpen: boolean;
  /** "Pick in 3D" is armed. */
  readonly pointPick: boolean;
  /** The open dialog (start card) shows. */
  readonly startShown: boolean;
  /** A tour is open behind the open dialog. */
  readonly tourOpen: boolean;
  /** The page is busy (a tour being opened). */
  readonly busy: boolean;
}

/** What Escape does: `native` leaves it to the native dialog;
 *  `closeStart` closes the open dialog back to the tour; `deselect`
 *  clears the selection. */
export type EscapeAction =
  "native" | "details" | "done" | "pointPick" | "closeStart" | "deselect";

/** Escape's target, first match wins: the characters' native dialog, Tour
 *  details, Share and publish, an armed "Pick in 3D", the open dialog
 *  over an open tour while not busy, else the selection. */
export function escapeAction(state: EscapeState): EscapeAction {
  if (state.charactersOpen) return "native";
  if (state.detailsOpen) return "details";
  if (state.doneOpen) return "done";
  if (state.pointPick) return "pointPick";
  if (state.startShown && state.tourOpen && !state.busy) return "closeStart";
  return "deselect";
}

/** The page's other parts while the backdrop dialog `backdrop` shows: each
 *  element child of `body` but the backdrop and scripts made inert
 *  (`holdPageInert`); the returned function gives them back, once. */
export function holdOutside(
  backdrop: HTMLElement,
  body: HTMLElement = document.body,
): () => void {
  return holdPageInert(
    [...body.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && el !== backdrop && el.tagName !== "SCRIPT",
    ),
  );
}
