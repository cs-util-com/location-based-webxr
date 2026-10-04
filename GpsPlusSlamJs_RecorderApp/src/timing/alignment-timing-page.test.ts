// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { wireAlignmentTimingPage } from './alignment-timing-page';
import type { TimingStoreLike } from './alignment-timing-run';
import { validateLicenseKey } from 'gps-plus-slam-app-framework/core';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-app-framework/licensing';

// The library gates its action creators on an active license; the real page
// activates it by building the app store, which a fake store cannot do.
validateLicenseKey(COMMUNITY_LICENSE_KEY);

/**
 * The page is wired against the REAL `alignment-timing.html` markup, read from
 * disk, rather than a hand-built fixture. That is deliberate: the element ids
 * are the contract between the markup and this module, and a fixture would let
 * a renamed id pass every test and break the page on the device - the one
 * place nobody can re-run the suite.
 */
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const markup = readFileSync(resolve(appRoot, 'alignment-timing.html'), 'utf8');

function installMarkup(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(markup)?.[1] ?? '';
  // The module script tag is inert under jsdom; strip it so nothing tries to
  // resolve a TypeScript entry point.
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
}

const zero: RecordedAction = {
  type: 'gpsData/setZeroPos',
  payload: { latitude: 1, longitude: 2 },
};
function fixes(count: number): RecordedAction[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'gpsData/recordGpsEvent',
    payload: {
      rawGpsPoint: { latitude: 1, longitude: 2, timestamp: i * 1000 },
    },
  }));
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from alignment-timing.html`);
  return node as T;
}

/** Pretend a file was chosen: `input.files` is read-only in jsdom. */
function chooseFile(name = 'walk.zip'): void {
  const input = el<HTMLInputElement>('timing-file');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ name }],
  });
  input.dispatchEvent(new Event('change'));
}

interface Harness {
  readonly storeCount: () => number;
  readonly loadCalls: () => number;
}

function wire(
  overrides: {
    loadRecording?: () => Promise<readonly RecordedAction[]>;
    copyText?: (text: string) => Promise<void>;
  } = {}
): Harness {
  let stores = 0;
  let loads = 0;
  let clock = 0;
  wireAlignmentTimingPage({
    document,
    readFile: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    loadRecording:
      overrides.loadRecording ??
      (() => {
        loads++;
        return Promise.resolve([zero, ...fixes(6)]);
      }),
    createStore: (): TimingStoreLike => {
      stores++;
      return {
        dispatch: () => {
          clock += 1;
        },
      };
    },
    environment: {
      userAgent: 'FakeBrowser/1.0',
      hardwareConcurrency: 8,
      appVersion: '0.1.0',
      libraryVersion: '1.25.0',
      frameworkVersion: '2.0.0',
      buildCommit: 'abc1234',
    },
    now: () => clock,
    nowIso: () => '2026-09-15T18:42:00.000Z',
    ladder: [2, 4],
    yieldControl: () => Promise.resolve(),
    copyText: overrides.copyText,
  });
  return { storeCount: () => stores, loadCalls: () => loads };
}

/** Let every pending microtask (and the loop's own yields) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

describe('the alignment timing page', () => {
  beforeEach(() => {
    installMarkup();
  });

  // Why this test matters: the parameters and the device are what make the
  // figures readable later. Printing them only after a successful run would
  // mean a run that fails halfway leaves nothing behind, and the owner is
  // standing outside with one device.
  it('prints the parameters and the device before anything is run', () => {
    wire();
    expect(el('timing-device').textContent).toContain('FakeBrowser/1.0');
    expect(el('timing-device').textContent).toContain('8');
    expect(el('timing-parameters').textContent).toContain('2 / 4');
    expect(el('timing-parameters').textContent).toContain('1 warm-up');
  });

  // Why this test matters: the repeat count is a swept parameter, not a
  // constant, and the page is where the sweep happens.
  it('offers the repeat counts and defaults to the recommended one', () => {
    wire();
    const select = el<HTMLSelectElement>('timing-repeats');
    expect([...select.options].map((o) => o.value)).toEqual(['3', '5', '9']);
    expect(select.value).toBe('5');
  });

  it('refuses to run before a recording is chosen', () => {
    wire();
    expect(el<HTMLButtonElement>('timing-run').disabled).toBe(true);
    chooseFile();
    expect(el<HTMLButtonElement>('timing-run').disabled).toBe(false);
  });

  // Why this test matters: the run takes minutes on a phone. Without a
  // distinguishable in-progress state the owner cannot tell a slow run from a
  // hung one, and a second tap would start a second run over the first.
  it('moves the button into an in-progress state and back on success', async () => {
    wire();
    chooseFile();
    const button = el<HTMLButtonElement>('timing-run');
    button.click();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toMatch(/running/i);
    await settle();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Run timing');
    expect(el('timing-status').textContent).toMatch(/done/i);
  });

  // Why this test matters: this is the page's whole output. A run that
  // finishes without a table and a JSON blob has measured something nobody
  // can read.
  it('renders the table, the totals and the JSON after a run', async () => {
    const h = wire();
    chooseFile();
    el<HTMLButtonElement>('timing-run').click();
    await settle();
    const table = el('timing-table');
    expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(table.textContent).toContain('ms/fix (median)');
    expect(el('timing-totals').textContent).toContain('shipped defaults');
    const json: unknown = JSON.parse(el('timing-json').textContent ?? '');
    expect((json as { schema: string }).schema).toBe('alignment-timing/1');
    expect(
      (json as { recording: { fileName: string } }).recording.fileName
    ).toBe('walk.zip');
    // Four arms x (1 warm-up + 5 timed) passes, one fresh store each.
    expect(h.storeCount()).toBe(24);
  });

  // Why this test matters: the failure path is the one a phone actually takes
  // - a wrong file, a zip the loader rejects - and the rule is that the
  // in-progress state must revert and the error must reach the user.
  it('surfaces a load failure and restores the button', async () => {
    wire({ loadRecording: () => Promise.reject(new Error('not a recording')) });
    chooseFile();
    const button = el<HTMLButtonElement>('timing-run');
    button.click();
    expect(button.disabled).toBe(true);
    await settle();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Run timing');
    const status = el('timing-status');
    expect(status.textContent).toContain('not a recording');
    expect(status.className).toContain('timing-status-error');
  });

  // Why this test matters: a recording with no GPS fixes cannot be timed, and
  // the honest outcome is a refusal rather than a table of zeros.
  it('refuses a recording that carries no GPS fixes', async () => {
    wire({ loadRecording: () => Promise.resolve([zero]) });
    chooseFile();
    el<HTMLButtonElement>('timing-run').click();
    await settle();
    expect(el('timing-status').textContent).toMatch(/no gps fixes/i);
    expect(el('timing-status').className).toContain('timing-status-error');
    expect(el('timing-json').textContent).toBe('');
  });

  // Why this test matters: copying is the only way the figure leaves the
  // device, and a silent failure would look exactly like a successful copy.
  it('reports whether the copy worked', async () => {
    wire({ copyText: () => Promise.reject(new Error('denied')) });
    chooseFile();
    el<HTMLButtonElement>('timing-run').click();
    await settle();
    el<HTMLButtonElement>('timing-copy').click();
    await settle();
    expect(el('timing-status').textContent).toMatch(/copy failed/i);
  });

  it('confirms a successful copy', async () => {
    let copied = '';
    wire({
      copyText: (text) => {
        copied = text;
        return Promise.resolve();
      },
    });
    chooseFile();
    el<HTMLButtonElement>('timing-run').click();
    await settle();
    el<HTMLButtonElement>('timing-copy').click();
    await settle();
    expect(copied).toContain('alignment-timing/1');
    expect(el('timing-status').textContent).toMatch(/copied/i);
  });
});
