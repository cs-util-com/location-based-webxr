/**
 * The visitor's toast in AR (visitor walk W4 build plan 2026-10-21-1105,
 * M2, §1.4): the framework's one toast (`toast-core`, its linger and its
 * live-region contract) for the walk's news - a GPS placement's reason, a
 * moved code, what could not load, "Skipped <title>." / "Brought back
 * <title>.", "Welcome back - your progress is kept.". A news item that
 * keeps applying (the status is re-rendered every camera frame) is said
 * ONCE per AR entry; a new entry may say it again. Everything said in one
 * synchronous run is joined into ONE toast: the framework's toast shows one
 * message, and a second show in the same frame would replace the first
 * unread. Two call sites say in one frame (the status's news and the
 * sheet's events: the sheet's first render re-renders the status), so the
 * join spans calls, not only one call's words.
 *
 * The toast's root is aria-hidden: its words are announced already, by
 * `#ar-status-live` (the status's news) or `#station-line` (a skip's
 * note), and a screen reader would hear each twice. A text no other region
 * says (the welcome back) goes to the walk's own live region by
 * `announce`.
 *
 * Why a closure holds what was said, not the store: it is the toast's own
 * dedup of a DOM resource (a re-shown toast restarts its timer and is
 * announced again), not walk state any view reads.
 *
 * @see walk-toast.ts.md
 */

import type { Toast } from "gps-plus-slam-app-framework/utils/toast-core";

export interface WalkToast {
  /** Show one render's words now, as one toast: its `events` (said every
   *  time) and its `news` (each said once this AR entry; only what is
   *  shown counts as said). Words said earlier in the same synchronous run
   *  stay in front of them (one toast per frame); a toast from an earlier
   *  run is replaced. "" is never said, and nothing shows when nothing is
   *  left to say. */
  say(events: readonly string[], news?: readonly string[]): void;
  /** Announce a text no other region says (the toast's root is
   *  aria-hidden), in the live region given; "" is never announced. */
  announce(text: string): void;
  /** A new AR entry (or none): forget what was said, take the toast down,
   *  empty the live region (the same words are announced again later). */
  reset(): void;
}

export function createWalkToast(
  toast: Pick<Toast, "show" | "clear">,
  live?: { textContent: string | null },
): WalkToast {
  const said = new Set<string>();
  /** The words shown in the current synchronous run, or null once it has
   *  ended (a microtask closes it). */
  let frame: string[] | null = null;
  return {
    announce(text) {
      if (live !== undefined && text !== "") live.textContent = text;
    },
    say(events, news = []) {
      const fresh = [...new Set(news)].filter((t) => t !== "" && !said.has(t));
      const words = [...events.filter((t) => t !== ""), ...fresh];
      if (words.length === 0) return;
      for (const t of fresh) said.add(t);
      if (frame === null) {
        const opened: string[] = [];
        frame = opened;
        queueMicrotask(() => {
          if (frame === opened) frame = null;
        });
      }
      for (const t of words) if (!frame.includes(t)) frame.push(t);
      toast.show(frame.join(" "));
    },
    reset() {
      frame = null;
      said.clear();
      toast.clear();
      if (live !== undefined) live.textContent = "";
    },
  };
}
