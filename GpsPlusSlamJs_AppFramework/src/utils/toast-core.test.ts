/**
 * @vitest-environment jsdom
 *
 * The shared toast surface.
 *
 * WHY THESE TESTS MATTER. This component's two non-obvious behaviours are both
 * about ANNOUNCEMENT, which nothing on screen reveals: a message that renders
 * perfectly can still be silent to a screen reader. Both were found by review
 * rather than by use, and both survived a first fix that looked right:
 *
 * - the text must be written in a LATER TASK than the insertion, because
 *   browsers flush accessibility updates once per task, so reordering two
 *   statements in the same task changes nothing observable;
 * - supersession must be handled by CANCELLING the pending write, not by
 *   guarding inside it — guards there can never fire, and a sidecar that
 *   described them as the mechanism was documenting something the code did not
 *   do.
 *
 * The 2D toast added in round two exists so errors have a channel visible while
 * the header is collapsed, which is what lets the auto-expand rule retire
 * (DEC-U10). If this component is silent, that retirement makes errors
 * invisible rather than merely quieter — so these are the tests standing under
 * that decision.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createToast, DEFAULT_TOAST_LINGER_MS } from './toast-core.js';

let root: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  vi.useRealTimers();
  root.remove();
});

const toastIn = (container: HTMLElement): HTMLElement | null =>
  container.querySelector('.toast');

describe('createToast', () => {
  it('attaches an EMPTY live region first and fills it in a later task', () => {
    // THE ANNOUNCEMENT CONTRACT. A live region inserted already carrying its
    // text is commonly not announced at all — the AT sees a region that
    // appeared populated rather than one whose content changed. Asserting the
    // intermediate empty state is the only way to pin the deferral; a test that
    // only checked the final text passes for the silent version too.
    const toast = createToast(root);

    toast.show('Nothing nearby');

    const element = toastIn(root);
    expect(element).not.toBeNull();
    expect(element?.getAttribute('role')).toBe('status');
    expect(element?.getAttribute('aria-live')).toBe('polite');
    expect(element?.textContent).toBe('');

    vi.advanceTimersByTime(0);
    expect(toastIn(root)?.textContent).toBe('Nothing nearby');
  });

  it('takes the message down after the linger', () => {
    const toast = createToast(root);
    toast.show('Saved');
    vi.advanceTimersByTime(0);
    expect(toastIn(root)).not.toBeNull();

    vi.advanceTimersByTime(DEFAULT_TOAST_LINGER_MS);
    expect(toastIn(root)).toBeNull();
  });

  it('replaces a standing message and restarts its clock', () => {
    const toast = createToast(root);
    toast.show('first');
    vi.advanceTimersByTime(0);

    vi.advanceTimersByTime(DEFAULT_TOAST_LINGER_MS - 100);
    toast.show('second');
    vi.advanceTimersByTime(0);
    expect(toastIn(root)?.textContent).toBe('second');

    // The first message's deadline has now passed; the second's has not.
    vi.advanceTimersByTime(200);
    expect(toastIn(root)?.textContent).toBe('second');
  });

  it('empties a standing message on replace, before the new text lands', () => {
    // The replace path must honour the same announcement contract as the first
    // show: the region's content CHANGES (old text -> empty -> new text) rather
    // than the new severity class painting over the old text for a task. Found
    // by review on PR #352 — `show()` set the class and re-appended while the
    // element still carried the previous message.
    const toast = createToast(root, { className: 'toast' });
    toast.show('old info');
    vi.advanceTimersByTime(0);
    expect(toastIn(root)?.textContent).toBe('old info');

    toast.show('new error', { className: 'toast toast-error' });
    const element = root.querySelector('.toast-error');
    expect(element).not.toBeNull();
    expect(element?.textContent).toBe('');

    vi.advanceTimersByTime(0);
    expect(element?.textContent).toBe('new error');
  });

  it('does not re-insert the live region when replacing a standing message', () => {
    // `append` on a node that is already a child is a spec-level
    // remove-then-insert, which tears the live region out of the accessibility
    // tree and re-inserts it populated — the state the deferred write exists to
    // avoid. Observable as reordering: a re-append would move the element past
    // the sentinel to the end of the container.
    const toast = createToast(root);
    toast.show('first');
    vi.advanceTimersByTime(0);

    const sentinel = document.createElement('span');
    root.append(sentinel);
    toast.show('second');

    expect(root.lastElementChild).toBe(sentinel);
  });

  it('never shows a superseded message, even for one task', () => {
    // The cancellation contract. Two `show` calls in the same task must not
    // produce a flash of the first text — which is what would happen if the
    // pending write were guarded rather than cancelled.
    const toast = createToast(root);
    toast.show('stale');
    toast.show('fresh');

    vi.advanceTimersByTime(0);
    expect(toastIn(root)?.textContent).toBe('fresh');
  });

  it('clear() removes the element and cancels a write already queued', () => {
    // Withdrawal must beat the deferred write. Without the cancellation a
    // cleared toast reappears one task later, populated.
    const toast = createToast(root);
    toast.show('about to be withdrawn');
    toast.clear();

    vi.advanceTimersByTime(0);
    expect(toastIn(root)).toBeNull();
  });

  it('is idempotent when cleared twice, and when cleared before anything shows', () => {
    const toast = createToast(root);
    expect(() => {
      toast.clear();
      toast.clear();
    }).not.toThrow();
  });

  it('reuses one element rather than leaking one per message', () => {
    // `#ar-root` is `position: fixed; inset: 0` and hidden only while `:empty`,
    // so a stray leftover child keeps a full-viewport click-eating layer over
    // the page. A per-message element would leave one behind on every show.
    const toast = createToast(root);
    for (const message of ['a', 'b', 'c']) {
      toast.show(message);
      vi.advanceTimersByTime(0);
    }

    expect(root.querySelectorAll('.toast')).toHaveLength(1);
  });

  it('honours a custom class and linger', () => {
    const toast = createToast(root, { className: 'ar-toast', lingerMs: 100 });
    toast.show('hi');
    vi.advanceTimersByTime(0);
    expect(root.querySelector('.ar-toast')?.textContent).toBe('hi');

    vi.advanceTimersByTime(100);
    expect(root.querySelector('.ar-toast')).toBeNull();
  });
  it('takes a per-message class and linger, overriding the defaults', () => {
    // WHY THIS EXISTS: the recorder styles by severity and gives errors a
    // longer linger. Without per-message overrides it would need one Toast per
    // severity, each with its own element and its own timer -- which is how the
    // second implementation this core replaced ended up with none of the ARIA.
    const toast = createToast(root, { className: 'toast', lingerMs: 5_000 });

    toast.show('bad', { className: 'toast toast-error', lingerMs: 100 });
    vi.advanceTimersByTime(0);
    expect(root.querySelector('.toast-error')?.textContent).toBe('bad');

    vi.advanceTimersByTime(100);
    expect(root.querySelector('.toast')).toBeNull();
  });

  it('falls back to the toast defaults on the NEXT message', () => {
    // The override is for one message only. A severity that stuck would make
    // every later message wear the last error's colour.
    const toast = createToast(root, { className: 'toast', lingerMs: 5_000 });

    toast.show('bad', { className: 'toast toast-error', lingerMs: 100 });
    vi.advanceTimersByTime(0);
    toast.show('fine');
    vi.advanceTimersByTime(0);

    const element = root.querySelector('.toast');
    expect(element?.className).toBe('toast');
    expect(element?.textContent).toBe('fine');
    vi.advanceTimersByTime(200);
    expect(root.querySelector('.toast')).not.toBeNull();
  });

  it('sets an id when asked, so CSS and tests can find it', () => {
    const toast = createToast(root, { id: 'toast-container' });
    toast.show('hi');
    vi.advanceTimersByTime(0);
    expect(document.getElementById('toast-container')?.textContent).toBe('hi');
  });
});
