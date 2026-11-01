// Why this test matters: the record/skip decision is the safety valve that
// keeps the timing history like-for-like. These properties pin the invariant
// for ALL argv shapes, not just the handful of examples in stage-args.test.mjs.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  decideRecording,
  appendArgs,
  buildStageCommand,
} from './stage-args.mjs';

const argvArb = fc.array(fc.string(), { maxLength: 8 });

describe('decideRecording properties', () => {
  it('records iff no effective extra args remain and it is not the GitHub runner, whatever CI says', () => {
    fc.assert(
      fc.property(argvArb, fc.boolean(), fc.boolean(), (argvRest, onCI, localCi) => {
        const env = onCI
          ? { GITHUB_ACTIONS: 'true', CI: 'true' }
          : localCi
            ? { CI: '1' }
            : {};
        const decision = decideRecording(argvRest, env);
        const effective =
          argvRest[0] === '--' ? argvRest.slice(1) : [...argvRest];
        expect(decision.extraArgs).toEqual(effective);
        expect(decision.record).toBe(!onCI && effective.length === 0);
      })
    );
  });

  it('never mutates its argv input', () => {
    fc.assert(
      fc.property(argvArb, (argvRest) => {
        const copy = [...argvRest];
        decideRecording(argvRest, { GITHUB_ACTIONS: 'true' });
        decideRecording(argvRest, {});
        expect(argvRest).toEqual(copy);
      })
    );
  });
});

describe('appendArgs properties', () => {
  it('always starts with the base command', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }),
        (cmd, args) => {
          expect(appendArgs(cmd, args).startsWith(cmd)).toBe(true);
        }
      )
    );
  });

  it('is the identity for an empty arg list', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (cmd) => {
        expect(appendArgs(cmd, [])).toBe(cmd);
      })
    );
  });
});

describe('buildStageCommand properties', () => {
  const cmdArb = fc.string({ minLength: 1 });
  // Disjoint token prefixes keep indexOf-based ordering checks unambiguous;
  // quote-free tokens keep the rendered command free of appendArgs quoting.
  const token = fc
    .string({ minLength: 1, maxLength: 6 })
    .filter((s) => !/[\s"]/.test(s));
  const neutralizersArb = fc.array(
    token.map((s) => `--nf-${s}`),
    { maxLength: 4 }
  );
  const forwardedArb = fc.array(
    token.map((s) => `fwd-${s}`),
    { minLength: 1, maxLength: 5 }
  );

  it('is the identity on the canonical command whenever no args are forwarded, for ANY filteredRunArgs', () => {
    fc.assert(
      fc.property(cmdArb, neutralizersArb, fc.boolean(), (cmd, nf, onCI) => {
        const decision = decideRecording([], onCI ? { GITHUB_ACTIONS: 'true' } : {});
        expect(buildStageCommand(cmd, decision, nf)).toBe(cmd);
      })
    );
  });

  it('on filtered runs: every filteredRunArg appears after the command and before every forwarded arg', () => {
    fc.assert(
      fc.property(cmdArb, neutralizersArb, forwardedArb, (cmd, nf, fwd) => {
        const decision = decideRecording(fwd, {});
        const result = buildStageCommand(cmd, decision, nf);
        expect(result.startsWith(cmd)).toBe(true);
        const firstFwd = result.indexOf(' fwd-', cmd.length);
        for (const arg of nf) {
          const at = result.indexOf(` ${arg} `, cmd.length);
          expect(at).toBeGreaterThanOrEqual(cmd.length);
          expect(at).toBeLessThan(firstFwd);
        }
      })
    );
  });

  it('without filteredRunArgs it degenerates to appendArgs of the forwarded args (reference model)', () => {
    fc.assert(
      fc.property(cmdArb, forwardedArb, (cmd, fwd) => {
        const decision = decideRecording(fwd, {});
        expect(buildStageCommand(cmd, decision)).toBe(appendArgs(cmd, fwd));
      })
    );
  });
});
