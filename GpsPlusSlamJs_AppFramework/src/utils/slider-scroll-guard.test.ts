/**
 * Tests for slider-scroll-guard.ts
 *
 * Why these tests matter:
 * Field feedback (2026-07-27): scrolling the recorder settings panel on a phone
 * kept changing slider values, because a native range input claims the touch
 * and jumps its thumb to the finger the moment the gesture starts. These tests
 * pin the gesture contract that fixes it — only an explicit horizontal drag or
 * a short deliberate tap may change a value, and a vertical swipe must leave
 * both the value and any downstream `input` listener untouched. The "detaches
 * cleanly" case doubles as the bug reproduction: without the guard the same
 * swipe edits the value.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { guardSliderAgainstScroll } from './slider-scroll-guard.js';
import {
  applyNativeSliderValue,
  createPointerEvent,
  simulateNativeSliderGesture,
} from '../test-utils/pointer-gestures.js';

function makeSlider(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.value = '50';
  document.body.appendChild(input);
  return input;
}

describe('slider-scroll-guard', () => {
  let slider: HTMLInputElement;
  let onInput: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    document.body.innerHTML = '';
    slider = makeSlider();
    // Guard first, app listener second — the registration order consumers use,
    // and what lets the guard shield the listener.
    guardSliderAgainstScroll(slider);
    onInput = vi.fn<() => void>();
    slider.addEventListener('input', onInput);
  });

  it('keeps the value untouched during a vertical scroll swipe', () => {
    // Why this test matters: this IS the reported bug — swiping down over a
    // slider must scroll the panel, never edit the setting.
    simulateNativeSliderGesture(slider, [
      { x: 40, y: 300 },
      { x: 42, y: 260 },
      { x: 41, y: 190 },
      { x: 43, y: 120 },
    ]);

    expect(slider.value).toBe('50');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('stays locked when a downward swipe later drifts sideways', () => {
    // Why this test matters: a long scroll is never perfectly straight. Once
    // the gesture is a scroll it must stay a scroll, otherwise the value jumps
    // mid-swipe — which is how the bug felt in the field.
    simulateNativeSliderGesture(slider, [
      { x: 40, y: 300 },
      { x: 41, y: 240 },
      { x: 90, y: 230 },
      { x: 95, y: 220 },
    ]);

    expect(slider.value).toBe('50');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('lets an explicit horizontal drag through', () => {
    // Why this test matters: the guard must not break the actual purpose of
    // the control — dragging sideways still edits the value.
    simulateNativeSliderGesture(slider, [
      { x: 40, y: 300 },
      { x: 55, y: 302 },
      { x: 80, y: 305 },
    ]);

    expect(slider.value).toBe('80');
    expect(onInput).toHaveBeenCalled();
  });

  it('commits a short tap on release', () => {
    // Why this test matters: a quick poke at a spot on the track is a
    // deliberate "set it here" (owner decision 2026-07-28) — it is committed
    // once the release proves the finger neither travelled nor lingered, i.e.
    // that it was never the beginning of a scroll.
    simulateNativeSliderGesture(slider, [{ x: 70, y: 300 }], {
      durationMs: 90,
    });

    expect(slider.value).toBe('70');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('discards a slow press that never moved', () => {
    // Why this test matters: the counterpart to the tap — a finger resting on
    // a slider is how a scroll starts, so a long press must not be read as an
    // edit even though it travelled no distance.
    simulateNativeSliderGesture(slider, [{ x: 70, y: 300 }], {
      durationMs: 900,
    });

    expect(slider.value).toBe('50');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('does not commit a tap while the gesture is still in flight', () => {
    // Why this test matters: the pointer-down write must stay invisible until
    // release decides what the gesture was — committing early is exactly the
    // reported bug.
    slider.dispatchEvent(
      createPointerEvent('pointerdown', { x: 70, y: 300, timeStamp: 0 })
    );
    applyNativeSliderValue(slider, 70);

    expect(slider.value).toBe('50');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('never commits when the browser cancels the gesture for scrolling', () => {
    // Why this test matters: with `touch-action: pan-y` the browser takes the
    // gesture over and fires pointercancel — even a fast one is a scroll, not
    // a tap, so the value must be restored.
    simulateNativeSliderGesture(slider, [{ x: 20, y: 300 }], {
      end: 'cancel',
      durationMs: 80,
    });

    expect(slider.value).toBe('50');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('leaves mouse interaction alone (click-to-set keeps working)', () => {
    // Why this test matters: the guard targets touch scrolling. On desktop
    // there is no scroll gesture to confuse, and clicking the track to set a
    // value is expected behaviour — including a slow, deliberate click.
    simulateNativeSliderGesture(slider, [{ x: 70, y: 300 }], {
      pointerType: 'mouse',
      durationMs: 2000,
    });

    expect(slider.value).toBe('70');
    expect(onInput).toHaveBeenCalled();
  });

  it('passes through input events that belong to no gesture', () => {
    // Why this test matters: keyboard edits and programmatic value changes
    // dispatch `input` with no pointer gesture in flight — those must never be
    // suppressed.
    slider.value = '77';
    slider.dispatchEvent(new Event('input'));

    expect(slider.value).toBe('77');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('ignores pointers other than the one that started the gesture', () => {
    // Why this test matters: a second finger landing during a scroll must not
    // be able to decide the intent of the first one.
    slider.dispatchEvent(
      createPointerEvent('pointerdown', { x: 40, y: 300, timeStamp: 0 })
    );
    applyNativeSliderValue(slider, 40);
    slider.dispatchEvent(
      createPointerEvent('pointermove', {
        x: 200,
        y: 300,
        pointerId: 2,
        timeStamp: 50,
      })
    );
    applyNativeSliderValue(slider, 200);
    slider.dispatchEvent(
      createPointerEvent('pointerup', { x: 40, y: 300, timeStamp: 900 })
    );

    expect(slider.value).toBe('50');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('re-arms when a gesture never ended (lost pointerup)', () => {
    // Why this test matters: if an end event is ever missed, a guard that
    // refuses to re-arm would freeze the slider for the rest of the session —
    // a much worse failure than the bug it fixes.
    slider.dispatchEvent(
      createPointerEvent('pointerdown', { x: 40, y: 300, timeStamp: 0 })
    );
    applyNativeSliderValue(slider, 40);
    // …no pointerup/pointercancel arrives…

    simulateNativeSliderGesture(slider, [
      { x: 10, y: 300 },
      { x: 60, y: 301 },
    ]);

    expect(slider.value).toBe('60');
    expect(onInput).toHaveBeenCalled();
  });

  it('detaches cleanly, restoring unguarded behaviour', () => {
    // Why this test matters: it is both the disposer contract and the bug
    // reproduction — unguarded, the exact same vertical swipe rewrites the
    // value (30 → 31) instead of leaving it at 50.
    const other = makeSlider();
    const dispose = guardSliderAgainstScroll(other);
    const otherInput = vi.fn<() => void>();
    other.addEventListener('input', otherInput);

    dispose();
    simulateNativeSliderGesture(other, [
      { x: 30, y: 300 },
      { x: 31, y: 200 },
    ]);

    expect(other.value).toBe('31');
    expect(otherInput).toHaveBeenCalled();
  });
});
