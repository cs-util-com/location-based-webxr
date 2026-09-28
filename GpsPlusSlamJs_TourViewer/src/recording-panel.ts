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
 * - Save is a page action: it is disabled while a session runs (the zip is
 *   read from the folder the session is still writing into, and a download
 *   needs its own tap anyway), shows it is busy, and ends on the durable
 *   outcome - the file's name, that nothing was saved, or the reason it
 *   failed (the async-UI rule).
 *
 * The module reaches no globals: every element, the clock and the hand-off
 * arrive as dependencies, so it is tested in node.
 *
 * @see recording-panel.ts.md
 */

import type { ShareOrDownloadResult } from "gps-plus-slam-app-framework/storage";

import type {
  AuthoringRecording,
  RecordingStatus,
} from "./authoring-recording.js";

export const SAVE_RECORDING_LABEL = "Save the recording";
export const SAVE_RECORDING_BUSY_LABEL = "Saving the recording…";

export interface RecordingPanelDom {
  /** "Record this session for troubleshooting" (step 4, before AR). */
  optIn: HTMLInputElement;
  /** Inside `#ar-root`: visible over the camera and on the page. */
  marker: HTMLElement;
  saveButton: HTMLButtonElement;
  /** The last save's outcome. */
  status: HTMLElement;
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

/** What a finished hand-off did, in the creator's words. */
function saveOutcomeText(
  outcome: ShareOrDownloadResult,
  filename: string,
): string {
  if (!outcome.delivered) {
    return `Nothing was saved - tap ${SAVE_RECORDING_LABEL} again.`;
  }
  return outcome.route === "share"
    ? `Shared as ${filename}.`
    : `Saved as ${filename}.`;
}

export function wireRecordingPanel(deps: {
  recording: AuthoringRecording;
  dom: RecordingPanelDom;
  /** Flush, write `session.json`, zip (the recording's `save`, bound). */
  save: () => Promise<{ blob: Blob; filename: string }>;
  /** The share sheet or a save picker - the same seam as the tour zip's. */
  handOff: (blob: Blob, filename: string) => Promise<ShareOrDownloadResult>;
  sessionLive: () => boolean;
  now: () => Date;
}): RecordingPanel {
  const { recording, dom } = deps;
  let busy = false;

  function render(): void {
    const status = recording.status();
    const marker = recordingMarkerText(status);
    dom.marker.hidden = marker === null;
    if (dom.marker.textContent !== (marker ?? "")) {
      dom.marker.textContent = marker ?? "";
    }
    const on = status.kind === "on";
    dom.optIn.disabled = status.kind !== "off";
    dom.saveButton.hidden = !on;
    dom.saveButton.disabled = busy || deps.sessionLive();
  }

  dom.saveButton.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    dom.saveButton.textContent = SAVE_RECORDING_BUSY_LABEL;
    dom.status.textContent = "";
    render();
    void (async () => {
      try {
        const saved = await deps.save();
        const outcome = await deps.handOff(saved.blob, saved.filename);
        dom.status.textContent = saveOutcomeText(outcome, saved.filename);
      } catch (err) {
        dom.status.textContent = `Could not save the recording: ${
          err instanceof Error ? err.message : String(err)
        }`;
      } finally {
        busy = false;
        dom.saveButton.textContent = SAVE_RECORDING_LABEL;
        render();
      }
    })();
  });

  render();
  return {
    beginOnArEntry: () => {
      if (dom.optIn.checked && recording.status().kind === "off") {
        recording.start(deps.now());
      }
      render();
      return recording.persistWhile();
    },
    render,
  };
}
