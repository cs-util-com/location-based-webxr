/**
 * The phone's "Save the debug data" (M2 of the debug-captures plan, E2):
 * a Finish leaves the walk out of the tour file by default, so the Done
 * step offers it as a file of its own - built from the bytes the first
 * Finish of the open tour read, never by reading the tour again: a tour
 * opened from a link reads its cache or its URL, which after a replace on
 * Drive is another file (plan M2 step 3).
 *
 * Why these tests matter: the tour file a creator puts at the link may be
 * the only copy they keep. A bundle built from the wrong bytes, a button
 * that stays busy, or a save that says nothing when it did not land loses
 * the walk without a word.
 */
import { describe, expect, it, vi } from "vitest";
import { DecompressionBudget } from "gps-plus-slam-app-framework/storage";

import {
  DEBUG_SAVE_LABELS,
  wireCreatorDebugSave,
  type CreatorDebugSaveDom,
} from "./creator-debug-save.js";
import { readDebugBundle } from "./debug-bundle.js";
import { sampleRecordingBytes } from "./test-support/sample-recording.js";
import { readZipBlobEntry, zipBlobEntryNames } from "./zip-blob.js";

function el() {
  const handlers = new Map<string, () => void>();
  return {
    hidden: true,
    disabled: false,
    textContent: "" as string | null,
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    fire: (type: string) => handlers.get(type)?.(),
  };
}

const TOUR = {
  seriesId: null,
  title: "Castle",
  fileName: "castle.zip",
} as const;

function wired(
  downloadZip: (blob: Blob, filename: string) => Promise<boolean> = () =>
    Promise.resolve(true),
) {
  const dom = {
    debugSave: el(),
    debugSaveText: el(),
    debugSaveButton: el(),
    debugSaveStatus: el(),
  };
  const ctx = { openGeneration: 1 };
  const seams = { downloadZip: vi.fn(downloadZip) };
  const save = wireCreatorDebugSave({
    ctx,
    seams,
    dom: dom as unknown as CreatorDebugSaveDom,
  });
  return { dom, ctx, seams, save };
}

/** An open tour as the module reads it: its budget, and no other read. */
function session(bytes: Blob) {
  return {
    budget: DecompressionBudget.forArchive(bytes.size),
    readWholeArchive: () => {
      throw new Error("the tour is never read again");
    },
  };
}

const recording = (): Blob => new Blob([sampleRecordingBytes()]);

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
}

describe("the phone's Save the debug data", () => {
  it("is offered only after a Finish that left the walk out, and goes with the tour", () => {
    const { dom, save } = wired();
    expect(dom.debugSave.hidden).toBe(true);
    const source = recording();
    const open = session(source);
    save.finished({ session: open, source, leftOut: true, tour: TOUR });
    expect(dom.debugSave.hidden).toBe(false);
    expect(dom.debugSaveText.textContent).toBe(DEBUG_SAVE_LABELS.line);
    expect(dom.debugSaveButton.textContent).toBe(DEBUG_SAVE_LABELS.idle);
    expect(dom.debugSaveButton.disabled).toBe(false);
    // A Finish the creator told to keep the walk: its file carries it.
    save.finished({ session: open, source, leftOut: false, tour: TOUR });
    expect(dom.debugSave.hidden).toBe(true);
    save.finished({ session: open, source, leftOut: true, tour: TOUR });
    save.reset();
    expect(dom.debugSave.hidden).toBe(true);
    expect(dom.debugSaveStatus.textContent).toBe("");
  });

  it("hands over the bundle of the FIRST Finish's bytes, under the tour's name, and says where it went", async () => {
    let finish!: (delivered: boolean) => void;
    const { dom, seams, save } = wired(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const source = recording();
    const open = session(source);
    save.finished({ session: open, source, leftOut: true, tour: TOUR });
    // A second Finish rebuilt from the first one's lean file: the walk is
    // in the bytes the first one read, and only there.
    const lean = new Blob(["not the walk"]);
    save.finished({
      session: open,
      source: lean,
      leftOut: true,
      tour: { ...TOUR, title: "Castle at night" },
    });
    dom.debugSaveButton.fire("click");
    // The async-UI rule: busy while the bundle is built and handed over.
    expect(dom.debugSaveButton.disabled).toBe(true);
    expect(dom.debugSaveButton.textContent).toBe(DEBUG_SAVE_LABELS.saving);
    // A second tap while it runs starts nothing.
    dom.debugSaveButton.fire("click");
    await vi.waitFor(() => {
      expect(seams.downloadZip).toHaveBeenCalledTimes(1);
    });
    const [blob, filename] = seams.downloadZip.mock.calls[0]!;
    expect(filename).toBe("castle-debug.zip");
    const names = await zipBlobEntryNames(blob);
    expect(names).toEqual(
      expect.arrayContaining([
        "session.json",
        "debug-bundle.json",
        "about-this-debug-data.txt",
      ]),
    );
    const read = await readDebugBundle(names, (name) =>
      readZipBlobEntry(blob, name),
    );
    // The newest name the tour carries.
    expect(read).toMatchObject({
      kind: "bundle",
      identity: { tour: "Castle at night", file: "castle.zip" },
    });
    finish(true);
    await vi.waitFor(() => {
      expect(dom.debugSaveStatus.textContent).toBe(
        DEBUG_SAVE_LABELS.saved("castle-debug.zip"),
      );
    });
    expect(dom.debugSaveButton.disabled).toBe(false);
    expect(dom.debugSaveButton.textContent).toBe(DEBUG_SAVE_LABELS.again);
  });

  it("says a save that did not land and one that failed, and gives the button back", async () => {
    for (const [download, said] of [
      [() => Promise.resolve(false), DEBUG_SAVE_LABELS.notSaved],
      [
        () => Promise.reject(new Error("storage full")),
        DEBUG_SAVE_LABELS.failed("storage full"),
      ],
    ] as const) {
      const { dom, save } = wired(download);
      const source = recording();
      save.finished({
        session: session(source),
        source,
        leftOut: true,
        tour: TOUR,
      });
      dom.debugSaveButton.fire("click");
      await vi.waitFor(() => {
        expect(dom.debugSaveStatus.textContent).toBe(said);
      });
      expect(dom.debugSaveButton.disabled).toBe(false);
      expect(dom.debugSaveButton.textContent).toBe(DEBUG_SAVE_LABELS.idle);
    }
  });

  it("says why when the bytes carry no recording, and saves nothing", async () => {
    const { dom, seams, save } = wired();
    const source = new Blob(["not a zip"]);
    save.finished({
      session: session(source),
      source,
      leftOut: true,
      tour: TOUR,
    });
    dom.debugSaveButton.fire("click");
    await vi.waitFor(() => {
      expect(dom.debugSaveStatus.textContent).toMatch(
        /^The debug data was not saved: /,
      );
    });
    expect(seams.downloadZip).not.toHaveBeenCalled();
    expect(dom.debugSaveButton.disabled).toBe(false);
  });

  it("lands nothing on the next tour when the tour closed while it was built", async () => {
    const { dom, ctx, seams, save } = wired();
    const source = recording();
    save.finished({
      session: session(source),
      source,
      leftOut: true,
      tour: TOUR,
    });
    dom.debugSaveButton.fire("click");
    ctx.openGeneration += 1;
    save.reset();
    await flush();
    expect(seams.downloadZip).not.toHaveBeenCalled();
    expect(dom.debugSaveStatus.textContent).toBe("");
    expect(dom.debugSave.hidden).toBe(true);
  });
});
