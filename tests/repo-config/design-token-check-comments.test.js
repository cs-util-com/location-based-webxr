// Why this test matters: the design system's `check-tokens.mjs` delimits a
// `@layer` by counting braces, and it used to strip CSS comments only from
// the body it had already extracted. A `}` inside a comment therefore ended
// the layer early and every colour literal after it went unchecked, while a
// `{` ran the body past the layer's end into an exempt layer and produced
// false positives there - silent either way, and a commented-out rule block
// is exactly what someone writes while tuning tokens (PR #419 review).
// Comments are stripped before the scan now; this pins both directions and
// the bonus that a token defined only inside a comment no longer satisfies
// the brief.
import { describe, expect, it } from 'vitest';
import { findProblems } from '../../GpsPlusSlamJs_DesignSystem/check-tokens.mjs';

const brief = 'The brief names `--accent` as the one warm colour.';

describe('check-tokens strips comments before delimiting layers', () => {
  it('a `}` inside a comment no longer hides the literals after it', () => {
    const css = [
      '@layer tokens {',
      ':root { --accent: #f2971f; }',
      '}',
      '@layer atoms {',
      '/* .old { color: red } */',
      '.btn { color: #ff0000; }',
      '}',
      '',
    ].join('\n');
    expect(findProblems({ css, brief })).toEqual([
      'color literal in @layer atoms: .btn { color: #ff0000; }',
    ]);
  });

  it('a `{` inside a comment no longer runs the body into the exempt layer', () => {
    const css = [
      '@layer tokens {',
      ':root { --accent: #f2971f; }',
      '}',
      '@layer atoms {',
      '/* .old { */',
      '.btn { color: var(--accent); }',
      '}',
      '@layer demo {',
      '.cam { background: #123456; }',
      '}',
      '',
    ].join('\n');
    expect(findProblems({ css, brief })).toEqual([]);
  });

  it('a token defined only inside a comment does not satisfy the brief', () => {
    const css = [
      '@layer tokens {',
      '/* --accent: #f2971f; */',
      ':root { --ink: #fff; }',
      '}',
      '',
    ].join('\n');
    expect(findProblems({ css, brief })).toEqual([
      'brief mentions --accent, the CSS does not define it',
    ]);
  });
});
