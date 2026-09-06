// Why this test matters: the design system forbids colour literals outside
// its tokens layer, and `check-tokens.mjs` enforces that for design.css. The
// accent nevertheless has to exist as a literal in places that cannot read a
// CSS custom property: the framework's WebGL HUD default (`indicatorColor`
// in wayfinding-hud.ts — a library that cannot assume any stylesheet) and
// the HUD demo's SVG sprite assets (an SVG file cannot use `var()`). Those
// are exactly the copies nobody looks at when the token is re-tuned, so
// this guard holds every one of them to `--accent` (and the SVG strokes to
// `--ink`) in the canonical design.css. Owner taste round 2026-09-04,
// DEC-T2 / DEC-T4 of the UI taste round plan.
//
// Since 2026-09-06 the same file guards two more copies that a stylesheet
// cannot reach: the framework's diamond ENTRANCE timeline and easing (TS
// constants mirroring the sheet's `--t-enter`, `--t-state`, `--ease-out` and
// the `.diamond` animation multipliers) and the canvas drawer's geometry
// (mirroring the SVG asset). Two edges: asset ↔ catalog, TS ↔ CSS/asset.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');

/** `#fff` and `#ffffff` are one colour; compare on the six-digit form. */
function normalizeHex(value) {
  const hex = value.trim().toLowerCase();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${value}`);
  const digits = m[1];
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits}`;
}

/** A token's value: a normalised hex colour, or (`px: true`) a px length as a bare number string. */
function token(css, name, px = false) {
  const m = new RegExp(`${name}:\\s*(${px ? '[0-9.]+' : '#[0-9a-fA-F]{3,6}'})${px ? 'px' : ''}\\s*;`).exec(css);
  if (!m) throw new Error(`design.css defines no ${px ? 'px' : 'hex'} ${name}`);
  return px ? m[1] : normalizeHex(m[1]);
}

describe('every literal copy of a design-system value equals its source', () => {
  const css = read('GpsPlusSlamJs_DesignSystem/design.css');
  const accent = token(css, '--accent');
  const ink = token(css, '--ink');

  it("the framework's default HUD tint is the accent", () => {
    const source = read(
      'GpsPlusSlamJs_AppFramework/src/visualization/wayfinding-hud.ts'
    );
    const m = /indicatorColor:\s*'(#[0-9a-fA-F]{3,6})'/.exec(source);
    expect(m, 'DEFAULT_WAYFINDING_HUD must carry a hex indicatorColor').not
      .toBeNull();
    expect(normalizeHex(m[1])).toBe(accent);
  });

  const SVGS = [
    'GpsPlusSlamJs_WayfindingHudDemo/src/assets/wayfinding-diamond.svg',
    'GpsPlusSlamJs_WayfindingHudDemo/src/assets/wayfinding-arrow.svg',
  ];

  it("the HUD demo's SVG sprites use only the accent, the ink, and the halo black", () => {
    for (const file of SVGS) {
      const svg = read(file);
      const literals = [
        ...svg.matchAll(/(?:stroke|fill|flood-color)="(#[0-9a-fA-F]{3,6})"/g),
      ].map(([, hex]) => normalizeHex(hex));
      expect(literals.length, `${file} carries no colour literals`).toBeGreaterThan(0);
      for (const hex of literals) {
        expect([accent, ink, '#000000'], `${file} uses ${hex}`).toContain(hex);
      }
    }
    // The dot is the accent, the strokes are the ink — not the other way round.
    expect(read(SVGS[0])).toMatch(new RegExp(`<circle[^>]*fill="${accent}"`));
  });

  it("the diamond sprite's geometry is the catalog's .diamond, attribute for attribute", () => {
    // The catalog holds the diamond inline three times; the sprite is the
    // fourth copy, in a file the catalog cannot include. Compare against the
    // first catalog instance so a re-proportioned marker moves the sprite too.
    const catalog = read('GpsPlusSlamJs_DesignSystem/index.html');
    const first = catalog.indexOf('class="diamond"');
    expect(first).toBeGreaterThan(-1);
    const block = catalog.slice(first, catalog.indexOf('</svg>', first));
    const attrs = (markup, tag) => {
      const m = new RegExp(`<${tag}\\b([^>]*)/?>`).exec(markup);
      if (!m) throw new Error(`no <${tag}> in ${markup.slice(0, 80)}`);
      return Object.fromEntries(
        [...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])
      );
    };
    const sprite = read(SVGS[0]);
    const rect = attrs(sprite, 'rect');
    const catalogRect = attrs(block, 'rect');
    for (const key of ['x', 'y', 'width', 'height', 'rx', 'transform']) {
      expect(rect[key], `rect ${key}`).toBe(catalogRect[key]);
    }
    const circle = attrs(sprite, 'circle');
    const catalogCircle = attrs(block, 'circle');
    for (const key of ['cx', 'cy', 'r']) {
      expect(circle[key], `circle ${key}`).toBe(catalogCircle[key]);
    }
    // Stroke weights are the system's line tokens: 2px strong, 0.5px hairline.
    expect(token(css, '--line-strong', true)).toBe(rect['stroke-width']);
    expect(token(css, '--line', true)).toBe(circle['stroke-width']);
  });

  it("the framework's entrance timeline and easing are the sheet's tokens, and its drawing geometry is the asset's", () => {
    // Why: the HUD's diamond entrance (2026-09-05 plan) mirrors the CSS
    // build-up in TypeScript constants a stylesheet cannot reach —
    // `DIAMOND_ENTRANCE` (800 = --t-enter × 2, 600 = --t-enter × 1.5,
    // 250 = --t-state, dash 180) and `EASE_OUT` (--ease-out's control
    // points) — and draws the asset's geometry from `DIAMOND_GEOMETRY`. Each
    // is a copy nobody re-reads when a token or the asset is re-tuned; the
    // asset ↔ catalog half is asserted above, this is the TS ↔ CSS/asset edge.
    const ms = (name) => {
      const m = new RegExp(`${name}:\\s*([0-9.]+)ms\\s*;`).exec(css);
      if (!m) throw new Error(`design.css defines no ms ${name}`);
      return Number(m[1]);
    };
    const tEnter = ms('--t-enter');
    const tState = ms('--t-state');
    const entrance = read(
      'GpsPlusSlamJs_AppFramework/src/visualization/diamond-entrance.ts'
    );
    const constant = (name) => {
      const m = new RegExp(`${name}:\\s*([0-9.]+),`).exec(entrance);
      if (!m) throw new Error(`diamond-entrance.ts defines no ${name}`);
      return Number(m[1]);
    };
    // The multipliers are READ from the sheet, not assumed: `calc(var(--t-enter)
    // * 2)` on the outline's animation, `* 1.5` on the dot's delay, and the
    // dot's duration is the bare `--t-state` token (M4 milestone review).
    const outlineMultiplier =
      /\.diamond rect,[\s\S]*?animation:\s*draw-line\s+calc\(var\(--t-enter\)\s*\*\s*([0-9.]+)\)/.exec(
        css
      );
    expect(outlineMultiplier, 'design.css animates the outline as a multiple of --t-enter').not.toBeNull();
    const dotDelayMultiplier =
      /\.diamond circle,[\s\S]*?animation-delay:\s*calc\(var\(--t-enter\)\s*\*\s*([0-9.]+)\)/.exec(
        css
      );
    expect(dotDelayMultiplier, 'design.css delays the dot as a multiple of --t-enter').not.toBeNull();
    expect(css).toMatch(/\.diamond circle,[\s\S]*?animation:\s*dot-pop\s+var\(--t-state\)/);
    const outlineFactor = Number(outlineMultiplier[1]);
    const dotDelayFactor = Number(dotDelayMultiplier[1]);
    expect(constant('outlineMs')).toBe(tEnter * outlineFactor);
    expect(constant('dotDelayMs')).toBe(tEnter * dotDelayFactor);
    expect(constant('dotMs')).toBe(tState);
    // The entrance is over when BOTH tracks are — the later of the outline
    // and the dot — not when the dot alone is (PR #422 review).
    expect(constant('totalMs')).toBe(
      Math.max(tEnter * outlineFactor, tEnter * dotDelayFactor + tState)
    );
    const dash = /\.diamond rect,\s*\.leader polyline \{\s*stroke-dasharray:\s*([0-9]+);/.exec(
      css
    );
    expect(dash, 'design.css sets the diamond dasharray').not.toBeNull();
    expect(constant('dashLength')).toBe(Number(dash[1]));

    const easeOut = /--ease-out:\s*cubic-bezier\(([^)]*)\)/.exec(css);
    expect(easeOut, 'design.css defines --ease-out').not.toBeNull();
    const controlPoints = easeOut[1].split(',').map((s) => Number(s.trim()));
    const easing = read(
      'GpsPlusSlamJs_AppFramework/src/utils/cubic-bezier-easing.ts'
    );
    const fromTs = /EASE_OUT[^=]*=\s*cubicBezierEasing\(([^)]*)\)/.exec(easing);
    expect(fromTs, 'EASE_OUT is built from literal control points').not.toBeNull();
    expect(fromTs[1].split(',').map((s) => Number(s.trim()))).toEqual(
      controlPoints
    );

    // The drawer's geometry is the asset's numbers, attribute for attribute.
    const sprite = read(SVGS[0]);
    const attr = (tag, name) => {
      const m = new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(sprite);
      if (!m) throw new Error(`${SVGS[0]}: no ${tag} ${name}`);
      return m[1];
    };
    const texture = read(
      'GpsPlusSlamJs_AppFramework/src/visualization/diamond-marker-texture.ts'
    );
    const geometry = (name) => {
      const m = new RegExp(`${name}:\\s*(-?[0-9.]+),`).exec(texture);
      if (!m) throw new Error(`diamond-marker-texture.ts defines no ${name}`);
      return Number(m[1]);
    };
    const viewBox = attr('svg', 'viewBox').split(/\s+/).map(Number);
    expect(geometry('viewBoxOrigin')).toBe(viewBox[0]);
    expect(geometry('viewBoxSize')).toBe(viewBox[2]);
    expect(geometry('rectOffset')).toBe(Number(attr('rect', 'x')));
    expect(geometry('rectSide')).toBe(Number(attr('rect', 'width')));
    expect(geometry('rectRadius')).toBe(Number(attr('rect', 'rx')));
    const rotate = /rotate\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)/.exec(
      attr('rect', 'transform')
    );
    expect(geometry('rotationDeg')).toBe(Number(rotate[1]));
    expect(geometry('centre')).toBe(Number(rotate[2]));
    expect(geometry('dotRadius')).toBe(Number(attr('circle', 'r')));
    expect(geometry('outlineStrokeWidth')).toBe(
      Number(attr('rect', 'stroke-width'))
    );
    expect(geometry('dotStrokeWidth')).toBe(
      Number(attr('circle', 'stroke-width'))
    );
    expect(geometry('haloOffsetY')).toBe(Number(attr('feDropShadow', 'dy')));
    // The canvas's shadowBlur is 2σ, the SVG's stdDeviation is σ.
    expect(geometry('haloBlur')).toBe(
      2 * Number(attr('feDropShadow', 'stdDeviation'))
    );
  });

  it('sanity: the tokens are the colours the brief names', () => {
    // If these move, every consumer above moves with them — that is the point
    // — but a typo in the regexes would pass vacuously, so pin the values too.
    expect(accent).toBe('#f2971f');
    expect(ink).toBe('#ffffff');
  });
});
