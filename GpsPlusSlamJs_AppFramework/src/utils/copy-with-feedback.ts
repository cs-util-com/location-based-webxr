/**
 * Copy text to the clipboard from a button, and say how it went (Tour
 * Viewer follow-up F7, the shared-helper rule and the async-UI rule): busy
 * and disabled before the write, the real outcome after, the button usable
 * again in every case. The write runs INSIDE the promise chain, so one
 * that throws before it returns a promise (no clipboard on an http page,
 * some in-app browsers) ends in "failed" instead of sticking at busy.
 *
 * Deep-import it (`gps-plus-slam-app-framework/utils/copy-with-feedback`),
 * never through the `/utils` barrel.
 *
 * @see copy-with-feedback.ts.md
 */

import { createLogger } from './logger';

const log = createLogger('Copy');

/** The button, structurally (a plain object in unit tests). */
export interface CopyButton {
  disabled: boolean;
  textContent: string | null;
}

export interface CopyFeedback {
  /** While the write runs ("Copying…"). */
  readonly busy: string;
  /** After a write that resolved. */
  readonly done: string;
  /** After a write that rejected, threw, or was missing. */
  readonly failed: string;
  /** After the done label, e.g. to clear older advice. */
  readonly onDone?: () => void;
  /** After the failed label, e.g. to put advice on the page's error line. */
  readonly onFailed?: (error: unknown) => void;
}

/**
 * Write `text` with `write` (normally `navigator.clipboard.writeText`;
 * undefined where there is none), showing `labels` on `button`. Resolves
 * whether it was copied, and never rejects: a failed write is `false`, and
 * a hook that throws is logged, not passed on (PR #600 review, F17) - the
 * call sites discard the promise with `void`.
 */
export function copyWithFeedback(
  button: CopyButton,
  text: string,
  write: ((text: string) => Promise<void>) | undefined,
  labels: CopyFeedback
): Promise<boolean> {
  button.disabled = true;
  button.textContent = labels.busy;
  return Promise.resolve()
    .then(() => {
      if (write === undefined) throw new Error('no clipboard');
      return write(text);
    })
    .then(
      () => {
        button.textContent = labels.done;
        runHook(() => labels.onDone?.());
        return true;
      },
      (error: unknown) => {
        button.textContent = labels.failed;
        runHook(() => labels.onFailed?.(error));
        return false;
      }
    )
    .finally(() => {
      button.disabled = false;
    });
}

/** A hook's throw is the caller's bug, not the copy's outcome. */
function runHook(hook: () => void): void {
  try {
    hook();
  } catch (error) {
    log.warn('A copy hook threw:', error);
  }
}
