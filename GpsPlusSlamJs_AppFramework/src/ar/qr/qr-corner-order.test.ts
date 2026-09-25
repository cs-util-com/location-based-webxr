/**
 * Canonical corner order from the finder patterns (QR near-frontal pose plan
 * 2026-09-23-2314, M1c).
 *
 * Why these tests matter: the owner's phone reports QR corners in IMAGE order
 * (QR summary §4b runs 3-6: shifted in every frame viewed at 90/180/270 deg),
 * which turns every solved pose by 90 or 180 deg about the code's normal and
 * no fit check can see it (a square is 4-fold symmetric). The frames here are
 * rendered at known poses with the synthetic renderer, and the detector's
 * behaviour is emulated by handing the TRUE corners over in image order.
 */
import { describe, expect, it } from 'vitest';
import type { Point2 } from './qr-pose';
import type { RgbaImage } from './qr-frontend';
import {
  perspectiveProjection,
  qrPoseFacingCamera,
  renderQrFrame,
} from '../../test-utils/synthetic-qr-frame';
import {
  canonicalizeCorners,
  createCornerOrderCanonicalizer,
} from './qr-corner-order';

const PAYLOAD =
  'https://gps-plus-slam.csutil.workers.dev/tour/?t=S/k7Qm2xPz9LbV4nRw8TcY3hFd6JsA1eGu5oKi0MNq';
type Quad = [Point2, Point2, Point2, Point2];

function frame(opts: {
  rollDeg: number;
  tiltXDeg?: number;
  tiltYDeg?: number;
  distanceM?: number;
}) {
  const projection = perspectiveProjection({ fovYDeg: 50, aspect: 1024 / 768 });
  return renderQrFrame({
    text: PAYLOAD,
    sizeM: 0.16,
    qrPoseInCamera: qrPoseFacingCamera({
      distanceM: opts.distanceM ?? 0.5,
      rollDeg: opts.rollDeg,
      tiltXDeg: opts.tiltXDeg ?? 0,
      tiltYDeg: opts.tiltYDeg ?? 0,
    }),
    projection,
    width: 1024,
    height: 768,
    supersample: 2,
    noiseSigma: 2,
    seed: Math.round(opts.rollDeg * 7 + (opts.tiltXDeg ?? 0)),
  });
}

/** A frontal code of the given payload (EC level M) at ~9 px/module. */
function codeFrame(text: string, rollDeg: number) {
  return renderQrFrame({
    text,
    ecLevel: 'M',
    sizeM: 0.16,
    qrPoseInCamera: qrPoseFacingCamera({ distanceM: 0.55, rollDeg }),
    projection: perspectiveProjection({ fovYDeg: 50, aspect: 1024 / 768 }),
    width: 1024,
    height: 768,
    supersample: 2,
    noiseSigma: 1,
    seed: 1,
  });
}

/** What an image-ordered detector returns: start at the top-left-most corner. */
function imageOrder(truth: readonly Point2[]): Quad {
  let start = 0;
  truth.forEach((p, i) => {
    if (p.x + p.y < truth[start]!.x + truth[start]!.y) start = i;
  });
  return [0, 1, 2, 3].map((k) => truth[(start + k) % 4]!) as Quad;
}

function shifted(q: readonly Point2[], k: number): Quad {
  return [0, 1, 2, 3].map((i) => q[(i + k) % 4]!) as Quad;
}

/** Integer corners, as the native detector reports them. */
function rounded(q: readonly Point2[]): Quad {
  return q.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) as Quad;
}

function expectSameCorners(
  actual: readonly Point2[],
  expected: readonly Point2[]
): void {
  for (let i = 0; i < 4; i++) {
    expect(
      Math.hypot(actual[i]!.x - expected[i]!.x, actual[i]!.y - expected[i]!.y)
    ).toBeLessThan(1e-9);
  }
}

describe('canonicalizeCorners', () => {
  it.each([0, 17, 45, 90, 133, 180, 222, 270, 315])(
    'recovers the symbol order from image-ordered corners at roll %i deg',
    (rollDeg) => {
      const f = frame({ rollDeg });
      const input = rounded(imageOrder(f.truthCorners));
      const out = canonicalizeCorners(f.image, input);
      expect(out.confident).toBe(true);
      expectSameCorners(out.corners, rounded(f.truthCorners));
    }
  );

  it.each([
    { tiltXDeg: 35, rollDeg: 100 },
    { tiltYDeg: -40, rollDeg: 200 },
    { tiltXDeg: 20, tiltYDeg: 25, rollDeg: 300 },
  ])('recovers it on a tilted code too (%o)', (pose) => {
    const f = frame(pose);
    const out = canonicalizeCorners(
      f.image,
      rounded(imageOrder(f.truthCorners))
    );
    expect(out.confident).toBe(true);
    expectSameCorners(out.corners, rounded(f.truthCorners));
  });

  // Why this test matters: the phone's corners sit ~2 px from zxing's (QR
  // summary §4b runs 4-8). The rule copes with 2 px either way on a small
  // code; the opt-in sweep maps where it stops (3 px on codes under 4 px per
  // module), and a relaxed rule that passed a 3 px case measured WORSE across
  // the sweep (fewer confident, two wrong-confident), so it was reverted.
  it.each([
    { shiftPx: 2, rollDeg: 270 },
    { shiftPx: -2, rollDeg: 270 },
    { shiftPx: 2, rollDeg: 90 },
    { shiftPx: -2, rollDeg: 180 },
  ])(
    'tolerates corners $shiftPx px off (+ = inward) on a small code (roll $rollDeg)',
    ({ shiftPx, rollDeg }) => {
      const f = frame({ rollDeg, distanceM: 1.1 });
      expect(f.modulePx).toBeLessThan(4.5);
      const truth = rounded(f.truthCorners);
      const cx = truth.reduce((sum, q) => sum + q.x, 0) / 4;
      const cy = truth.reduce((sum, q) => sum + q.y, 0) / 4;
      const moved = truth.map((q) => {
        const d = Math.hypot(cx - q.x, cy - q.y);
        return {
          x: Math.round(q.x + ((cx - q.x) / d) * shiftPx),
          y: Math.round(q.y + ((cy - q.y) / d) * shiftPx),
        };
      }) as Quad;
      const out = canonicalizeCorners(f.image, imageOrder(moved));
      expect(out.confident).toBe(true);
      expectSameCorners(out.corners, moved);
    }
  );

  // Why this test matters (milestone review 2026-09-24, finding 1): from the
  // BR corner the diagonal crosses data modules and then the alignment
  // pattern's rings; for many printed codes they merge into a perfect
  // 1:1:3:1:1, so BR reads as a fourth finder and the order is never known.
  // These short payloads (version 2) all did that with the diagonal-only rule.
  it.each([
    'https://ex.co/p/0',
    'https://ex.co/p/10',
    'https://ex.co/p/14',
    'https://ex.co/p/17',
  ])('orders a code whose BR diagonal mimics a finder (%s)', (text) => {
    for (const rollDeg of [0, 180]) {
      const f = codeFrame(text, rollDeg);
      const truth = rounded(f.truthCorners);
      const out = canonicalizeCorners(f.image, imageOrder(truth));
      expect(out.confident, `roll ${rollDeg}`).toBe(true);
      expectSameCorners(out.corners, truth);
    }
  });

  // Why this test matters: with a real finder washed out (glare, a smudge),
  // a BR that mimics a finder must not stand in for it - that was a
  // CONFIDENT 90/180-deg error with the diagonal-only rule. Unsure is fine.
  it('is never confidently wrong when a real finder is washed out', () => {
    const f = codeFrame('https://ex.co/p/0', 0);
    const [tl, tr, , bl] = f.truthCorners;
    // Paint the TL finder (7 of 25 modules) and a margin white.
    const reach = 8.5 / f.moduleCount;
    const { data, width } = f.image;
    for (let y = 0; y < f.image.height; y++) {
      for (let x = 0; x < width; x++) {
        const u =
          ((x - tl.x) * (tr.x - tl.x) + (y - tl.y) * (tr.y - tl.y)) /
          ((tr.x - tl.x) ** 2 + (tr.y - tl.y) ** 2);
        const v =
          ((x - tl.x) * (bl.x - tl.x) + (y - tl.y) * (bl.y - tl.y)) /
          ((bl.x - tl.x) ** 2 + (bl.y - tl.y) ** 2);
        if (u > -0.02 && u < reach && v > -0.02 && v < reach) {
          const o = (y * width + x) * 4;
          data[o] = data[o + 1] = data[o + 2] = 255;
        }
      }
    }
    const truth = rounded(f.truthCorners);
    const out = canonicalizeCorners(f.image, imageOrder(truth));
    const correct = out.corners.every(
      (p, i) => p.x === truth[i]!.x && p.y === truth[i]!.y
    );
    expect(out.confident && !correct).toBe(false);
  });

  // Why this test matters: the answer must depend on the image, never on the
  // order the detector happened to report.
  it('gives the same order for every cyclic shift of the input', () => {
    const f = frame({ rollDeg: 61, tiltXDeg: 15 });
    const truth = rounded(f.truthCorners);
    for (let k = 0; k < 4; k++) {
      const out = canonicalizeCorners(f.image, shifted(truth, k));
      expect(out.confident, `shift ${k}`).toBe(true);
      expectSameCorners(out.corners, truth);
    }
  });

  // Why this test matters: a wrong CONFIDENT answer is the failure that
  // matters; on an image with no QR in the quad the rule must say "unsure"
  // and hand the input back unchanged.
  it('is never confident on a quad without a QR code, and keeps the input', () => {
    const blank: RgbaImage = {
      data: new Uint8ClampedArray(1024 * 768 * 4).fill(128),
      width: 1024,
      height: 768,
    };
    const quad: Quad = [
      { x: 300, y: 200 },
      { x: 600, y: 210 },
      { x: 590, y: 500 },
      { x: 310, y: 490 },
    ];
    const out = canonicalizeCorners(blank, quad);
    expect(out.confident).toBe(false);
    expectSameCorners(out.corners, quad);
  });

  // Why this test matters: an alignment-like pattern (rings of ONE module,
  // 1:1:1:1:1) sits near a real symbol's BR corner; only the finder's 3-module
  // core tells them apart. Without that check this corner reads as a fourth
  // finder and the order is lost (mutation-checked).
  it('does not mistake 1:1:1:1:1 rings for a finder pattern', () => {
    const size = 640;
    const module = 20; // 21 modules over 420 px, from (100, 100)
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    const paint = (mx: number, my: number, w: number, dark: boolean) => {
      for (let y = 100 + my * module; y < 100 + (my + w) * module; y++) {
        for (let x = 100 + mx * module; x < 100 + (mx + w) * module; x++) {
          const o = (y * size + x) * 4;
          data[o] = data[o + 1] = data[o + 2] = dark ? 0 : 255;
        }
      }
    };
    const finder = (mx: number, my: number) => {
      paint(mx, my, 7, true);
      paint(mx + 1, my + 1, 5, false);
      paint(mx + 2, my + 2, 3, true);
    };
    finder(0, 0);
    finder(14, 0);
    finder(0, 14);
    // BR corner: concentric one-module rings, no finder.
    paint(16, 16, 5, true);
    paint(17, 17, 3, false);
    paint(18, 18, 1, true);
    const image: RgbaImage = { data, width: size, height: size };
    const symbol: Quad = [
      { x: 100, y: 100 },
      { x: 520, y: 100 },
      { x: 520, y: 520 },
      { x: 100, y: 520 },
    ];
    const out = canonicalizeCorners(image, shifted(symbol, 3));
    expect(out.confident).toBe(true);
    expectSameCorners(out.corners, symbol);
  });

  it('is unsure, not throwing, for corners outside the image', () => {
    const f = frame({ rollDeg: 0 });
    const outside: Quad = [
      { x: -500, y: -500 },
      { x: 5000, y: -500 },
      { x: 5000, y: 5000 },
      { x: -500, y: 5000 },
    ];
    expect(canonicalizeCorners(f.image, outside).confident).toBe(false);
  });
});

describe('createCornerOrderCanonicalizer (memory for unsure frames)', () => {
  const blank: RgbaImage = {
    data: new Uint8ClampedArray(1024 * 768 * 4).fill(128),
    width: 1024,
    height: 768,
  };

  // Why this test matters: when a frame is unsure (blur, a small code), the
  // last confident order of the same code, moments ago, is a better guess
  // than the detector's image order.
  it('falls back to the closest shift of the last confident order, while it is recent', () => {
    let t = 0;
    const c = createCornerOrderCanonicalizer({ now: () => t, memoryMs: 500 });
    const f = frame({ rollDeg: 150 });
    const truth = rounded(f.truthCorners);
    expect(c.canonicalize(PAYLOAD, f.image, imageOrder(truth)).confident).toBe(
      true
    );
    t = 200;
    const moved = truth.map((p) => ({ x: p.x + 3, y: p.y - 2 }));
    const out = c.canonicalize(PAYLOAD, blank, imageOrder(moved));
    expect(out.confident).toBe(false);
    expectSameCorners(out.corners, moved);
  });

  it('keeps the detector order once the memory is stale, or for another code', () => {
    let t = 0;
    const c = createCornerOrderCanonicalizer({ now: () => t, memoryMs: 500 });
    const f = frame({ rollDeg: 150 });
    const truth = rounded(f.truthCorners);
    expect(c.canonicalize(PAYLOAD, f.image, imageOrder(truth)).confident).toBe(
      true
    );
    t = 800;
    const input = imageOrder(truth);
    expectSameCorners(c.canonicalize(PAYLOAD, blank, input).corners, input);
    t = 900;
    expectSameCorners(
      c.canonicalize('other-code', blank, input).corners,
      input
    );
  });
});

describe('corner order source (plan §39 F0a)', () => {
  // Why this test matters: the field tests show pose jumps of ~90/180 deg
  // (corner-order flips), and the fix depends on whether those frames had
  // an order from the finder patterns (confident) or a fallback. The
  // canonicaliser knows; it must say so.
  const blank: RgbaImage = {
    data: new Uint8ClampedArray(1024 * 768 * 4).fill(128),
    width: 1024,
    height: 768,
  };

  it('names the finder patterns when confident, the native order when not', () => {
    const f = frame({ rollDeg: 0 });
    const truth = rounded(f.truthCorners);
    expect(canonicalizeCorners(f.image, imageOrder(truth)).source).toBe(
      'finder'
    );
    expect(canonicalizeCorners(blank, imageOrder(truth)).source).toBe('native');
  });

  it('names the memory when an unsure frame took the remembered order', () => {
    let t = 0;
    const c = createCornerOrderCanonicalizer({ now: () => t, memoryMs: 500 });
    const f = frame({ rollDeg: 150 });
    const truth = rounded(f.truthCorners);
    expect(c.canonicalize(PAYLOAD, f.image, imageOrder(truth)).source).toBe(
      'finder'
    );
    t = 200;
    expect(c.canonicalize(PAYLOAD, blank, imageOrder(truth)).source).toBe(
      'memory'
    );
    t = 900;
    expect(c.canonicalize(PAYLOAD, blank, imageOrder(truth)).source).toBe(
      'native'
    );
  });
});

describe('createCornerOrderCanonicalizer chain (plan §42)', () => {
  // Why these tests matter: on the phone every big pose jump was a frame in
  // the detector's own (image) order after the 500 ms memory ran out
  // (plan §40). The chain keeps a code's order frame to frame; the roll
  // check and the breaks keep it from carrying a WRONG order.
  /** A square code in the image, in symbol order, rolled `rollDeg`. */
  function quadAt(cx: number, cy: number, edge: number, rollDeg: number): Quad {
    const h = edge / 2;
    const r = (rollDeg * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return (
      [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ] as const
    ).map(([x, y]) => ({
      x: cx + c * x - s * y,
      y: cy + s * x + c * y,
    })) as Quad;
  }
  const image = (width = 1024, height = 768): RgbaImage => ({
    data: new Uint8ClampedArray(4),
    width,
    height,
  });
  /** A canonicaliser whose single-frame orderer is confident only on demand. */
  function rig() {
    let confident: Quad | null = null;
    let t = 0;
    const c = createCornerOrderCanonicalizer({
      now: () => t,
      orderFrame: (_image, corners) =>
        confident
          ? { corners: confident, confident: true, source: 'finder' }
          : {
              corners: [...corners] as Quad,
              confident: false,
              source: 'native',
            },
    });
    return {
      c,
      at(ms: number) {
        t = ms;
      },
      finder(q: Quad | null) {
        confident = q;
      },
    };
  }
  /** Anchor the code's order with a finder frame at t = 0. */
  function anchored(q: Quad, img = image()) {
    const r = rig();
    r.finder(q);
    r.c.canonicalize(PAYLOAD, img, imageOrder(q));
    r.finder(null);
    return r;
  }

  it('chains unsure frames past 500 ms while each follows the last within it', () => {
    const start = quadAt(500, 380, 150, 50);
    // At 50 deg of roll the image order is NOT the symbol order.
    expect(imageOrder(start)[0]).not.toEqual(start[0]);
    const r = anchored(start);
    for (let i = 1; i <= 10; i++) {
      r.at(i * 150);
      const truth = quadAt(500 + 15 * i, 380, 150, 50 + 3 * i);
      const out = r.c.canonicalize(PAYLOAD, image(), imageOrder(truth));
      expect(out.source).toBe('memory');
      expectSameCorners(out.corners, truth);
    }
  });

  // A regression pin rather than a red-first test: today's nearest-shift
  // pick already survives translation; a ratio-style ambiguity test would
  // not (plan §42 #1), and the roll check must not either.
  it('holds through an ordinary pan: the roll check ignores translation', () => {
    const r = anchored(quadAt(300, 380, 150, 50));
    for (let i = 1; i <= 4; i++) {
      r.at(i * 150);
      const truth = quadAt(300 + 105 * i, 380, 150, 50);
      const out = r.c.canonicalize(PAYLOAD, image(), imageOrder(truth));
      expect(out.source).toBe('memory');
      expectSameCorners(out.corners, truth);
    }
  });

  // A roll of 45 deg between two detections is as far from one shift as
  // from the next: the chain cannot tell it from a relabel and must end.
  // (A roll of 60-120 deg is indistinguishable from a smaller roll plus a
  // relabel in ANY image-space check - only its implausible rate guards it.)
  it('ends the chain on a roll it cannot tell from a relabel (45 deg)', () => {
    const r = anchored(quadAt(500, 380, 150, 50));
    r.at(150);
    const truth = quadAt(500, 380, 150, 95);
    const out = r.c.canonicalize(PAYLOAD, image(), imageOrder(truth));
    expect(out.source).toBe('native');
    expectSameCorners(out.corners, imageOrder(truth));
  });

  it('breaks on a fast roll and stays broken, never picking a wrong shift', () => {
    const r = anchored(quadAt(500, 380, 150, 50));
    r.at(150);
    const first = quadAt(500, 380, 150, 86);
    expect(r.c.canonicalize(PAYLOAD, image(), imageOrder(first)).source).toBe(
      'native'
    );
    r.at(300);
    const second = quadAt(500, 380, 150, 122);
    expect(r.c.canonicalize(PAYLOAD, image(), imageOrder(second)).source).toBe(
      'native'
    );
  });

  it('ends the chain when the capture size changes (a fold or rotation)', () => {
    const q = quadAt(500, 380, 150, 50);
    const r = anchored(q, image(1024, 768));
    r.at(150);
    const out = r.c.canonicalize(PAYLOAD, image(768, 1024), imageOrder(q));
    expect(out.source).toBe('native');
  });

  it("ends the chain when the code's centre jumps (a second print)", () => {
    const r = anchored(quadAt(200, 380, 150, 50));
    r.at(150);
    const far = quadAt(200 + 3 * 150, 380, 150, 50);
    expect(r.c.canonicalize(PAYLOAD, image(), imageOrder(far)).source).toBe(
      'native'
    );
  });

  it('ends the chain after a gap longer than memoryMs between detections', () => {
    const q = quadAt(500, 380, 150, 50);
    const r = anchored(q);
    r.at(600);
    expect(r.c.canonicalize(PAYLOAD, image(), imageOrder(q)).source).toBe(
      'native'
    );
  });

  it('picks the same order whatever cyclic shift the detector reports', () => {
    const truth = quadAt(520, 380, 150, 55);
    for (let k = 0; k < 4; k++) {
      const r = anchored(quadAt(500, 380, 150, 50));
      r.at(150);
      const out = r.c.canonicalize(PAYLOAD, image(), shifted(truth, k));
      expect(out.source).toBe('memory');
      expectSameCorners(out.corners, truth);
    }
  });

  // The phone check that cannot pass by construction (plan §42 #3): on
  // every finder frame, what would the live chain have chosen?
  it('audits a live chain against every finder frame', () => {
    const q = quadAt(500, 380, 150, 50);
    const agree = anchored(q);
    agree.at(150);
    agree.finder(q);
    expect(agree.c.canonicalize(PAYLOAD, image(), imageOrder(q)).audit).toBe(
      'agree'
    );
    const disagree = anchored(q);
    disagree.at(150);
    disagree.finder(shifted(q, 1));
    expect(disagree.c.canonicalize(PAYLOAD, image(), imageOrder(q)).audit).toBe(
      'disagree'
    );
    const reject = anchored(q);
    reject.at(150);
    const turned = quadAt(500, 380, 150, 95);
    reject.finder(turned);
    expect(
      reject.c.canonicalize(PAYLOAD, image(), imageOrder(turned)).audit
    ).toBe('reject');
    const none = rig();
    none.finder(q);
    expect(
      none.c.canonicalize(PAYLOAD, image(), imageOrder(q)).audit
    ).toBeUndefined();
  });
});
