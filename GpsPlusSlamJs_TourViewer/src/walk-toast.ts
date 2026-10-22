/**
 * The visitor's toast in AR (visitor walk W4 build plan 2026-10-21-1105,
 * M2, §1.4): the framework's one toast (`toast-core`, its linger and its
 * live-region contract) for the walk's news - a GPS placement's reason, a
 * moved code, what could not load, "Skipped <title>." / "Brought back
 * <title>.", "Welcome back - your progress is kept.". A news item that
 * keeps applying (the status is re-rendered every camera frame) is said
 * ONCE per AR entry (`sayOnce`); a new entry may say it again.
 *
 * Why a closure holds what was said, not the store: it is the toast's own
 * dedup of a DOM resource (a re-shown toast restarts its timer and is
 * announced again), not walk state any view reads.
 *
 * @see walk-toast.ts.md
 */

import type { Toast } from "gps-plus-slam-app-framework/utils/toast-core";

export interface WalkToast {
  /** Show a message now (replacing one that shows). */
  say(text: string): void;
  /** Show a message once this AR entry; "" is never said. */
  sayOnce(text: string): void;
  /** A new AR entry (or none): forget what was said, take the toast down. */
  reset(): void;
}

export function createWalkToast(
  toast: Pick<Toast, "show" | "clear">,
): WalkToast {
  const said = new Set<string>();
  return {
    say(text) {
      if (text !== "") toast.show(text);
    },
    sayOnce(text) {
      if (text === "" || said.has(text)) return;
      said.add(text);
      toast.show(text);
    },
    reset() {
      said.clear();
      toast.clear();
    },
  };
}
