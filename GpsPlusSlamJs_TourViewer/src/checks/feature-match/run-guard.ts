/**
 * Guards a long timing run on a phone: holds the screen wake lock while it
 * runs (taken again when the page comes back) and records whether the page
 * was hidden at any moment, since a hidden page is throttled and its
 * numbers are not the device's.
 *
 * @see run-guard.ts.md
 */

/** The report's error line for a run during which the page was hidden. */
export const HIDDEN_DURING_RUNS = "page was hidden during runs";

interface WakeLockLike {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

export interface RunGuardEnv {
  readonly doc: {
    readonly visibilityState: DocumentVisibilityState;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
  };
  /** `navigator.wakeLock`, or undefined where the browser has none. */
  readonly wakeLock:
    { request(type: "screen"): Promise<WakeLockLike> } | undefined;
  readonly log: (line: string) => void;
}

export interface RunGuard {
  /** Whether the page was hidden at any moment since the guard started. */
  readonly wasHidden: () => boolean;
  /** Releases the lock and stops watching; safe to call twice. */
  readonly end: () => void;
}

const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** Starts guarding; call `end` when the run is over, also on failure. */
export function guardRun(env: RunGuardEnv): RunGuard {
  let hidden = false;
  let ended = false;
  let lock: WakeLockLike | null = null;
  let requesting = false;

  const releaseQuietly = (l: WakeLockLike): void => {
    l.release().catch(() => undefined);
  };

  const hold = async (): Promise<void> => {
    if (
      ended ||
      lock !== null ||
      requesting ||
      env.wakeLock === undefined ||
      env.doc.visibilityState !== "visible"
    ) {
      return;
    }
    requesting = true;
    try {
      const l = await env.wakeLock.request("screen");
      if (ended) {
        releaseQuietly(l);
        return;
      }
      lock = l;
      // The browser releases it when the page is hidden.
      l.addEventListener("release", () => {
        if (lock === l) {
          lock = null;
        }
      });
    } catch (e) {
      env.log(`screen wake lock refused: ${errorText(e)}`);
    } finally {
      requesting = false;
    }
  };

  const onVisibility = (): void => {
    if (env.doc.visibilityState === "hidden") {
      hidden = true;
    } else {
      void hold();
    }
  };

  if (env.doc.visibilityState === "hidden") {
    hidden = true;
  }
  env.doc.addEventListener("visibilitychange", onVisibility);
  void hold();

  return {
    wasHidden: () => hidden,
    end: () => {
      if (ended) {
        return;
      }
      ended = true;
      env.doc.removeEventListener("visibilitychange", onVisibility);
      const l = lock;
      lock = null;
      if (l) {
        releaseQuietly(l);
      }
    },
  };
}
