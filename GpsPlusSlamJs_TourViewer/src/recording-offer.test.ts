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
 * included.
 */
import { describe, expect, it, vi } from "vitest";

import {
  RECORDING_OFFER_SAVE_BUSY_LABEL,
  RECORDING_OFFER_SAVE_LABEL,
  wireRecordingOffer,
  type RecordingOfferDom,
} from "./recording-offer.js";

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

function harness(
  options: {
    pack?: (name: string) => Promise<{
      blob: Blob;
      filename: string;
      metadataError?: string;
      markSaved: (atMs: number) => Promise<boolean>;
    }>;
    discard?: (name: string) => Promise<void>;
    delivered?: boolean;
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
  const handOff = vi.fn(() =>
    Promise.resolve({
      route: "download" as const,
      delivered: options.delivered ?? true,
    }),
  );
  const reveal = vi.fn();
  const offer = wireRecordingOffer({
    dom: dom as unknown as RecordingOfferDom,
    pack,
    discard,
    handOff,
    now: () => NOW,
    describeTime: (ms) => `T+${String((ms - T0) / 3_600_000)}h`,
    reveal,
  });
  return { dom, offer, pack, discard, handOff, markSaved, reveal };
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

  it("Save it: busy while packing and handing over, then the saved name, the folder marked, and the next recording offered", async () => {
    const pending = deferred<{
      blob: Blob;
      filename: string;
      markSaved: (atMs: number) => Promise<boolean>;
    }>();
    const markSaved = vi.fn(() => Promise.resolve(true));
    const h = harness({ pack: () => pending.promise });
    h.offer.present([FIRST, SECOND]);
    expect(h.dom.text.textContent).toContain("(1 of 2)");

    h.dom.saveButton.click();
    expect(h.dom.saveButton.textContent).toBe(RECORDING_OFFER_SAVE_BUSY_LABEL);
    expect(h.dom.saveButton.disabled).toBe(true);
    expect(h.dom.dismissButton.disabled).toBe(true);
    expect(h.dom.discardButton.disabled).toBe(true);

    pending.resolve({
      blob: new Blob(["zip"]),
      filename: "tour-recording-2026-09-28_10-00-00utc.zip",
      markSaved,
    });
    await settle();

    expect(h.dom.status.textContent).toBe(
      "Saved as tour-recording-2026-09-28_10-00-00utc.zip.",
    );
    expect(markSaved).toHaveBeenCalledWith(NOW.getTime());
    expect(h.dom.saveButton.textContent).toBe(RECORDING_OFFER_SAVE_LABEL);
    expect(h.dom.saveButton.disabled).toBe(false);
    // The next one takes its place.
    expect(h.dom.offer.hidden).toBe(false);
    expect(h.dom.text.textContent).toBe(
      "The recording from T+1h was not saved. Save it or delete it? (2 of 2)",
    );
  });

  it("a hand-off that delivered nothing keeps the offer up and says so", async () => {
    const h = harness({ delivered: false });
    h.offer.present([FIRST]);
    h.dom.saveButton.click();
    await settle();
    expect(h.dom.status.textContent).toBe(
      `Nothing was saved - tap ${RECORDING_OFFER_SAVE_LABEL} again.`,
    );
    expect(h.markSaved).not.toHaveBeenCalled();
    expect(h.dom.offer.hidden).toBe(false);
    expect(h.dom.text.textContent).toContain("T+0h");
  });

  it("a failed save surfaces its reason and the offer stays", async () => {
    const h = harness({
      pack: () => Promise.reject(new Error("the folder is gone")),
    });
    h.offer.present([FIRST]);
    h.dom.saveButton.click();
    await settle();
    expect(h.dom.status.textContent).toBe(
      "Could not save the recording: the folder is gone",
    );
    expect(h.dom.offer.hidden).toBe(false);
    expect(h.dom.saveButton.disabled).toBe(false);
  });

  it("Not now hides the offer and deletes nothing: it comes back on the next open", () => {
    const h = harness();
    h.offer.present([FIRST, SECOND]);
    h.dom.dismissButton.click();
    expect(h.dom.offer.hidden).toBe(true);
    expect(h.discard).not.toHaveBeenCalled();
    expect(h.pack).not.toHaveBeenCalled();
  });

  it("Delete it: busy while deleting, then says what went, and offers the next", async () => {
    const pending = deferred<undefined>();
    const h = harness({ discard: () => pending.promise });
    h.offer.present([FIRST, SECOND]);
    h.dom.discardButton.click();
    expect(h.dom.discardButton.textContent).toBe("Deleting…");
    expect(h.dom.saveButton.disabled).toBe(true);
    expect(h.discard).toHaveBeenCalledWith(FIRST.name);

    pending.resolve(undefined);
    await settle();
    expect(h.dom.status.textContent).toBe("Deleted the recording from T+0h.");
    expect(h.dom.discardButton.textContent).toBe("Delete it");
    expect(h.dom.text.textContent).toContain("T+1h");

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
});
