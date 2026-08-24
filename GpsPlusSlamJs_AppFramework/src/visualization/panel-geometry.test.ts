import { describe, expect, it } from 'vitest';

import { contains, type Rect } from './panel-geometry.js';

describe('contains', () => {
  const rect: Rect = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 }; // spans u∈[0.2,0.6], v∈[0.3,0.5]

  it('is true for a point inside the rect', () => {
    expect(contains(rect, 0.4, 0.4)).toBe(true);
  });

  it('is inclusive on all four edges', () => {
    expect(contains(rect, 0.2, 0.3)).toBe(true); // bottom-left corner
    expect(contains(rect, 0.6, 0.5)).toBe(true); // top-right corner
    expect(contains(rect, 0.2, 0.4)).toBe(true); // left edge
    expect(contains(rect, 0.6, 0.4)).toBe(true); // right edge
  });

  it('is false just outside each edge', () => {
    expect(contains(rect, 0.19, 0.4)).toBe(false); // left of
    expect(contains(rect, 0.61, 0.4)).toBe(false); // right of
    expect(contains(rect, 0.4, 0.29)).toBe(false); // below
    expect(contains(rect, 0.4, 0.51)).toBe(false); // above
  });
});
