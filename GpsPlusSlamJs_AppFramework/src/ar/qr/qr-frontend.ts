/**
 * QR detection front-ends — Phase 2 of the QR-code detection & tracking plan
 * (§3). The *detect + decode* hot path is abstracted behind {@link QrFrontEnd}.
 *
 * - {@link BarcodeDetectorFrontEnd} — the only implementation. Wraps the native
 *   Android-Chrome `BarcodeDetector` (GPU/SIMD-backed, zero WASM), returning the
 *   decoded URL + 4 corner pixels in one call.
 *
 * The OpenCV `QRCodeDetector` fallback was removed (the framework is now
 * OpenCV-free); the interim posture is **BarcodeDetector-only**. A pure-JS
 * decoder fallback for browsers without `BarcodeDetector` is a separate
 * dependency decision — see the follow-up
 * `GpsPlusSlamJs_Docs/docs/2026-06-17-0020-qr-decoder-fallback-followup.md`.
 *
 * Corners are emitted in **pixel** coordinates (top-left origin), in SYMBOL
 * order (TL, TR, BR, BL of the printed code) whenever the finder patterns say
 * so (`qr-corner-order.ts`): the native detector reports them in IMAGE order
 * on the owner's phone, which turned the solved pose in 90-degree steps
 * ("Cause A"; QR near-frontal pose plan 2026-09-23-2314, M1c). When the image
 * cannot tell, the order is chained from the same code's last known order
 * (plan §42: at most 500 ms between detections, a small roll, no jump of
 * the centre) or, failing that, comes from the detector.
 *
 * The native detector is INJECTED so this module and its tests need no DOM.
 */

import type { Point2 } from './qr-pose.js';
import { rgbaToImageData } from '../rgba-image-data.js';
import {
  createCornerOrderCanonicalizer,
  type CornerOrderSource,
} from './qr-corner-order.js';

/** Raw RGBA pixels of the frame fed to detection (top-left origin). */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** One decoded QR: its 4 corner pixels and the decoded text (the level URL). */
export interface QrDetection {
  corners: [Point2, Point2, Point2, Point2];
  text: string;
  /**
   * Where the corner order came from (near-frontal pose plan §39 F0a):
   * `finder`, `memory` or `native`; absent when the producer does not say.
   */
  orderSource?: CornerOrderSource;
  /**
   * On a finder frame with a live chain (plan §42 S4): whether the chain
   * would have chosen the same order - the chain's error rate on the phone.
   */
  orderAudit?: 'agree' | 'disagree' | 'reject';
}

/** Front-agnostic detect+decode contract. */
export interface QrFrontEnd {
  readonly kind: 'barcode-detector';
  /** Detect the first QR in the frame, or `null` if none. */
  detect(image: RgbaImage): Promise<QrDetection | null>;
  /** Free any native resources. */
  dispose?(): void;
}

// --- Native BarcodeDetector ------------------------------------------------

/** The native-`BarcodeDetector` result shape we consume. */
export interface DetectedBarcodeLike {
  rawValue: string;
  cornerPoints: ReadonlyArray<{ x: number; y: number }>;
  format?: string;
}

/** Puts one detection's corners into symbol order, saying how (injectable for tests). */
export type CornerOrderer = (
  text: string,
  image: RgbaImage,
  corners: [Point2, Point2, Point2, Point2]
) => {
  corners: [Point2, Point2, Point2, Point2];
  source: CornerOrderSource;
  audit?: 'agree' | 'disagree' | 'reject';
};

/** The slice of `BarcodeDetector` we depend on. */
export interface BarcodeDetectorLike {
  detect(image: unknown): Promise<DetectedBarcodeLike[]>;
}

/**
 * Convert our `RgbaImage` into something `BarcodeDetector.detect` accepts
 * (`ImageData` is a valid `ImageBitmapSource`). Injected so tests need no DOM.
 */
export type ToImageBitmapSource = (image: RgbaImage) => unknown;

/**
 * Default conversion: wrap the frame in `ImageData` WITHOUT copying (the frame
 * is already an owned copy; QR perf plan 2026-09-23, M3). The adopt-or-copy
 * rule lives in one place, `../rgba-image-data.ts`.
 */
const defaultToImageData: ToImageBitmapSource = rgbaToImageData;

export class BarcodeDetectorFrontEnd implements QrFrontEnd {
  readonly kind = 'barcode-detector';
  private readonly detector: BarcodeDetectorLike;
  private readonly toSource: ToImageBitmapSource;
  private readonly orderCorners: CornerOrderer;

  constructor(
    detector: BarcodeDetectorLike,
    toSource: ToImageBitmapSource = defaultToImageData,
    orderCorners: CornerOrderer = defaultCornerOrderer()
  ) {
    this.detector = detector;
    this.toSource = toSource;
    this.orderCorners = orderCorners;
  }

  async detect(image: RgbaImage): Promise<QrDetection | null> {
    const results = await this.detector.detect(this.toSource(image));
    for (const r of results) {
      const corners = toQuad(r.cornerPoints);
      if (corners && typeof r.rawValue === 'string' && r.rawValue.length > 0) {
        const ordered = this.orderCorners(r.rawValue, image, corners);
        return {
          corners: ordered.corners,
          text: r.rawValue,
          orderSource: ordered.source,
          ...(ordered.audit ? { orderAudit: ordered.audit } : {}),
        };
      }
    }
    return null;
  }
}

/**
 * Build a {@link BarcodeDetectorFrontEnd} if the runtime exposes a
 * `BarcodeDetector` constructor; otherwise `null` (→ the caller must handle the
 * unsupported-browser case; there is no OpenCV fallback). `ctor` is injectable
 * for tests; `toSource` overrides the default no-copy conversion (e.g. a
 * measuring or copying one for a performance A/B).
 */
export function createBarcodeDetectorFrontEnd(
  ctor?: new (opts: { formats: string[] }) => BarcodeDetectorLike,
  toSource?: ToImageBitmapSource
): BarcodeDetectorFrontEnd | null {
  const Ctor =
    ctor ??
    (
      globalThis as {
        BarcodeDetector?: new (opts: {
          formats: string[];
        }) => BarcodeDetectorLike;
      }
    ).BarcodeDetector;
  if (!Ctor) return null;
  return new BarcodeDetectorFrontEnd(
    new Ctor({ formats: ['qr_code'] }),
    toSource ?? defaultToImageData
  );
}

// --- helpers ---------------------------------------------------------------

/** The finder-pattern orderer with its per-code memory, one per front end. */
function defaultCornerOrderer(): CornerOrderer {
  const canonicalizer = createCornerOrderCanonicalizer();
  return (text, image, corners) => {
    const result = canonicalizer.canonicalize(text, image, corners);
    return {
      corners: result.corners,
      source: result.source,
      ...(result.audit ? { audit: result.audit } : {}),
    };
  };
}

function toQuad(
  points: ReadonlyArray<{ x: number; y: number }>
): [Point2, Point2, Point2, Point2] | null {
  if (points.length !== 4) return null;
  const [a, b, c, d] = points;
  if (!a || !b || !c || !d) return null;
  const out: [Point2, Point2, Point2, Point2] = [
    { x: a.x, y: a.y },
    { x: b.x, y: b.y },
    { x: c.x, y: c.y },
    { x: d.x, y: d.y },
  ];
  if (out.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return null;
  return out;
}
