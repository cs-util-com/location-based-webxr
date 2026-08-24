import { describe, expect, it } from 'vitest';

import { DEFAULT_PANEL_LAYOUT, hitToAction } from './panel-layout.js';
import type { PanelTapAction } from './panel-layout.js';

/** Narrow an action to a seek and return its fraction (fails the test if not). */
function seekFraction(action: PanelTapAction | null): number {
  expect(action).not.toBeNull();
  expect(action?.type).toBe('seek');
  return (action as { type: 'seek'; fraction: number }).fraction;
}

/**
 * Why these tests matter: this is the pure heart of making the in-world panel
 * interactive without a renderer. The view layer raycasts the panel plane and
 * gets a UV; this function turns that UV into a ready-to-dispatch transport
 * action (toggle play/stop, or seek to a fraction) using the same layout the
 * panel is *drawn* from. Pinning the button/track regions and the seek-fraction
 * maths here means the AR interaction (component 8) is correct by construction
 * — only the ray that produces the UV changes between desktop pointer and XR
 * select.
 */

const { button, track } = DEFAULT_PANEL_LAYOUT;
const center = (r: { x: number; y: number; w: number; h: number }) => ({
  u: r.x + r.w / 2,
  v: r.y + r.h / 2,
});

describe('hitToAction', () => {
  it('returns a toggle when the button region is hit', () => {
    expect(hitToAction(center(button))).toEqual({ type: 'toggle' });
  });

  it('returns a seek at the fraction along the track', () => {
    expect(seekFraction(hitToAction(center(track)))).toBeCloseTo(0.5, 6);
  });

  it("maps the track's left edge to fraction 0 and right edge to fraction 1", () => {
    const v = track.y + track.h / 2;
    expect(seekFraction(hitToAction({ u: track.x, v }))).toBeCloseTo(0, 6);
    expect(seekFraction(hitToAction({ u: track.x + track.w, v }))).toBeCloseTo(
      1,
      6
    );
  });

  it('returns null when neither region is hit', () => {
    // A point above the track and outside the button (panel chrome / padding).
    expect(hitToAction({ u: 0.99, v: 0.99 })).toBeNull();
  });

  it('does not treat a track-row hit left of the track as a seek', () => {
    // Same vertical band as the track but left of its start and outside the
    // button → no action (avoids a phantom seek in the gap).
    const v = track.y + track.h / 2;
    const gapU = (button.x + button.w + track.x) / 2;
    expect(hitToAction({ u: gapU, v })).toBeNull();
  });

  it('button takes priority if regions were to overlap', () => {
    // DEFAULT layout keeps them disjoint; assert the default really is disjoint
    // so the button-first ordering is unambiguous.
    const buttonRight = button.x + button.w;
    expect(buttonRight).toBeLessThanOrEqual(track.x);
  });
});
