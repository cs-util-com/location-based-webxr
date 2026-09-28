/**
 * The troubleshooting recording's page controls: the opt-in, the
 * "Recording" marker, and "Save the recording".
 *
 * Why these tests matter (authoring recording plan 2026-09-28-0953 §3.1,
 * M1a): nothing may be written behind the creator's back, so the recording
 * starts only on an AR entry with the box ticked, and the marker is up for
 * as long as it runs. Saving builds a zip and hands it to the share sheet
 * or a save picker, which can take seconds - the async-UI rule: the button
 * shows it is busy, then the durable outcome (the file's name, or that
 * nothing was saved), and a failure surfaces instead of vanishing.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  AuthoringRecording,
  RecordingStatus,
} from "./authoring-recording.js";
import {
  SAVE_RECORDING_BUSY_LABEL,
  SAVE_RECORDING_LABEL,
  wireRecordingPanel,
  type RecordingPanelDom,
} from "./recording-panel.js";

function el() {
  const handlers = new Map<string, () => void>();
  return {
    hidden: false,
    textContent: "",
    disabled: false,
    checked: false,
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
  };
}

function fakeRecording(): AuthoringRecording & {
  setStatus(status: RecordingStatus): void;
} {
  let status: RecordingStatus = { kind: "off" };
  return {
    storageBackend: {} as never,
    persistWhile: () => status.kind === "on",
    status: () => status,
    start: vi.fn(() => {
      status = { kind: "on", failedWrites: 0 };
    }),
    save: vi.fn(),
    setStatus: (next) => {
      status = next;
    },
  };
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

const SAVED = {
  blob: new Blob(["zip"]),
  filename: "tour-recording-2026-09-28_10-00-00utc.zip",
  actionCount: 42,
};
const AT = new Date(Date.UTC(2026, 8, 28, 10, 0, 0));

function harness(
  options: {
    live?: boolean;
    save?: () => Promise<typeof SAVED>;
    handOff?: () => Promise<{
      route: "share" | "download";
      delivered: boolean;
    }>;
  } = {},
) {
  const dom = {
    optIn: el(),
    marker: el(),
    saveButton: el(),
    status: el(),
  };
  const recording = fakeRecording();
  const handOff = vi.fn(
    options.handOff ??
      (() => Promise.resolve({ route: "download" as const, delivered: true })),
  );
  const panel = wireRecordingPanel({
    recording,
    dom: dom as unknown as RecordingPanelDom,
    save: options.save ?? (() => Promise.resolve(SAVED)),
    handOff,
    sessionLive: () => options.live === true,
    now: () => AT,
  });
  return { dom, recording, handOff, panel };
}

describe("the opt-in and the marker", () => {
  it("an unticked box starts nothing: no recording, no marker, no Save", () => {
    const h = harness();

    expect(h.panel.beginOnArEntry()).toBe(false);

    expect(h.recording.start).not.toHaveBeenCalled();
    expect(h.dom.marker.hidden).toBe(true);
    expect(h.dom.saveButton.hidden).toBe(true);
  });

  it("a ticked box starts the recording at the AR entry, puts the marker up and locks the box on", () => {
    const h = harness();
    h.dom.optIn.checked = true;

    expect(h.panel.beginOnArEntry()).toBe(true);

    expect(h.recording.start).toHaveBeenCalledWith(AT);
    expect(h.dom.marker.hidden).toBe(false);
    expect(h.dom.marker.textContent).toBe("Recording this session");
    // A recording runs for the page's life: unticking would promise a stop
    // that never happens.
    expect(h.dom.optIn.disabled).toBe(true);
    expect(h.dom.saveButton.hidden).toBe(false);
  });

  it("a later AR entry keeps recording without starting a second one", () => {
    const h = harness();
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();

    expect(h.panel.beginOnArEntry()).toBe(true);
    expect(h.recording.start).toHaveBeenCalledTimes(1);
  });

  it("the marker counts failed writes, and says so when the recording could not start", () => {
    const h = harness();
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();

    h.recording.setStatus({ kind: "on", failedWrites: 3 });
    h.panel.render();
    expect(h.dom.marker.textContent).toBe(
      "Recording this session - 3 writes failed",
    );

    h.recording.setStatus({ kind: "failed", error: "no OPFS here" });
    h.panel.render();
    expect(h.dom.marker.hidden).toBe(false);
    expect(h.dom.marker.textContent).toBe(
      "The recording stopped: no OPFS here",
    );
    expect(h.dom.saveButton.hidden).toBe(true);
    expect(h.panel.beginOnArEntry()).toBe(false);
  });

  it("Save waits for the page: it is disabled while an AR session runs", () => {
    const h = harness({ live: true });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();

    expect(h.dom.saveButton.disabled).toBe(true);
  });
});

describe("Save the recording", () => {
  it("shows it is busy while the zip is built and handed over, then names the saved file", async () => {
    const pending = deferred<typeof SAVED>();
    const h = harness({ save: () => pending.promise });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();

    h.dom.saveButton.click();
    expect(h.dom.saveButton.disabled).toBe(true);
    expect(h.dom.saveButton.textContent).toBe(SAVE_RECORDING_BUSY_LABEL);

    pending.resolve(SAVED);
    await settle();

    expect(h.handOff).toHaveBeenCalledWith(SAVED.blob, SAVED.filename);
    expect(h.dom.status.textContent).toBe(
      "Saved as tour-recording-2026-09-28_10-00-00utc.zip.",
    );
    expect(h.dom.saveButton.disabled).toBe(false);
    expect(h.dom.saveButton.textContent).toBe(SAVE_RECORDING_LABEL);
  });

  it("says SHARED on the share route, and says nothing was saved when nothing left the page", async () => {
    const shared = harness({
      handOff: () => Promise.resolve({ route: "share", delivered: true }),
    });
    shared.dom.optIn.checked = true;
    shared.panel.beginOnArEntry();
    shared.dom.saveButton.click();
    await settle();
    expect(shared.dom.status.textContent).toBe(
      "Shared as tour-recording-2026-09-28_10-00-00utc.zip.",
    );

    const dismissed = harness({
      handOff: () => Promise.resolve({ route: "download", delivered: false }),
    });
    dismissed.dom.optIn.checked = true;
    dismissed.panel.beginOnArEntry();
    dismissed.dom.saveButton.click();
    await settle();
    expect(dismissed.dom.status.textContent).toBe(
      "Nothing was saved - tap Save the recording again.",
    );
  });

  it("a failure surfaces with its reason and the button comes back", async () => {
    const h = harness({
      save: () => Promise.reject(new Error("quota exceeded")),
    });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();

    h.dom.saveButton.click();
    await settle();

    expect(h.dom.status.textContent).toBe(
      "Could not save the recording: quota exceeded",
    );
    expect(h.dom.saveButton.disabled).toBe(false);
    expect(h.dom.saveButton.textContent).toBe(SAVE_RECORDING_LABEL);
  });

  it("a second tap while busy starts no second save", () => {
    const pending = deferred<typeof SAVED>();
    const save = vi.fn(() => pending.promise);
    const h = harness({ save });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();

    h.dom.saveButton.click();
    h.dom.saveButton.click();

    expect(save).toHaveBeenCalledTimes(1);
  });
});
