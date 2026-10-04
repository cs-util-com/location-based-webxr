/**
 * The creator's print-size check (QR size consensus plan 2026-09-27-0350,
 * §11-§13, S3a): while the creator walks at a code, measure the printed code
 * by parallax and offer the measured size when the print came out at a
 * different size than typed - a print dialog's fit-to-page shrank the
 * owner's 16 cm print to 15.45 cm. See print-size-check.ts.md.
 */

import {
  createQrParallaxSizeTally,
  measuredSizeOffer,
  type QrFusedPose,
  type QrParallaxSizeWindow,
} from "gps-plus-slam-app-framework/ar/qr";

export interface PrintSizeCheckDeps {
  /** The parallax estimate over `text`'s current entries, or null (refused). */
  estimate: (text: string) => QrParallaxSizeWindow | null;
}

/** How the creator answered, or the check's own quiet answer. */
type Answer = "kept" | "adopted" | "confirmed";

export interface PrintSizeCheck {
  /** One detection of `text`, with its fused result and the typed size. */
  onDetection(
    text: string,
    fused: QrFusedPose | null,
    typedSizeM: number,
  ): void;
  /** The measured size on offer, or null. */
  offer(): { text: string; sizeM: number } | null;
  /** True while `text` has no answer yet (the creator should step sideways). */
  pending(text: string): boolean;
  /** The creator kept the typed size or adopted the measured one. */
  answer(text: string, answer: "kept" | "adopted"): void;
  /** A new AR session or tour: forget everything. */
  reset(): void;
}

/** Independent windows the answer waits for (plan §13). */
const WINDOWS = 3;

export function createPrintSizeCheck(deps: PrintSizeCheckDeps): PrintSizeCheck {
  const tally = createQrParallaxSizeTally();
  const answers = new Map<string, Answer>();
  let current: { text: string; sizeM: number } | null = null;

  return {
    onDetection(text, fused, typedSizeM) {
      // Asked once per code per session (plan §12 #8), and not again while
      // an offer waits for the creator.
      if (answers.has(text) || current?.text === text) return;
      const turning = fused?.motion?.state.includes("turning") ?? false;
      tally.add(text, {
        parallax: turning ? null : deps.estimate(text),
        turning,
      });
      const independent = tally.independent(text);
      if (independent.length < WINDOWS) return;
      const offer = measuredSizeOffer(independent, typedSizeM, {
        windows: WINDOWS,
      });
      if (offer) current = { text, sizeM: offer.sizeM };
      else answers.set(text, "confirmed");
    },
    offer: () => current,
    pending: (text) => !answers.has(text) && current?.text !== text,
    answer(text, answer) {
      answers.set(text, answer);
      if (current?.text === text) current = null;
    },
    reset() {
      tally.reset();
      answers.clear();
      current = null;
    },
  };
}
