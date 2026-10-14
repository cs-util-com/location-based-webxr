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
import { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";

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
    levelTexts: () => new Map(),
    integrity: { kind: "none" },
    integrityFailure: () => null,
    close: vi.fn(() => Promise.resolve()),
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
    tourTrust: el(),
    statsPanel: el(),
    statsHeadline: el(),
    statsDetail: el(),
    errorBox: el(),
    linkStatus: el(),
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
    mode: "creator",
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
    expect(dom.openFileButton.textContent).toBe("Open it from this device");
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

  // Why (code book plan M1): what the hosted zip holds for each code is the
  // Finish's baseline; it is kept with the levels, as they arrive.
  it("keeps the opened tour's level texts with its levels", async () => {
    const texts = new Map([["lvl", '{"version":1}']]);
    mocks.openTourFile.mockResolvedValueOnce({
      ...fakeSession("local-file:abc"),
      levelTexts: () => texts,
    });
    const { dom, ctx } = wire();
    pick(dom, new File(["zip"], "tour.zip"));
    await vi.waitFor(() => expect(ctx.currentLevels).not.toBeNull());
    expect(ctx.currentLevelTexts).toBe(texts);
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
    expect(dom.openFileButton.textContent).toBe("Open it from this device");
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
    // The check has settled once the status line says more than
    // "Checking"; a tolerated failure speaks there alone (PR #584).
    await vi.waitFor(() =>
      expect(env.dom.linkStatus.textContent).not.toMatch(/^Checking/),
    );
    return env;
  }

  it("a host that blocks browsers: download-and-open advice, with its button shown", async () => {
    const { dom } = await failWith("cors");
    expect(dom.errorBox.textContent).toContain("Download the file");
    expect(dom.fileAdvice.hidden).toBe(false);
  });

  it("offline: says so, and offers no download", async () => {
    const { dom } = await failWith("offline");
    expect(dom.linkStatus.textContent).toContain("offline");
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

describe("the signature line (tour kit plan K1, K-D2)", () => {
  // Why this matters (r820 feedback R6, D-R3): the creator's step 2 said
  // "Not signed" under every starter zip - which is never signed - and
  // signing does not exist yet (tour kit K2). An unsigned tour without a
  // warning has no line, in both modes; the open still settles.
  it("shows no line for a tour without a manifest", async () => {
    mocks.openTourFile.mockResolvedValueOnce(fakeSession("local-file:abc"));
    const { dom, hooks } = wire();
    pick(dom, new File(["zip"], "tour.zip"));
    await vi.waitFor(() => {
      expect(hooks.presentLocalTour).toHaveBeenCalled();
    });
    await Promise.resolve();
    expect(dom.tourTrust.hidden).toBe(true);
    expect(dom.tourTrust.textContent).toBe("");
  });
});

describe("a late integrity failure (tour kit plan K1, §8 D3)", () => {
  // Why this matters: a range-streamed tour is checked entry by entry and
  // as a whole only once its download ends - by then it may be on screen,
  // in AR. The failure must remove the tour's content and say why, in the
  // page AND in the AR status line (the error box is outside the overlay),
  // and a failure from a tour that is no longer open must change nothing.
  async function openedFile() {
    const session = fakeSession("local-file:abc");
    mocks.openTourFile.mockResolvedValueOnce(session);
    const wired = wire();
    pick(wired.dom, new File(["zip"], "tour.zip"));
    await vi.waitFor(() => {
      expect(wired.ctx.session).toBe(session);
    });
    const options = mocks.openTourFile.mock.calls[0]?.[1] as {
      onIntegrityFailure: (err: TourIntegrityError, s: unknown) => void;
    };
    return { ...wired, session, report: options.onIntegrityFailure };
  }

  it("removes the open tour and says it does not match its list, in the page and the AR line", async () => {
    const { ctx, dom, session, report } = await openedFile();
    report(new TourIntegrityError("hash-mismatch", "bad bytes"), session);
    await vi.waitFor(() => {
      expect(dom.errorBox.textContent).toMatch(/does not match its own list/);
    });
    expect(ctx.session).toBeNull();
    expect(session.close).toHaveBeenCalled();
    expect(dom.errorBox.textContent).toMatch(/content was removed/);
    expect(ctx.contentError).toBe(dom.errorBox.textContent);
  });

  it("ignores a failure reported by a tour that is no longer open", async () => {
    const { ctx, dom, report } = await openedFile();
    const stale = fakeSession("local-file:old");
    report(new TourIntegrityError("hash-mismatch", "bad bytes"), stale);
    await Promise.resolve();
    expect(ctx.session).not.toBeNull();
    expect(dom.errorBox.textContent).toBe("");
  });
});

describe("step 2's link check (polish round M2, A13/A16)", () => {
  // Why these tests matter: the link is given once and checked by itself.
  // A link whose file is not there yet still goes on to printing, marked
  // unverified; a link that can never work for a visitor must not, or the
  // printed code fails for every one of them.
  function withUnverifiedHook() {
    const env = wire();
    const presentUnverifiedLink = vi.fn();
    env.hooks.presentUnverifiedLink = presentUnverifiedLink;
    return { ...env, presentUnverifiedLink };
  }

  it("a missing file: says 'not verified yet' and hands the link to printing", async () => {
    mocks.openTourSession.mockRejectedValueOnce(
      new OpenRemoteArchiveError("x", "missing"),
    );
    const { dom, presentUnverifiedLink } = withUnverifiedHook();
    dom.linkInput.value = "https://own.example/tour.zip";
    dom.form.fire("submit");
    expect(dom.linkStatus.hidden).toBe(false);
    expect(dom.linkStatus.textContent).toBe("Checking the link…");
    await vi.waitFor(() =>
      expect(presentUnverifiedLink).toHaveBeenCalledWith(
        "https://own.example/tour.zip",
      ),
    );
    expect(dom.linkStatus.textContent).toMatch(/not verified yet/i);
    // PRs #584/#585: the open's own error ("that file does not exist")
    // contradicted the status line's "that is fine"; the line speaks alone.
    expect(dom.errorBox.textContent).toBe("");
  });

  // PR #584 review: a cloud host gives its link once the file is there, so
  // a missing file is a wrong link - no hand-off, and the line says so.
  it("a missing file on a cloud host: check the link, no hand-off", async () => {
    mocks.openTourSession.mockRejectedValueOnce(
      new OpenRemoteArchiveError("x", "missing"),
    );
    const { dom, presentUnverifiedLink } = withUnverifiedHook();
    dom.linkInput.value = "https://drive.google.com/file/d/abc/view";
    dom.form.fire("submit");
    await vi.waitFor(() =>
      expect(dom.linkStatus.textContent).toMatch(/check that you copied/i),
    );
    expect(presentUnverifiedLink).not.toHaveBeenCalled();
  });

  // PR #585 review: a paste checks by itself, and tapping "Check link"
  // right after it (the field's change fires on that blur too) opened the
  // archive a second time while the first open was still running.
  it("does not start a second check of the link being checked", async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.openTourSession.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          finish = () => {
            resolve(fakeSession(url));
          };
        }),
    );
    const { dom } = wire();
    dom.linkInput.value = "https://h.example/tour.zip";
    dom.linkInput.fire("change");
    await vi.waitFor(() =>
      expect(mocks.openTourSession).toHaveBeenCalledTimes(1),
    );
    dom.form.fire("submit");
    // Long enough for a second open to reach the session layer.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.openTourSession).toHaveBeenCalledTimes(1);
    finish(undefined);
    await vi.waitFor(() =>
      expect(dom.linkStatus.textContent).toBe("Tour found - the link works."),
    );
    // Once it settled, the button is the explicit retry again.
    mocks.openTourSession.mockImplementation((url: string) =>
      Promise.resolve(fakeSession(url)),
    );
    dom.form.fire("submit");
    await vi.waitFor(() =>
      expect(mocks.openTourSession).toHaveBeenCalledTimes(2),
    );
  });

  it("a host that blocks browsers: no hand-off", async () => {
    mocks.openTourSession.mockRejectedValueOnce(
      new OpenRemoteArchiveError("x", "cors"),
    );
    const { dom, presentUnverifiedLink } = withUnverifiedHook();
    dom.linkInput.value = "https://blocked.example/tour.zip";
    dom.form.fire("submit");
    await vi.waitFor(() =>
      expect(dom.linkStatus.textContent).toMatch(/visitors/),
    );
    expect(presentUnverifiedLink).not.toHaveBeenCalled();
  });

  it("checks by itself on paste and when the field is left, once per link", async () => {
    mocks.openTourSession.mockImplementation((url: string) =>
      Promise.resolve(fakeSession(url)),
    );
    const { dom } = wire();
    dom.linkInput.value = "https://h.example/tour.zip";
    dom.linkInput.fire("paste");
    await vi.waitFor(() =>
      expect(dom.linkStatus.textContent).toBe("Tour found - the link works."),
    );
    // The paste's own `change` when the field is left: the same link.
    dom.linkInput.fire("change");
    expect(mocks.openTourSession).toHaveBeenCalledTimes(1);
    // A new link is checked again.
    dom.linkInput.value = "https://h.example/other.zip";
    dom.linkInput.fire("change");
    await vi.waitFor(() =>
      expect(mocks.openTourSession).toHaveBeenCalledTimes(2),
    );
  });
});

// Why (r857 review #4 and #5): the visitor's line above the button and its
// "needs no GPS" start read whether the tour's codes can place it, and that
// is known only once the levels settle - often after `tour.json`. Both
// outcomes must reach the visitor screen (`presentTourLevels`), and a read
// that failed must say so for good, or the tour stays "unknown" forever.
describe("the levels' settle reaches the visitor screen", () => {
  it("calls presentTourLevels once the levels are read", async () => {
    mocks.openTourFile.mockResolvedValueOnce(fakeSession("local-file:abc"));
    const { dom, hooks, ctx } = wire();
    const presentTourLevels = vi.spyOn(hooks, "presentTourLevels");
    pick(dom, new File(["zip"], "tour.zip"));
    await vi.waitFor(() => expect(presentTourLevels).toHaveBeenCalledOnce());
    expect(ctx.currentLevels).not.toBeNull();
    expect(ctx.levelsUnreadable).toBe(false);
  });

  it("marks a failed read unreadable and calls presentTourLevels", async () => {
    mocks.openTourFile.mockResolvedValueOnce({
      ...fakeSession("local-file:abc"),
      loadQrLevels: () => Promise.reject(new Error("bad qr/x.json")),
    });
    const { dom, hooks, ctx } = wire();
    const presentTourLevels = vi.spyOn(hooks, "presentTourLevels");
    pick(dom, new File(["zip"], "tour.zip"));
    await vi.waitFor(() => expect(presentTourLevels).toHaveBeenCalledOnce());
    expect(ctx.currentLevels).toBeNull();
    expect(ctx.levelsUnreadable).toBe(true);
    expect(dom.errorBox.textContent).toContain("printed-code levels failed");
  });
});
