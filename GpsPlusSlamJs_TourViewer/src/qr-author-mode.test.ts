import type { QrFusedPose } from "gps-plus-slam-app-framework/ar/qr";
import { describe, expect, it, vi } from "vitest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { QrDetectionEvent } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";

import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";

import {
  autoMeasureAllowed,
  archiveSizeNote,
  authorStatusLine,
  finishBlockedHint,
  finishReadiness,
  setupHint,
  entryHint,
  codeIndexFromInput,
  buildAuthorControllerConfig,
  syntheticAuthorLevel,
  reprintOrphanWarning,
  FINISH_LABELS,
  finishSaveStatus,
  driveReplaceSteps,
  sizeOfferView,
  adoptedSizeNote,
  codeTourLine,
  correctionRefusedLine,
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

  // Why this test matters (code book plan M4c-3): each code is solved at
  // its OWN printed size - the size the tour stores for it, else the size
  // field - so the level the controller fetches carries the size per text.
  it("resolves each text at the size `sizeFor` gives it", async () => {
    const config = buildAuthorControllerConfig(0.16, {
      ...fakeDeps(),
      sizeFor: (text) => Promise.resolve(text.endsWith("big") ? 0.3 : 0.16),
    });
    expect(await config.fetchLevel("https://x/?qr=big")).toEqual({
      version: 1,
      qr: { physicalSizeM: 0.3 },
    });
    expect(await config.fetchLevel("https://x/?qr=small")).toEqual({
      version: 1,
      qr: { physicalSizeM: 0.16 },
    });
  });

  // Why: a size that cannot be resolved must not reject the fetch (the
  // controller would flap); the pipeline's size stands.
  it("falls back to the pipeline's size when `sizeFor` fails", async () => {
    const config = buildAuthorControllerConfig(0.2, {
      ...fakeDeps(),
      sizeFor: () => Promise.reject(new Error("no crypto")),
    });
    expect(await config.fetchLevel("t")).toEqual({
      version: 1,
      qr: { physicalSizeM: 0.2 },
    });
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
describe("the print-size check's copy (QR size consensus plan S3a)", () => {
  // Plan §12 #3: the mint usually comes before the size check has an
  // answer, since nothing asked for the sideways step it needs.
  it("asks for a sideways step on the ready line while the check is pending", () => {
    const align = { hasMatrix: true, sampleCount: 5 };
    const stable = {
      status: "stable",
      notStableReason: null,
    } as unknown as QrFusedPose;
    const ready = authorStatusLine("A", stable, align);
    // UI round 1, U3: measured on its own, so the line says so - no
    // button to tap.
    expect(ready.text).toBe("Code measured.");
    const pending = authorStatusLine("A", stable, align, true);
    expect(pending.text).toBe(
      "Code measured. Take a step sideways to check the print size.",
    );
    // The mint is not held (plan §12 #3).
    expect(pending.canMint).toBe(true);
  });

  // Plan §12 #1, #9, #10: an approximate figure, the ruler as the arbiter,
  // and the field's own unit beside the centimetres.
  it("offers the measured size in plain words, with a ruler check", () => {
    expect(sizeOfferView(0.155, 0.16)).toEqual({
      text: "Print measures ~15.5 cm, the size field says 16.0 cm. Check it with a ruler.",
      useLabel: "Use 15.5 cm",
      keepLabel: "Keep 16.0 cm",
    });
  });

  it("confirms an adopted size and says what to do next", () => {
    expect(adoptedSizeNote(0.155)).toBe(
      "Now using 15.5 cm (0.155 m) - walk slowly around the code again to measure it at this size.",
    );
  });
});

describe("authorStatusLine", () => {
  /** A fused result (QR near-frontal pose plan §60: the mint uses the fused pose). */
  const fused = (over: Partial<QrFusedPose> = {}): QrFusedPose => ({
    status: "stable",
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    method: "joint",
    views: 7,
    droppedViews: 0,
    fitPx: 0.6,
    windowEntries: 7,
    averagedRotationDeltaDeg: 1,
    frameEpoch: 0,
    oldestTimestamp: 0,
    newestTimestamp: 0,
    motion: null,
    edgePx: 180,
    notStableReason: null,
    nativeIgnored: 0,
    ...over,
  });

  it("gates the mint button on BOTH a stable pose and a live alignment", () => {
    // Why this matters: minting with either half missing writes a garbage
    // anchor into the printed code. The readout is the author's only view
    // into the gate, so each blocked state must say WHAT is missing.
    const noAlign = { hasMatrix: false, sampleCount: 0 };
    expect(authorStatusLine(null, null, noAlign).canMint).toBe(false);
    const measuring = authorStatusLine(
      "text",
      fused({ status: "measuring", notStableReason: "views", views: 3 }),
      GOOD_ALIGNMENT_INFO,
    );
    expect(measuring.canMint).toBe(false);
    expect(measuring.text).toMatch(/measuring/i);
    // Milestone review #1 — the identity-matrix hole: a matrix EXISTS from
    // the very first GPS fix (the store ships identity), so a matrix-only
    // gate is vacuous and would mint a heading wrong by the session's
    // arbitrary WebXR yaw. The gate must count solved-in fixes.
    const identityOnly = authorStatusLine("text", fused(), {
      hasMatrix: true,
      sampleCount: 1,
    });
    expect(identityOnly.canMint).toBe(false);
    // The constant is the tuning knob M5 may raise - the readout must
    // follow it, not restate 3.
    expect(identityOnly.text).toMatch(
      new RegExp(String.raw`1 of ${MIN_ALIGNMENT_SAMPLES} fixes`),
    );
    const ready = authorStatusLine("text", fused(), GOOD_ALIGNMENT_INFO);
    expect(ready.canMint).toBe(true);
    expect(ready.text).toMatch(/Code measured/);
  });

  // Plan §60-§61 #11: the readout says what actually gates the fused pose,
  // in plain words per reason, and never restates the view threshold (a
  // private tuning value) or asks the author to hold the phone still -
  // camera movement is what resolves the code's tilt.
  it("names what the fused pose is waiting for, per reason", () => {
    const line = (over: Partial<QrFusedPose>) =>
      authorStatusLine(
        "text",
        fused({ status: "measuring", ...over }),
        GOOD_ALIGNMENT_INFO,
      ).text;
    expect(line({ notStableReason: "views", views: 2 })).toMatch(
      /walk slowly around the code/i,
    );
    expect(line({ notStableReason: "fit" })).toMatch(/keep moving slowly/i);
    expect(line({ notStableReason: "fallback" })).toMatch(/views disagree/i);
    // A wall code the author cannot hold: "motion" there is mostly a false
    // "turning" from a relabelled frame (milestone review of b4b #11).
    expect(line({ notStableReason: "motion" })).toMatch(/seemed to move/i);
    expect(line({ notStableReason: "order" })).toMatch(/move closer/i);
    const unknown = authorStatusLine(
      "text",
      fused({
        status: "unknown",
        pose: null,
        views: 0,
        notStableReason: "views",
      }),
      GOOD_ALIGNMENT_INFO,
    );
    expect(unknown.canMint).toBe(false);
    for (const reason of [
      "views",
      "fit",
      "fallback",
      "motion",
      "order",
    ] as const) {
      const text = line({ notStableReason: reason, views: 2 });
      expect(text).not.toMatch(/hold steady/i);
      expect(text).not.toMatch(/of 5/);
    }
  });
});

describe("entryHint (authoring plan 2026-09-28-0953 §3.2a, decision D5)", () => {
  it("asks for the code first while a tour is open and the code was not seen in this AR visit", () => {
    // Why this matters: a later visit's notes are only corrected through
    // the code when the code was seen in THAT visit (D10b). The owner chose
    // a hint over a rule: nothing blocks placing, so the hint is all that
    // tells the author what to do first.
    expect(entryHint({ tourOpen: true, codeSeen: false })).toBe(
      "First, point the camera at the code you scanned to open this tour.",
    );
    expect(entryHint({ tourOpen: true, codeSeen: true })).toBe("");
    // No tour open: there is no "code of this tour" to point at yet.
    expect(entryHint({ tourOpen: false, codeSeen: false })).toBe("");
  });
});

describe("setupHint / finishReadiness", () => {
  it("names the next move once measured, and refuses to finish without a tour open", () => {
    // Why this matters: the measured position is only useful inside the
    // hosted zip. A creator who measured before opening the tour must be
    // told to open it, not left with a disabled button and no reason.
    expect(setupHint({ measured: false, tourOpen: true, inTour: "none" })).toBe(
      "",
    );
    // With no tour open the code-status line says what is happening to the
    // code's tour (scan-to-open plan §9 #9); "open it in step 1" pointed at
    // a form a creator holding the phone at the poster cannot reach.
    expect(setupHint({ measured: true, tourOpen: false, inTour: "none" })).toBe(
      "Position saved.",
    );
    expect(
      setupHint({ measured: true, tourOpen: true, inTour: "this-code" }),
    ).toMatch(/replaces this code's saved position/);
    // Why (code book plan review #13): a NEW code in a tour that carries
    // other codes is ADDED by the Finish beside them; "it replaces the
    // code this tour already carried" told the creator the opposite.
    const added = setupHint({
      measured: true,
      tourOpen: true,
      inTour: "other-codes",
    });
    expect(added).toMatch(/one more code/);
    expect(added).not.toMatch(/replaces/);
    expect(
      setupHint({ measured: true, tourOpen: true, inTour: "none" }),
    ).toMatch(/Finish/);
    // A stored pose in hand (the hosted zip's, a draft's, an earlier
    // visit's kept through a new measurement) is NOT replaced (D10b, M2c
    // review #5): saying "replaces" there would contradict what the zip
    // gets.
    const kept = setupHint({
      measured: true,
      tourOpen: true,
      inTour: "this-code",
      keptStored: true,
    });
    expect(kept).not.toMatch(/replaces/);
    expect(kept).toMatch(/Saved position kept/);
    expect(kept).toMatch(/Finish/);
    const settled = "settled" as const;
    expect(
      finishReadiness({ hasWork: false, tourOpen: true, manifest: settled }),
    ).toBe("not-measured");
    expect(
      finishReadiness({ hasWork: true, tourOpen: false, manifest: settled }),
    ).toBe("no-tour");
    // The manifest must have settled (M3 review #5): finishing while it
    // loads, or when it is broken, would overwrite the creator's placement.
    expect(
      finishReadiness({ hasWork: true, tourOpen: true, manifest: "pending" }),
    ).toBe("manifest-pending");
    expect(
      finishReadiness({ hasWork: true, tourOpen: true, manifest: "broken" }),
    ).toBe("manifest-broken");
    expect(finishBlockedHint("manifest-broken")).toMatch(/tour\.json/);
    expect(finishBlockedHint("ready")).toBe("");
    expect(
      finishReadiness({ hasWork: true, tourOpen: true, manifest: settled }),
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

describe("printing a code that would strand an existing measurement", () => {
  /**
   * Why this test matters: a printed code's identity is a hash of the text
   * it carries, and the measured pose is filed under that identity inside
   * the hosted zip. Change the text - move the file, swap in a short link,
   * add a tracking parameter - and the printed code asks for an id the
   * archive does not hold.
   *
   * The failure is SILENT and it is the expensive kind. The visitor's app
   * reads a missing level as "this code has no level", says nothing is
   * wrong, and waits out the scan gate into a location-only experience.
   * The creator's walk is gone; nothing anywhere tells them, and the app
   * behaves exactly as it does for a code nobody ever measured.
   *
   * It is reachable today with no new feature, by any creator who changes
   * their link and re-prints - which is why this exists before the
   * shortener decision that also depends on it. Moving the hosted file
   * alone is NOT this bug: that breaks the link, and a dead URL is loud.
   */
  it("says nothing when there is nothing to lose", () => {
    // The common case, and the one that must never nag: every tour before
    // its first walk, and every creator who never measures.
    expect(reprintOrphanWarning(["abc123"], [])).toBeNull();
  });

  it("says nothing when the code about to be printed IS the measured one", () => {
    // Re-printing the same poster is routine - a torn sheet, a second
    // copy - and warning there would train the creator to ignore the line.
    expect(reprintOrphanWarning(["abc123"], ["abc123"])).toBeNull();
    expect(reprintOrphanWarning(["abc123"], ["zzz999", "abc123"])).toBeNull();
  });

  it("says nothing when ANOTHER poster of the same tour holds the measurement", () => {
    // The multi-poster flow is a first-class feature: one tour can carry
    // several codes, each with its own identity, which is what the code
    // number and the multi-code PDF are for. A creator who measured code 2
    // and comes back to re-print code 1 has changed nothing - and the
    // first version of this told them their link had changed and offered
    // to put it back, which is advice to undo something they never did
    // (PR #442 review).
    //
    // The question is about the LINK: if any measurement is still
    // reachable from it, at any of its code numbers, nothing is stranded.
    const linkIds = ["id-code-1", "id-code-2", "id-code-3"];
    expect(reprintOrphanWarning(linkIds, ["id-code-2"])).toBeNull();
  });

  it("warns, names the cost, and says how to keep the measurement", () => {
    const warning = reprintOrphanWarning(["newid"], ["oldid"]);
    expect(warning).not.toBeNull();
    // The three things a creator needs: that something is wrong, what it
    // will cost, and the way out. A warning without the last one leaves
    // them stuck at the point of no return.
    expect(warning).toMatch(/step 4 again/i);
    expect(warning).toMatch(/original link/i);
    expect(warning).toMatch(/will not be found/i);
  });

  it("warns when NO code number of the current link reaches any measurement", () => {
    // The genuine case: the link changed, so every id it can produce is
    // new and every measurement the tour holds belongs to the old one.
    expect(
      reprintOrphanWarning(["new1", "new2", "new3"], ["a", "b", "c"]),
    ).not.toBeNull();
  });
});

describe("codeTourLine (scan-to-open plan §9 #9)", () => {
  // Why this matters: in step 4 the creator holds the phone at the poster;
  // this line is the only place they learn that the code is opening its
  // tour, that the open failed and why, or that the code belongs to another
  // tour - and whether waiting will help.
  it("says nothing when there is nothing to say", () => {
    expect(codeTourLine({ kind: "quiet" })).toBe("");
  });

  it("names each state in plain words", () => {
    expect(codeTourLine({ kind: "opening" })).toMatch(/Opening the tour/);
    expect(codeTourLine({ kind: "not-a-tour" })).toMatch(
      /does not point to a tour/,
    );
    expect(codeTourLine({ kind: "not-a-tour" })).toMatch(/step 2/);
    // Plan §13: another tour's code joins the open tour - the line says so.
    expect(codeTourLine({ kind: "added-to-open-tour" })).toMatch(
      /added to the open tour/,
    );
    expect(codeTourLine({ kind: "unknown" })).toMatch(/Cannot tell/);
  });

  it("says whether keeping the code in view will retry", () => {
    const retrying = codeTourLine({
      kind: "failed",
      cause: "missing",
      retrying: true,
    });
    expect(retrying).toMatch(/not found/);
    expect(retrying).toMatch(/in view to try again/);
    const final = codeTourLine({
      kind: "failed",
      cause: "corrupt",
      retrying: false,
    });
    expect(final).toMatch(/not a readable tour/);
    expect(final).not.toMatch(/try again/);
    expect(final, "and what to do instead").toMatch(/restart AR/);
  });

  it("names an offline phone as offline (K0)", () => {
    expect(
      codeTourLine({ kind: "failed", cause: "offline", retrying: true }),
    ).toMatch(/offline/);
  });

  it("names a too-large tour as too large (K0)", () => {
    expect(
      codeTourLine({ kind: "failed", cause: "too-large", retrying: false }),
    ).toMatch(/too large/);
  });

  it("stays short enough for the phone panel", () => {
    // The longest line shares the panel with the live readout at 360 px;
    // describeOpenError's 200-character Drive text was the review's worst
    // case (plan §9 #14).
    const causes = [
      "missing",
      "cors",
      "corrupt",
      "unusable-link",
      "too-large",
      "offline",
      "other",
    ] as const;
    for (const cause of causes) {
      for (const retrying of [true, false]) {
        expect(
          codeTourLine({ kind: "failed", cause, retrying }).length,
        ).toBeLessThanOrEqual(110);
      }
    }
  });
});

describe("the finish saves the tour zip by itself (field test 2, F4)", () => {
  // Why these tests matter (owner decisions D-F4a, D-F4b): the owner's
  // second field test ended with one zip on the phone - the troubleshooting
  // recording - because the tour zip waited on a button they did not see.
  // The Finish now saves the tour zip itself, and the one button left saves
  // it again the same way. The copy must say what is happening and what
  // happened; the old copy told the creator to press a button first.
  it("says the zip is being saved while it is, and never asks for a tap first", () => {
    const line = FINISH_LABELS.savingTour(2_400_000);
    expect(line).toContain("2.4 MB");
    expect(line).toMatch(/being saved to this phone/);
    expect(line).not.toMatch(/tap|press|download it|share it/i);
  });

  it("names the saved file, and the Drive steps for a Drive tour", () => {
    expect(finishSaveStatus(true, "tour.zip", false)).toBe(
      FINISH_LABELS.saved("tour.zip"),
    );
    expect(finishSaveStatus(true, "tour.zip", true)).toBe(
      FINISH_LABELS.savedToPhone("tour.zip"),
    );
    // A save over the hosted file keeps the link and the printed code.
    expect(finishSaveStatus(true, "tour.zip", true)).toContain("stay the same");
  });

  it("names the button to tap when nothing was saved", () => {
    const line = finishSaveStatus(false, "tour.zip", true);
    expect(line).toMatch(/not saved/i);
    expect(line).toContain(FINISH_LABELS.saveAgain);
  });

  it("labels the one button left as saving the tour zip again", () => {
    expect(FINISH_LABELS.saveAgain).toBe("Save the tour zip again");
  });

  it("never names a step beyond 4", () => {
    // Why (Drive replace plan §5 #5): the download and the replace
    // instructions were steps 5 and 6 until the flow rework folded them
    // into the end of step 4 (F10).
    const lines = [
      FINISH_LABELS.savingTour(1_000_000),
      FINISH_LABELS.saved("tour.zip"),
      FINISH_LABELS.savedToPhone("tour.zip"),
      FINISH_LABELS.notSaved,
    ];
    for (const line of lines) expect(line).not.toMatch(/step [5-9]/i);
  });
});

describe("the finish on a Drive-hosted tour (Drive replace plan §2, §5)", () => {
  // Why these matter: on a phone the only way the owner found to put the
  // rebuilt zip in place of the hosted one is the Drive WEBSITE's upload,
  // which needs the zip saved on the phone (decision 4) and asks "Replace
  // existing file" only for the SAME name. A share hands the zip to another
  // app instead, and the Drive app cannot replace.
  it("gives the owner's working steps, with the file's own name", () => {
    const { rename, steps } = driveReplaceSteps("My tour.zip");
    expect(rename).toBeNull();
    const text = steps.join(" ");
    // Decision 2: typed into a NEW tab (review #6), then Desktop site.
    expect(text).toMatch(/new tab/i);
    expect(text).toContain("drive.google.com");
    expect(text).toMatch(/Desktop site/);
    expect(text).toMatch(/File upload/);
    expect(text).toMatch(/Replace existing file/);
    expect(text).toContain("My tour.zip");
    // Review #1: a repeat download is saved as "name (1).zip". These steps
    // appear only AFTER the save, so they cannot prevent it - they check
    // for it, and send the creator back to the button (milestone review
    // #1: "pick X" would otherwise pick the OLD zip).
    expect(steps[0]).toContain("My tour (1).zip");
    expect(steps[0]).toMatch(/delete every copy/i);
    expect(steps[0]).toMatch(/Save the tour zip again/);
    expect(text, "and what to do if Drive does not ask").toMatch(
      /does not ask/i,
    );
    expect(text).not.toMatch(/Manage versions/);
  });

  it("asks to rename a Drive file whose name a phone would change", () => {
    // Review #7: without .zip (Chrome may append one) or with characters a
    // file system refuses, the saved name differs and Drive offers no
    // "Replace".
    expect(driveReplaceSteps("Altstadt Tour").rename).toBe("Altstadt Tour.zip");
    expect(driveReplaceSteps("what?.zip").rename).toBe("what-.zip");
    expect(driveReplaceSteps("tour.zip").rename).toBeNull();
    expect(driveReplaceSteps("Altstadt Tour").steps[0]).toMatch(
      /rename the file on Drive to "Altstadt Tour\.zip"/,
    );
  });

  it("asks to check the name when the host sent none", () => {
    // Plan §4: without the header the page can only guess (tour.zip), so
    // the creator checks the Drive file carries that name.
    expect(driveReplaceSteps("tour.zip", false).steps[0]).toMatch(
      /Check that the file on Drive is named "tour\.zip"/,
    );
    expect(driveReplaceSteps("tour.zip").steps[0]).not.toMatch(/Check that/);
  });

  it("says where a Drive save went and what comes next", () => {
    // Plan §5 #5: the file is in Downloads, and the Drive steps follow.
    const status = finishSaveStatus(true, "My tour.zip", true);
    expect(status).toBe(FINISH_LABELS.savedToPhone("My tour.zip"));
    expect(status).toMatch(/Downloads/);
    // It cannot know the name the phone gave the file (F4 milestone review
    // #2): it asks to check it, before the Drive steps.
    expect(status).toContain("My tour (1).zip");
    expect(status).toMatch(/step 1 below/);
    expect(status).toMatch(/Drive steps/);
    expect(finishSaveStatus(true, "My tour.zip", false)).toBe(
      FINISH_LABELS.saved("My tour.zip"),
    );
  });
});

describe("correctionRefusedLine (M2c review #2)", () => {
  it("names the distance, or the turn when only the yaw broke the bound, and says the visit follows GPS", () => {
    // Why this matters: a refused correction changes where this visit's
    // notes go; the author must see why in one line, in plain words.
    const far = correctionRefusedLine({
      horizontalM: 61.4,
      yawDeg: 3,
      maxHorizontalM: 26,
    });
    expect(far).toMatch(/^Code seen 61 m from its saved position/);
    expect(far).toMatch(/this visit follows GPS/);
    expect(
      correctionRefusedLine({
        horizontalM: 2,
        yawDeg: 150.2,
        maxHorizontalM: 26,
      }),
    ).toMatch(/^Code seen turned 150° from its saved position/);
  });
});

describe("autoMeasureAllowed (code book plan §11 D5, extended by the owner)", () => {
  // Why: the owner decided every code seen while a tour is open is
  // measured - even a stray QR that names no tour is "another anchor".
  // Only a code read with no tour open, or still being read, is not.
  it.each([
    ["this-tour", true],
    ["other-tour", true],
    ["unknown", true],
    ["not-a-tour", true],
    ["no-tour-open", false],
    ["resolving", false],
  ] as const)("%s: %s", (relation, allowed) => {
    expect(autoMeasureAllowed(relation)).toBe(allowed);
  });
});

describe("authorStatusLine's ready line says what became of the code (UI round 1, U3)", () => {
  // Why: the code is measured on its own now, so the gate being open is
  // not the same as "measured": a code of another tour is not measured at
  // all, and the line must not claim it was.
  const align = { hasMatrix: true, sampleCount: 5 };
  const stable = {
    status: "stable",
    notStableReason: null,
  } as unknown as QrFusedPose;
  it.each([
    ["measured", "Code measured."],
    ["measuring", "Measuring the code…"],
    ["seen", "Code seen."],
  ] as const)("%s", (ready, text) => {
    expect(authorStatusLine("A", stable, align, false, ready).text).toBe(text);
  });
});
