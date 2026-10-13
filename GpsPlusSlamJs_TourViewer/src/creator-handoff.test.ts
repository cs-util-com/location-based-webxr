/**
 * The hand-off's save in isolation (the 2026-10-08 field test, F4): what
 * the status line keeps across saves. The composed behaviour - the Finish
 * saving by itself, the leave guard, the replace steps - is in
 * `creator-finish.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { DRIVE_COPY_LABELS, wireCreatorHandoff } from "./creator-handoff.js";
import { FINISH_LABELS } from "./qr-author-mode.js";
import { hostReplaceText } from "./tour-host.js";
import { createTourViewerSession } from "./tour-viewer-session.js";

function el() {
  const handlers = new Map<string, () => void>();
  return {
    hidden: false,
    disabled: false,
    textContent: "",
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function wired(outcome: { delivered: boolean }) {
  const ctx = createTourViewerSession();
  ctx.session = {
    archive: { url: "https://example.test/tour.zip", size: 1 },
    hostedFileName: () => null,
  } as never;
  ctx.rebuiltZip = { blob: new Blob(["zip"]), filename: "tour.zip" };
  const dom = {
    downloadButton: el(),
    finishStatus: el(),
    replaceHelp: el(),
    replaceHelpGeneric: el(),
    replaceHelpDrive: el(),
    replaceDriveCopy: el(),
  };
  const handoff = wireCreatorHandoff({
    ctx,
    seams: { downloadZip: () => Promise.resolve(outcome.delivered) },
    dom: dom as never,
    render: () => undefined,
  });
  return { ctx, dom, handoff };
}

describe("the hand-off's status line", () => {
  // Why (F4 milestone review #4b): the Finish's result sentences - the
  // code's position (with a large-turn warning), a walk left out - stay
  // under the status of EVERY save, the button's later ones too; the old
  // tapped save replaced them with its own line.
  it("keeps the Finish's notes under every save's status", async () => {
    const outcome = { delivered: false };
    const { dom, handoff } = wired(outcome);
    handoff.save("The code's saved position was kept.");
    await flush();
    expect(dom.finishStatus.textContent).toBe(
      `${FINISH_LABELS.notSaved} The code's saved position was kept.`,
    );
    outcome.delivered = true;
    dom.downloadButton.click();
    await flush();
    expect(dom.finishStatus.textContent).toBe(
      `${FINISH_LABELS.saved("tour.zip")} The code's saved position was kept.`,
    );
  });

  // Why: a closed tour's notes must not reach the next tour's line.
  it("forgets the notes when the tour closes", async () => {
    const outcome = { delivered: true };
    const { dom, handoff } = wired(outcome);
    handoff.save("A note of the closed tour.");
    await flush();
    handoff.reset();
    handoff.save();
    await flush();
    expect(dom.finishStatus.textContent).toBe(FINISH_LABELS.saved("tour.zip"));
  });
});

describe("the replace steps follow the chosen host (polish round M2, step 6)", () => {
  // Why: the completion step names the creator's own host instead of a
  // paragraph about all of them; with no host chosen (a tour opened from a
  // link before step 1 existed) the paragraph stays as it was.
  function wiredWithHost(host: string | null) {
    const ctx = createTourViewerSession();
    ctx.session = {
      archive: { url: "https://example.test/tour.zip", size: 1 },
      hostedFileName: () => null,
    } as never;
    ctx.rebuiltZip = { blob: new Blob(["zip"]), filename: "tour.zip" };
    const dom = {
      downloadButton: el(),
      finishStatus: el(),
      replaceHelp: el(),
      replaceHelpGeneric: el(),
      replaceHelpDrive: el(),
      replaceDriveCopy: el(),
    };
    dom.replaceHelpGeneric.textContent = "The paragraph about every host.";
    const handoff = wireCreatorHandoff({
      ctx,
      seams: { downloadZip: () => Promise.resolve(true) },
      dom: dom as never,
      render: () => undefined,
      host: () => host as never,
    });
    return { dom, handoff };
  }

  it("shows the chosen host's own steps after a save", async () => {
    const { dom, handoff } = wiredWithHost("dropbox");
    handoff.save();
    await flush();
    expect(dom.replaceHelp.hidden).toBe(false);
    expect(dom.replaceHelpGeneric.textContent).toBe(hostReplaceText("dropbox"));
  });

  it("keeps the paragraph with no host chosen, and restores it when the tour closes", async () => {
    const none = wiredWithHost(null);
    none.handoff.save();
    await flush();
    expect(none.dom.replaceHelpGeneric.textContent).toBe(
      "The paragraph about every host.",
    );
    const { dom, handoff } = wiredWithHost("github");
    handoff.save();
    await flush();
    handoff.reset();
    expect(dom.replaceHelpGeneric.textContent).toBe(
      "The paragraph about every host.",
    );
  });
});

describe("the Drive address button (polish round M2, step 6)", () => {
  // Why (the owner's polish-round transcript): a Drive tour is replaced on
  // the Drive website, and the creator needs the file's address there; a
  // share into the Drive app would add a second file the link does not
  // point to. The copy is async, so it shows its progress and its outcome
  // (async-UI rule), and a failed copy shows the address to copy by hand.
  function wiredOnDrive(writeText: (text: string) => Promise<void>) {
    const ctx = createTourViewerSession();
    ctx.session = {
      archive: {
        url: "https://gps.csutil.com/api/drive-proxy?id=File_1",
        size: 1,
      },
      hostedFileName: () => "tour.zip",
    } as never;
    ctx.rebuiltZip = { blob: new Blob(["zip"]), filename: "tour.zip" };
    const dom = {
      downloadButton: el(),
      finishStatus: el(),
      replaceHelp: el(),
      replaceHelpGeneric: el(),
      replaceHelpDrive: el(),
      replaceDriveCopy: el(),
    };
    dom.replaceDriveCopy.hidden = true;
    const handoff = wireCreatorHandoff({
      ctx,
      seams: { downloadZip: () => Promise.resolve(true), copyText: writeText },
      dom: dom as never,
      render: () => undefined,
    });
    return { dom, handoff };
  }

  it("shows with the Drive steps and copies the file's Drive address", async () => {
    const copied: string[] = [];
    const { dom, handoff } = wiredOnDrive((text) => {
      copied.push(text);
      return Promise.resolve();
    });
    handoff.save();
    await flush();
    expect(dom.replaceDriveCopy.hidden).toBe(false);
    expect(dom.replaceDriveCopy.textContent).toBe(DRIVE_COPY_LABELS.idle);
    dom.replaceDriveCopy.click();
    expect(dom.replaceDriveCopy.disabled).toBe(true);
    expect(dom.replaceDriveCopy.textContent).toBe(DRIVE_COPY_LABELS.busy);
    await flush();
    expect(copied).toEqual(["https://drive.google.com/file/d/File_1/view"]);
    expect(dom.replaceDriveCopy.disabled).toBe(false);
    expect(dom.replaceDriveCopy.textContent).toBe(DRIVE_COPY_LABELS.done);
  });

  it("says when the copy failed and shows the address to copy by hand", async () => {
    const { dom, handoff } = wiredOnDrive(() =>
      Promise.reject(new Error("denied")),
    );
    handoff.save();
    await flush();
    dom.replaceDriveCopy.click();
    await flush();
    expect(dom.replaceDriveCopy.disabled).toBe(false);
    expect(dom.replaceDriveCopy.textContent).toBe(
      DRIVE_COPY_LABELS.failed("https://drive.google.com/file/d/File_1/view"),
    );
  });

  it("stays hidden for a tour that is not on Drive, and after a close", async () => {
    const { dom, handoff } = wired({ delivered: true });
    dom.replaceDriveCopy.hidden = true;
    handoff.save();
    await flush();
    expect(dom.replaceDriveCopy.hidden).toBe(true);
    const drive = wiredOnDrive(() => Promise.resolve());
    drive.handoff.save();
    await flush();
    drive.handoff.reset();
    expect(drive.dom.replaceDriveCopy.hidden).toBe(true);
  });
});
