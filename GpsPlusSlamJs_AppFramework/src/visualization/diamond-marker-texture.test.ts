/**
 * @vitest-environment jsdom
 *
 * Why this test matters: the drawer is the one place the CSS's geometry and
 * choreography become pixels, and pixels are exactly what these tests
 * cannot see (jsdom has no canvas backend). So they pin what CAN be seen:
 * the transform that puts the SVG's −4 viewBox origin where it belongs, the
 * dash offset the seam's `outline` becomes, the dot skipped while absent,
 * the ONE group shadow on the texture canvas and none on the scratch one,
 * the change-detection freeze that stops uploads once settled, and the
 * null-context path the HUD's own jsdom tests will hit.
 *
 * @see diamond-marker-texture.ts.md
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DIAMOND_ENTRANCE_SETTLED,
  computeDiamondEntrance,
} from './diamond-entrance.js';
import {
  DEFAULT_DIAMOND_HALO,
  DIAMOND_GEOMETRY,
  createDiamondMarkerTexture,
  type DiamondMarkerTextureOptions,
} from './diamond-marker-texture.js';

/** A recording stub of the 2D context: every call a spy, every property a plain field. */
function makeRecordingContext(overrides: Record<string, unknown> = {}) {
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    lineDashOffset: 0,
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    ...overrides,
  };
}

type RecordingContext = ReturnType<typeof makeRecordingContext>;

/**
 * Patch document.createElement so EACH canvas gets its own recorder, in
 * creation order. The two must be told apart — the shadow belongs on the
 * texture canvas and not on the scratch one.
 */
function injectContexts(
  make: () => RecordingContext | null
): RecordingContext[] {
  const contexts: RecordingContext[] = [];
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (tagName: string): HTMLElement => {
      const el = original(tagName);
      if (tagName === 'canvas') {
        const ctx = make();
        if (ctx) contexts.push(ctx);
        (el as HTMLCanvasElement).getContext = vi.fn(
          () => ctx
        ) as unknown as HTMLCanvasElement['getContext'];
      }
      return el;
    }
  );
  return contexts;
}

/** Inject, create, and hand back the recorders: texture canvas first, scratch second. */
function create(
  options: DiamondMarkerTextureOptions,
  make: () => RecordingContext | null = makeRecordingContext
) {
  const contexts = injectContexts(make);
  const marker = createDiamondMarkerTexture(options);
  return {
    marker,
    main: contexts[0] as RecordingContext,
    scratch: contexts[1] as RecordingContext,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

const colours = { ink: '#fff', accent: '#f2971f' };

describe('createDiamondMarkerTexture — drawing', () => {
  it('draws in the SVG space: shifts by the viewBox inset, then scales, then rotates about the centre', () => {
    const { marker, scratch } = create({ ...colours, size: 256 });
    marker.apply(computeDiamondEntrance(0));
    const s = 256 / DIAMOND_GEOMETRY.viewBoxSize;
    expect(scratch.translate.mock.calls[0]).toEqual([4 * s, 4 * s]);
    expect(scratch.scale).toHaveBeenCalledWith(s, s);
    expect(scratch.translate.mock.calls[1]).toEqual([32, 32]);
    expect(scratch.rotate).toHaveBeenCalledWith(Math.PI / 4);
    expect(scratch.translate.mock.calls[2]).toEqual([-32, -32]);
    expect(scratch.roundRect).toHaveBeenCalledWith(10, 10, 44, 44, 4);
    expect(scratch.lineWidth).toBe(2);
    expect(scratch.strokeStyle).toBe('#fff');
  });

  it("the dash offset is the seam's undrawn share, and the dot is skipped while absent", () => {
    const { marker, scratch } = create(colours);
    marker.apply(computeDiamondEntrance(0));
    expect(scratch.setLineDash).toHaveBeenCalledWith([180, 180]);
    expect(scratch.lineDashOffset).toBe(180);
    expect(scratch.arc).not.toHaveBeenCalled();

    marker.apply({ outline: 0.5, dot: 0, settled: false });
    expect(scratch.lineDashOffset).toBe(90);
    expect(scratch.arc).not.toHaveBeenCalled();

    marker.apply(DIAMOND_ENTRANCE_SETTLED);
    expect(scratch.lineDashOffset).toBe(0);
    expect(scratch.arc).toHaveBeenCalledWith(32, 32, 4.5, 0, Math.PI * 2);
    expect(scratch.fillStyle).toBe('#f2971f');
    expect(scratch.globalAlpha).toBe(1);
    // The dot's stroke is the hairline, and the dash is cleared for it.
    expect(scratch.lineWidth).toBe(0.5);
    expect(scratch.setLineDash).toHaveBeenLastCalledWith([]);
  });

  it('a half-popped dot is scaled and faded by the same factor, its stroke included', () => {
    // The CSS pops the dot with `transform: scale`, which scales the stroke
    // with the radius; a fixed hairline would read 2× heavier mid-pop.
    const { marker, scratch } = create(colours);
    marker.apply({ outline: 1, dot: 0.5, settled: false });
    expect(scratch.arc).toHaveBeenCalledWith(32, 32, 2.25, 0, Math.PI * 2);
    expect(scratch.globalAlpha).toBe(0.5);
    expect(scratch.lineWidth).toBe(0.25);
  });

  it('composites the scratch canvas ONCE onto the texture canvas with the group shadow; the scratch canvas has none', () => {
    const { marker, main, scratch } = create({ ...colours, size: 72 });
    marker.apply(DIAMOND_ENTRANCE_SETTLED);
    expect(main.drawImage).toHaveBeenCalledTimes(1);
    expect(main.shadowColor).toBe(DEFAULT_DIAMOND_HALO);
    expect(main.shadowBlur).toBe(2); // 2σ at scale 1
    expect(main.shadowOffsetY).toBe(1);
    expect(main.shadowOffsetX).toBe(0);
    expect(scratch.shadowBlur).toBe(0);
    expect(scratch.drawImage).not.toHaveBeenCalled();
    // Nothing of the shapes is drawn on the texture canvas directly.
    expect(main.stroke).not.toHaveBeenCalled();
    expect(main.arc).not.toHaveBeenCalled();
  });

  it('scales the shadow with the canvas and honours a custom halo', () => {
    const { marker, main } = create({
      ...colours,
      size: 144,
      halo: 'rgba(1, 2, 3, 0.5)',
    });
    marker.apply(DIAMOND_ENTRANCE_SETTLED);
    expect(main.shadowBlur).toBe(4);
    expect(main.shadowOffsetY).toBe(2);
    expect(main.shadowColor).toBe('rgba(1, 2, 3, 0.5)');
  });

  it('falls back to a hand-built rounded path where roundRect is absent', () => {
    const { marker, scratch } = create(colours, () =>
      makeRecordingContext({ roundRect: undefined })
    );
    marker.apply(computeDiamondEntrance(0));
    expect(scratch.arcTo).toHaveBeenCalledTimes(4);
    expect(scratch.closePath).toHaveBeenCalled();
  });
});

describe('createDiamondMarkerTexture — uploads and lifecycle', () => {
  it('requests an upload exactly once per changed state and never for a repeated one', () => {
    // `needsUpdate` is write-only in three; each `= true` bumps `version`,
    // which is what the renderer compares — so the version is the upload count.
    const { marker } = create(colours);
    const before = marker.texture.version;
    expect(marker.apply(computeDiamondEntrance(0))).toBe(true);
    expect(marker.texture.version).toBe(before + 1);
    expect(marker.apply(computeDiamondEntrance(0))).toBe(false);
    expect(marker.texture.version).toBe(before + 1);
    expect(marker.apply(DIAMOND_ENTRANCE_SETTLED)).toBe(true);
    expect(marker.texture.version).toBe(before + 2);
    // A settled marker is drawn once; later applies of the same state are free.
    expect(marker.apply(DIAMOND_ENTRANCE_SETTLED)).toBe(false);
    expect(marker.texture.version).toBe(before + 2);
  });

  it('is sRGB-tagged and reports a non-negative draw time', () => {
    const { marker } = create(colours);
    expect(marker.texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(marker.lastDrawMs).toBe(0);
    marker.apply(DIAMOND_ENTRANCE_SETTLED);
    expect(marker.lastDrawMs).toBeGreaterThanOrEqual(0);
  });

  it('tolerates a null 2D context: apply reports no redraw, dispose stays safe', () => {
    // jsdom without a canvas backend — the environment the HUD's own unit
    // tests run in once they construct a marker per target.
    const { marker } = create(colours, () => null);
    const before = marker.texture.version;
    expect(marker.apply(computeDiamondEntrance(0))).toBe(false);
    expect(marker.texture.version).toBe(before);
    expect(() => marker.dispose()).not.toThrow();
  });

  it('dispose releases the texture once, zeroes both canvases, and stops drawing', () => {
    const { marker, main } = create(colours);
    const canvas: HTMLCanvasElement = marker.texture.image;
    expect(canvas.width).toBe(256);
    const disposeSpy = vi.spyOn(marker.texture, 'dispose');
    marker.dispose();
    marker.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    // The backing stores go now, not at the next GC.
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(marker.apply(DIAMOND_ENTRANCE_SETTLED)).toBe(false);
    expect(main.drawImage).not.toHaveBeenCalled();
  });
});

describe('createDiamondMarkerTexture — validation', () => {
  it('rejects a missing or empty colour and a bad size at creation', () => {
    injectContexts(makeRecordingContext);
    expect(() =>
      createDiamondMarkerTexture({ ink: '', accent: '#f2971f' })
    ).toThrow(TypeError);
    expect(() =>
      createDiamondMarkerTexture({
        ink: '#fff',
        accent: undefined as unknown as string,
      })
    ).toThrow(TypeError);
    expect(() => createDiamondMarkerTexture({ ...colours, halo: ' ' })).toThrow(
      TypeError
    );
    expect(() => createDiamondMarkerTexture({ ...colours, size: 0 })).toThrow(
      RangeError
    );
    expect(() =>
      createDiamondMarkerTexture({ ...colours, size: 10.5 })
    ).toThrow(RangeError);
  });

  it("the geometry constants are the SVG asset's numbers", () => {
    // The webxr root's design-accent-copies guard compares these with the
    // asset; this pins the shape a reader expects here.
    expect(DIAMOND_GEOMETRY).toMatchObject({
      viewBoxSize: 72,
      viewBoxOrigin: -4,
      rectOffset: 10,
      rectSide: 44,
      rectRadius: 4,
      centre: 32,
      rotationDeg: 45,
      dotRadius: 4.5,
      outlineStrokeWidth: 2,
      dotStrokeWidth: 0.5,
      haloBlur: 2,
      haloOffsetY: 1,
    });
  });
});
