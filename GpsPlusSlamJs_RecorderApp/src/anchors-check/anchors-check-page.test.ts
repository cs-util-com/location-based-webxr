// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  COPY_FAILED_ADVICE,
  COPY_LABELS,
  createAnchorsCheckPage,
} from './anchors-check-page';
import type { AnchorsCheckController } from './anchors-check-session';
import { createAnchorJumpTracker } from './anchor-jump-tracker';

/**
 * Wired against the REAL `ar-anchors-check.html` markup: the element ids are
 * the contract, and the page is used once, on a phone, where nobody can
 * re-run the suite.
 */
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const markup = readFileSync(resolve(appRoot, 'ar-anchors-check.html'), 'utf8');

beforeEach(() => {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(markup)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
});

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
};

function connect(copyText: ((t: string) => Promise<void>) | undefined) {
  const page = createAnchorsCheckPage({ document, copyText });
  let toggles = 0;
  const controller: AnchorsCheckController = {
    checkSupport: () => Promise.resolve(true),
    toggle: () => {
      toggles++;
      return Promise.resolve();
    },
    log: () => 'THE LOG',
  };
  const wired = page.connect(controller);
  return { page, wired, toggles: () => toggles };
}

describe('anchors check page', () => {
  // Why this matters: the overlay root is what WebXR shows over the camera;
  // anything outside it is invisible during the walk.
  it('puts the panel inside the dom-overlay root', () => {
    const { page } = connect(undefined);
    expect(page.overlayRoot.id).toBe('ac-overlay');
    expect(page.overlayRoot.contains(el('ac-copy'))).toBe(true);
    expect(page.overlayRoot.contains(el('ac-verdicts'))).toBe(true);
  });

  // Why this matters: a tap on a button must not also place an anchor.
  it('keeps taps on the panel from reaching the AR scene', () => {
    connect(undefined);
    const event = new Event('beforexrselect', { cancelable: true });
    el('ac-copy').dispatchEvent(new Event('noop'));
    el('ac-panel').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  // Why this matters: the async-UI rule for the start button: in progress
  // while the session starts, never pressable twice.
  it('labels and disables the start button per state', () => {
    const { page, toggles } = connect(undefined);
    const start = el<HTMLButtonElement>('ac-start');
    page.view.setStartState('starting');
    expect([start.textContent, start.disabled]).toEqual([
      'Starting AR...',
      true,
    ]);
    page.view.setStartState('running');
    expect([start.textContent, start.disabled]).toEqual(['Stop AR', false]);
    page.view.setStartState('unavailable');
    expect([start.textContent, start.disabled]).toEqual([
      'AR not available',
      true,
    ]);
    page.view.setStartState('idle');
    start.click();
    expect(toggles()).toBe(1);
  });

  it('shows errors in the error tone and clears it again', () => {
    const { page } = connect(undefined);
    page.view.status('bad', 'error');
    expect(el('ac-status').classList.contains('ac-status-error')).toBe(true);
    page.view.status('fine', 'info');
    expect(el('ac-status').textContent).toBe('fine');
    expect(el('ac-status').classList.contains('ac-status-error')).toBe(false);
  });

  // Why this matters: the walker stops at two jumps; the count and the
  // lines must be on screen.
  it('lists the events and counts the jumps', () => {
    const { page } = connect(undefined);
    const tracker = createAnchorJumpTracker();
    const events = [
      ...tracker.notePlaced(0, { position: [0, 0, 0], rotation: [0, 0, 0, 1] }),
    ];
    page.view.showEvents(events);
    expect(el('ac-counts').textContent).toBe('No jumps yet.');
    expect([...el('ac-verdicts').children].map((li) => li.textContent)).toEqual(
      ['Anchor and marker placed']
    );
  });

  // Why this matters: the async-UI rule, success path: busy at once, then
  // the confirmation, the button usable again, the controller's log copied.
  it('copies the log with an in-progress and a copied state', async () => {
    const copied: string[] = [];
    const { wired } = connect((t) => {
      copied.push(t);
      return Promise.resolve();
    });
    const button = el<HTMLButtonElement>('ac-copy');
    const done = wired.copy();
    expect([button.textContent, button.disabled]).toEqual([
      COPY_LABELS.busy,
      true,
    ]);
    expect(await done).toBe(true);
    expect([button.textContent, button.disabled]).toEqual([
      COPY_LABELS.done,
      false,
    ]);
    expect(copied).toEqual(['THE LOG']);
    expect(el<HTMLTextAreaElement>('ac-log').hidden).toBe(true);
  });

  // Why this matters: failure path: the label reverts, the user is told,
  // and the log is put where it can be copied by hand.
  it('reverts and shows the log by hand when the copy fails', async () => {
    const { wired } = connect(() => Promise.reject(new Error('denied')));
    expect(await wired.copy()).toBe(false);
    const button = el<HTMLButtonElement>('ac-copy');
    expect([button.textContent, button.disabled]).toEqual([
      COPY_LABELS.idle,
      false,
    ]);
    expect(el('ac-status').textContent).toBe(COPY_FAILED_ADVICE);
    const box = el<HTMLTextAreaElement>('ac-log');
    expect([box.hidden, box.value]).toEqual([false, 'THE LOG']);
  });

  it('takes the failure path when there is no clipboard at all', async () => {
    const { wired } = connect(undefined);
    expect(await wired.copy()).toBe(false);
    expect(el<HTMLTextAreaElement>('ac-log').hidden).toBe(false);
  });
});
