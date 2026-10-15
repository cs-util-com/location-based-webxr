/**
 * The session the desktop editor's card reads its photos from once a save
 * replaced the bytes the opened file had (E2b plan review #2, #5): the
 * newest written copy, opened one at a time.
 *
 * WHY ONE AT A TIME (the E2b-2 milestone review #3). Opening a session over
 * a written copy starts its whole-archive check in the background
 * (`tour-session.ts`), which hashes a listed tour's entries again - about
 * 6 s per GiB - and cannot be stopped once it runs. Opened after every
 * autosave, those checks piled up. So while one copy's check runs, the
 * newest copy waits and replaces any copy that was waiting before it; the
 * photos read from the last copy that opened meanwhile, whose bytes are
 * this page's own and still read.
 *
 * @see photo-copy.ts.md
 */

/** What the page opens over a written copy (`openTourFile`'s session). */
export interface PhotoCopy {
  /** Its whole-archive check, run in the background from the open on. */
  readonly wholeArchiveCheck: Promise<unknown>;
  close(): Promise<void>;
}

export interface PhotoCopies<S extends PhotoCopy> {
  /** The copy the photos read from now; null before any save. */
  current(): S | null;
  /**
   * `file` is the newest written copy; `live()`: still the open tour's.
   * Resolves once it is the current copy (or did not open), or at once
   * when it waits behind a check that runs.
   */
  use(file: File, live: () => boolean): Promise<void>;
  /** The tour closed: its copy closes and a waiting one is dropped. A
   *  check still running is still waited for by the next copy. */
  clear(): void;
}

export function createPhotoCopies<S extends PhotoCopy>(
  open: (file: File) => Promise<S>,
): PhotoCopies<S> {
  let current: S | null = null;
  /** The newest copy not opened yet, while a check runs. */
  let waiting: { file: File; live: () => boolean } | null = null;
  /** A copy this module opened is still checking. */
  let checking = false;

  /** Open `file`; the session (whose check then runs) or null. */
  async function take(file: File, live: () => boolean): Promise<S | null> {
    let next: S;
    try {
      next = await open(file);
    } catch {
      // The current copy stays; a photo that no longer reads says so.
      return null;
    }
    if (live()) {
      void current?.close().catch(() => undefined);
      current = next;
    } else {
      void next.close().catch(() => undefined);
    }
    return next;
  }

  /** Wait for `running`'s check, then open the copy waiting meanwhile, in
   *  turn, until none waits. */
  async function drain(running: S | null): Promise<void> {
    try {
      let checked = running;
      for (;;) {
        await checked?.wholeArchiveCheck.catch(() => undefined);
        const next = waiting;
        waiting = null;
        if (next === null) return;
        checked = next.live() ? await take(next.file, next.live) : null;
      }
    } finally {
      checking = false;
    }
  }

  return {
    current: () => current,
    async use(file, live) {
      if (checking) {
        waiting = { file, live };
        return;
      }
      checking = true;
      const opened = await take(file, live);
      void drain(opened);
    },
    clear() {
      waiting = null;
      void current?.close().catch(() => undefined);
      current = null;
    },
  };
}
