/**
 * Unit tests for the shared text-sprite helper.
 *
 * Why these tests matter:
 * text-sprite is the single CanvasTexture→SpriteMaterial→Sprite implementation
 * shared by gps-compass-cubes (static glyph labels) and the wayfinding HUD
 * (dynamic distance labels). Its two consumers depend on different halves of
 * the API: the compass on the default static-glyph configuration, the HUD on
 * change-detection redraw (skip identical text to avoid GPU texture uploads
 * at 60–90 Hz) and on explicit dispose(). Both halves are pinned here.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';

import { createTextSprite, type TextSprite } from './text-sprite.js';

/**
 * A minimal recording stub of CanvasRenderingContext2D — jsdom has no real
 * canvas backend (getContext returns null), so drawing-path assertions need
 * an injected context that records calls.
 */
function makeRecordingContext(overrides: Record<string, unknown> = {}) {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    ...overrides,
  };
}

/** Patch document.createElement so canvas elements expose the given context. */
function injectContext(ctx: ReturnType<typeof makeRecordingContext> | null) {
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (tagName: string): HTMLElement => {
      const el = original(tagName);
      if (tagName === 'canvas') {
        (el as HTMLCanvasElement).getContext = vi.fn(
          () => ctx
        ) as unknown as HTMLCanvasElement['getContext'];
      }
      return el;
    }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createTextSprite — construction', () => {
  it('returns a THREE.Sprite backed by a CanvasTexture', () => {
    const label: TextSprite = createTextSprite({ text: 'N' });
    expect(label.sprite).toBeInstanceOf(THREE.Sprite);
    expect(label.sprite.material.map).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('defaults to a 64×64 canvas with depthTest disabled (compass glyph configuration)', () => {
    const label = createTextSprite({ text: 'N' });
    const canvas = label.sprite.material.map!.image as HTMLCanvasElement;
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(64);
    expect(label.sprite.material.depthTest).toBe(false);
    // Compass parity: default material leaves depthWrite/transparent at
    // three.js SpriteMaterial defaults, and renderOrder unset (0).
    expect(label.sprite.renderOrder).toBe(0);
  });

  it('applies canvas size, material flags, renderOrder, scale, and linear filters when configured (HUD label configuration)', () => {
    const label = createTextSprite({
      text: '12.3 m',
      canvasWidth: 256,
      canvasHeight: 128,
      background: 'pill',
      depthWrite: false,
      transparent: true,
      linearFilters: true,
      renderOrder: 1000,
      scale: { x: 0.16, y: 0.08, z: 1 },
    });
    const material = label.sprite.material;
    const canvas = material.map!.image as HTMLCanvasElement;
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(128);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.map!.minFilter).toBe(THREE.LinearFilter);
    expect(material.map!.magFilter).toBe(THREE.LinearFilter);
    expect(label.sprite.renderOrder).toBe(1000);
    expect(label.sprite.scale.x).toBeCloseTo(0.16, 6);
    expect(label.sprite.scale.y).toBeCloseTo(0.08, 6);
    expect(label.sprite.scale.z).toBeCloseTo(1, 6);
  });

  it('draws the initial text centered on the canvas', () => {
    const ctx = makeRecordingContext();
    injectContext(ctx);
    createTextSprite({ text: 'E', canvasWidth: 64, canvasHeight: 64 });
    expect(ctx.fillText).toHaveBeenCalledWith('E', 32, 32);
  });

  it('survives a null 2D context (jsdom / headless environments) without throwing', () => {
    injectContext(null);
    expect(() => {
      const label = createTextSprite({ text: 'S' });
      label.setText('W');
      label.dispose();
    }).not.toThrow();
  });
});

describe('createTextSprite — setText change detection', () => {
  // Why this matters: the HUD calls setText every frame with the current
  // distance. Redrawing + re-uploading the texture on identical text would
  // waste GPU bandwidth at frame rate; the texture version must only bump
  // when the text actually changed.
  it('redraws and bumps the texture version only when the text changes', () => {
    const ctx = makeRecordingContext();
    injectContext(ctx);
    const label = createTextSprite({ text: '1.0 m' });
    const texture = label.sprite.material.map!;
    const versionAfterInit = texture.version;
    const drawsAfterInit = ctx.fillText.mock.calls.length;

    label.setText('1.0 m'); // identical — no redraw, no upload
    expect(ctx.fillText.mock.calls.length).toBe(drawsAfterInit);
    expect(texture.version).toBe(versionAfterInit);

    label.setText('2.0 m'); // changed — one redraw, one upload
    expect(ctx.fillText.mock.calls.length).toBe(drawsAfterInit + 1);
    expect(texture.version).toBe(versionAfterInit + 1);
    expect(ctx.fillText).toHaveBeenLastCalledWith('2.0 m', 32, 32);
  });

  it('clears the previous frame before redrawing', () => {
    const ctx = makeRecordingContext();
    injectContext(ctx);
    const label = createTextSprite({ text: 'a' });
    ctx.clearRect.mockClear();
    label.setText('b');
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 64, 64);
  });
});

describe('createTextSprite — pill background', () => {
  it('draws a rounded pill behind the text', () => {
    const ctx = makeRecordingContext();
    injectContext(ctx);
    createTextSprite({
      text: '5.0 m',
      canvasWidth: 256,
      canvasHeight: 128,
      background: 'pill',
    });
    expect(ctx.roundRect).toHaveBeenCalledWith(10, 10, 236, 108, 30);
    expect(ctx.fill).toHaveBeenCalled();
  });

  // Why this matters: ctx.roundRect is a relatively recent 2D-context API;
  // the helper must not crash on engines that lack it (defensive boundary).
  it('falls back to a plain rect when roundRect is unavailable', () => {
    const ctx = makeRecordingContext({ roundRect: undefined });
    injectContext(ctx);
    expect(() =>
      createTextSprite({ text: '5.0 m', background: 'pill' })
    ).not.toThrow();
    expect(ctx.rect).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });
});

describe('createTextSprite — dispose', () => {
  it('disposes the sprite material and its canvas texture', () => {
    const label = createTextSprite({ text: 'N' });
    const material = label.sprite.material;
    const texture = material.map!;
    const materialSpy = vi.spyOn(material, 'dispose');
    const textureSpy = vi.spyOn(texture, 'dispose');

    label.dispose();

    expect(materialSpy).toHaveBeenCalledOnce();
    expect(textureSpy).toHaveBeenCalledOnce();
  });
});
