/**
 * The troubleshooting recording's page controls (authoring recording plan
 * 2026-09-28-0953 §3.1, M1a): the opt-in box in step 4, the "Recording"
 * marker inside the AR overlay root (so it shows over the camera AND on the
 * page), and "Save the recording" beside the box.
 *
 * - The box only ARMS the recording; it starts on the next AR entry, where
 *   the depth feature has to be requested anyway (decision D4), and it then
 *   runs for the rest of the page's life - the box locks on, because
 *   unticking it would promise a stop that does not exist.
 * - The box can arm only the page's FIRST AR entry. The store's zero
 *   reference is set by the first GPS fix of the first AR session and kept
 *   across sessions, so a recording started on a later entry would hold no
 *   `setZeroPos` and replay empty (M1a review finding 1). Once an AR session
 *   has run unrecorded, the box locks off and says to reload the page.
 * - Ticking it checks the free storage and WARNS when it is low; it never
 *   blocks (the estimate is the browser's guess at this page's share).
 * - Save is a page action: it is disabled while a session runs (the zip is
 *   read from the folder the session is still writing into, and a download
 *   needs its own tap anyway), shows it is busy, and ends on the durable
 *   outcome - the file's name, that nothing was saved, or the reason it
 *   failed (the async-UI rule). A zip saved without its `session.json`
 *   says so.
 *
 * The module reaches no globals: every element, the clock and the hand-off
 * arrive as dependencies, so it is tested in node.
 *
 * @see recording-panel.ts.md
 */

import type { ShareOrDownloadResult } from "gps-plus-slam-app-framework/storage";

import {
  lowStorageWarning,
  type AuthoringRecording,
  type RecordingStatus,
} from "./authoring-recording.js";

export const SAVE_RECORDING_LABEL = "Save the recording";
export const SAVE_RECORDING_BUSY_LABEL = "Saving the recording…";
/** The line a save tap gets while another save of the block runs. */
export const ANOTHER_SAVE_RUNNING =
  "Another recording is being saved - wait for it to finish.";
/** The notice when an unrecorded AR session has already run. */
const RELOAD_TO_RECORD = "Reload the page to record.";

export interface RecordingPanelDom {
  /** "Record this session for troubleshooting" (step 4, before AR). */
  optIn: HTMLInputElement;
  /** Inside `#ar-root`: visible over the camera and on the page. */
  marker: HTMLElement;
  saveButton: HTMLButtonElement;
  /** The last save's outcome. */
  status: HTMLElement;
  /** Beside the box: "reload the page to record", or the storage warning. */
  notice: HTMLElement;
}

export interface RecordingPanel {
  /** Called at each AR entry, before the session is requested: starts the
   *  recording when the box is ticked, and says whether this entry records
   *  (and therefore needs depth). */
  beginOnArEntry: () => boolean;
  render: () => void;
}

/** The marker's words for a status; null hides it. */
function recordingMarkerText(status: RecordingStatus): string | null {
  switch (status.kind) {
    case "off":
      return null;
    case "failed":
      return `The recording stopped: ${status.error}`;
    case "on":
      return status.failedWrites === 0
        ? "Recording this session"
        : `Recording this session - ${String(status.failedWrites)} writes failed`;
  }
}

/** What a finished hand-off did, in the author's words. `retryLabel` is
 *  the button that tries again. */
function saveOutcomeText(
  outcome: ShareOrDownloadResult,
  filename: string,
  metadataError: string | undefined,
  retryLabel: string,
): string {
  if (!outcome.delivered) {
    return `Nothing was saved - tap ${retryLabel} again.`;
  }
  const verb = outcome.route === "share" ? "Shared" : "Saved";
  return metadataError === undefined
    ? `${verb} as ${filename}.`
    : `${verb} as ${filename}, but without its session.json (${metadataError}) - the Recorder may replay it misaligned.`;
}

/** A packed recording, as the hand-off needs it (`PackedRecording`). */
interface HandableRecording {
  blob: Blob;
  filename: string;
  metadataError?: string;
  markSaved: (atMs: number) => Promise<boolean>;
}

/**
 * Hand a packed recording over, mark its folder saved when the hand-off
 * DELIVERED, and say what happened - the one path both "Save the
 * recording" and the orphan offer's "Save it" take (M1b).
 *
 * The mark comes after the hand-off, never before: a share sheet the
 * author closed handed nothing over, and a marked folder is one the
 * cleanup may delete. A mark that does not persist is not reported - the
 * zip WAS handed over; the folder is merely offered again next time.
 */
export async function handOverRecording(
  saved: HandableRecording,
  handOff: (blob: Blob, filename: string) => Promise<ShareOrDownloadResult>,
  now: () => Date,
  retryLabel: string,
): Promise<{ delivered: boolean; text: string }> {
  const outcome = await handOff(saved.blob, saved.filename);
  if (outcome.delivered) await saved.markSaved(now().getTime());
  return {
    delivered: outcome.delivered,
    text: saveOutcomeText(
      outcome,
      saved.filename,
      saved.metadataError,
      retryLabel,
    ),
  };
}

/**
 * One save at a time across the recording block (M1b review #9): "Save the
 * recording" and the orphan offer's steps each build a zip of up to a
 * gigabyte, open a share sheet, and write the block's one status line. The
 * page creates one guard and hands it to both.
 */
export interface SaveGuard {
  /** Take the guard: true when nothing else held it. */
  tryStart(): boolean;
  /** Give it back (in a `finally`). */
  finish(): void;
  active(): boolean;
}

export function createSaveGuard(): SaveGuard {
  let active = false;
  return {
    tryStart() {
      if (active) return false;
      active = true;
      return true;
    },
    finish() {
      active = false;
    },
    active: () => active,
  };
}

export function wireRecordingPanel(deps: {
  recording: AuthoringRecording;
  dom: RecordingPanelDom;
  /** Flush, write `session.json`, zip (the recording's `save`, bound). */
  save: () => Promise<HandableRecording>;
  /** The share sheet or a save picker - the same seam as the tour zip's. */
  handOff: (blob: Blob, filename: string) => Promise<ShareOrDownloadResult>;
  sessionLive: () => boolean;
  /** Whether an AR session has run (or runs) on this page. */
  arHasRun: () => boolean;
  /** `navigator.storage.estimate`, or undefined where there is none. */
  estimateStorage: () => Promise<StorageEstimate | undefined>;
  now: () => Date;
  /** Shared with the orphan offer (`createSaveGuard`). */
  saveGuard: SaveGuard;
}): RecordingPanel {
  const { recording, dom } = deps;
  let busy = false;
  /** The storage warning of the last tick; null when there is room. */
  let storageWarning: string | null = null;
  /** Counts ticks, so a slow estimate cannot outlive an untick. */
  let tickGeneration = 0;

  /** An unrecorded AR session has run: the box can no longer record. */
  function tooLateToRecord(status: RecordingStatus): boolean {
    return status.kind === "off" && deps.arHasRun();
  }

  function render(): void {
    const status = recording.status();
    const marker = recordingMarkerText(status);
    dom.marker.hidden = marker === null;
    if (dom.marker.textContent !== (marker ?? "")) {
      dom.marker.textContent = marker ?? "";
    }
    const on = status.kind === "on";
    const tooLate = tooLateToRecord(status);
    dom.optIn.disabled = status.kind !== "off" || tooLate;
    const notice = tooLate
      ? RELOAD_TO_RECORD
      : status.kind === "off" && dom.optIn.checked
        ? storageWarning
        : null;
    dom.notice.hidden = notice === null;
    // Written only on a change: render runs after every store dispatch.
    if (dom.notice.textContent !== (notice ?? "")) {
      dom.notice.textContent = notice ?? "";
    }
    dom.saveButton.hidden = !on;
    // The guard covers this panel's own save and the offer's.
    dom.saveButton.disabled = deps.saveGuard.active() || deps.sessionLive();
  }

  dom.optIn.addEventListener("change", () => {
    tickGeneration += 1;
    storageWarning = null;
    render();
    if (!dom.optIn.checked) return;
    const tick = tickGeneration;
    void (async () => {
      let warning: string | null = null;
      try {
        warning = lowStorageWarning(await deps.estimateStorage());
      } catch {
        // No estimate, no warning: it is advice, never a gate.
      }
      if (tick !== tickGeneration) return;
      storageWarning = warning;
      render();
    })();
  });

  dom.saveButton.addEventListener("click", () => {
    if (busy) return;
    if (!deps.saveGuard.tryStart()) {
      dom.status.textContent = ANOTHER_SAVE_RUNNING;
      return;
    }
    busy = true;
    dom.saveButton.textContent = SAVE_RECORDING_BUSY_LABEL;
    dom.status.textContent = "";
    render();
    void (async () => {
      try {
        const handed = await handOverRecording(
          await deps.save(),
          deps.handOff,
          deps.now,
          SAVE_RECORDING_LABEL,
        );
        dom.status.textContent = handed.text;
      } catch (err) {
        dom.status.textContent = `Could not save the recording: ${
          err instanceof Error ? err.message : String(err)
        }`;
      } finally {
        busy = false;
        deps.saveGuard.finish();
        dom.saveButton.textContent = SAVE_RECORDING_LABEL;
        render();
      }
    })();
  });

  render();
  return {
    beginOnArEntry: () => {
      const status = recording.status();
      if (
        dom.optIn.checked &&
        status.kind === "off" &&
        !tooLateToRecord(status)
      ) {
        recording.start(deps.now());
      }
      render();
      return recording.persistWhile();
    },
    render,
  };
}
