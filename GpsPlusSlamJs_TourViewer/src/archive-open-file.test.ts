/**
 * "Open a file" (tour kit plan K0, K-D1).
 *
 * Why these tests matter: a link only opens when its host lets browsers
 * read the file; a zip on the device is the way around every other host.
 * These drive the real wiring (`wireArchiveOpen`) over stand-in elements
 * and a mocked session layer: the async-UI rule (the file button goes to
 * "Opening…" and comes back, on success and on failure), and the file
 * tour's own identity (its content key, never a link) reaching the draft
 * and the print step.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  it("the file button opens the picker", () => {
    const { dom } = wire();
    dom.openFileButton.fire("click");
    expect(dom.fileInput.clicks).toBe(1);
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
  });

  it("does nothing when the picker closes without a file", () => {
    const { dom } = wire();
    dom.fileInput.files = [];
    dom.fileInput.fire("change");
    expect(mocks.openTourFile).not.toHaveBeenCalled();
    expect(dom.openFileButton.disabled).toBe(false);
  });
});
