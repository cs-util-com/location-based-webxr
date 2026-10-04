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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  guardSliderAgainstScroll,
  guardSlidersIn,
  SLIDER_GUARD_TUNING,
} from './slider-scroll-guard.js';
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

// The same gesture contract holds whether a page guards one slider or the
// whole document (owner report 2026-09-30: every demo page needs the fix, so
// the page-wide install is the one pages use).
const INSTALLS: ReadonlyArray<
  [string, (slider: HTMLInputElement) => () => void]
> = [
  ['one slider', (slider) => guardSliderAgainstScroll(slider)],
  ['the whole document', () => guardSlidersIn(document)],
];

describe.each(INSTALLS)('slider-scroll-guard on %s', (_name, install) => {
  let slider: HTMLInputElement;
  let onInput: ReturnType<typeof vi.fn<() => void>>;
  let dispose: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    slider = makeSlider();
    // Guard first, app listener second — the registration order consumers use,
    // and what lets the guard shield the listener.
    dispose = install(slider);
    onInput = vi.fn<() => void>();
    slider.addEventListener('input', onInput);
  });

  afterEach(() => {
    dispose();
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

  it('delivers a touch tap as exactly one input and one change', () => {
    // Why this test matters (review 2026-09-30, A3; measured in headless
    // Chromium the same day as `input:s change:s change:t`): Chromium fires
    // its own `change` on touchend, AFTER the guard committed the tap with
    // its own pair, so an app that saves or logs on `change` saw one tap as
    // two edits. Without the guard Chromium delivers one of each.
    const onChange = vi.fn<() => void>();
    slider.addEventListener('change', onChange);

    simulateNativeSliderGesture(slider, [{ x: 70, y: 300 }], {
      durationMs: 90,
      touchEvents: true,
    });

    expect(slider.value).toBe('70');
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('lets a later change through when the browser sent none after the tap', async () => {
    // Why this test matters: the guard drops the browser's trailing change
    // only while that tap's touch sequence is ending. An engine that sends no
    // such change must not leave the guard waiting to swallow the next real
    // one, e.g. an arrow-key edit a moment later.
    const onChange = vi.fn<() => void>();
    slider.addEventListener('change', onChange);
    slider.dispatchEvent(
      createPointerEvent('pointerdown', { x: 70, y: 300, timeStamp: 0 })
    );
    slider.dispatchEvent(new Event('touchstart', { bubbles: true }));
    applyNativeSliderValue(slider, 70);
    slider.dispatchEvent(
      createPointerEvent('pointerup', { x: 70, y: 300, timeStamp: 90 })
    );
    slider.dispatchEvent(new Event('touchend', { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 0));
    slider.value = '71';
    slider.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('passes the browser change after a horizontal drag', () => {
    // Why this test matters: the trailing `change` is dropped only after a
    // tap the guard replayed; after a drag it is the only `change` there is.
    const onChange = vi.fn<() => void>();
    slider.addEventListener('change', onChange);

    simulateNativeSliderGesture(
      slider,
      [
        { x: 40, y: 300 },
        { x: 55, y: 302 },
        { x: 80, y: 305 },
      ],
      { touchEvents: true }
    );

    expect(slider.value).toBe('80');
    expect(onChange).toHaveBeenCalledTimes(1);
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
    dispose();
    simulateNativeSliderGesture(slider, [
      { x: 30, y: 300 },
      { x: 31, y: 200 },
    ]);

    expect(slider.value).toBe('31');
    expect(onInput).toHaveBeenCalled();
  });

  it('keeps holding the value after the browser takes the swipe over, until the touch ends', () => {
    // Why this test matters: by Blink's source, it locks its OWN drag
    // direction on the first touchmove it sees, with no threshold; when that
    // lock says horizontal it keeps writing the value on every touchmove after
    // the browser started scrolling (pointercancel), until the finger lifts. A
    // guard that stopped at pointercancel would let those writes through. A
    // headless Chromium run (2026-09-30) did not reproduce such writes, so
    // this pins a defence, not a measured bug.
    simulateNativeSliderGesture(
      slider,
      [
        { x: 40, y: 300 },
        { x: 43, y: 299 },
        { x: 44, y: 280 },
      ],
      {
        end: 'cancel',
        touchEvents: true,
        afterCancel: [
          { x: 70, y: 200 },
          { x: 90, y: 120 },
        ],
      }
    );

    expect(slider.value).toBe('50');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('lets keyboard edits through again once the cancelled touch has ended', () => {
    // Why this test matters: the hold after pointercancel must end with the
    // touch sequence, or the slider would swallow the next arrow key.
    simulateNativeSliderGesture(slider, [{ x: 40, y: 300 }], {
      end: 'cancel',
      touchEvents: true,
    });
    slider.value = '51';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(slider.value).toBe('51');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('re-arms for a new finger while a cancelled touch is still ending', () => {
    // Why this test matters: if the touchend of a cancelled gesture were ever
    // lost, the hold must not freeze the slider for the next finger.
    simulateNativeSliderGesture(slider, [{ x: 40, y: 300 }], {
      end: 'cancel',
      touchEvents: true,
      omitTouchEnd: true,
    });

    simulateNativeSliderGesture(
      slider,
      [
        { x: 10, y: 300 },
        { x: 60, y: 301 },
      ],
      { pointerId: 2 }
    );

    expect(slider.value).toBe('60');
    expect(onInput).toHaveBeenCalled();
  });
});

describe('guardSlidersIn(document)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('guards a slider created after the install', () => {
    // Why this test matters: pages build sliders at runtime (the recorder's
    // HUD wheel, the OSM demo's compass control). One install per page is
    // only a generic fix if it covers those too.
    const dispose = guardSlidersIn(document);
    const late = makeSlider();
    const onInput = vi.fn<() => void>();
    late.addEventListener('input', onInput);

    simulateNativeSliderGesture(late, [
      { x: 40, y: 300 },
      { x: 42, y: 200 },
    ]);
    dispose();

    expect(late.value).toBe('50');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('shields a listener registered BEFORE the install', () => {
    // Why this test matters: the per-slider guard depended on being
    // registered before the page's own listener. The page-wide guard listens
    // in the capture phase, so the order in which a page wires things up can
    // no longer reopen the bug.
    const slider = makeSlider();
    const onInput = vi.fn<() => void>();
    slider.addEventListener('input', onInput);
    const dispose = guardSlidersIn(document);

    simulateNativeSliderGesture(slider, [
      { x: 40, y: 300 },
      { x: 41, y: 200 },
    ]);
    dispose();

    expect(slider.value).toBe('50');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('leaves other inputs alone', () => {
    // Why this test matters: the install is page-wide, so it must not touch a
    // text field's input events even while a touch is on it.
    const dispose = guardSlidersIn(document);
    const text = document.createElement('input');
    text.type = 'text';
    document.body.appendChild(text);
    const onInput = vi.fn<() => void>();
    text.addEventListener('input', onInput);

    text.dispatchEvent(createPointerEvent('pointerdown', { x: 1, y: 1 }));
    text.value = 'typed';
    text.dispatchEvent(new Event('input', { bubbles: true }));
    dispose();

    expect(text.value).toBe('typed');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('is installed once however often it is called, and removed by the last disposer', () => {
    // Why this test matters: two modules of one page may both install it. Two
    // live guards would each replay a tap, so the app would see it twice.
    const first = guardSlidersIn(document);
    const second = guardSlidersIn(document);
    const slider = makeSlider();
    const onInput = vi.fn<() => void>();
    slider.addEventListener('input', onInput);

    simulateNativeSliderGesture(slider, [{ x: 70, y: 300 }], {
      durationMs: 90,
    });
    expect(onInput).toHaveBeenCalledTimes(1);

    first();
    first(); // a disposer called twice must not release the other install
    simulateNativeSliderGesture(slider, [
      { x: 20, y: 300 },
      { x: 21, y: 200 },
    ]);
    expect(slider.value).toBe('70');

    second();
    simulateNativeSliderGesture(slider, [
      { x: 20, y: 300 },
      { x: 21, y: 200 },
    ]);
    expect(slider.value).toBe('21');
  });

  it('keeps the tuning of the first install: a later install on the same root only adds a reference', () => {
    // Why this test matters (review 2026-09-30): installs on one root are
    // shared, so a second caller passing a different `tuning` gets the first
    // caller's rule, silently. This pins that documented behaviour, so a
    // change to it is a decision rather than an accident.
    const first = guardSlidersIn(document);
    const second = guardSlidersIn(document, {
      ...SLIDER_GUARD_TUNING,
      intentPx: 1000,
    });
    const slider = makeSlider();
    // A 60 px sideways drag: horizontal under the default 12 px rule, still
    // undecided (so discarded) under the ignored 1000 px one.
    simulateNativeSliderGesture(slider, [
      { x: 20, y: 300 },
      { x: 50, y: 300 },
      { x: 80, y: 300 },
    ]);
    expect(slider.value).toBe('80');
    second();
    first();
  });

  it('is exported from the utils barrel beside its deprecated alias', async () => {
    // Why this test matters (review 2026-09-30): the barrel carried only the
    // deprecated per-slider alias, so a consumer of `/utils` could not reach
    // the page-wide install the migration note tells it to use.
    const barrel = await import('./index.js');
    expect(barrel.guardSlidersIn).toBe(guardSlidersIn);
    expect(barrel.guardSliderAgainstScroll).toBe(guardSliderAgainstScroll);
  });
});
