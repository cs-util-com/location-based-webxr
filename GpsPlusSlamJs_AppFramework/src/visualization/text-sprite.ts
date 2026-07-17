/**
 * Shared CanvasTexture→SpriteMaterial→Sprite text-label helper.
 *
 * Single implementation behind the two in-scene text consumers:
 * - gps-compass-cubes: static one-shot glyph labels (defaults),
 * - wayfinding-hud: dynamic distance labels redrawn per change
 *   (pill background, linear filters, explicit renderOrder).
 *
 * Text always renders with a change-detection guard: setText() with the
 * current text is a no-op, so per-frame callers never pay a canvas redraw
 * or a GPU texture upload for unchanged labels.
 */

import * as THREE from 'three';

export interface TextSpriteOptions {
  /** Initial label text. Defaults to ''. */
  text?: string;
  /** Canvas backing-store width in px. Defaults to 64. */
  canvasWidth?: number;
  /** Canvas backing-store height in px. Defaults to 64. */
  canvasHeight?: number;
  /** CSS font shorthand used for the label. Defaults to 'bold 48px sans-serif'. */
  font?: string;
  /** Fill style for the text. Defaults to '#ffffff'. */
  textColor?: string;
  /**
   * Background painted behind the text on every redraw.
   * 'none' keeps the canvas transparent; 'pill' draws a rounded
   * semi-transparent black capsule for contrast against AR video.
   */
  background?: 'none' | 'pill';
  /** SpriteMaterial.depthWrite. Defaults to the three.js material default. */
  depthWrite?: boolean;
  /** SpriteMaterial.transparent. Defaults to the three.js material default. */
  transparent?: boolean;
  /** Use LinearFilter for min/mag (crisper animated text). Defaults to false. */
  linearFilters?: boolean;
  /** Sprite.renderOrder. Defaults to 0. */
  renderOrder?: number;
  /** Initial sprite scale. Defaults to the three.js sprite default (1,1,1). */
  scale?: { x: number; y: number; z: number };
}

export interface TextSprite {
  /** The renderable sprite — attach it to the scene graph yourself. */
  readonly sprite: THREE.Sprite;
  /** Redraw the label. No-op (no redraw, no texture upload) when unchanged. */
  setText(text: string): void;
  /** Dispose the sprite material and its canvas texture. */
  dispose(): void;
}

/** Options with every defaultable field resolved; the three "absent means
 * engine default" fields (depthWrite, transparent, scale) stay optional. */
type ResolvedTextSpriteOptions = Required<
  Omit<TextSpriteOptions, 'depthWrite' | 'transparent' | 'scale'>
> &
  Pick<TextSpriteOptions, 'depthWrite' | 'transparent' | 'scale'>;

const DEFAULT_TEXT_SPRITE_OPTIONS: Required<
  Omit<TextSpriteOptions, 'depthWrite' | 'transparent' | 'scale'>
> = {
  text: '',
  canvasWidth: 64,
  canvasHeight: 64,
  font: 'bold 48px sans-serif',
  textColor: '#ffffff',
  background: 'none',
  linearFilters: false,
  renderOrder: 0,
};

/** Inner padding and corner radius of the 'pill' background, in canvas px. */
const PILL_PADDING_PX = 10;
const PILL_RADIUS_PX = 30;

/**
 * Paint the optional pill background. roundRect is a relatively recent
 * 2D-context API — fall back to a square-cornered rect on engines that
 * lack it rather than crashing.
 */
function drawPill(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number
): void {
  const w = canvasWidth - 2 * PILL_PADDING_PX;
  const h = canvasHeight - 2 * PILL_PADDING_PX;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(PILL_PADDING_PX, PILL_PADDING_PX, w, h, PILL_RADIUS_PX);
  } else {
    ctx.rect(PILL_PADDING_PX, PILL_PADDING_PX, w, h);
  }
  ctx.fill();
}

/** Clear the canvas and draw the label text (plus optional background). */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  opts: ResolvedTextSpriteOptions,
  text: string
): void {
  const { canvasWidth, canvasHeight } = opts;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  if (opts.background === 'pill') {
    drawPill(ctx, canvasWidth, canvasHeight);
  }
  ctx.font = opts.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.textColor;
  ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);
}

function buildMaterial(
  texture: THREE.CanvasTexture,
  opts: ResolvedTextSpriteOptions
): THREE.SpriteMaterial {
  const params: THREE.SpriteMaterialParameters = {
    map: texture,
    depthTest: false,
  };
  if (opts.depthWrite !== undefined) params.depthWrite = opts.depthWrite;
  if (opts.transparent !== undefined) params.transparent = opts.transparent;
  return new THREE.SpriteMaterial(params);
}

/**
 * Create a text sprite backed by an off-screen canvas texture.
 *
 * Tolerates a null 2D context (headless test environments without a canvas
 * backend): the sprite is still created and setText()/dispose() stay safe;
 * only the pixels are skipped.
 */
export function createTextSprite(options: TextSpriteOptions = {}): TextSprite {
  const opts: ResolvedTextSpriteOptions = {
    ...DEFAULT_TEXT_SPRITE_OPTIONS,
    ...options,
  };

  const canvas = document.createElement('canvas');
  canvas.width = opts.canvasWidth;
  canvas.height = opts.canvasHeight;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  if (opts.linearFilters) {
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }

  const sprite = new THREE.Sprite(buildMaterial(texture, opts));
  sprite.renderOrder = opts.renderOrder;
  if (opts.scale) {
    sprite.scale.set(opts.scale.x, opts.scale.y, opts.scale.z);
  }

  let currentText: string | null = null;

  function setText(newText: string): void {
    if (newText === currentText) return;
    currentText = newText;
    if (!ctx) return;
    drawLabel(ctx, opts, newText);
    texture.needsUpdate = true;
  }

  setText(opts.text);

  return {
    sprite,
    setText,
    dispose(): void {
      sprite.material.dispose();
      texture.dispose();
    },
  };
}
