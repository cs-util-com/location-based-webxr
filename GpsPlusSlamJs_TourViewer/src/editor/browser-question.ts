/**
 * The browser's own yes-or-no question (`window.confirm`) asked so that
 * the 3D views' frame clocks (`../editor3d/frame-clock.ts`) do not time
 * the wait for its answer as a slow frame: the question holds the page
 * still, its frames with it. Here, not beside the clock, because the edit
 * page asks before any of the 3D view's code is loaded.
 *
 * @see browser-question.ts.md
 */

/** The page's event that its frames stopped while it was shown. */
export const FRAMES_STOPPED_EVENT = "framesstopped";

/** Where the event goes: the page's document. */
export interface QuestionPage {
  dispatchEvent(event: Event): boolean;
}

/** Asks `message` (by `ask`, the browser's question by default), then
 *  tells `page` its frames stopped; returns the answer. */
export function confirmPausingFrames(
  message: string,
  page: QuestionPage = document,
  ask: (message: string) => boolean = (m) => window.confirm(m),
): boolean {
  const answer = ask(message);
  page.dispatchEvent(new Event(FRAMES_STOPPED_EVENT));
  return answer;
}
