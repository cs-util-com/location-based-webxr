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

describe("a tour switch forgets the closing tour's fused-pose state", () => {
  it("clears the visitor hint's evaluation and empties the counts in place", async () => {
    const ctx = createTourViewerSession();
    // The running pipeline holds this map in its closure: it must be
    // emptied, not replaced, or the readout loses the new tour's counts.
    const tallies = new Map([["old-code", createFusedPoseTally()]]);
    ctx.fusedTallies = tallies;
    ctx.viewerLastEvaluation = {
      text: "old-code",
      result: { status: "stable", notStableReason: null } as never,
      atMs: 0,
    };
    const dom = {
      form: el(),
      linkInput: el(),
      openButton: el(),
      missingForm: el(),
      missingInput: el(),
      missingButton: el(),
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
    await vi.waitFor(() => expect(dom.openButton.disabled).toBe(false));
    expect(ctx.viewerLastEvaluation).toBeNull();
    expect(ctx.fusedTallies).toBe(tallies);
    expect(tallies.size).toBe(0);
  });
});
