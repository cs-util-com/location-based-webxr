/**
 * The offer of a recording a killed tab left unsaved (authoring recording
 * plan 2026-09-28-0953, M1b).
 *
 * Why these tests matter: the recording of a field session that went wrong
 * is most likely to be one whose tab was killed - by the phone, a call, a
 * back gesture - and nothing but this offer ever brings it back. It must
 * say which recording it is, never apply anything without a tap, keep the
 * folder on "Not now", save it through the same hand-off (and saved mark)
 * as "Save the recording", delete it only on "Delete it", and show each
 * async step's busy and final state (the async-UI rule), a failure
 * included. The save is TWO taps (M1b review #4): preparing parses every
 * action of a recording that may be an hour long, and a share sheet opened
 * after that has lost the tap's user activation - so the hand-off gets a
 * fresh tap of its own.
 */
import { describe, expect, it, vi } from "vitest";

import {
  RECORDING_OFFER_PREPARE_BUSY_LABEL,
  RECORDING_OFFER_SAVE_BUSY_LABEL,
  RECORDING_OFFER_SAVE_LABEL,
  wireRecordingOffer,
  type RecordingOfferDom,
} from "./recording-offer.js";
import {
  ANOTHER_SAVE_RUNNING,
  createSaveGuard,
  type SaveGuard,
} from "./recording-panel.js";

function el() {
  const handlers = new Map<string, () => void>();
  return {
    hidden: false,
    textContent: "",
    disabled: false,
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
  };
}

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

const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);
const NOW = new Date(T0 + 86_400_000);
const FIRST = { name: "recording-2026-09-28_10-00-00utc", startedAtMs: T0 };
const SECOND = {
  name: "recording-2026-09-28_11-00-00utc",
  startedAtMs: T0 + 3_600_000,
};

interface Packed {
  blob: Blob;
  filename: string;
  metadataError?: string;
  markSaved: (atMs: number) => Promise<boolean>;
}

function harness(
  options: {
    pack?: (name: string) => Promise<Packed>;
    discard?: (name: string) => Promise<void>;
    handOff?: () => Promise<{
      route: "share" | "download";
      delivered: boolean;
    }>;
    canShare?: boolean;
    saveGuard?: SaveGuard;
  } = {},
) {
  const dom = {
    offer: el(),
    text: el(),
    saveButton: el(),
    dismissButton: el(),
    discardButton: el(),
    status: el(),
  };
  dom.offer.hidden = true;
  const markSaved = vi.fn(() => Promise.resolve(true));
  const pack = vi.fn(
    options.pack ??
      ((name: string) =>
        Promise.resolve({
          blob: new Blob([name]),
          filename: `tour-recording-${name.slice("recording-".length)}.zip`,
          markSaved,
        })),
  );
  const discard = vi.fn(options.discard ?? (() => Promise.resolve()));
  const handOff = vi.fn(
    options.handOff ??
      (() => Promise.resolve({ route: "download" as const, delivered: true })),
  );
  const reveal = vi.fn();
  const saveGuard = options.saveGuard ?? createSaveGuard();
  const offer = wireRecordingOffer({
    dom: dom as unknown as RecordingOfferDom,
    pack,
    discard,
    handOff,
    canShare: () => options.canShare ?? false,
    now: () => NOW,
    describeTime: (ms) => `T+${String((ms - T0) / 3_600_000)}h`,
    reveal,
    saveGuard,
  });
  return { dom, offer, pack, discard, handOff, markSaved, reveal, saveGuard };
}

/** Tap "Save it" and let the preparation finish. */
async function prepare(h: ReturnType<typeof harness>): Promise<void> {
  h.dom.saveButton.click();
  await settle();
}

describe("the unsaved-recording offer", () => {
  it("offers nothing when nothing was left behind", () => {
    const h = harness();
    h.offer.present([]);
    expect(h.dom.offer.hidden).toBe(true);
    expect(h.reveal).not.toHaveBeenCalled();
  });

  it("names the recording by its start time, shows itself, and applies nothing until a tap", () => {
    const h = harness();
    h.offer.present([FIRST]);
    expect(h.dom.offer.hidden).toBe(false);
    expect(h.dom.text.textContent).toBe(
      "The recording from T+0h was not saved. Save it or delete it?",
    );
    // The offer lives in a step that may be collapsed (the draft offer's
    // lesson, M5 review #8): it reveals it.
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(h.pack).not.toHaveBeenCalled();
    expect(h.discard).not.toHaveBeenCalled();
  });

  it("Save it, step 1: busy while the zip is prepared, then ready with a Download button - and nothing handed over yet", async () => {
    const pending = deferred<Packed>();
    const h = harness({ pack: () => pending.promise });
    h.offer.present([FIRST, SECOND]);
    expect(h.dom.text.textContent).toContain("(1 of 2)");

    h.dom.saveButton.click();
    expect(h.dom.saveButton.textContent).toBe(
      RECORDING_OFFER_PREPARE_BUSY_LABEL,
    );
    expect(h.dom.saveButton.disabled).toBe(true);
    expect(h.dom.dismissButton.disabled).toBe(true);
    expect(h.dom.discardButton.disabled).toBe(true);

    pending.resolve({
      blob: new Blob(["zip"]),
      filename: "tour-recording-2026-09-28_10-00-00utc.zip",
      markSaved: h.markSaved,
    });
    await settle();

    // The hand-off needs a fresh tap: a share sheet opened now, long after
    // the first tap, would have lost its user activation.
    expect(h.handOff).not.toHaveBeenCalled();
    expect(h.dom.saveButton.textContent).toBe("Download it");
    expect(h.dom.saveButton.disabled).toBe(false);
    expect(h.dom.status.textContent).toBe(
      "Ready: tour-recording-2026-09-28_10-00-00utc.zip. Tap Download it to save it.",
    );
    expect(h.dom.text.textContent).toContain("T+0h");
  });

  it("the ready button says Share it where the page shares files", async () => {
    const h = harness({ canShare: true });
    h.offer.present([FIRST]);
    await prepare(h);
    expect(h.dom.saveButton.textContent).toBe("Share it");
  });

  it("Save it, step 2: busy while handing over, then the saved name, the folder marked, and the next recording offered", async () => {
    const pending = deferred<{ route: "download"; delivered: boolean }>();
    const h = harness({ handOff: () => pending.promise });
    h.offer.present([FIRST, SECOND]);
    await prepare(h);

    h.dom.saveButton.click();
    expect(h.dom.saveButton.textContent).toBe(RECORDING_OFFER_SAVE_BUSY_LABEL);
    expect(h.dom.saveButton.disabled).toBe(true);
    expect(h.dom.discardButton.disabled).toBe(true);
    pending.resolve({ route: "download", delivered: true });
    await settle();

    expect(h.pack).toHaveBeenCalledTimes(1);
    expect(h.dom.status.textContent).toBe(
      "Saved as tour-recording-2026-09-28_10-00-00utc.zip.",
    );
    expect(h.markSaved).toHaveBeenCalledWith(NOW.getTime());
    // The next one takes its place, back at step 1.
    expect(h.dom.saveButton.textContent).toBe(RECORDING_OFFER_SAVE_LABEL);
    expect(h.dom.saveButton.disabled).toBe(false);
    expect(h.dom.offer.hidden).toBe(false);
    expect(h.dom.text.textContent).toBe(
      "The recording from T+1h was not saved. Save it or delete it? (2 of 2)",
    );
  });

  it("a hand-off that delivered nothing keeps the prepared zip for another tap, without preparing it again", async () => {
    const h = harness({
      handOff: () => Promise.resolve({ route: "share", delivered: false }),
      canShare: true,
    });
    h.offer.present([FIRST]);
    await prepare(h);
    h.dom.saveButton.click();
    await settle();
    expect(h.dom.status.textContent).toBe(
      "Nothing was saved - tap Share it again.",
    );
    expect(h.markSaved).not.toHaveBeenCalled();
    expect(h.dom.offer.hidden).toBe(false);
    expect(h.dom.saveButton.textContent).toBe("Share it");

    h.dom.saveButton.click();
    await settle();
    expect(h.pack).toHaveBeenCalledTimes(1);
    expect(h.handOff).toHaveBeenCalledTimes(2);
  });

  it("a failed preparation surfaces its reason and the offer stays at step 1", async () => {
    const h = harness({
      pack: () => Promise.reject(new Error("the folder is gone")),
    });
    h.offer.present([FIRST]);
    await prepare(h);
    expect(h.dom.status.textContent).toBe(
      "Could not prepare the recording: the folder is gone",
    );
    expect(h.dom.offer.hidden).toBe(false);
    expect(h.dom.saveButton.disabled).toBe(false);
    expect(h.dom.saveButton.textContent).toBe(RECORDING_OFFER_SAVE_LABEL);
    expect(h.handOff).not.toHaveBeenCalled();
  });

  it("a failed hand-off surfaces its reason and keeps the prepared zip", async () => {
    const h = harness({
      handOff: () => Promise.reject(new Error("no save picker")),
    });
    h.offer.present([FIRST]);
    await prepare(h);
    h.dom.saveButton.click();
    await settle();
    expect(h.dom.status.textContent).toBe(
      "Could not save the recording: no save picker",
    );
    expect(h.dom.saveButton.textContent).toBe("Download it");
    expect(h.dom.saveButton.disabled).toBe(false);
    expect(h.dom.offer.hidden).toBe(false);
  });

  it("Not now hides the offer and deletes nothing: it comes back on the next open", () => {
    const h = harness();
    h.offer.present([FIRST, SECOND]);
    h.dom.dismissButton.click();
    expect(h.dom.offer.hidden).toBe(true);
    expect(h.discard).not.toHaveBeenCalled();
    expect(h.pack).not.toHaveBeenCalled();
  });

  it("Delete it: busy while deleting, then says what went, and offers the next at step 1", async () => {
    const pending = deferred<undefined>();
    const h = harness({ discard: () => pending.promise });
    h.offer.present([FIRST, SECOND]);
    await prepare(h);
    h.dom.discardButton.click();
    expect(h.dom.discardButton.textContent).toBe("Deleting…");
    expect(h.dom.saveButton.disabled).toBe(true);
    expect(h.discard).toHaveBeenCalledWith(FIRST.name);

    pending.resolve(undefined);
    await settle();
    expect(h.dom.status.textContent).toBe("Deleted the recording from T+0h.");
    expect(h.dom.discardButton.textContent).toBe("Delete it");
    expect(h.dom.text.textContent).toContain("T+1h");
    // The first recording's prepared zip does not carry over.
    expect(h.dom.saveButton.textContent).toBe(RECORDING_OFFER_SAVE_LABEL);

    h.dom.discardButton.click();
    await settle();
    expect(h.dom.offer.hidden).toBe(true);
  });

  it("a failed delete says so and keeps the recording offered", async () => {
    const h = harness({
      discard: () => Promise.reject(new Error("NoModificationAllowed")),
    });
    h.offer.present([FIRST]);
    h.dom.discardButton.click();
    await settle();
    expect(h.dom.status.textContent).toBe(
      "Could not delete the recording: NoModificationAllowed",
    );
    expect(h.dom.offer.hidden).toBe(false);
    expect(h.dom.discardButton.disabled).toBe(false);
  });

  it("a second tap while busy starts nothing more", () => {
    const pending = deferred<never>();
    const h = harness({ pack: () => pending.promise });
    h.offer.present([FIRST]);
    h.dom.saveButton.click();
    h.dom.saveButton.click();
    h.dom.discardButton.click();
    expect(h.pack).toHaveBeenCalledTimes(1);
    expect(h.discard).not.toHaveBeenCalled();
  });

  it("shares one in-progress guard with Save the recording: while that runs, Save it starts nothing and says why (M1b review #9)", async () => {
    const saveGuard = createSaveGuard();
    const h = harness({ saveGuard });
    h.offer.present([FIRST]);

    expect(saveGuard.tryStart()).toBe(true); // "Save the recording" runs
    h.dom.saveButton.click();
    expect(h.pack).not.toHaveBeenCalled();
    expect(h.dom.status.textContent).toBe(ANOTHER_SAVE_RUNNING);

    saveGuard.finish();
    h.dom.saveButton.click();
    // Held while preparing, given back once ready.
    expect(saveGuard.active()).toBe(true);
    await settle();
    expect(saveGuard.active()).toBe(false);

    expect(saveGuard.tryStart()).toBe(true);
    h.dom.saveButton.click(); // the hand-off step is guarded too
    expect(h.handOff).not.toHaveBeenCalled();
    expect(h.dom.status.textContent).toBe(ANOTHER_SAVE_RUNNING);
    saveGuard.finish();
  });
});
