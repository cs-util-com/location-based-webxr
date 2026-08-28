/**
 * The QR HUD row's per-session state: which code was seen most recently, its
 * short identity, and what the level lookup did for each code.
 *
 * WHY THIS IS A MODULE AND NOT THREE VARIABLES IN `main.ts`. It was three
 * module-level `let`s, and nothing cleared them between AR sessions. The
 * accumulator IS rebuilt per session (`wireQrRecording` makes a fresh one), so
 * on the second session of a page load the newest-code scan found nothing, the
 * `newest !== latestText` guard never fired, and the row kept rendering the
 * PREVIOUS session's code against an empty accumulator - reading
 * `QR abc123: visit 0.` where the honest line is
 * `QR: scanning - no code seen yet.` Worse, the stale level state could append
 * `using its saved position` for a code this session had never seen.
 *
 * That is precisely the "looked like it worked" failure the QR row was added
 * to end, so the state that has to be reset now lives somewhere a test can
 * reach without standing up the whole AR session.
 *
 * @see qr-status-line.ts - renders a line from this plus the accumulator.
 * @see qr-level-source.ts - produces the level states fed in here.
 */

import type { QrLevelLookupState } from './qr-level-source';

/** What the status line needs from this state, alongside the accumulator. */
export interface QrHudSnapshot {
  latestText: string | null;
  latestId: string | null;
  levelState?: QrLevelLookupState;
}

export interface QrHudState {
  /**
   * Record the code with the most recent detection. Re-notifying the same
   * text is a no-op, so the id lookup runs once per code rather than per
   * frame.
   */
  noteNewest(text: string): void;
  /** Record what the level lookup did for one code. */
  noteLevelState(text: string, state: QrLevelLookupState): void;
  /** Forget everything. Called when an AR session starts. */
  reset(): void;
  /** The inputs `qrStatusLine` needs besides the accumulator. */
  snapshot(): QrHudSnapshot;
}

export interface QrHudStateDeps {
  /**
   * Resolve a code's short identity. Async and deliberately not awaited by
   * `noteNewest`: the readout falls back to a neutral label until it resolves
   * rather than blocking a frame callback, and a rejection costs only the
   * short label.
   */
  hashId: (text: string) => Promise<string>;
}

export function createQrHudState(deps: QrHudStateDeps): QrHudState {
  let latestText: string | null = null;
  let latestId: string | null = null;
  const levelStates = new Map<string, QrLevelLookupState>();
  /** Bumped on every reset so an id resolving after one cannot write into the
   *  new session's state - the same generation guard the frame paths use. */
  let generation = 0;

  return {
    noteNewest(text) {
      if (text === latestText) return;
      latestText = text;
      latestId = null;
      const armed = generation;
      void deps.hashId(text).then(
        (id) => {
          if (generation === armed && latestText === text) latestId = id;
        },
        () => {
          /* a failed hash only costs the short label */
        }
      );
    },

    noteLevelState(text, state) {
      levelStates.set(text, state);
    },

    reset() {
      latestText = null;
      latestId = null;
      levelStates.clear();
      generation += 1;
    },

    snapshot() {
      const levelState =
        latestText === null ? undefined : levelStates.get(latestText);
      return {
        latestText,
        latestId,
        ...(levelState !== undefined ? { levelState } : {}),
      };
    },
  };
}
