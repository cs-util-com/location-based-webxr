/**
 * The hand-off's save in isolation (the 2026-10-08 field test, F4): what
 * the status line keeps across saves. The composed behaviour - the Finish
 * saving by itself, the leave guard, the replace steps - is in
 * `creator-finish.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  DRIVE_COPY_LABELS,
  UPLOAD_ASK_LABELS,
  wireCreatorHandoff,
} from "./creator-handoff.js";
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

function wired(
  outcome: { delivered: boolean },
  onDelivered?: (rebuilt: { blob: Blob; filename: string }) => void,
) {
  const ctx = createTourViewerSession();
  ctx.session = {
    archive: { url: "https://example.test/tour.zip", size: 1 },
    hostedFileName: () => null,
  } as never;
  ctx.rebuiltZip = {
    blob: new Blob(["zip"]),
    filename: "tour.zip",
    written: createEmptyTourManifest(),
  };
  const dom = {
    downloadButton: el(),
    finishStatus: el(),
    replaceHelp: el(),
    replaceHelpGeneric: el(),
    replaceHelpDrive: el(),
    replaceDriveCopy: el(),
    uploadAsk: el(),
    uploadAskText: el(),
    uploadYes: el(),
    uploadNo: el(),
  };
  const handoff = wireCreatorHandoff({
    ctx,
    seams: { downloadZip: () => Promise.resolve(outcome.delivered) },
    dom: dom as never,
    render: () => undefined,
    ...(onDelivered === undefined ? {} : { onDelivered }),
  });
  return { ctx, dom, handoff };
}

describe("a save that delivered tells the page which file it was (debug-captures plan, Q-I)", () => {
  // Why: the file a Finish saved of a tour opened from a file opens under
  // the tour's own id from then on, and the page moves the draft there -
  // but only for a file the creator actually has. A save that did not
  // deliver (a dismissed picker) or that ended after the tour closed
  // must not move anything.
  it("hands over each delivered file, and none that was not", async () => {
    const outcome = { delivered: false };
    const heard: string[] = [];
    const { ctx, handoff } = wired(outcome, (rebuilt) => {
      heard.push(rebuilt.filename);
    });
    handoff.save();
    await flush();
    expect(heard).toEqual([]);
    outcome.delivered = true;
    handoff.save();
    await flush();
    expect(heard).toEqual(["tour.zip"]);
    handoff.save();
    ctx.openGeneration += 1;
    await flush();
    expect(heard).toEqual(["tour.zip"]);
  });
});

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
    ctx.rebuiltZip = {
      blob: new Blob(["zip"]),
      filename: "tour.zip",
      written: createEmptyTourManifest(),
    };
    const dom = {
      downloadButton: el(),
      finishStatus: el(),
      replaceHelp: el(),
      replaceHelpGeneric: el(),
      replaceHelpDrive: el(),
      replaceDriveCopy: el(),
      uploadAsk: el(),
      uploadAskText: el(),
      uploadYes: el(),
      uploadNo: el(),
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
    ctx.rebuiltZip = {
      blob: new Blob(["zip"]),
      filename: "tour.zip",
      written: createEmptyTourManifest(),
    };
    const dom = {
      downloadButton: el(),
      finishStatus: el(),
      replaceHelp: el(),
      replaceHelpGeneric: el(),
      replaceHelpDrive: el(),
      replaceDriveCopy: el(),
      uploadAsk: el(),
      uploadAskText: el(),
      uploadYes: el(),
      uploadNo: el(),
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

describe("the question after a download-only Finish (F19)", () => {
  // Why (F19, owner decision 2026-10-14): a page cannot know the creator
  // uploaded the file it saved, so a pin deleted later on the desktop came
  // back from the phone's draft. The phone asks ONCE per Finish - after
  // the save delivered, never before, never again for the same file - and
  // a yes is noted in the draft (`onUploaded`), with its progress and its
  // outcome on the line (async-UI rule).
  function wiredAsk(
    options: {
      delivered?: boolean;
      onUploaded?: () => Promise<boolean>;
    } = {},
  ) {
    const ctx = createTourViewerSession();
    ctx.session = {
      archive: { url: "https://example.test/tour.zip", size: 1 },
      hostedFileName: () => null,
    } as never;
    ctx.rebuiltZip = {
      blob: new Blob(["zip"]),
      filename: "tour.zip",
      written: createEmptyTourManifest(),
    };
    const dom = {
      downloadButton: el(),
      finishStatus: el(),
      replaceHelp: el(),
      replaceHelpGeneric: el(),
      replaceHelpDrive: el(),
      replaceDriveCopy: el(),
      uploadAsk: el(),
      uploadAskText: el(),
      uploadYes: el(),
      uploadNo: el(),
    };
    const answers: string[] = [];
    /** The manifests each yes noted. */
    const noted: TourManifest[] = [];
    const wiring = {
      ctx,
      dom,
      answers,
      noted,
      /** What the next save comes to. */
      delivered: options.delivered ?? true,
      handoff: null as unknown as ReturnType<typeof wireCreatorHandoff>,
    };
    wiring.handoff = wireCreatorHandoff({
      ctx,
      seams: {
        downloadZip: () => Promise.resolve(wiring.delivered),
      },
      dom: dom as never,
      render: () => undefined,
      onUploaded: (written) => {
        answers.push("yes");
        noted.push(written);
        return options.onUploaded?.() ?? Promise.resolve(true);
      },
    });
    return wiring;
  }

  it("is hidden until a save delivered the file", async () => {
    const { dom, handoff } = wiredAsk({ delivered: false });
    expect(dom.uploadAsk.hidden).toBe(true);
    handoff.save();
    await flush();
    expect(dom.uploadAsk.hidden).toBe(true);
  });

  it("asks after a delivered save, and a yes is noted with its progress and its outcome", async () => {
    let land: (ok: boolean) => void = () => undefined;
    const { dom, handoff, answers } = wiredAsk({
      onUploaded: () =>
        new Promise<boolean>((resolve) => {
          land = resolve;
        }),
    });
    handoff.save();
    await flush();
    expect(dom.uploadAsk.hidden).toBe(false);
    expect(dom.uploadAskText.textContent).toBe(UPLOAD_ASK_LABELS.question);
    expect(dom.uploadYes.textContent).toBe(UPLOAD_ASK_LABELS.yes);
    dom.uploadYes.click();
    expect(answers).toEqual(["yes"]);
    expect(dom.uploadYes.disabled).toBe(true);
    expect(dom.uploadNo.disabled).toBe(true);
    expect(dom.uploadAskText.textContent).toBe(UPLOAD_ASK_LABELS.noting);
    land(true);
    await flush();
    expect(dom.uploadAskText.textContent).toBe(UPLOAD_ASK_LABELS.noted);
    expect(dom.uploadYes.hidden).toBe(true);
    expect(dom.uploadNo.hidden).toBe(true);
    // A second tap cannot note it twice.
    dom.uploadYes.click();
    expect(answers).toEqual(["yes"]);
  });

  it("says when the yes could not be noted", async () => {
    const { dom, handoff } = wiredAsk({
      onUploaded: () => Promise.resolve(false),
    });
    handoff.save();
    await flush();
    dom.uploadYes.click();
    await flush();
    expect(dom.uploadAskText.textContent).toBe(UPLOAD_ASK_LABELS.failed);
    expect(dom.uploadYes.hidden).toBe(true);
  });

  // Why (F19 milestone review #9): "Not yet" was a dead end for the page
  // load - the file uploaded later, then saved again, was never asked
  // about. One question per save that delivered; a yes is never asked for
  // again.
  it("Not yet puts the question away, a later save of the same file asks once more, and a yes ends it", async () => {
    const { dom, handoff, answers } = wiredAsk();
    handoff.save();
    await flush();
    dom.uploadNo.click();
    expect(dom.uploadAsk.hidden).toBe(true);
    dom.downloadButton.click();
    await flush();
    expect(dom.uploadAsk.hidden).toBe(false);
    expect(dom.uploadYes.hidden).toBe(false);
    expect(answers).toEqual([]);
    dom.uploadYes.click();
    await flush();
    expect(dom.uploadAskText.textContent).toBe(UPLOAD_ASK_LABELS.noted);
    dom.downloadButton.click();
    await flush();
    expect(dom.uploadAskText.textContent).toBe(UPLOAD_ASK_LABELS.noted);
    expect(dom.uploadYes.hidden).toBe(true);
    expect(answers).toEqual(["yes"]);
  });

  // Why (F19 milestone review #2): the question stayed on screen through a
  // later Finish whose save did not go through, and a yes then noted THAT
  // file's versions - read from the draft's "last written" - as hosted.
  it("a yes notes the file the question was asked about, never a later Finish's", async () => {
    const { ctx, dom, handoff, noted } = wiredAsk();
    const asked = ctx.rebuiltZip!.written;
    handoff.save();
    await flush();
    // A later Finish made another file; its save has not run.
    ctx.rebuiltZip = {
      blob: new Blob(["zip 2"]),
      filename: "tour.zip",
      written: createEmptyTourManifest(),
    };
    dom.uploadYes.click();
    await flush();
    expect(noted).toHaveLength(1);
    expect(noted[0]).toBe(asked);
  });

  it("a new Finish, or a save of another file, takes the question away", async () => {
    const started = wiredAsk();
    started.handoff.save();
    await flush();
    started.handoff.finishStarted();
    expect(started.dom.uploadAsk.hidden).toBe(true);
    // A tap on the hidden question notes nothing.
    started.dom.uploadYes.click();
    await flush();
    expect(started.noted).toHaveLength(0);

    const other = wiredAsk({ delivered: false });
    other.delivered = true;
    other.handoff.save();
    await flush();
    expect(other.dom.uploadAsk.hidden).toBe(false);
    other.ctx.rebuiltZip = {
      blob: new Blob(["zip 2"]),
      filename: "tour.zip",
      written: createEmptyTourManifest(),
    };
    other.delivered = false;
    other.handoff.save();
    expect(other.dom.uploadAsk.hidden).toBe(true);
    await flush();
    expect(other.dom.uploadAsk.hidden).toBe(true);

    const offered = wiredAsk();
    offered.handoff.save();
    await flush();
    offered.ctx.rebuiltZip = {
      blob: new Blob(["zip 2"]),
      filename: "tour.zip",
      written: createEmptyTourManifest(),
    };
    offered.handoff.offer("");
    expect(offered.dom.uploadAsk.hidden).toBe(true);
  });

  it("asks again for the next Finish's file, and a closed tour takes the question away", async () => {
    const { ctx, dom, handoff } = wiredAsk();
    handoff.save();
    await flush();
    dom.uploadNo.click();
    ctx.rebuiltZip = {
      blob: new Blob(["zip 2"]),
      filename: "tour.zip",
      written: createEmptyTourManifest(),
    };
    handoff.save();
    await flush();
    expect(dom.uploadAsk.hidden).toBe(false);
    expect(dom.uploadYes.hidden).toBe(false);
    expect(dom.uploadYes.disabled).toBe(false);
    handoff.reset();
    expect(dom.uploadAsk.hidden).toBe(true);
  });
});
