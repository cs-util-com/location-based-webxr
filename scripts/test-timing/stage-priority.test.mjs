// Why this test matters: a headless-Chromium 3D suite renders on the CPU
// (SwiftShader) and takes ~85 % of this 4-core laptop by itself. At normal
// priority it starves every short gate beside it; the repo-config suite then
// fails on 5 s timeouts even after its own cost was halved (2026-09-30:
// 2-26 timeouts per run at 86-96 % load). Running browser stages at
// BELOW_NORMAL gives the short gates the CPU first (load findings
// 2026-09-28, recommendation 1). These tests pin WHICH stages are lowered and
// that the parent's own priority is always restored, because `run-gate`
// runs every stage in one process: a leaked lowering would slow every later
// stage of the gate.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { constants } from 'node:os';

import {
  BROWSER_PRIORITY_ENV,
  stageSpawnPriority,
  spawnAtPriority,
} from './stage-priority.mjs';

const BELOW = constants.priority.PRIORITY_BELOW_NORMAL;
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

  it('spawns while the parent is lowered, then restores the parent', () => {
    const f = fakeOs(0);
    let seenDuringSpawn;
    const child = spawnAtPriority(() => {
      seenDuringSpawn = f.current();
      return 'child';
    }, BELOW, f.os);
    expect(child).toBe('child');
    expect(seenDuringSpawn).toBe(BELOW);
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

  it('does not touch the priority at all when none is asked for', () => {
    const f = fakeOs(0);
    expect(spawnAtPriority(() => 'child', null, f.os)).toBe('child');
    expect(f.calls).toEqual([]);
  });

  it('still spawns, at the inherited priority, when lowering is refused', () => {
    // setPriority can throw (EACCES/EPERM). A priority is an optimisation;
    // it must never fail the gate.
    const os = {
      getPriority: () => 0,
      setPriority: () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      },
    };
    expect(spawnAtPriority(() => 'child', BELOW, os)).toBe('child');
  });

  it('property: whatever the starting priority, the parent ends where it began', () => {
    fc.assert(
      fc.property(fc.integer({ min: -20, max: 19 }), fc.boolean(), (start, fails) => {
        const f = fakeOs(start);
        try {
          spawnAtPriority(() => {
            if (fails) throw new Error('x');
            return 1;
          }, BELOW, f.os);
        } catch {
          // the throw itself is covered above
        }
        expect(f.current()).toBe(start);
      })
    );
  });
});
