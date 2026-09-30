// Why this test matters: a headless-Chromium 3D suite renders on the CPU
// (SwiftShader) and can take most of a small development machine by itself.
// At normal priority it starves every short gate beside it; the repo-config
// suite then failed on 5 s timeouts even after its own cost was halved
// (2026-09-30: 2-26 timeouts per run at 86-96 % load). Running browser
// stages at BELOW_NORMAL gives the short gates the CPU first. These tests pin
// WHICH stages are lowered, that the parent's own priority is always
// restored (`run-gate` runs every stage in one process: a leaked lowering
// would slow every later stage of the gate), that the parent is never
// RAISED, and that the stage learns whether it really runs lowered (the
// marker the Playwright configs key `--in-process-gpu` on).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { constants } from 'node:os';

import {
  BROWSER_PRIORITY_ENV,
  LOWERED_MARKER_ENV,
  stageSpawnPriority,
  spawnAtPriority,
} from './stage-priority.mjs';

const BELOW = constants.priority.PRIORITY_BELOW_NORMAL;
const IDLE = constants.priority.PRIORITY_LOW;
const browser = { command: 'playwright test --config 3d/playwright.config.mjs' };
const unit = { command: 'vitest run --config vitest.config.js' };
// The shared app format command lists the "playwright-tests" DIRECTORY; it
// must not count as a browser stage (the bug isBrowserStage records).
const format = { command: 'prettier --write "src" "playwright-tests"' };

describe('stageSpawnPriority', () => {
  it('lowers a browser stage on Windows', () => {
    expect(stageSpawnPriority(browser, { platform: 'win32', env: {} })).toBe(BELOW);
  });

  it('leaves non-browser stages alone, including a command that only names playwright-tests', () => {
    expect(stageSpawnPriority(unit, { platform: 'win32', env: {} })).toBeNull();
    expect(stageSpawnPriority(format, { platform: 'win32', env: {} })).toBeNull();
  });

  it('is a no-op off Windows', () => {
    // Linux CI runs one job per machine; nothing competes there, and a
    // lowered nice value would only slow the e2e job itself.
    for (const platform of ['linux', 'darwin']) {
      expect(stageSpawnPriority(browser, { platform, env: {} })).toBeNull();
    }
  });

  it(`can be switched off with ${BROWSER_PRIORITY_ENV}=normal`, () => {
    // The control arm of a measurement needs the old behaviour back without
    // editing code.
    expect(
      stageSpawnPriority(browser, { platform: 'win32', env: { [BROWSER_PRIORITY_ENV]: 'normal' } })
    ).toBeNull();
  });

  it('keeps the default for any other value, so a typo cannot silently restore normal', () => {
    expect(
      stageSpawnPriority(browser, { platform: 'win32', env: { [BROWSER_PRIORITY_ENV]: 'Normal ' } })
    ).toBe(BELOW);
  });
});

describe('spawnAtPriority', () => {
  function fakeOs(initial = 0) {
    const calls = [];
    let current = initial;
    return {
      calls,
      os: {
        getPriority: () => current,
        setPriority: (value) => {
          calls.push(value);
          current = value;
        },
      },
      current: () => current,
    };
  }

  it('spawns while the parent is lowered, tells the spawn so, then restores the parent', () => {
    const f = fakeOs(0);
    let seenDuringSpawn;
    let told;
    const child = spawnAtPriority(({ lowered }) => {
      seenDuringSpawn = f.current();
      told = lowered;
      return 'child';
    }, BELOW, f.os);
    expect(child).toBe('child');
    expect(seenDuringSpawn).toBe(BELOW);
    expect(told).toBe(true);
    expect(f.current()).toBe(0);
  });

  it('restores the parent even when the spawn throws', () => {
    const f = fakeOs(0);
    expect(() =>
      spawnAtPriority(() => {
        throw new Error('spawn failed');
      }, BELOW, f.os)
    ).toThrow('spawn failed');
    expect(f.current()).toBe(0);
  });

  it('does not touch the priority at all when none is asked for, and says it did not lower', () => {
    const f = fakeOs(0);
    let told;
    expect(
      spawnAtPriority(({ lowered }) => {
        told = lowered;
        return 'child';
      }, null, f.os)
    ).toBe('child');
    expect(f.calls).toEqual([]);
    expect(told).toBe(false);
  });

  it('never raises a parent that already runs lower, and the child still counts as lowered', () => {
    // Review finding 4: a gate started at IDLE would otherwise have its
    // stage RAISED to below-normal. The child inherits the lower class anyway.
    const f = fakeOs(IDLE);
    let told;
    let seenDuringSpawn;
    spawnAtPriority(({ lowered }) => {
      told = lowered;
      seenDuringSpawn = f.current();
    }, BELOW, f.os);
    expect(f.calls).toEqual([]);
    expect(seenDuringSpawn).toBe(IDLE);
    expect(told).toBe(true);
  });

  it('still spawns, at the inherited priority, when lowering is refused, and says it did not lower', () => {
    // setPriority can throw (EACCES/EPERM). A priority is an optimisation;
    // it must never fail the gate. The stage must then not claim to run
    // lowered, or the configs would switch the renderer model for nothing.
    const os = {
      getPriority: () => 0,
      setPriority: () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      },
    };
    let told;
    expect(
      spawnAtPriority(({ lowered }) => {
        told = lowered;
        return 'child';
      }, BELOW, os)
    ).toBe('child');
    expect(told).toBe(false);
  });

  it('names the marker the Playwright configs read', () => {
    expect(LOWERED_MARKER_ENV).toBe('GATE_BROWSER_STAGE_LOWERED');
  });

  it('property: the parent ends where it began, is never raised, and "lowered" is true exactly when the spawn ran at or below the target', () => {
    fc.assert(
      fc.property(fc.integer({ min: -20, max: 19 }), fc.boolean(), (start, fails) => {
        const f = fakeOs(start);
        let told;
        let seen;
        try {
          spawnAtPriority(({ lowered }) => {
            told = lowered;
            seen = f.current();
            if (fails) throw new Error('x');
            return 1;
          }, BELOW, f.os);
        } catch {
          // the throw itself is covered above
        }
        expect(f.current()).toBe(start);
        // node's scale: a larger number is a LOWER priority
        expect(seen).toBeGreaterThanOrEqual(Math.min(start, BELOW));
        expect(seen).toBe(Math.max(start, BELOW));
        expect(told).toBe(seen >= BELOW);
      })
    );
  });
});
