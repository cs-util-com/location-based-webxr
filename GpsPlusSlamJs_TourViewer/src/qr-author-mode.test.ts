import { describe, expect, it, vi } from "vitest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";

import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";

import {
  archiveSizeNote,
  authorStatusLine,
  finishBlockedHint,
  finishReadiness,
  setupHint,
  codeIndexFromInput,
  buildAuthorControllerConfig,
  syntheticAuthorLevel,
  FINISH_LABELS,
  finishHandoffStatus,
  finishHelpVisibility,
  finishIdleLabel,
  finishBusyLabel,
  type AuthorPipelineDeps,
} from "./qr-author-mode";

/**
 * Why these tests matter: author mode is the half of the QR-pose loop that
 * WRITES the anchor every later visitor relocalizes against — a wrong frame
 * conversion here is stamped into the printed code's level file forever, and
 * every mistake is silent (a pose is just numbers). The three load-bearing
 * decisions pinned here come straight from the plan's M3 deltas:
 * - the synthetic level is GEO-LESS with the printed size as an INPUT
 *   (delta #1/#8): the controller then emits detections without voting, and
 *   never re-fetches an HTML launch page at 8 Hz;
 * - the controller runs `minIntervalMs: 0` because the camera-frame source
 *   is the single cadence owner (Option A);
 * - minting converts raw-WebXR → GPS-world NUE via alignment × WEBXR_TO_NUE
 *   (delta #2 wired the STABLE pose; the conversion is proven by a
 *   round-trip through the stack's own GPS→NUE direction).
 */

// The geodesy the mint rides on is licence-gated; constructing the store is
// the documented activation path, and it is exactly what production does
// before any mint can happen (main.ts creates the AR store at boot).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const GOOD_ALIGNMENT_INFO = {
  hasMatrix: true,
  sampleCount: 5,
  gpsAccuracyM: 4.2,
};

function fakeDeps(): AuthorPipelineDeps {
  return {
    frontEnd: {
      kind: "barcode-detector" as const,
      detect: () => Promise.resolve(null),
    },
    solvePose: () => null,
    getCameraPose: () => null,
    getIntrinsics: () => null,
    recordDetection: vi.fn(),
    onError: vi.fn(),
  };
}

describe("syntheticAuthorLevel", () => {
  it("is geo-less and carries the printed size as its only physical fact", () => {
    const level = syntheticAuthorLevel(0.18);
    expect(level).toEqual({ version: 1, qr: { physicalSizeM: 0.18 } });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-positive/non-finite printed size (%s)",
    (sizeM) => {
      expect(() => syntheticAuthorLevel(sizeM)).toThrow();
    },
  );
});

describe("buildAuthorControllerConfig", () => {
  it("resolves the synthetic geo-less level locally for any decoded text", async () => {
    const config = buildAuthorControllerConfig(0.25, fakeDeps());
    // The decoded QR text is a printed LAUNCH URL (an HTML page) — fetching
    // it for real would fail validation and flap the status at 8 Hz.
    const level = await config.fetchLevel(
      "https://gps.csutil.com/tour/?qr=x&c=1",
    );
    expect(level).toEqual({ version: 1, qr: { physicalSizeM: 0.25 } });
  });

  it("runs minIntervalMs 0 — the frame source is the single cadence owner", () => {
    const config = buildAuthorControllerConfig(0.2, fakeDeps());
    expect(config.minIntervalMs).toBe(0);
  });

  it("routes detections into the injected recorder", () => {
    const deps = fakeDeps();
    const config = buildAuthorControllerConfig(0.2, deps);
    const event = { text: "t", timestamp: 1 } as QrDetectionEvent;
    config.onDetection?.(event);
    expect(deps.recordDetection).toHaveBeenCalledWith(event);
  });
});

// The status line is the author's only view into the mint gate; the mint
// itself now lives in the framework (qr-mint-level.test.ts) because a
// second authoring surface needs it.
describe("authorStatusLine", () => {
  it("gates the mint button on BOTH a stable pose and a live alignment", () => {
    // Why this matters: minting with either half missing writes a garbage
    // anchor into the printed code. The readout is the author's only view
    // into the gate, so each blocked state must say WHAT is missing.
    const stable = {
      status: "stable" as const,
      pose: {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
      translationSpreadM: 0.01,
      rotationSpreadDeg: 1.2,
      inlierCount: 8,
      sampleCount: 8,
    };
    const noAlign = { hasMatrix: false, sampleCount: 0 };
    expect(authorStatusLine(null, null, noAlign).canMint).toBe(false);
    const measuring = authorStatusLine(
      "text",
      { ...stable, status: "measuring" as const },
      GOOD_ALIGNMENT_INFO,
    );
    expect(measuring.canMint).toBe(false);
    expect(measuring.text).toMatch(/measuring/i);
    // Milestone review #1 — the identity-matrix hole: a matrix EXISTS from
    // the very first GPS fix (the store ships identity), so a matrix-only
    // gate is vacuous and would mint a heading wrong by the session's
    // arbitrary WebXR yaw. The gate must count solved-in fixes.
    const identityOnly = authorStatusLine("text", stable, {
      hasMatrix: true,
      sampleCount: 1,
    });
    expect(identityOnly.canMint).toBe(false);
    // The constant is the tuning knob M5 may raise - the readout must
    // follow it, not restate 3.
    expect(identityOnly.text).toMatch(
      new RegExp(String.raw`1 of ${MIN_ALIGNMENT_SAMPLES} fixes`),
    );
    const ready = authorStatusLine("text", stable, GOOD_ALIGNMENT_INFO);
    expect(ready.canMint).toBe(true);
    expect(ready.text).toMatch(/save the position/i);
  });
});

describe("setupHint / finishReadiness", () => {
  it("names the next move once measured, and refuses to finish without a tour open", () => {
    // Why this matters: the measured position is only useful inside the
    // hosted zip. A creator who measured before opening the tour must be
    // told to open it, not left with a disabled button and no reason.
    expect(
      setupHint({ measured: false, tourOpen: true, hadLevel: false }),
    ).toBe("");
    expect(
      setupHint({ measured: true, tourOpen: false, hadLevel: false }),
    ).toMatch(/step 1/);
    expect(
      setupHint({ measured: true, tourOpen: true, hadLevel: true }),
    ).toMatch(/replaces/);
    expect(
      setupHint({ measured: true, tourOpen: true, hadLevel: false }),
    ).toMatch(/Finish/);
    const settled = "settled" as const;
    expect(
      finishReadiness({ measured: false, tourOpen: true, manifest: settled }),
    ).toBe("not-measured");
    expect(
      finishReadiness({ measured: true, tourOpen: false, manifest: settled }),
    ).toBe("no-tour");
    // The manifest must have settled (M3 review #5): finishing while it
    // loads, or when it is broken, would overwrite the creator's placement.
    expect(
      finishReadiness({ measured: true, tourOpen: true, manifest: "pending" }),
    ).toBe("manifest-pending");
    expect(
      finishReadiness({ measured: true, tourOpen: true, manifest: "broken" }),
    ).toBe("manifest-broken");
    expect(finishBlockedHint("manifest-broken")).toMatch(/tour\.json/);
    expect(finishBlockedHint("ready")).toBe("");
    expect(
      finishReadiness({ measured: true, tourOpen: true, manifest: settled }),
    ).toBe("ready");
    expect(archiveSizeNote(250_000_000)).toMatch(/250 MB.*a while/);
    expect(archiveSizeNote(12_000_000)).toBe("The hosted zip is 12 MB.");
  });
});

describe("codeIndexFromInput", () => {
  it("treats a blank field as the first code, silently", () => {
    expect(codeIndexFromInput("")).toEqual({ codeIndex: 1, coerced: false });
    expect(codeIndexFromInput("  ")).toEqual({ codeIndex: 1, coerced: false });
  });

  it("takes a usable code number literally", () => {
    expect(codeIndexFromInput("3")).toEqual({ codeIndex: 3, coerced: false });
  });

  it("reports a coercion rather than swallowing it", () => {
    // Why this matters: two posters both printed as "code 1" get ONE identity
    // and ONE level file - a silent mis-placement, and the exact failure the
    // per-code token exists to prevent.
    for (const bad of ["0", "-1", "1.5", "abc"]) {
      expect(codeIndexFromInput(bad), bad).toEqual({
        codeIndex: 1,
        coerced: true,
      });
    }
  });
});

describe("the finish step's hand-off copy", () => {
  /**
   * Why these tests matter: the finish button now takes one of two routes
   * and each can fail, and THREE of those four outcomes are unreachable in
   * an e2e run - a headless browser has no share sheet. The copy is also
   * the half that was wrong: \`saved\` states as fact that the link and the
   * printed code are unchanged, which is true when the creator overwrites
   * the hosted file and FALSE when they share, because sharing hands the
   * zip to another app that normally stores it as a new file with a new
   * id. A creator who reads "the link stays the same" after a share walks
   * away believing a poster works when it points at the old file.
   */
  it("promises an unchanged link ONLY on the save route", () => {
    const saved = finishHandoffStatus(
      { route: "download", delivered: true },
      "tour.zip",
    );
    expect(saved).toContain("stay the same");

    const shared = finishHandoffStatus(
      { route: "share", delivered: true },
      "tour.zip",
    );
    expect(shared).not.toContain("stay the same");
    expect(shared).not.toContain("stays the same");
    // And it must say what still has to happen. Not "make sure it
    // replaced": sharing to a cloud app CREATES a file, so framing a
    // near-certainty as a coin flip lets a creator walk away believing the
    // poster is probably fine (M2 review #6).
    expect(shared).toMatch(/replace it/i);
    expect(shared).toMatch(/NEW file/);
    expect(shared).toContain("tour.zip");
  });

  it("says nothing happened, without blaming the user, when nothing was delivered", () => {
    // The Web Share API reports a cancelled sheet and a failed share as
    // the same AbortError, so copy that said "you cancelled" would be a
    // guess presented as a fact.
    const notShared = finishHandoffStatus(
      { route: "share", delivered: false },
      "tour.zip",
    );
    expect(notShared).toMatch(/nothing was shared/i);
    expect(notShared.toLowerCase()).not.toContain("cancel");

    expect(
      finishHandoffStatus({ route: "download", delivered: false }, "tour.zip"),
    ).toMatch(/not saved/i);
  });

  it("labels the button with the action it will actually take", () => {
    expect(finishIdleLabel(true).toLowerCase()).toContain("share");
    expect(finishIdleLabel(true).toLowerCase()).not.toContain("download");
    expect(finishIdleLabel(false).toLowerCase()).toContain("download");
    expect(finishIdleLabel(false).toLowerCase()).not.toContain("share");
    expect(finishBusyLabel(true)).not.toBe(finishBusyLabel(false));
  });

  it("covers all four outcomes with distinct copy", () => {
    const all = [
      { route: "share" as const, delivered: true },
      { route: "share" as const, delivered: false },
      { route: "download" as const, delivered: true },
      { route: "download" as const, delivered: false },
    ].map((outcome) => finishHandoffStatus(outcome, "tour.zip"));
    expect(new Set(all).size).toBe(4);
  });
});

describe("which help the finish step reveals", () => {
  /**
   * Why this test matters: the replace instructions are what keeps a
   * printed code working, and they used to appear exactly when a file had
   * been written to the device. On the share route no file lands here at
   * all - it is inside whichever app the creator picked - so the same
   * block now needs one extra sentence saying where to find it. That
   * branch is otherwise reachable only by walking a full AR setup on a
   * phone with a share sheet, which is to say by nothing that runs in CI.
   */
  it("shows nothing until something has actually gone somewhere", () => {
    for (const route of ["share", "download"] as const) {
      expect(finishHelpVisibility({ route, delivered: false })).toEqual({
        replaceHelp: false,
        shareNote: false,
      });
    }
  });

  it("always shows the replace instructions once delivered, and the share note only on the share route", () => {
    expect(
      finishHelpVisibility({ route: "download", delivered: true }),
    ).toEqual({ replaceHelp: true, shareNote: false });
    expect(finishHelpVisibility({ route: "share", delivered: true })).toEqual({
      replaceHelp: true,
      shareNote: true,
    });
  });
});

describe("the help blocks are EARNED, and a later failure does not take them back", () => {
  // Why this test matters: the reveal used to be a one-way assignment and
  // briefly became a two-way one. A creator who saved the zip, then tapped
  // again and dismissed the picker, would have had the step-6 replace
  // instructions disappear - the flow's last instruction, removed at the
  // moment they most need it, by an action that changed nothing.
  //
  // The function answers "what does THIS outcome earn", and the caller only
  // ever reveals. Only closing the tour hides them again.
  it("earns nothing when nothing was delivered, so a retry cannot un-earn", () => {
    for (const route of ["share", "download"] as const) {
      const earned = finishHelpVisibility({ route, delivered: false });
      expect(earned.replaceHelp).toBe(false);
      expect(earned.shareNote).toBe(false);
    }
  });
});

describe("the share note follows the LAST delivered route", () => {
  // Why this test matters: `replaceHelp` is true of any delivered hand-off
  // and is earned once. `shareNote` is a claim about WHICH hand-off
  // happened, and making it earned-and-kept let it outlive its truth: a
  // share followed by a save on the retry left "you shared it rather than
  // saving it, so it is now wherever that app put it" on screen beside a
  // file that is on disk, sending the creator to hunt for it in an app.
  //
  // The caller reveals `replaceHelp` one-way and sets `shareNote` from the
  // last DELIVERED outcome, so this function has to answer for the route,
  // not for the panel.
  it("claims a share only for a delivered share", () => {
    expect(
      finishHelpVisibility({ route: "share", delivered: true }).shareNote,
    ).toBe(true);
    expect(
      finishHelpVisibility({ route: "download", delivered: true }).shareNote,
    ).toBe(false);
    // A hand-off that delivered nothing changed nothing, so it must not
    // move the note in either direction - the caller checks `delivered`
    // before applying it, and this is the value it would apply.
    expect(
      finishHelpVisibility({ route: "share", delivered: false }).shareNote,
    ).toBe(false);
  });
});

describe("the ready line names the action the button will take", () => {
  // Why: this is the sentence a creator reads immediately before pressing
  // the button. It said "Download it" on every device, including one whose
  // button says "Share the rebuilt zip" (M2 review #3).
  it("says share where the button says share, and download where it says download", () => {
    expect(FINISH_LABELS.ready(1_000_000, true)).toContain("Share it");
    expect(FINISH_LABELS.ready(1_000_000, true)).not.toContain("Download it");
    expect(FINISH_LABELS.ready(1_000_000, false)).toContain("Download it");
    expect(FINISH_LABELS.ready(1_000_000, false)).not.toContain("Share it");
  });
});
