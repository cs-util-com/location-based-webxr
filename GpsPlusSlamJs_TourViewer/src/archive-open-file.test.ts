/**
 * "Open a file" and the advice that leads to it (tour kit plan K0, K-D1).
 *
 * Why these tests matter: a link only opens when its host lets browsers
 * read the file; for every other host the page now says "download the file
 * and open it here" and offers the button right under the error. These
 * drive the real wiring (`wireArchiveOpen`) over stand-in elements and a
 * mocked session layer: the async-UI rule (every open button goes to
 * "Opening…" and comes back, on success and on failure), the advice shown
 * for a host that blocks browsers and NOT for an offline phone, and the
 * file tour's own identity (its content key, never a link) reaching the
 * draft and the print step.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRemoteArchiveError } from "gps-plus-slam-app-framework/storage";

import { wireArchiveOpen, type ArchiveOpenDom } from "./archive-open.js";
import {
  createTourViewerSession,
  createUnwiredHooks,
} from "./tour-viewer-session.js";

const mocks = vi.hoisted(() => ({
  openTourFile: vi.fn(),
  openTourSession: vi.fn(),
}));

vi.mock("./tour-session.js", () => ({
  openTourFile: mocks.openTourFile,
  openTourSession: mocks.openTourSession,
  tourLabel: (url: string) => url,
}));

/** A stand-in element: the fields the open path writes, and listeners. */
function el() {
  const handlers = new Map<
    string,
    (event: { preventDefault(): void }) => void
  >();
  return {
    textContent: "",
    hidden: true,
    disabled: false,
    value: "",
    open: false,
    files: null as File[] | null,
    clicks: 0,
    click() {
      this.clicks += 1;
    },
    replaceChildren: () => undefined,
    append: () => undefined,
    addEventListener: (
      type: string,
      handler: (event: { preventDefault(): void }) => void,
    ) => handlers.set(type, handler),
    fire: (type: string) =>
      handlers.get(type)?.({ preventDefault: () => undefined }),
  };
}

/** A session the open path can hold: no entries, nothing to read. */
function fakeSession(url: string) {
  return {
    entries: [],
    fromFile: url.startsWith("local-file:"),
    archive: { url, size: 10 },
    stats: () => ({
      networkBytes: 0,
      networkRequests: 0,
      cacheReads: 0,
      cacheBytes: 0,
      origin: "cache",
    }),
    loadTourManifest: () => Promise.resolve(null),
    loadQrLevels: () => Promise.resolve(new Map()),
    close: () => Promise.resolve(),
  };
}

function wire() {
  const dom = {
    form: el(),
    linkInput: el(),
    openButton: el(),
    openFileButton: el(),
    fileInput: el(),
    fileAdvice: el(),
    openFileAdviceButton: el(),
    fileStatus: el(),
    statsPanel: el(),
    statsHeadline: el(),
    statsDetail: el(),
    errorBox: el(),
    gallery: el(),
    storagePanel: el(),
    clearCacheButton: el(),
  };
  const hooks = {
    ...createUnwiredHooks(),
    presentLocalTour: vi.fn(),
    presentTourForPrint: vi.fn(),
    presentDraftForTour: vi.fn(),
  };
  const ctx = createTourViewerSession();
  wireArchiveOpen({
    ctx,
    dom: dom as unknown as ArchiveOpenDom,
    cacheStore: undefined,
    corsProxyBaseUrl: "https://proxy.test",
    hooks,
  });
  return { dom, hooks, ctx };
}

beforeEach(() => {
  mocks.openTourFile.mockReset();
  mocks.openTourSession.mockReset();
});

function pick(dom: ReturnType<typeof wire>["dom"], file: File): void {
  dom.fileInput.files = [file];
  dom.fileInput.fire("change");
}

describe("open a file", () => {
  it("both file buttons open the one picker", () => {
    const { dom } = wire();
    dom.openFileButton.fire("click");
    dom.openFileAdviceButton.fire("click");
    expect(dom.fileInput.clicks).toBe(2);
  });

  it("opens the picked file: in progress, then the file named, its key handed on", async () => {
    let finish!: (value: unknown) => void;
    mocks.openTourFile.mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );
    const { dom, hooks, ctx } = wire();
    pick(dom, new File(["zip"], "tour (1).zip"));

    await vi.waitFor(() => expect(mocks.openTourFile).toHaveBeenCalled());
    expect(dom.openFileButton.disabled).toBe(true);
    expect(dom.openFileButton.textContent).toBe("Opening…");
    // The picker is reset so the SAME file can be picked again.
    expect(dom.fileInput.value).toBe("");

    finish(fakeSession("local-file:abc"));
    await vi.waitFor(() => expect(dom.openFileButton.disabled).toBe(false));
    expect(dom.openFileButton.textContent).toBe("Open a file");
    expect(dom.fileStatus.hidden).toBe(false);
    expect(dom.fileStatus.textContent).toContain("tour (1).zip");
    expect(ctx.tourLabel).toBe("tour (1).zip");
    // No link to print: the local hook, never the print prefill.
    expect(hooks.presentLocalTour).toHaveBeenCalledWith("host-step");
    expect(hooks.presentTourForPrint).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(hooks.presentDraftForTour).toHaveBeenCalledWith("local-file:abc"),
    );
  });

  it("reports a failed file open and restores every button", async () => {
    mocks.openTourFile.mockRejectedValueOnce(
      new Error('"notes.zip" is not a readable tour zip.'),
    );
    const { dom } = wire();
    pick(dom, new File(["no"], "notes.zip"));
    await vi.waitFor(() =>
      expect(dom.errorBox.textContent).toContain("not a readable tour zip"),
    );
    expect(dom.openFileButton.disabled).toBe(false);
    expect(dom.openFileButton.textContent).toBe("Open a file");
    expect(dom.openFileAdviceButton.textContent).toBe(
      "Open the downloaded file",
    );
    expect(dom.fileAdvice.hidden).toBe(true);
  });

  it("does nothing when the picker closes without a file", () => {
    const { dom } = wire();
    dom.fileInput.files = [];
    dom.fileInput.fire("change");
    expect(mocks.openTourFile).not.toHaveBeenCalled();
    expect(dom.openFileButton.disabled).toBe(false);
  });
});

describe("the advice after a failed link", () => {
  async function failWith(cause: "cors" | "offline" | "missing") {
    mocks.openTourSession.mockRejectedValueOnce(
      new OpenRemoteArchiveError("x", cause),
    );
    const env = wire();
    env.dom.linkInput.value = "https://blocked.example/tour.zip";
    env.dom.form.fire("submit");
    await vi.waitFor(() => expect(env.dom.errorBox.textContent).not.toBe(""));
    return env;
  }

  it("a host that blocks browsers: download-and-open advice, with its button shown", async () => {
    const { dom } = await failWith("cors");
    expect(dom.errorBox.textContent).toContain("Download the file");
    expect(dom.fileAdvice.hidden).toBe(false);
  });

  it("offline: says so, and offers no download", async () => {
    const { dom } = await failWith("offline");
    expect(dom.errorBox.textContent).toContain("offline");
    expect(dom.fileAdvice.hidden).toBe(true);
  });

  it("a missing file: no download advice either", async () => {
    const { dom } = await failWith("missing");
    expect(dom.fileAdvice.hidden).toBe(true);
  });

  it("the advice goes away when the next open starts", async () => {
    const { dom } = await failWith("cors");
    expect(dom.fileAdvice.hidden).toBe(false);
    mocks.openTourFile.mockReturnValueOnce(new Promise(() => undefined));
    pick(dom, new File(["zip"], "tour.zip"));
    await vi.waitFor(() => expect(dom.fileAdvice.hidden).toBe(true));
  });
});
