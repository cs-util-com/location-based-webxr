// Why this test matters: after the rewiring, the gate is defined twice —
// stages.mjs (used by run-gate + the md rows) and the package.json `&&`
// chains (test:core, check:all) that developers still run directly. The
// guard warns (never fails) when the two drift, e.g. a new check added to
// check:all but not stages.mjs, which would silently miss a timing row.
import { describe, it, expect } from 'vitest';
import { expandChain, checkChainDrift } from './chain-guard.mjs';

/**
 * A minimal consistent package.json scripts map matching the real layout.
 * @returns {Record<string, string | undefined>}
 */
function consistentScripts() {
  return {
    test: 'node scripts/test-timing/run-gate.mjs',
    'test:core':
      'pnpm run format && pnpm run lint && pnpm run check:all && pnpm run typecheck && pnpm run typecheck:tests && pnpm run test:unit',
    'check:all':
      'pnpm run check:dup && pnpm run check:cycles && pnpm run check:boundaries && pnpm run check:deadcode',
    format: 'node scripts/test-timing/timed-stage.mjs format',
    lint: 'node scripts/test-timing/timed-stage.mjs lint',
    'check:dup': 'node scripts/test-timing/timed-stage.mjs check:dup',
    'check:cycles': 'node scripts/test-timing/timed-stage.mjs check:cycles',
    'check:boundaries':
      'node scripts/test-timing/timed-stage.mjs check:boundaries',
    'check:deadcode': 'node scripts/test-timing/timed-stage.mjs check:deadcode',
    typecheck: 'node scripts/test-timing/timed-stage.mjs typecheck',
    'typecheck:tests':
      'node scripts/test-timing/timed-stage.mjs typecheck:tests',
    'test:unit': 'node scripts/test-timing/timed-stage.mjs test:unit',
    'test:e2e:index': 'node scripts/test-timing/timed-stage.mjs test:e2e:index',
    'test:guardrail': 'node scripts/test-timing/timed-stage.mjs test:guardrail',
  };
}

const STAGE_NAMES = [
  'format',
  'lint',
  'check:dup',
  'check:cycles',
  'check:boundaries',
  'check:deadcode',
  'typecheck',
  'typecheck:tests',
  'test:unit',
  'test:e2e:index',
  'test:guardrail',
];

describe('wrapper path variants (webxr multi-package layout)', () => {
  // Why this test matters: in this workspace the wrapper lives at the ROOT
  // (scripts/test-timing/), so package-level scripts reach it via
  // `node ../scripts/test-timing/timed-stage.mjs` while root-level scripts
  // use the plain relative path. Both spellings must count as "wrapped" or
  // every package gate would emit a false drift warning on every run.
  it('accepts the package-level ../scripts wrapper path', () => {
    const scripts = {
      lint: 'node ../scripts/test-timing/timed-stage.mjs lint',
    };
    expect(checkChainDrift(scripts, ['lint'])).toEqual([]);
  });
});

describe('expandChain', () => {
  it('flattens nested pnpm-run chains to their leaf script names', () => {
    expect(expandChain(consistentScripts(), 'test:core')).toEqual([
      'format',
      'lint',
      'check:dup',
      'check:cycles',
      'check:boundaries',
      'check:deadcode',
      'typecheck',
      'typecheck:tests',
      'test:unit',
    ]);
  });

  it('returns raw command parts as-is (they are not chain references)', () => {
    const scripts = { odd: 'eslint . && pnpm run lint', lint: 'eslint .' };
    expect(expandChain(scripts, 'odd')).toEqual(['eslint .', 'lint']);
  });

  // Why this test matters: the guard must never take the gate down (module
  // contract, plan §4). Without cycle tracking, two chain scripts that
  // accidentally reference each other made expandChain recurse forever and
  // throw RangeError (maximum call stack size exceeded) — found via PR #518
  // review. The back-reference is dropped; all other leaves still surface.
  it('terminates on circular chain references instead of overflowing the stack', () => {
    const scripts = {
      'test:core': 'pnpm run check:all && pnpm run lint',
      'check:all': 'pnpm run test:core && pnpm run check:dup',
      lint: 'node scripts/test-timing/timed-stage.mjs lint',
      'check:dup': 'node scripts/test-timing/timed-stage.mjs check:dup',
    };
    expect(expandChain(scripts, 'test:core')).toEqual(['check:dup', 'lint']);
    expect(() => checkChainDrift(scripts, ['lint', 'check:dup'])).not.toThrow();
  });
});

describe('checkChainDrift', () => {
  it('accepts the consistent layout without warnings', () => {
    expect(checkChainDrift(consistentScripts(), STAGE_NAMES)).toEqual([]);
  });

  it('warns when a chain references a leaf missing from stages.mjs', () => {
    const scripts = consistentScripts();
    scripts['check:all'] += ' && pnpm run check:new-shiny';
    scripts['check:new-shiny'] = 'shiny .';
    const warnings = checkChainDrift(scripts, STAGE_NAMES);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/check:new-shiny/);
    expect(warnings[0]).toMatch(/stages\.mjs/);
  });

  it('warns when chain order contradicts the stages.mjs order', () => {
    const scripts = consistentScripts();
    scripts['test:core'] =
      'pnpm run lint && pnpm run format && pnpm run check:all && pnpm run typecheck && pnpm run typecheck:tests && pnpm run test:unit';
    const warnings = checkChainDrift(scripts, STAGE_NAMES);
    expect(warnings.some((w) => /order/.test(w))).toBe(true);
  });

  it('warns when a stage script no longer invokes the wrapper', () => {
    const scripts = consistentScripts();
    scripts['test:unit'] = 'vitest run --coverage';
    const warnings = checkChainDrift(scripts, STAGE_NAMES);
    expect(
      warnings.some((w) => /test:unit/.test(w) && /timed-stage/.test(w))
    ).toBe(true);
  });

  it('warns when a stage has no package.json script at all', () => {
    const scripts = consistentScripts();
    delete scripts['test:guardrail'];
    const warnings = checkChainDrift(scripts, STAGE_NAMES);
    expect(warnings.some((w) => /test:guardrail/.test(w))).toBe(true);
  });
});
