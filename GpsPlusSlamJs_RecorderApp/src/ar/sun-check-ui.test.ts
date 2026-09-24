// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SunCheck } from 'gps-plus-slam-app-framework/ar/sun-check';

import {
  createSunCheckUi,
  describeSunMark,
  describeSunStatus,
  type SunCheckUiDeps,
} from './sun-check-ui';
import type { SunSighting } from './sun-sighting-note';

type MarkResult = Awaited<ReturnType<SunCheck['mark']>>;
type Status = ReturnType<SunCheck['status']>;

const sighting = (h: number, v: number, el = 12): SunSighting =>
  ({
    schema: 1,
    mode: 'reticle',
    atMs: 1_700_000_000_000,
    headingErrDeg: h,
    elevationErrDeg: v,
    sunElApparentDeg: el,
  }) as unknown as SunSighting;

/** A stub check whose Mark resolves when the test says so. */
function stubCheck(
  status: Status = { visible: true, sunAzDeg: 265.24, sunElDeg: 12.06 }
) {
  let resolveMark: ((r: MarkResult) => void) | null = null;
  const check = {
    marker: {} as SunCheck['marker'],
    status: vi.fn(() => status),
    mark: vi.fn(
      () =>
        new Promise<MarkResult>((resolve) => {
          resolveMark = resolve;
        })
    ),
    dispose: vi.fn(),
  };
  return {
    check: check as unknown as SunCheck & typeof check,
    settle: (r: MarkResult) => resolveMark?.(r),
    setStatus: (s: Status) => {
      status = s;
    },
  };
}

function setup(overrides: Partial<SunCheckUiDeps> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const stub = stubCheck();
  const ticks: Array<() => void> = [];
  const deps = {
    root,
    startCheck: vi.fn(() => stub.check),
    confirmSafety: vi.fn(() => Promise.resolve(true)),
    showToast: vi.fn(),
    recordSighting: vi.fn(() => 'recorded' as const),
    every: vi.fn((_ms: number, f: () => void) => {
      ticks.push(f);
      return () => {
        ticks.splice(ticks.indexOf(f), 1);
      };
    }),
    ...overrides,
  };
  const ui = createSunCheckUi(deps);
  const tick = () => {
    for (const f of [...ticks]) f();
  };
  const q = (id: string) => root.querySelector<HTMLElement>(`#${id}`);
  return { ui, deps, stub, root, tick, q };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('describeSunMark', () => {
  // WHY (owner default Q13): the toast says where the CONTENT is, not the
  // maths sign. h > 0 = the app's azimuths too large = the virtual sun, and
  // every piece of content with it, sits LEFT of true (sun-check-geometry).
  it('says where the content sits, left for a positive heading error', () => {
    const left = describeSunMark(
      { ok: true, sighting: sighting(1.84, -0.21), warnings: [] },
      'recorded'
    );
    expect(left.message).toBe(
      'Content 1.8° left of true · 0.2° high · sun el 12° · recorded'
    );
    expect(left.severity).toBe('info');
    const right = describeSunMark(
      { ok: true, sighting: sighting(-0.66, 0.34), warnings: [] },
      'not-recording'
    );
    expect(right.message).toBe(
      'Content 0.7° right of true · 0.3° low · sun el 12° · not recorded (no recording running)'
    );
  });

  it('calls a sub-0.05° error on true instead of inventing a side', () => {
    const r = describeSunMark(
      { ok: true, sighting: sighting(0.04, -0.01), warnings: [] },
      'recorded'
    );
    expect(r.message).toBe(
      'Content on true heading · level · sun el 12° · recorded'
    );
  });

  // WHY: a warning keeps the measurement but must not read like a clean one.
  it('appends warnings and raises the severity', () => {
    const r = describeSunMark(
      {
        ok: true,
        sighting: sighting(1, 0, 58),
        warnings: ['high-sun', 'target-changed', 'alignment-moving'],
      },
      'recorded'
    );
    expect(r.message).toContain('sun high (58°): heading less precise');
    expect(r.message).toContain('the alignment changed during the Mark');
    expect(r.message).toContain('the alignment was moving');
    expect(r.severity).toBe('warning');
  });

  it('names every refusal, with the spread for a moved Mark', () => {
    expect(
      describeSunMark(
        { ok: false, reason: 'moved', spreadDeg: 0.62, frames: 30 },
        'recorded'
      )
    ).toEqual({
      message: 'Moved 0.6° during the Mark - hold still and try again',
      severity: 'warning',
    });
    const reasons = [
      'no-position',
      'no-alignment',
      'not-tracking',
      'sun-down',
      'busy',
      'no-frames',
      'disposed',
    ] as const;
    const messages = reasons.map(
      (reason) => describeSunMark({ ok: false, reason }, 'recorded').message
    );
    expect(new Set(messages).size).toBe(reasons.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(8);
  });
});

describe('describeSunStatus', () => {
  it('shows the sun and the instruction when visible, the reason when hidden', () => {
    expect(
      describeSunStatus({ visible: true, sunAzDeg: 265.24, sunElDeg: 12.06 })
    ).toBe(
      'Sun az 265.2° el 12.1° (apparent) · centre the cross on the sun ON THE SCREEN, then Mark'
    );
    expect(
      describeSunStatus({ visible: false, hiddenBecause: 'no-alignment' })
    ).toBe('Sun check: waiting for the alignment');
    expect(
      describeSunStatus({ visible: false, hiddenBecause: 'sun-down' })
    ).toBe('Sun check: the sun is below the horizon');
  });
});

describe('createSunCheckUi', () => {
  // WHY (owner default Q11): the check draws attention toward the sun, so the
  // first enable per page shows the safety note, and declining it keeps the
  // check off.
  it('asks for the safety note once per page; declining keeps it off', async () => {
    const declined = setup({
      confirmSafety: vi.fn(() => Promise.resolve(false)),
    });
    expect(await declined.ui.setEnabled(true)).toBe(false);
    expect(declined.ui.isEnabled()).toBe(false);
    declined.ui.attach();
    expect(declined.deps.startCheck).not.toHaveBeenCalled();

    const { ui, deps } = setup();
    expect(await ui.setEnabled(true)).toBe(true);
    await ui.setEnabled(false);
    expect(await ui.setEnabled(true)).toBe(true);
    expect(deps.confirmSafety).toHaveBeenCalledTimes(1);
  });

  // WHY: the toggle lives in the debug wheel, which exists before any AR
  // session; the check needs the session's scene, so it starts on attach
  // and is disposed with the session.
  it('starts the check only while enabled AND attached, and disposes it on detach', async () => {
    const { ui, deps, stub, q } = setup();
    await ui.setEnabled(true);
    expect(deps.startCheck).not.toHaveBeenCalled();
    expect(q('sun-check')).toBeNull();
    ui.attach();
    expect(deps.startCheck).toHaveBeenCalledTimes(1);
    expect(q('sun-check')?.hidden).toBe(false);
    ui.detach();
    expect(stub.check.dispose).toHaveBeenCalledTimes(1);
    expect(q('sun-check')).toBeNull();
    ui.attach();
    expect(deps.startCheck).toHaveBeenCalledTimes(2);
    await ui.setEnabled(false);
    expect(stub.check.dispose).toHaveBeenCalledTimes(2);
    expect(q('sun-check')).toBeNull();
  });

  it('keeps the safety reminder on screen and the status line current', async () => {
    const { ui, stub, tick, q } = setup();
    await ui.setEnabled(true);
    ui.attach();
    expect(q('sun-check-reminder')?.textContent).toContain(
      'Never look at the sun'
    );
    expect(q('sun-check-status')?.textContent).toContain('Sun az 265.2°');
    stub.setStatus({ visible: false, hiddenBecause: 'not-tracking' });
    tick();
    expect(q('sun-check-status')?.textContent).toBe('Sun check: tracking lost');
  });

  // WHY (the repo's async-UI rule): a Mark takes a second of holding still,
  // so the button shows it is busy, and returns to idle on every outcome.
  it('shows the in-progress state, then the result, and records an accepted Mark', async () => {
    const { ui, deps, stub, q } = setup();
    await ui.setEnabled(true);
    ui.attach();
    const button = q('btn-sun-mark') as HTMLButtonElement;
    button.click();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toBe('Hold still… 1 s');
    button.click(); // a second tap while busy is ignored
    expect(stub.check.mark).toHaveBeenCalledTimes(1);

    const s = sighting(1.84, -0.21);
    stub.settle({ ok: true, sighting: s, warnings: [] });
    await flush();
    expect(deps.recordSighting).toHaveBeenCalledWith(s);
    expect(deps.showToast).toHaveBeenCalledWith(
      'Content 1.8° left of true · 0.2° high · sun el 12° · recorded',
      expect.objectContaining({ severity: 'info' })
    );
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');
    expect(button.textContent).toBe('Mark');
    expect(q('sun-check-history')?.textContent).toContain('1.8° left');
  });

  it('keeps only the last three Marks in the HUD', async () => {
    const { ui, stub, q } = setup();
    await ui.setEnabled(true);
    ui.attach();
    const button = q('btn-sun-mark') as HTMLButtonElement;
    for (const h of [1, 2, 3, 4]) {
      button.click();
      stub.settle({ ok: true, sighting: sighting(h, 0), warnings: [] });
      await flush();
    }
    const lines = q('sun-check-history')?.children;
    expect(lines).toHaveLength(3);
    expect(lines?.[0]?.textContent).toContain('4.0° left');
    expect(lines?.[2]?.textContent).toContain('2.0° left');
  });

  it('reverts the button and records nothing on a refusal', async () => {
    const { ui, deps, stub, q } = setup();
    await ui.setEnabled(true);
    ui.attach();
    const button = q('btn-sun-mark') as HTMLButtonElement;
    button.click();
    stub.settle({ ok: false, reason: 'moved', spreadDeg: 0.62, frames: 30 });
    await flush();
    expect(deps.recordSighting).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith(
      'Moved 0.6° during the Mark - hold still and try again',
      expect.objectContaining({ severity: 'warning' })
    );
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Mark');
  });

  // WHY: a failed write is a real failure (the error channel), and it must
  // not leave the button stuck busy.
  it('reports a failed record as an error and reverts the button', async () => {
    const { ui, deps, stub, q } = setup({
      recordSighting: vi.fn(() => {
        throw new Error('store gone');
      }),
    });
    await ui.setEnabled(true);
    ui.attach();
    const button = q('btn-sun-mark') as HTMLButtonElement;
    button.click();
    stub.settle({ ok: true, sighting: sighting(1, 0), warnings: [] });
    await flush();
    expect(deps.showToast).toHaveBeenCalledWith(
      expect.stringContaining('could not be recorded'),
      expect.objectContaining({ severity: 'error' })
    );
    expect(button.disabled).toBe(false);
  });

  it('turns itself off with an error when the check cannot start', async () => {
    const { ui, deps, q } = setup({
      startCheck: vi.fn(() => {
        throw new Error('no scene');
      }),
    });
    ui.attach();
    expect(await ui.setEnabled(true)).toBe(false);
    expect(ui.isEnabled()).toBe(false);
    expect(deps.showToast).toHaveBeenCalledWith(
      expect.stringContaining('could not start'),
      expect.objectContaining({ severity: 'error' })
    );
    expect(q('sun-check')).toBeNull();
  });

  it('stops its status refresh and removes its DOM on dispose', async () => {
    const { ui, deps, stub, q } = setup();
    await ui.setEnabled(true);
    ui.attach();
    ui.dispose();
    expect(stub.check.dispose).toHaveBeenCalled();
    expect(q('sun-check')).toBeNull();
    expect(deps.every).toHaveBeenCalledTimes(1);
    ui.attach();
    expect(deps.startCheck).toHaveBeenCalledTimes(1);
  });
});
