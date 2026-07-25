// Why this test matters: proves the guard is warning-free for ANY package
// layout generated canonically from a stage list (no false positives), and
// that dropping any single stage script always warns (no false negatives on
// the most likely drift: a rename/removal).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { checkChainDrift } from './chain-guard.mjs';

const stageListArb = fc
  .uniqueArray(fc.stringMatching(/^[a-z][a-z0-9:_-]{0,15}$/), {
    minLength: 1,
    maxLength: 12,
  })
  // "test:core"/"check:all" are chain names, never stage names
  .map((names) => names.filter((n) => n !== 'test:core' && n !== 'check:all'))
  .filter((names) => names.length > 0);

/** @param {string[]} stageNames */
function canonicalScripts(stageNames) {
  /** @type {Record<string, string>} */
  const scripts = {
    'test:core': stageNames.map((n) => `pnpm run ${n}`).join(' && '),
  };
  for (const name of stageNames) {
    scripts[name] = `node scripts/test-timing/timed-stage.mjs ${name}`;
  }
  return scripts;
}

describe('chain-guard properties', () => {
  it('canonically constructed layouts never warn', () => {
    fc.assert(
      fc.property(stageListArb, (stageNames) => {
        expect(
          checkChainDrift(canonicalScripts(stageNames), stageNames)
        ).toEqual([]);
      })
    );
  });

  it('removing any one stage script always produces a warning naming it', () => {
    fc.assert(
      fc.property(stageListArb, fc.nat(), (stageNames, seed) => {
        const victim = stageNames[seed % stageNames.length];
        const scripts = canonicalScripts(stageNames);
        delete scripts[victim];
        const warnings = checkChainDrift(scripts, stageNames);
        expect(warnings.some((w) => w.includes(`"${victim}"`))).toBe(true);
      })
    );
  });
});
