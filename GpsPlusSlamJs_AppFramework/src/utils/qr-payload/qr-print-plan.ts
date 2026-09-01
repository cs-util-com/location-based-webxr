/**
 * Planning a printable QR code: the launch URL to encode, and the physical
 * size to print it at.
 *
 * WHY THIS EXISTS HERE. The printed code is the anchor between two apps —
 * one authors the level behind it, another consumes it — and the printed
 * string decides the code's identity (`qrCodeId`). Keeping the print rule in
 * one app and the read rule in another is how the two drift apart, and the
 * failure is silent: a code that scans fine but resolves to nothing.
 *
 * The launch URL comes from the MEASURED builder (`buildQrLaunchUrl`): every
 * candidate form is costed by the oracle-locked size estimator with any extra
 * parameter INSIDE the estimate, so the printed string is guaranteed to fit a
 * scannable QR (≤ v25 at EC Q).
 *
 * SIZE CONTRACT — the number the pose solve depends on. The printed side
 * length is the QR SYMBOL: the dark module area WITHOUT the quiet zone. The
 * detector's corners outline the symbol, and the PnP solve scales by it. A
 * renderer must therefore draw the canvas with margin 0 and let the page add
 * the mandatory quiet zone as CSS padding around it.
 *
 * SEE `GpsPlusSlamJs_Docs/docs/2026-08-28-0636-recorder-qr-anchor-authoring-plan.md`
 * §3 M-A (DEC-2b, DEC-6).
 */

import { buildQrLaunchUrl } from './qr-launch-url.js';

/**
 * Where a scanned code lands by default: the BARE host, never a path.
 *
 * The landing page owns `/` and forwards any `?qr=` launch untouched to the
 * viewer, precisely so printed codes never spend payload bits on a path — a
 * path in the printed base would forfeit the densest QR encodings forever
 * (ZD-9). Shared rather than duplicated per app: every app that prints a code
 * prints one that opens the SAME viewer, so the value is a property of the
 * product, not of the printing app.
 */
export const DEFAULT_QR_LAUNCH_BASE_URL = 'https://gps.csutil.com/';

/**
 * Query parameter carrying the per-code token.
 *
 * Its ONLY job is to make several codes for one archive textually distinct,
 * so their `qrCodeId`s differ. Nothing reads its value.
 */
const CODE_TOKEN_PARAM = 'n';

/**
 * Printable-width budget (m) for a home printer: ~19 cm of printable width on
 * A4/Letter with default margins, divided by 1.16 (the 8% quiet zone on each
 * side). At the mandated 100% scale a larger symbol is CLIPPED — and a
 * clipped QR does not decode at all. Larger prints stay allowed (print shops,
 * tiling) but callers should warn in plain words.
 */
export const MAX_HOME_PRINTABLE_SIDE_M = 0.19 / 1.16;

/** A plain-words warning when `sizeM` will not fit a home printer's page, or
 *  `null` when it fits. */
export function homePrintWarning(sizeM: number): string | null {
  if (sizeM <= MAX_HOME_PRINTABLE_SIDE_M) return null;
  const budget = Math.floor(MAX_HOME_PRINTABLE_SIDE_M * 1000) / 1000;
  return (
    `Warning: ${printedSideCss(sizeM)} plus the quiet zone is wider than an ` +
    `A4/Letter page — at 100% scale the code would be cut off and will not ` +
    `scan. Use ${printedSideCss(budget)} or less, or print on a larger sheet.`
  );
}

export interface QrPrintPlan {
  /** The full printable launch URL (the QR's payload). */
  url: string;
  /** The measured QR version (≤ 25 by the builder's guarantee). */
  qrVersion: number;
}

export interface QrPrintOptions {
  /** Where a scan lands. Defaults to {@link DEFAULT_QR_LAUNCH_BASE_URL}. */
  baseUrl?: string;
  /**
   * Which code of a set this is, 1-based. Codes 2 and up get a token
   * appended so their URLs — and therefore their ids — differ from code 1's
   * and from each other. Code 1 gets none: spending those bytes on the
   * single-code case would shrink the payload budget for nothing.
   */
  codeIndex?: number;
  /** Bare-name payload prefix, passed through to the URL builder. */
  defaultAssetPrefix?: string;
}

/**
 * Plan the printable launch URL for one code.
 *
 * @throws RangeError when `codeIndex` is not a positive integer
 * @throws TypeError (from the builder) when no launch form fits a scannable
 *   QR, or the hosting URL is unusable
 */
export async function planPrintCode(
  dataUrl: string,
  options: QrPrintOptions = {}
): Promise<QrPrintPlan> {
  const codeIndex = options.codeIndex ?? 1;
  if (!Number.isInteger(codeIndex) || codeIndex < 1) {
    throw new RangeError(
      `planPrintCode: codeIndex must be a positive integer, got ${String(codeIndex)}`
    );
  }
  const plan = await buildQrLaunchUrl(
    options.baseUrl ?? DEFAULT_QR_LAUNCH_BASE_URL,
    dataUrl,
    {
      ...(options.defaultAssetPrefix !== undefined
        ? { defaultAssetPrefix: options.defaultAssetPrefix }
        : {}),
      // Appended BEFORE size estimation, so the fits-a-QR guarantee covers
      // the string actually printed.
      ...(codeIndex > 1
        ? { extraQuery: { [CODE_TOKEN_PARAM]: String(codeIndex) } }
        : {}),
    }
  );
  return { url: plan.url, qrVersion: plan.estimate.version };
}

/** Metres → exact CSS centimetres for a print stylesheet. */
export function printedSideCss(sizeM: number): string {
  if (!Number.isFinite(sizeM) || sizeM <= 0) {
    throw new RangeError(
      `printed size must be a positive number of metres, got ${String(sizeM)}`
    );
  }
  // Round to 0.1 mm — beyond print-registration accuracy either way. Rounding
  // to a whole millimetre while claiming 0.1 mm is inert for step-aligned
  // inputs, but a hand-typed off-step size would print ~0.3 % off the sizeM
  // the PnP solve assumes: a depth bias on the least-constrained axis.
  const cm = Math.round(sizeM * 10000) / 100;
  return `${String(cm)}cm`;
}
