/**
 * When the desktop editor saves by itself (M6 E2b-2, owner question Q-E2-4:
 * yes, a few seconds after a change). Page-free: the page says when a
 * committed change was made and when a hold may have ended, and runs the
 * save it is asked for; this module only decides WHEN.
 *
 * THE RULES (the E2b plan and its review, #3, #7, #11):
 * - A save starts `delayMs` after the last committed change - and at the
 *   latest `maxWaitMs` after the first change not yet saved, so a creator
 *   who never pauses is still saved (a debounce alone starves a stream that
 *   trails off instead of ending).
 * - Never while the page holds it (`held()`: a delete's undo is live, a
 *   field is being typed in, a marker is being moved, another save runs,
 *   another tour is being opened). A save that fell due while held starts
 *   at the next `poke()` after the hold ended - or, when no poke comes (a
 *   field typed in and put back as it was commits nothing), at the next
 *   look, once per delay (the E2b-2 milestone review #4).
 * - One at a time: a change made while a save runs is saved after it.
 * - A save that did not land (a refusal, a disk error) PAUSES autosave
 *   until an explicit save or a download lands (`saved()`): no write loop
 *   against a file that refuses it.
 *
 * @see autosave.ts.md
 */

/** The quiet after the last change before the page saves by itself. Swept
 *  over 0.5 s to 10 s in `autosave.property.test.ts`. */
export const AUTOSAVE_DELAY_MS = 3_000;

/** The longest the first unsaved change waits while changes keep coming.
 *  Swept over 15 s to 120 s. */
export const AUTOSAVE_MAX_WAIT_MS = 30_000;

/**
 * The largest opened tour file the page saves by itself (the E2b-2
 * milestone review #3): 200 MiB. Every save rebuilds the tour with its
 * entries hashed and rewrites the whole file, which a sync client uploads
 * again - about 6 s and a full write per GiB, so the cost is linear in the
 * file's size and the timers only set how often it is paid. Above the cap
 * the creator saves with Save. A judgement, not a measurement: no large
 * tour's save was timed on a real disk or sync client.
 */
export const AUTOSAVE_MAX_BYTES = 200 * 1024 * 1024;

/** Whether a tour file of `bytes` is saved by itself; false for a size
 *  that is not a finite, non-negative number. */
export function autosaveFits(
  bytes: number,
  maxBytes: number = AUTOSAVE_MAX_BYTES,
): boolean {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= maxBytes;
}

/**
 * `off` - no file to write in place; `idle` - nothing to save; `waiting` -
 * a save is due at the timer; `held` - due, but the page holds it; `saving`
 * - a save runs; `paused` - the last save did not land.
 */
export type AutosaveState =
  "off" | "idle" | "waiting" | "held" | "saving" | "paused";

/** What a save came to: `saved` (it landed, or there was nothing to
 *  save), `failed` (refused or not written: autosave pauses), `held`
 *  (the page found a hold before it took its snapshot: the save waits for
 *  the next poke, nothing paused). */
export type AutosaveOutcome = "saved" | "failed" | "held";

export interface AutosaveDeps {
  /** Save the committed changes. Never called while another of its saves
   *  runs. A rejection counts as `failed`. */
  readonly save: () => Promise<AutosaveOutcome>;
  /** The page forbids a save now. */
  readonly held: () => boolean;
  /** Committed changes the file does not carry yet. */
  readonly pending: () => boolean;
  readonly delayMs?: number;
  readonly maxWaitMs?: number;
  /** Each change of state, for the page's readiness mark. */
  readonly onState?: (state: AutosaveState) => void;
}

export interface Autosave {
  state(): AutosaveState;
  /** On while the open tour can be written in place. */
  enable(on: boolean): void;
  /** A committed change was made. */
  changed(): void;
  /** A hold may have ended: a save that fell due meanwhile starts now. */
  poke(): void;
  /** An explicit save or a download landed: a pause ends. */
  saved(): void;
  /** An explicit save did not land: autosave pauses too. */
  failed(): void;
  /** The tour closed: timers cleared, nothing more is saved. */
  stop(): void;
}

function positive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number of ms`);
  }
  return value;
}

export function createAutosave(deps: AutosaveDeps): Autosave {
  const delayMs = positive("delayMs", deps.delayMs ?? AUTOSAVE_DELAY_MS);
  const maxWaitMs = positive(
    "maxWaitMs",
    deps.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS,
  );
  if (maxWaitMs < delayMs) {
    throw new RangeError("maxWaitMs must not be shorter than delayMs");
  }

  let enabled = false;
  let paused = false;
  let inFlight = false;
  /** A save fell due while the page held it. */
  let due = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastChange: number | null = null;
  /** The first change not yet in a save's snapshot. */
  let firstUnsaved: number | null = null;
  let current: AutosaveState = "off";
  /** Bumped by `stop()`: a save of a closed tour ends without effect. */
  let generation = 0;

  function show(next: AutosaveState): void {
    if (next === current) return;
    current = next;
    deps.onState?.(next);
  }

  function clear(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  /** The state when no timer, hold or save is in play. */
  function rest(): void {
    show(!enabled ? "off" : paused ? "paused" : "idle");
  }

  function arm(): void {
    if (!enabled || paused || inFlight) return;
    clear();
    if (!deps.pending()) {
      firstUnsaved = null;
      due = false;
      rest();
      return;
    }
    const now = Date.now();
    const last = lastChange ?? now;
    const first = firstUnsaved ?? last;
    const at = Math.min(last + delayMs, first + maxWaitMs);
    due = false;
    timer = setTimeout(fire, Math.max(0, at - now));
    show("waiting");
  }

  /** Due, but held: looked at again once per delay, so a hold that ends
   *  without a poke still saves (never sooner: no loop). */
  function hold(): void {
    due = true;
    show("held");
    clear();
    timer = setTimeout(fire, delayMs);
  }

  function fire(): void {
    timer = null;
    if (!enabled || paused || inFlight) return;
    if (!deps.pending()) {
      firstUnsaved = null;
      due = false;
      rest();
      return;
    }
    if (deps.held()) {
      hold();
      return;
    }
    run();
  }

  function run(): void {
    inFlight = true;
    due = false;
    // What changes from here on is the next save's (the session snapshots
    // before its first await).
    firstUnsaved = null;
    show("saving");
    const mine = generation;
    const startedAt = Date.now();
    let outcome: Promise<AutosaveOutcome>;
    try {
      outcome = deps.save();
    } catch {
      outcome = Promise.resolve("failed");
    }
    void outcome
      .catch((): AutosaveOutcome => "failed")
      .then((result) => {
        if (mine !== generation) return;
        inFlight = false;
        if (result === "failed") paused = true;
        if (!enabled || paused) {
          rest();
          return;
        }
        if (result === "held") {
          hold();
          return;
        }
        // Still pending with no change since the save began: the page's
        // count and its save disagree. Timed from now, never from a change
        // long past, so this is one retry per delay and never a loop.
        if (lastChange === null || lastChange < startedAt) {
          lastChange = Date.now();
        }
        arm();
      });
  }

  return {
    state: () => current,
    enable(on) {
      if (on === enabled) return;
      enabled = on;
      if (!on) {
        clear();
        due = false;
        rest();
        return;
      }
      rest();
      arm();
    },
    changed() {
      const now = Date.now();
      lastChange = now;
      firstUnsaved ??= now;
      arm();
    },
    poke() {
      if (!due) return;
      clear();
      fire();
    },
    saved() {
      paused = false;
      // The explicit save carried every change committed before it; a
      // change made while it ran is timed from the last change (the max
      // wait may run that much longer).
      firstUnsaved = null;
      if (deps.pending()) firstUnsaved = lastChange;
      if (inFlight) return;
      rest();
      arm();
    },
    failed() {
      paused = true;
      clear();
      due = false;
      if (!inFlight) rest();
    },
    stop() {
      generation += 1;
      inFlight = false;
      enabled = false;
      clear();
      due = false;
      paused = false;
      lastChange = null;
      firstUnsaved = null;
      rest();
    },
  };
}
