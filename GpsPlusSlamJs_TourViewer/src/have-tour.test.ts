/**
 * "You already have a tour?" on a phone (tour editor plan 2026-10-17-1816,
 * W1; plan 2026-10-15-0348 round 2).
 *
 * Why these tests matter: a returning creator could not find their way
 * back into a tour - the page told only the first-time story. The box
 * opens a tour through the page's one open path and then asks "Play it, or
 * continue setting it up?", which the owner chose so the co-author case is
 * served too. These pin the async-UI rule (busy while the open runs, back
 * on both outcomes), what each outcome says, and that "Play it" is offered
 * only where a visitor's page can open the tour: a link, never a file.
 */
import { describe, expect, it, vi } from "vitest";

import { OpenRemoteArchiveError } from "gps-plus-slam-app-framework/storage";

import {
  FILE_OPENED_ASK,
  HAVE_TOUR_CORS_TEXT,
  HAVE_TOUR_FAILED_TEXT,
  HAVE_TOUR_LABELS,
  PLAY_OR_CONTINUE,
  wireHaveTour,
  type HaveTourDom,
} from "./have-tour.js";
import { HOST_REFUSED_TEXT, describeOpenError } from "./open-errors.js";
import type { OpenOutcome } from "./scan-open.js";

function el() {
  const handlers = new Map<
    string,
    (event: { preventDefault(): void }) => void
  >();
  return {
    textContent: "" as string | null,
    hidden: true,
    disabled: false,
    value: "",
    href: "",
    files: null as File[] | null,
    clicks: 0,
    click() {
      this.clicks += 1;
    },
    addEventListener: (
      type: string,
      handler: (event: { preventDefault(): void }) => void,
    ) => handlers.set(type, handler),
    fire: (type: string) =>
      handlers.get(type)?.({ preventDefault: () => undefined }),
  };
}

function wire(outcome: OpenOutcome = { kind: "opened" }) {
  const dom = {
    fileButton: el(),
    fileInput: el(),
    form: el(),
    linkInput: el(),
    linkButton: el(),
    status: el(),
    ask: el(),
    askText: el(),
    play: el(),
    continueButton: el(),
  };
  let settle: (o: OpenOutcome) => void = () => undefined;
  const pending = () =>
    new Promise<OpenOutcome>((resolve) => {
      settle = resolve;
    });
  const deps = {
    openFile: vi.fn(pending),
    openLink: vi.fn(pending),
    playHref: (url: string) => `?qr=${encodeURIComponent(url)}`,
    errorText: vi.fn(() => "That file is not a zip."),
    continueSetup: vi.fn(),
  };
  wireHaveTour({ dom: dom as unknown as HaveTourDom, ...deps });
  return {
    dom,
    deps,
    finish: async (o: OpenOutcome = outcome) => {
      settle(o);
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const LINK = "https://example.test/tours/castle.zip";

function submitLink(h: ReturnType<typeof wire>, url = LINK) {
  h.dom.linkInput.value = url;
  h.dom.form.fire("submit");
}

describe("wireHaveTour", () => {
  it("labels its buttons at once", () => {
    const h = wire();
    expect(h.dom.fileButton.textContent).toBe(HAVE_TOUR_LABELS.file);
    expect(h.dom.linkButton.textContent).toBe(HAVE_TOUR_LABELS.link);
  });

  it("opens a link through the page's open path, busy until it settles, then asks", async () => {
    const h = wire();
    submitLink(h, `  ${LINK} `);
    expect(h.deps.openLink).toHaveBeenCalledWith(LINK);
    expect(h.dom.linkButton.disabled).toBe(true);
    expect(h.dom.fileButton.disabled).toBe(true);
    expect(h.dom.linkButton.textContent).toBe(HAVE_TOUR_LABELS.busy);
    expect(h.dom.status.hidden).toBe(false);
    expect(h.dom.status.textContent).toBe("Opening the tour…");
    await h.finish();
    expect(h.dom.linkButton.disabled).toBe(false);
    expect(h.dom.linkButton.textContent).toBe(HAVE_TOUR_LABELS.link);
    expect(h.dom.fileButton.textContent).toBe(HAVE_TOUR_LABELS.file);
    expect(h.dom.status.hidden).toBe(true);
    expect(h.dom.ask.hidden).toBe(false);
    expect(h.dom.askText.textContent).toBe(PLAY_OR_CONTINUE);
    expect(h.dom.play.hidden).toBe(false);
    expect(h.dom.play.href).toBe(`?qr=${encodeURIComponent(LINK)}`);
  });

  it("does nothing for an empty link", () => {
    const h = wire();
    submitLink(h, "   ");
    expect(h.deps.openLink).not.toHaveBeenCalled();
    expect(h.dom.linkButton.disabled).toBe(false);
  });

  it("says why a host refused a link in the box's own words, pointing to From this device, and comes back", async () => {
    // M1 review #3: the box used step 2's printing message ("a printed
    // code would not open for visitors... pick another host in step 1"),
    // which answers a question the box never asked. Here the way around a
    // host that blocks browsers is the box's own other button.
    const h = wire();
    submitLink(h);
    await h.finish({ kind: "failed", cause: "cors" });
    expect(h.dom.linkButton.disabled).toBe(false);
    expect(h.dom.ask.hidden).toBe(true);
    expect(h.dom.status.hidden).toBe(false);
    expect(h.dom.status.textContent).toBe(HAVE_TOUR_CORS_TEXT);
    expect(h.dom.status.textContent).toContain(HOST_REFUSED_TEXT);
    expect(h.dom.status.textContent).toContain(`"${HAVE_TOUR_LABELS.file}"`);
    expect(h.dom.status.textContent).not.toMatch(/printed code|step 1/);
  });

  it("words any other failed link in the open's own words (the page's error box)", async () => {
    const h = wire();
    h.deps.errorText.mockReturnValue("Google Drive refused that file.");
    submitLink(h);
    await h.finish({ kind: "failed", cause: "other" });
    expect(h.dom.status.textContent).toBe("Google Drive refused that file.");
  });

  it("words a missing file in the open's own words when step 2 cleared its error box", async () => {
    // Step 2's check clears the error box for a link it tolerates (a file
    // not uploaded yet), so the box reads the cause's own sentence, never
    // step 2's "not verified yet, you can print".
    const h = wire();
    h.deps.errorText.mockReturnValue("");
    submitLink(h);
    await h.finish({ kind: "failed", cause: "missing" });
    expect(h.dom.status.textContent).toBe(
      describeOpenError(new OpenRemoteArchiveError("gone", "missing")),
    );
    expect(h.dom.status.textContent).not.toMatch(/print/);
  });

  it("falls back to a line of its own when nothing else words the failure", async () => {
    const h = wire();
    h.deps.errorText.mockReturnValue("");
    submitLink(h);
    await h.finish({ kind: "failed", cause: "other" });
    expect(h.dom.status.textContent).toBe(HAVE_TOUR_FAILED_TEXT);
  });

  it("comes back from an open that threw, and says it failed", async () => {
    const h = wire();
    h.deps.openLink.mockImplementationOnce(() =>
      Promise.reject(new Error("boom")),
    );
    submitLink(h);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.dom.linkButton.disabled).toBe(false);
    expect(h.dom.ask.hidden).toBe(true);
    expect(h.dom.status.textContent).not.toBe("");
  });

  it("opens a picked file and asks to continue, without Play: a file has no link", async () => {
    const h = wire();
    h.dom.fileButton.fire("click");
    expect(h.dom.fileInput.clicks).toBe(1);
    const file = new File(["x"], "castle.zip");
    h.dom.fileInput.files = [file];
    h.dom.fileInput.value = "C:\\fakepath\\castle.zip";
    h.dom.fileInput.fire("change");
    expect(h.deps.openFile).toHaveBeenCalledWith(file);
    // Cleared, so the same file can be picked again after a failure.
    expect(h.dom.fileInput.value).toBe("");
    expect(h.dom.status.textContent).toBe("Opening castle.zip…");
    expect(h.dom.fileButton.disabled).toBe(true);
    await h.finish();
    expect(h.dom.fileButton.disabled).toBe(false);
    expect(h.dom.ask.hidden).toBe(false);
    expect(h.dom.askText.textContent).toBe(FILE_OPENED_ASK);
    expect(h.dom.play.hidden).toBe(true);
  });

  it("says why a file failed, in the open's own words", async () => {
    const h = wire();
    h.dom.fileInput.files = [new File(["x"], "notes.txt")];
    h.dom.fileInput.fire("change");
    await h.finish({ kind: "failed", cause: "other" });
    expect(h.dom.status.textContent).toBe("That file is not a zip.");
    expect(h.dom.fileButton.disabled).toBe(false);
  });

  it("a closed picker opens nothing", () => {
    const h = wire();
    h.dom.fileInput.files = [];
    h.dom.fileInput.fire("change");
    expect(h.deps.openFile).not.toHaveBeenCalled();
  });

  it("a kept tour says so (the creator chose not to leave an unsaved one)", async () => {
    const h = wire();
    submitLink(h);
    await h.finish({ kind: "cancelled" });
    expect(h.dom.ask.hidden).toBe(true);
    expect(h.dom.status.textContent).toMatch(/Kept the tour that is open/);
  });

  it("Continue setting it up closes the question and goes back to the steps", async () => {
    const h = wire();
    submitLink(h);
    await h.finish();
    h.dom.continueButton.fire("click");
    expect(h.dom.ask.hidden).toBe(true);
    expect(h.deps.continueSetup).toHaveBeenCalledTimes(1);
  });

  it("a new open hides the last question until it settles", async () => {
    const h = wire();
    submitLink(h);
    await h.finish();
    submitLink(h, "https://example.test/other.zip");
    expect(h.dom.ask.hidden).toBe(true);
  });
});
