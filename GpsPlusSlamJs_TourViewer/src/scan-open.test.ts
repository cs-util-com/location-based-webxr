import { describe, expect, it, vi } from "vitest";

import type { CodeTour } from "./code-tour.js";
import {
  createScanOpen,
  type OpenOutcome,
  type ScanOpenDeps,
} from "./scan-open.js";
import { createTourViewerSession } from "./tour-viewer-session.js";

/**
 * Why these tests matter (TourViewer scan-to-open plan §2, §9, and the
 * milestone review): the owner decided step 4 needs no pasted link - the
 * first code the camera reads opens its tour. These pin the policy: one
 * open at a time; retries only for causes a creator can fix, with a capped
 * backoff; once a tour is open, another tour's code is added to it rather
 * than switching (plan §13); and work measured before any tour opened
 * never landing in the wrong tour's zip.
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
    outcomes?: (OpenOutcome | "reject")[];
    /** Opens wait for `release()` instead of settling at once. */
    hold?: boolean;
  } = {},
) {
  const ctx = createTourViewerSession();
  if (options.openAt != null) {
    ctx.session = { archive: { url: options.openAt } } as never;
  }
  const outcomes = [...(options.outcomes ?? [])];
  let clock = 0;
  let opening = false;
  let release: () => void = () => undefined;
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
      const gate =
        options.hold === true
          ? new Promise<void>((resolve) => {
              release = resolve;
            })
          : Promise.resolve();
      return gate.then(() => {
        opening = false;
        if (outcome === "reject") throw new Error("boom");
        if (outcome.kind === "opened") {
          ctx.session = { archive: { url } } as never;
        }
        return outcome;
      });
    },
    isOpening: () => opening,
    now: () => clock,
    render: vi.fn(),
  };
  const scan = createScanOpen(deps);
  /** Two detections a frame apart, as the 8 Hz capture delivers them. */
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
    release: () => {
      release();
    },
    setOpening: (value: boolean) => {
      opening = value;
    },
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

  it("opens as soon as the code is read, on its first sighting", async () => {
    // Milestone review #9: the open used to wait for a second detection,
    // leaving "Opening…" on screen for a code seen once.
    const s = setup();
    s.scan.onDetection(codeOf(A));
    await settle();
    expect(s.opened).toEqual([A]);
  });

  it("starts one open however many frames arrive while it runs", async () => {
    const s = setup({ hold: true });
    s.scan.onDetection(codeOf(A));
    await settle();
    for (let i = 0; i < 5; i += 1) s.scan.onDetection(codeOf(A));
    expect(s.opened).toEqual([A]);
    expect(s.scan.status(codeOf(A)).kind).toBe("opening");
    s.release();
    await settle();
    expect(s.scan.status(codeOf(A)).kind).toBe("quiet");
  });

  it("starts none while an open from step 1 is in flight", async () => {
    const s = setup();
    s.setOpening(true);
    await s.see(codeOf(A));
    expect(s.opened).toEqual([]);
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
    expect(s.scan.status(codeOf(B))).toMatchObject({
      kind: "measured-for-another",
    });
    await s.see(codeOf(A));
    expect(s.opened).toEqual([A]);
  });

  it("ignores a tour binding left from an earlier level", async () => {
    // The binding counts only for the level it was made for.
    const s = setup();
    s.ctx.mintedLevel = { id: "lvl-new", json: "{}" };
    s.ctx.mintedLevelTour = { levelId: "lvl-old", tourUrl: A };
    await s.see(codeOf(B));
    expect(s.opened).toEqual([B]);
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
    expect(s.scan.status(codeOf(A))).toEqual({
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

  it("never waits more than 30 s between tries", async () => {
    // Milestone review #10: a creator who fixed the upload should not stand
    // at the poster for minutes; a retry is one small request.
    const failures = Array.from({ length: 6 }, () => ({
      kind: "failed" as const,
      cause: "cors" as const,
    }));
    const s = setup({ outcomes: failures });
    await s.see(codeOf(A));
    for (const wait of [10_000, 20_000, 30_000, 30_000]) {
      s.advance(wait);
      await s.see(codeOf(A));
    }
    expect(s.opened, "cors is retried, and the cap holds").toHaveLength(5);
  });

  it("retries a phone that was offline (K0)", async () => {
    // Tour kit plan K0 split `offline` out of `cors`: a phone back online
    // must get the same retry a blocked host did.
    const s = setup({
      outcomes: [{ kind: "failed", cause: "offline" }, { kind: "opened" }],
    });
    await s.see(codeOf(A));
    expect(s.scan.status(codeOf(A))).toEqual({
      kind: "failed",
      cause: "offline",
      retrying: true,
    });
    s.advance(10_000);
    await s.see(codeOf(A));
    expect(s.opened).toHaveLength(2);
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

  it("treats an open that throws as a failure, not a hang", async () => {
    const s = setup({ outcomes: ["reject"] });
    await s.see(codeOf(A));
    expect(s.scan.status(codeOf(A))).toMatchObject({
      kind: "failed",
      cause: "other",
    });
  });

  it("does not count a superseded open against the link", async () => {
    const s = setup({ outcomes: [{ kind: "superseded" }] });
    s.scan.onDetection(codeOf(A));
    await settle();
    expect(s.opened).toHaveLength(1);
    s.scan.onDetection(codeOf(A));
    await settle();
    expect(s.opened, "tried again on the next frame").toHaveLength(2);
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
  // Plan §13 (owner): in authoring there is no wrong code. The open tour is
  // the one being edited; a code printed from another tour's zip is one
  // more reference for it - measured in, never a switch.
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

  it("adds another tour's code to the open tour, however long it stays in view", async () => {
    const s = setup({ openAt: A });
    await s.see(codeOf(B));
    s.advance(60_000);
    await s.see(codeOf(B));
    expect(s.opened).toEqual([]);
    expect(s.scan.status(codeOf(B)).kind).toBe("added-to-open-tour");
  });
});

describe("a code that cannot be compared with the open tour", () => {
  it("neither switches tours nor claims another tour", async () => {
    const s = setup({ openAt: A });
    await s.see(codeOf("https://bit.ly/x"));
    s.advance(5_000);
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
