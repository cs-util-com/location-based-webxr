import { describe, expect, it, vi } from "vitest";

import type { CodeTour } from "./code-tour.js";
import {
  createScanOpen,
  type OpenOutcome,
  type ScanOpenDeps,
} from "./scan-open.js";
import { createTourViewerSession } from "./tour-viewer-session.js";

/**
 * Why these tests matter (TourViewer scan-to-open plan §2, §9): the owner
 * decided step 4 needs no pasted link - the first code the camera reads
 * opens its tour. These pin the policy the second review reshaped: one open
 * per code at a time, retries only for causes a creator can fix (a file not
 * yet hosted, a refused host) and with backoff, a code of ANOTHER tour
 * switching only when nothing unfinished would be lost, and work measured
 * before any tour opened never landing in the wrong tour's zip.
 */

const A = "https://h.test/a.zip";
const B = "https://h.test/b.zip";
const codeOf = (url: string): string =>
  `https://gps.csutil.com/tour/?qr=${encodeURIComponent(url)}`;

function tour(url: string): CodeTour {
  // A short link is the one kind the real resolver cannot compare.
  const comparable = !url.startsWith("https://bit.ly/");
  return { kind: "tour", url, normalizedUrl: url, comparable };
}

/** Let resolutions and opens settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function setup(
  options: {
    openAt?: string | null;
    openedBy?: "scan" | "link";
    outcomes?: OpenOutcome[];
  } = {},
) {
  const ctx = createTourViewerSession();
  if (options.openAt != null) {
    ctx.session = { archive: { url: options.openAt } } as never;
    ctx.tourOpenedBy = options.openedBy ?? "scan";
  }
  const outcomes = [...(options.outcomes ?? [])];
  let clock = 0;
  let opening = false;
  const opened: string[] = [];
  const deps: ScanOpenDeps = {
    ctx,
    resolve: (text) => {
      const url = new URL(text).searchParams.get("qr");
      return Promise.resolve(
        url === null ? { kind: "not-a-tour-code" } : tour(url),
      );
    },
    open: (url) => {
      opened.push(url);
      opening = true;
      const outcome = outcomes.shift() ?? { kind: "opened" };
      return Promise.resolve().then(() => {
        opening = false;
        if (outcome.kind === "opened") {
          ctx.session = { archive: { url } } as never;
          ctx.tourOpenedBy = "scan";
        }
        return outcome;
      });
    },
    isOpening: () => opening,
    now: () => clock,
    render: vi.fn(),
  };
  const scan = createScanOpen(deps);
  /** Two detections a frame apart: the first resolves the code, the
   *  second acts on it - as the 8 Hz capture does. */
  const see = async (text: string): Promise<void> => {
    scan.onDetection(text);
    await settle();
    scan.onDetection(text);
    await settle();
  };
  return {
    ctx,
    scan,
    opened,
    see,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("a creator with no tour open", () => {
  it("opens the tour the first code names, once", async () => {
    const s = setup();
    await s.see(codeOf(A));
    await s.see(codeOf(A));
    expect(s.opened).toEqual([A]);
    expect(s.scan.status(codeOf(A)).kind).toBe("quiet");
  });

  it("starts one open however many frames arrive while it runs", async () => {
    const s = setup();
    s.scan.onDetection(codeOf(A));
    await settle();
    for (let i = 0; i < 5; i += 1) s.scan.onDetection(codeOf(A));
    expect(s.opened).toEqual([A]);
    expect(s.scan.status(codeOf(A)).kind).toBe("opening");
  });

  it("says a code that names no tour does not point to one", async () => {
    const s = setup();
    await s.see("https://menu.test/today");
    expect(s.opened).toEqual([]);
    expect(s.scan.status("https://menu.test/today").kind).toBe("not-a-tour");
  });

  it("does not open another tour than the one the level was measured from", async () => {
    // Plan §9 #4: X's open failed, the creator measured X anyway, then
    // walked past Y's poster - Y must not take X's level.
    const s = setup();
    s.ctx.mintedLevel = { id: "lvl-x", json: "{}" };
    s.ctx.mintedLevelTour = { levelId: "lvl-x", tourUrl: A };
    await s.see(codeOf(B));
    expect(s.opened).toEqual([]);
    expect(s.scan.status(codeOf(B)).kind).toBe("other-tour");
    await s.see(codeOf(A));
    expect(s.opened).toEqual([A]);
  });

  it("lets any tour take a level whose code named none", async () => {
    const s = setup();
    s.ctx.mintedLevel = { id: "lvl", json: "{}" };
    s.ctx.mintedLevelTour = { levelId: "lvl", tourUrl: null };
    await s.see(codeOf(B));
    expect(s.opened).toEqual([B]);
  });
});

describe("a failed open", () => {
  it("retries a file that is not hosted yet, with backoff", async () => {
    const s = setup({
      outcomes: [
        { kind: "failed", cause: "missing" },
        { kind: "failed", cause: "missing" },
      ],
    });
    await s.see(codeOf(A));
    expect(s.opened).toHaveLength(1);
    const failed = s.scan.status(codeOf(A));
    expect(failed).toEqual({
      kind: "failed",
      cause: "missing",
      retrying: true,
    });
    s.advance(9_999);
    await s.see(codeOf(A));
    expect(s.opened, "not before 10 s").toHaveLength(1);
    s.advance(1);
    await s.see(codeOf(A));
    expect(s.opened).toHaveLength(2);
    s.advance(19_999);
    await s.see(codeOf(A));
    expect(s.opened, "the second wait is 20 s").toHaveLength(2);
    s.advance(1);
    await s.see(codeOf(A));
    expect(s.opened).toHaveLength(3);
  });

  it("does not retry a file that is there but unreadable", async () => {
    const s = setup({ outcomes: [{ kind: "failed", cause: "corrupt" }] });
    await s.see(codeOf(A));
    s.advance(600_000);
    await s.see(codeOf(A));
    expect(s.opened).toHaveLength(1);
    expect(s.scan.status(codeOf(A))).toEqual({
      kind: "failed",
      cause: "corrupt",
      retrying: false,
    });
  });

  it("is tried afresh in the next AR session", async () => {
    const s = setup({ outcomes: [{ kind: "failed", cause: "corrupt" }] });
    await s.see(codeOf(A));
    s.ctx.arSessionGeneration += 1;
    await s.see(codeOf(A));
    expect(s.opened).toHaveLength(2);
  });
});

describe("a creator with a tour open", () => {
  it("does nothing for the open tour's own code", async () => {
    const s = setup({ openAt: A });
    await s.see(codeOf(A));
    expect(s.opened).toEqual([]);
    expect(s.scan.status(codeOf(A)).kind).toBe("quiet");
  });

  it("stays quiet about a code that names no tour", async () => {
    // Plan §9 #15: a third-party code near the poster must not talk over
    // the measuring readout.
    const s = setup({ openAt: A });
    await s.see("https://menu.test/today");
    expect(s.scan.status("https://menu.test/today").kind).toBe("quiet");
  });

  it("switches to another tour's code when nothing unfinished would be lost", async () => {
    const s = setup({ openAt: A });
    await s.see(codeOf(B));
    expect(s.opened).toEqual([B]);
  });

  it("keeps the tour, and says why, while placements are unfinished", async () => {
    const s = setup({ openAt: A });
    s.ctx.placedObjects = [{ object: { id: "p" } as never }];
    await s.see(codeOf(B));
    expect(s.opened).toEqual([]);
    expect(s.scan.status(codeOf(B)).kind).toBe("other-tour");
  });

  it("keeps the tour while a measured level is not finished", async () => {
    const s = setup({ openAt: A });
    s.ctx.mintedLevel = { id: "lvl", json: "{}" };
    await s.see(codeOf(B));
    expect(s.opened).toEqual([]);
  });

  it("keeps the tour while a finished zip has not been handed off", async () => {
    const s = setup({ openAt: A });
    s.ctx.mintedLevel = { id: "lvl", json: "{}" };
    s.ctx.rebuiltZip = { blob: new Blob([]), filename: "a.zip" };
    await s.see(codeOf(B));
    expect(s.opened).toEqual([]);
    s.ctx.rebuiltZipDelivered = true;
    await s.see(codeOf(B));
    expect(s.opened).toEqual([B]);
  });

  it("keeps the tour while a finish runs", async () => {
    const s = setup({ openAt: A });
    s.ctx.finishing = true;
    await s.see(codeOf(B));
    expect(s.opened).toEqual([]);
  });
});

describe("a tour the creator opened by its link", () => {
  // Plan §2 (owner): step 1's link stays for "a code that points somewhere
  // else (an old print)" - the creator chose this tour, so a code naming
  // another one is measured into it; switching would throw the choice away
  // and might open a dead old link.
  it("does not switch to another tour's code, and keeps Save on for it", async () => {
    const s = setup({ openAt: A, openedBy: "link" });
    await s.see(codeOf(B));
    expect(s.opened).toEqual([]);
    expect(s.scan.status(codeOf(B)).kind).toBe("other-link");
  });
});

describe("a code that cannot be compared with the open tour", () => {
  it("neither switches tours nor claims another tour", async () => {
    const s = setup({ openAt: A });
    await s.see(codeOf("https://bit.ly/x"));
    expect(s.opened).toEqual([]);
    expect(s.scan.status(codeOf("https://bit.ly/x")).kind).toBe("unknown");
  });
});

describe("tourOf", () => {
  it("names the tour of a code once it has been read", async () => {
    const s = setup();
    expect(s.scan.tourOf(codeOf(A))).toBeNull();
    await s.see(codeOf(A));
    expect(s.scan.tourOf(codeOf(A))).toBe(A);
    await s.see("https://menu.test/today");
    expect(s.scan.tourOf("https://menu.test/today")).toBeNull();
  });
});
