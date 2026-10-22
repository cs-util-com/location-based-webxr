/**
 * The words of the editor's "Add debug data…" (debug-captures plan
 * 2026-10-20-1159, M2 step 5, Q-C): an added debug bundle or plain Recorder
 * zip is shown on the debug layer, never refused for being another tour's,
 * and the line under the layer says whose it is; and the button through
 * one add (`createAddDebugButton`). Pure but for that button; the page
 * (`edit-main.ts`) opens the file and runs the layer over it.
 *
 * @see added-debug-data.ts.md
 */

import type { BundleMatch, DebugBundleIdentity } from "../debug-bundle.js";

export const ADD_DEBUG_LABELS = {
  idle: "Add debug data…",
  adding: "Adding the debug data…",
} as const;

/** What the line says of an added file. */
export interface AddedDebugData {
  /** The added file's own name. */
  readonly fileName: string;
  readonly match: BundleMatch;
  /** The tour the bundle names; null for a plain recording. */
  readonly identity: Pick<DebugBundleIdentity, "tour" | "file"> | null;
  /** The open tour carries a walk of its own: the added file is shown in
   *  its place. */
  readonly tourCarriesWalk: boolean;
}

function otherTour(identity: AddedDebugData["identity"]): string {
  const named = [
    ...(identity?.tour == null ? [] : [`"${identity.tour}"`]),
    ...(identity?.file == null ? [] : [identity.file]),
  ];
  return named.length === 0
    ? "It was saved from another tour, not this one."
    : `It was saved from another tour (${named.join(", ")}), not this one.`;
}

/** The line ahead of the layer's own while it shows an added file. */
export function addedDebugLine(added: AddedDebugData): string {
  return [
    `Added from ${added.fileName}, not saved with the tour.`,
    ...(added.match === "other-tour" ? [otherTour(added.identity)] : []),
    ...(added.match === "recording"
      ? ["It is a recording, not saved from this tour."]
      : []),
    ...(added.tourCarriesWalk
      ? ["It is shown in place of the tour's own walk."]
      : []),
  ].join(" ");
}

/** Why a file was not added. */
export function notAddedLine(reason: string): string {
  return `Not added: ${reason}`;
}

/** The part of the button the add drives (structural, for tests). */
export interface AddDebugButtonDom {
  disabled: boolean;
  textContent: string | null;
}

export interface AddDebugButton {
  /** Run one add with the button in its adding state (disabled, "Adding
   *  the debug data…"), back to idle and enabled when it settles, however
   *  it settles. Null, and nothing run, while another add runs. */
  run<T>(work: () => Promise<T>): Promise<T | null>;
  /** An add is running. */
  busy(): boolean;
}

export function createAddDebugButton(
  button: AddDebugButtonDom,
): AddDebugButton {
  let running = false;
  return {
    async run(work) {
      if (running) return null;
      running = true;
      button.disabled = true;
      button.textContent = ADD_DEBUG_LABELS.adding;
      try {
        return await work();
      } finally {
        running = false;
        button.disabled = false;
        button.textContent = ADD_DEBUG_LABELS.idle;
      }
    },
    busy: () => running,
  };
}
