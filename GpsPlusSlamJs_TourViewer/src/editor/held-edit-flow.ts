/**
 * The page's run of an edit that reads first and may wait for the draft
 * question (Paste, a folder's Duplicate): the busy flag and a held
 * "working" toast while it reads, then the outcome said - a refusal by a
 * toast, a made edit by `made` - and, for an edit held by the draft gate
 * (`EditorHeld`), nothing until it lands: `made` once it is in the tour,
 * silence when it never gets there (the gate says that itself). Pure of
 * the DOM and the store: the page passes its own toast and flag.
 *
 * @see held-edit-flow.ts.md
 */
import type { EditorHeld } from "./editor-session.js";

/** The working toast as the flow needs it: marked busy, then removed. */
interface WorkingToast {
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** What `runHeldEdit` needs from the page. */
export interface HeldEditFlow<T> {
  /** The working toast's words, e.g. "Pasting...". */
  readonly working: string;
  /** The edit: what it made, held, or refused with words. */
  readonly run: () => Promise<
    T | EditorHeld<T> | { readonly kind: "refused"; readonly reason: string }
  >;
  /** Whether the editor that started it is still the page's: a tour
   *  switched meanwhile drops the outcome unsaid. */
  readonly current: () => boolean;
  /** Sets the page's "an edit is running" flag. */
  readonly busy: (on: boolean) => void;
  /** Shows a toast; `held` keeps it until removed. */
  readonly toast: (text: string, held: boolean) => WorkingToast;
  /** Redraws the page from the document. */
  readonly refresh: () => void;
  /** Says and shows what the edit made. */
  readonly made: (result: T) => void;
}

function isHeld<T>(value: unknown): value is EditorHeld<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "held" &&
    (value as { landed?: unknown }).landed instanceof Promise
  );
}

function isRefused(value: unknown): value is { reason: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "refused"
  );
}

/** Runs `flow`; resolves once its outcome is said, or, for a held edit,
 *  once it is known whether it landed (the busy flag and the working
 *  toast go before that wait: a held edit runs no more). The flag and
 *  the toast go however `run` ends, a throw included. */
export async function runHeldEdit<T>(flow: HeldEditFlow<T>): Promise<void> {
  const held = await ranUntilHeld(flow);
  if (held === null) return;
  const landed = await held.landed;
  if (landed === null || !flow.current()) return;
  flow.refresh();
  flow.made(landed);
}

/** `flow` run with its flag and working toast, its outcome said; the
 *  held edit, when it waits for the draft question, else null. */
async function ranUntilHeld<T>(
  flow: HeldEditFlow<T>,
): Promise<EditorHeld<T> | null> {
  flow.busy(true);
  const working = flow.toast(flow.working, true);
  working.setAttribute("aria-busy", "true");
  try {
    const outcome = await flow.run();
    if (!flow.current()) return null;
    flow.refresh();
    if (isRefused(outcome)) {
      flow.toast(outcome.reason, false);
      return null;
    }
    if (isHeld<T>(outcome)) return outcome;
    flow.made(outcome);
    return null;
  } finally {
    working.remove();
    flow.busy(false);
  }
}
