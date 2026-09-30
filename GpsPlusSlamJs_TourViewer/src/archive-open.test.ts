/**
 * The tour switch forgets the closing tour's QR state (PR #434 review, and
 * PR #508 review for the fused-pose fields of QR near-frontal pose plan §66).
 *
 * Why these tests matter: the viewer's QR pipeline runs per AR SESSION, not
 * per tour, so opening another tour mid-session does not restart it. Every
 * field that describes the closing tour's codes must be cleared by the open
 * itself - or the visitor reads "Code measured - waiting for the first GPS
 * fix." about a code the new tour does not contain, and the `?debug=1`
 * readout keeps listing the old tour's codes. This drives the real submit
 * handler; the open fails after the teardown, which is all it needs.
 */
import { describe, expect, it, vi } from "vitest";
import { createFusedPoseTally } from "gps-plus-slam-app-framework/ar/qr";
import { wireArchiveOpen, type ArchiveOpenDom } from "./archive-open.js";
import {
  createTourViewerSession,
  createUnwiredHooks,
} from "./tour-viewer-session.js";

vi.mock("./tour-session.js", () => ({
  openTourSession: () => Promise.reject(new Error("offline")),
}));

/** A stand-in element: the fields the open path writes, and listeners. */
function el() {
  const handlers = new Map<
    string,
    (event: { preventDefault(): void }) => void
  >();
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    value: "",
    open: false,
    replaceChildren: () => undefined,
    addEventListener: (
      type: string,
      handler: (event: { preventDefault(): void }) => void,
    ) => handlers.set(type, handler),
    fire: (type: string) =>
      handlers.get(type)?.({ preventDefault: () => undefined }),
  };
}

/** An open tour that closes cleanly - all a teardown asks of it. */
function openTour(): NonNullable<
  ReturnType<typeof createTourViewerSession>["session"]
> {
  return { close: () => Promise.resolve() } as never;
}

/** Work a creator can have in hand: a measured level, a placed pin, a
 *  note, and a print-size check whose reset is observable. */
function creatorWork(ctx: ReturnType<typeof createTourViewerSession>) {
  const reset = vi.fn();
  ctx.mintedLevel = { id: "lvl", json: "{}" };
  ctx.placedObjects = [
    {
      object: {
        id: "pin-1",
        kind: "pin",
        label: "Gate",
        createdAtIso: "2026-09-27T00:00:00.000Z",
        geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
      },
    },
  ];
  ctx.placementNote = "1 object placed";
  ctx.printSizeCheck = { reset } as never;
  return { reset };
}

/** Wire the open path over `ctx` and submit another tour's link; the open
 *  fails after the teardown (the mocked `openTourSession`). */
function openAnotherTour(ctx: ReturnType<typeof createTourViewerSession>) {
  const dom = {
    form: el(),
    linkInput: el(),
    openButton: el(),
    statsPanel: el(),
    statsHeadline: el(),
    statsDetail: el(),
    errorBox: el(),
    gallery: el(),
    storagePanel: el(),
    clearCacheButton: el(),
  };
  wireArchiveOpen({
    ctx,
    dom: dom as unknown as ArchiveOpenDom,
    cacheStore: undefined,
    corsProxyBaseUrl: "https://proxy.test",
    hooks: createUnwiredHooks(),
  });
  dom.linkInput.value = "https://example.com/other-tour.zip";
  dom.form.fire("submit");
  return dom;
}

describe("a tour switch forgets the closing tour's fused-pose state", () => {
  it("clears the visitor hint's evaluation and empties the counts in place", async () => {
    const ctx = createTourViewerSession();
    ctx.session = openTour();
    // The running pipeline holds this map in its closure: it must be
    // emptied, not replaced, or the readout loses the new tour's counts.
    const tallies = new Map([["old-code", createFusedPoseTally()]]);
    ctx.fusedTallies = tallies;
    ctx.viewerLastEvaluation = {
      text: "old-code",
      result: { status: "stable", notStableReason: null } as never,
      atMs: 0,
    };
    const dom = openAnotherTour(ctx);
    await vi.waitFor(() => expect(dom.openButton.disabled).toBe(false));
    expect(ctx.viewerLastEvaluation).toBeNull();
    expect(ctx.fusedTallies).toBe(tallies);
    expect(tallies.size).toBe(0);
  });

  // Authoring plan M2b: the keep-alive re-votes a kept code for up to four
  // minutes. That code belongs to the closing tour - voting it into the next
  // tour's alignment would pull it toward a place the new tour never
  // measured. The pipeline (and its keep-alive) outlive the switch, so the
  // hold is stopped, not the keep-alive replaced.
  it("stops the closing tour's code keep-alive", async () => {
    const ctx = createTourViewerSession();
    ctx.session = openTour();
    const keepAlive = {
      stop: vi.fn(),
      phase: () => ({ kind: "none" as const }),
    };
    ctx.viewerKeepAlive = keepAlive as never;
    const dom = openAnotherTour(ctx);
    await vi.waitFor(() => expect(dom.openButton.disabled).toBe(false));
    expect(keepAlive.stop).toHaveBeenCalled();
    expect(ctx.viewerKeepAlive).toBe(keepAlive);
  });
});

describe("a tour switch forgets the closing tour's failed finish", () => {
  it("clears finishError, which otherwise locks Save in the next tour", async () => {
    // Why this test matters (TourViewer scan-to-open plan §9 #8, a
    // pre-existing bug): while `finishError` is set the panel keeps Save
    // off, and only a finish clears it - which returns early without a
    // measured level. A failed finish in tour A therefore locked Save in
    // tour B until a reload; scan-to-open makes switching tours routine.
    const ctx = createTourViewerSession();
    ctx.session = openTour();
    ctx.finishError = "Rebuilding the zip failed: quota";
    const dom = openAnotherTour(ctx);
    await vi.waitFor(() => expect(dom.openButton.disabled).toBe(false));
    expect(ctx.finishError).toBeNull();
  });
});

describe("the teardown clears tour-scoped state only when a tour closes", () => {
  // Why these tests matter (TourViewer scan-to-open plan §5 #1, §9 #1): a
  // creator can measure and place with NO tour open - scan-to-open makes
  // that the normal order - and the open that follows ran the whole tour
  // teardown, wiping the measurement, the pins and the print-size check.
  // With retries of a failed open every few seconds, the size check could
  // never finish. Nothing tour-scoped exists without an open tour, so there
  // is nothing to clear.
  it("keeps work made with no tour open", async () => {
    const ctx = createTourViewerSession();
    const { reset } = creatorWork(ctx);
    const dom = openAnotherTour(ctx);
    await vi.waitFor(() => expect(dom.openButton.disabled).toBe(false));
    expect(ctx.mintedLevel).toEqual({ id: "lvl", json: "{}" });
    expect(ctx.placedObjects).toHaveLength(1);
    expect(ctx.placementNote).toBe("1 object placed");
    expect(reset).not.toHaveBeenCalled();
  });

  // The other half, which no test held before: a CLOSING tour's work must
  // not reach the next tour's zip (M4 review #1, M5 review #9).
  it("clears a closing tour's work", async () => {
    const ctx = createTourViewerSession();
    ctx.session = openTour();
    const { reset } = creatorWork(ctx);
    const generation = ctx.mintGeneration;
    const dom = openAnotherTour(ctx);
    await vi.waitFor(() => expect(dom.openButton.disabled).toBe(false));
    expect(ctx.mintedLevel).toBeNull();
    expect(ctx.mintGeneration).toBe(generation + 1);
    expect(ctx.placedObjects).toEqual([]);
    expect(ctx.placementNote).toBeNull();
    expect(reset).toHaveBeenCalledOnce();
  });
});
