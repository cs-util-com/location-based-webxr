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

import {
  LOW_STORAGE_BYTES,
  type AuthoringRecording,
  type RecordingStatus,
} from "./authoring-recording.js";
import {
  ANOTHER_SAVE_RUNNING,
  createSaveGuard,
  SAVE_RECORDING_BUSY_LABEL,
  SAVE_RECORDING_LABEL,
  wireRecordingPanel,
  type RecordingPanelDom,
  type SaveGuard,
} from "./recording-panel.js";

function el() {
  const handlers = new Map<string, () => void>();
  const element = {
    hidden: false,
    textContent: "",
    disabled: false,
    checked: false,
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
    /** Tick or untick, as a tap on the switch does. */
    toggle: (checked: boolean) => {
      element.checked = checked;
      handlers.get("change")?.();
    },
  };
  return element;
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
  markSaved: () => Promise.resolve(true),
};
const AT = new Date(Date.UTC(2026, 8, 28, 10, 0, 0));
/** Plenty of room: ten times the warning threshold. */
const ROOMY: StorageEstimate = { usage: 0, quota: 10 * LOW_STORAGE_BYTES };

function harness(
  options: {
    live?: boolean;
    arHasRun?: () => boolean;
    estimateStorage?: () => Promise<StorageEstimate | undefined>;
    save?: () => Promise<{
      blob: Blob;
      filename: string;
      metadataError?: string;
      markSaved: (atMs: number) => Promise<boolean>;
    }>;
    handOff?: () => Promise<{
      route: "share" | "download";
      delivered: boolean;
    }>;
    saveGuard?: SaveGuard;
  } = {},
) {
  const saveGuard = options.saveGuard ?? createSaveGuard();
  const dom = {
    optIn: el(),
    marker: el(),
    saveButton: el(),
    status: el(),
    notice: el(),
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
    arHasRun: options.arHasRun ?? (() => false),
    estimateStorage: options.estimateStorage ?? (() => Promise.resolve(ROOMY)),
    now: () => AT,
    saveGuard,
  });
  return { dom, recording, handOff, panel, saveGuard };
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

  it("before any AR session the switch is free and no reload line shows", () => {
    // Why this test matters (M1a review finding 1): the other half of the
    // pair below - the lock must not fire on a fresh page, or nobody could
    // ever opt in.
    const h = harness({ arHasRun: () => false });

    expect(h.dom.optIn.disabled).toBe(false);
    expect(h.dom.notice.hidden).toBe(true);
  });

  it("once an AR session has run unrecorded, the switch locks and says to reload the page", () => {
    // Why this test matters (M1a review finding 1): the store's zero
    // reference is set by the first GPS fix of the page's first AR session
    // and kept across sessions. A recording started on a later entry would
    // hold no `setZeroPos` and replay empty - so after an unrecorded
    // session the only honest offer is a fresh page.
    let hasRun = false;
    const h = harness({ arHasRun: () => hasRun });
    hasRun = true;
    h.panel.render();

    expect(h.dom.optIn.disabled).toBe(true);
    expect(h.dom.notice.hidden).toBe(false);
    expect(h.dom.notice.textContent).toBe("Reload the page to record.");
    // A box ticked anyway (the DOM allows a script to) starts nothing.
    h.dom.optIn.checked = true;
    expect(h.panel.beginOnArEntry()).toBe(false);
    expect(h.recording.start).not.toHaveBeenCalled();
  });

  it("a recording that runs keeps its switch locked on without the reload line", () => {
    // The lock above is for an UNRECORDED page; a running recording locks
    // the switch for its own reason and needs no reload.
    let hasRun = false;
    const h = harness({ arHasRun: () => hasRun });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();
    hasRun = true;
    h.panel.render();

    expect(h.dom.optIn.disabled).toBe(true);
    expect(h.dom.notice.hidden).toBe(true);
  });

  it("Save waits for the page: it is disabled while an AR session runs", () => {
    const h = harness({ live: true });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();

    expect(h.dom.saveButton.disabled).toBe(true);
  });
});

describe("the free-space check at opt-in", () => {
  // Why these tests matter (M1a review finding 3): a recording that fills
  // the phone's storage fails its writes part-way (each one counted on the
  // marker, but the recording is then incomplete). Ticking the box is the
  // one moment the creator can still free space or decide not to record,
  // so the check runs there - and it WARNS, never blocks: the estimate is
  // the browser's guess at this site's share, not the disk.
  it("warns when less than the threshold is free, and the box stays ticked", async () => {
    const h = harness({
      estimateStorage: () =>
        Promise.resolve({ usage: 0, quota: LOW_STORAGE_BYTES - 1 }),
    });

    h.dom.optIn.toggle(true);
    await settle();

    expect(h.dom.optIn.checked).toBe(true);
    expect(h.dom.notice.hidden).toBe(false);
    expect(h.dom.notice.textContent).toMatch(
      /^Only \d+ MB of storage is left for this page - about \d+ minutes of recording\.$/,
    );
    // Warned, not blocked: the entry still records.
    expect(h.panel.beginOnArEntry()).toBe(true);
  });

  it("says nothing when there is room, when the browser gives no estimate, or when the estimate fails", async () => {
    for (const estimateStorage of [
      () => Promise.resolve(ROOMY),
      () => Promise.resolve(undefined),
      () => Promise.resolve({}),
      () => Promise.reject(new Error("no storage manager")),
    ]) {
      const h = harness({ estimateStorage });
      h.dom.optIn.toggle(true);
      await settle();
      expect(h.dom.notice.hidden).toBe(true);
    }
  });

  it("unticking takes the warning away", async () => {
    const h = harness({
      estimateStorage: () => Promise.resolve({ usage: 0, quota: 1 }),
    });
    h.dom.optIn.toggle(true);
    await settle();
    h.dom.optIn.toggle(false);
    await settle();

    expect(h.dom.notice.hidden).toBe(true);
  });
});

describe("Save the recording", () => {
  it("names the saved file AND says session.json is missing when only the metadata could not be written", async () => {
    // Why this test matters (M1a review finding 3): the zip of what is on
    // disk is still worth handing over, but without session.json the
    // Recorder takes it for an old recording and migrates its coordinates -
    // the creator must know the zip is not the whole story.
    const h = harness({
      save: () =>
        Promise.resolve({ ...SAVED, metadataError: "quota exceeded" }),
    });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();

    h.dom.saveButton.click();
    await settle();

    expect(h.handOff).toHaveBeenCalledWith(SAVED.blob, SAVED.filename);
    expect(h.dom.status.textContent).toBe(
      "Saved as tour-recording-2026-09-28_10-00-00utc.zip, but without its session.json (quota exceeded) - the Recorder may replay it misaligned.",
    );
  });

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

  it("marks the folder saved only after a hand-off that delivered, at the moment it did (M1b)", async () => {
    // Why: the next page offers every folder without the mark, and the
    // cleanup deletes only marked ones. A share sheet the author closed
    // handed nothing over - marking it would let the cleanup delete the
    // only copy.
    const delivered = vi.fn(() => Promise.resolve(true));
    const h = harness({
      save: () => Promise.resolve({ ...SAVED, markSaved: delivered }),
    });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();
    h.dom.saveButton.click();
    await settle();
    expect(delivered).toHaveBeenCalledWith(AT.getTime());

    const cancelled = vi.fn(() => Promise.resolve(true));
    const none = harness({
      save: () => Promise.resolve({ ...SAVED, markSaved: cancelled }),
      handOff: () => Promise.resolve({ route: "share", delivered: false }),
    });
    none.dom.optIn.checked = true;
    none.panel.beginOnArEntry();
    none.dom.saveButton.click();
    await settle();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("a mark that does not persist still reports the save: the zip was handed over, the folder is only offered again", async () => {
    const h = harness({
      save: () =>
        Promise.resolve({ ...SAVED, markSaved: () => Promise.resolve(false) }),
    });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();
    h.dom.saveButton.click();
    await settle();
    expect(h.dom.status.textContent).toBe(
      "Saved as tour-recording-2026-09-28_10-00-00utc.zip.",
    );
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

  it("shares one in-progress guard with the offer: while another save runs, a tap starts nothing and says why (M1b review #9)", async () => {
    // Why: "Save the recording" and the offer's "Save it" each build a zip
    // of up to a gigabyte and open a share sheet, and write one status
    // line. With a busy flag each, both could run at once.
    const saveGuard = createSaveGuard();
    const save = vi.fn(() => Promise.resolve(SAVED));
    const h = harness({ save, saveGuard });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();

    expect(saveGuard.tryStart()).toBe(true); // the offer's save runs
    h.panel.render();
    expect(h.dom.saveButton.disabled).toBe(true);
    h.dom.saveButton.click();
    expect(save).not.toHaveBeenCalled();
    expect(h.dom.status.textContent).toBe(ANOTHER_SAVE_RUNNING);

    saveGuard.finish();
    h.panel.render();
    expect(h.dom.saveButton.disabled).toBe(false);
    h.dom.saveButton.click();
    // Its own save holds the guard until it settles.
    expect(saveGuard.active()).toBe(true);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(saveGuard.active()).toBe(false);
  });

  it("follows the offer's save on its own: disabled while it runs, enabled again when it ends, with no other re-render", () => {
    // Why: the panel re-renders on store dispatches and AR state changes,
    // and after the AR exit neither happens. An offer save that ended then
    // left "Save the recording" disabled although nothing was running -
    // the button only came back with the next unrelated render.
    const saveGuard = createSaveGuard();
    const h = harness({ saveGuard });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();
    expect(h.dom.saveButton.disabled).toBe(false);

    expect(saveGuard.tryStart()).toBe(true); // the offer's save starts
    expect(h.dom.saveButton.disabled).toBe(true);
    saveGuard.finish(); // ...and ends
    expect(h.dom.saveButton.disabled).toBe(false);
  });

  it("a failed save gives the guard back", async () => {
    const saveGuard = createSaveGuard();
    const h = harness({
      save: () => Promise.reject(new Error("disk full")),
      saveGuard,
    });
    h.dom.optIn.checked = true;
    h.panel.beginOnArEntry();
    h.dom.saveButton.click();
    await settle();
    expect(saveGuard.active()).toBe(false);
  });
});
