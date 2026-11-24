// Tests for scripts/verify-community-key-lifetime.mjs.
//
// These tests pin the parsing/decoding/banding logic against historical
// and future bundler output shapes. The original guardrail false-positived
// when tsdown/rolldown started emitting the JWT literal as a backtick
// template literal in `gps-plus-slam-js@1.0.4` — see the commit that
// introduced this file. Each test below comments the "why this matters"
// note required by AGENTS.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  extractTokenLiteral,
  decodeJwtPayload,
  evaluateLifetime,
  DEFAULT_MIN_DAYS,
  DEFAULT_MAX_DAYS,
} from './verify-community-key-lifetime.mjs';

const SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'verify-community-key-lifetime.mjs'
);

// A real-shape token (payload base64url-decodes to {"type":"community","exp":1809247058}).
// Picked from the production gps-plus-slam-js@1.0.4 dist so tests are
// representative; signature bytes are arbitrary base64url.
const REAL_TOKEN =
  'eyJ0eXBlIjoiY29tbXVuaXR5IiwiZXhwIjoxODA5MjQ3MDU4fQ.OCzMOU_IZZjWpNgZDss7eIsVFtfD_uvUY6ST8PUw77vGYCxK_9FyI87CeKEBK9UFQYwqaJBw1x-yr_jT2OFPDQ';
const REAL_EXP_SEC = 1_809_247_058;

/**
 * Build a `<base64url-payload>.<sig>` token from a JS object payload.
 * Used by the lifetime tests to vary `exp` deterministically.
 */
function buildToken(payload, sig = 'sigsig') {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${b64}.${sig}`;
}

describe('extractTokenLiteral — bundler output shape compatibility', () => {
  it('matches a backtick template literal (tsdown/rolldown ≥ gps-plus-slam-js@1.0.4 shape)', () => {
    // Why: this is the exact regression that broke the
    // app-framework@1.0.4 publish — the dist switched from quoted to
    // backtick form and the regex's old `['"]` class missed it.
    const dist = `/*! gps-plus-slam-js */const e=\`${REAL_TOKEN}\`;export{e as COMMUNITY_LICENSE_KEY};`;
    expect(extractTokenLiteral(dist)).toBe(REAL_TOKEN);
  });

  it('matches a single-quoted literal (older bundler shape)', () => {
    // Why: previous gps-plus-slam-js versions emitted single quotes; we
    // must keep matching them so a downgrade does not silently break.
    const dist = `const e='${REAL_TOKEN}';export{e as COMMUNITY_LICENSE_KEY};`;
    expect(extractTokenLiteral(dist)).toBe(REAL_TOKEN);
  });

  it('matches a double-quoted literal (alternative bundler shape)', () => {
    // Why: same reasoning as single quotes — defensive against future
    // bundler/minifier changes that flip preferred quote style.
    const dist = `const e="${REAL_TOKEN}";export{e as COMMUNITY_LICENSE_KEY};`;
    expect(extractTokenLiteral(dist)).toBe(REAL_TOKEN);
  });

  it('matches when the constant is named COMMUNITY_LICENSE_KEY directly (un-minified shape)', () => {
    // Why: in dev / non-minified builds the constant keeps its full name
    // instead of being renamed to a single letter. Both branches of the
    // regex alternation must be covered.
    const dist = `export const COMMUNITY_LICENSE_KEY = "${REAL_TOKEN}";`;
    expect(extractTokenLiteral(dist)).toBe(REAL_TOKEN);
  });

  it('returns null when the file contains no JWT-shaped literal', () => {
    // Why: the script must surface a clear error rather than crashing
    // later during base64 decode if the dist file was tampered with or
    // the export was removed.
    const dist = `export const SOMETHING_ELSE = "not.a.jwt.token";`;
    expect(extractTokenLiteral(dist)).toBeNull();
  });

  it('returns null when the literal is missing the "." separator', () => {
    // Why: `<payload>.<sig>` is the JWT grammar; a single segment must
    // not be accepted as a token.
    const dist = `const e=\`abcdefghi\`;export{e as COMMUNITY_LICENSE_KEY};`;
    expect(extractTokenLiteral(dist)).toBeNull();
  });

  it('extracts the first JWT-shaped literal when several exist', () => {
    // Why: locks the regex to a deterministic first-match semantics so
    // tests for malformed multi-token files do not flake across V8s.
    const dist = `const a='AAA.BBB';const b='CCC.DDD';`;
    expect(extractTokenLiteral(dist)).toBe('AAA.BBB');
  });

  it('source contains no useless escapes inside regex character classes', () => {
    // Why: regression for app-framework@1.0.4 publish failure. The
    // extractor regex previously used `[A-Za-z0-9_\-]` — functionally
    // identical to `[A-Za-z0-9_-]` (a trailing `-` in a character class
    // is literal), so every behavioral test above still passed. Only
    // ESLint's `no-useless-escape` flagged it, and that error blocked
    // `pnpm run test:core` in CI. This test surfaces the same failure
    // in the unit-test layer so it is caught locally without waiting
    // for the lint stage. If a future contributor reintroduces `\-`
    // inside `[...]`, this fires immediately with a clear reason.
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    // Match `\-` only when it appears inside a `[...]` character class.
    // The pattern looks for `[` followed by any non-`]` characters,
    // a `\-`, then more non-`]` characters and a closing `]`.
    const uselessEscapeInClass = /\[[^\]]*\\-[^\]]*\]/;
    expect(source).not.toMatch(uselessEscapeInClass);
  });
});

describe('decodeJwtPayload', () => {
  it('decodes a real-shape token to the expected payload', () => {
    // Why: end-to-end check against the actual production token shape.
    // If base64url decoding ever regresses, this catches it without
    // needing a network round-trip.
    expect(decodeJwtPayload(REAL_TOKEN)).toEqual({
      type: 'community',
      exp: REAL_EXP_SEC,
    });
  });

  it('throws code="no-dot" for a token with no "." separator', () => {
    // Why: the script's no-dot branch must be reachable; if the regex
    // loosens accidentally and lets through single segments, this test
    // pins the contract that decoding still rejects them.
    expect(() => decodeJwtPayload('justpayloadnodot')).toThrow(
      expect.objectContaining({ code: 'no-dot' })
    );
  });

  it('throws code="no-dot" when the token starts with "."', () => {
    // Why: `dotIndex <= 0` covers both "no dot at all" and "leading dot,
    // empty payload". Both should be a single failure mode.
    expect(() => decodeJwtPayload('.sigonly')).toThrow(
      expect.objectContaining({ code: 'no-dot' })
    );
  });

  it('throws code="invalid-json" when the payload base64url-decodes to non-JSON', () => {
    // Why: distinguishing base64 vs JSON failures helps debugging an
    // accidental dist-shape change. base64url("hello") is valid base64
    // but not JSON.
    const token = `${Buffer.from('hello', 'utf8').toString('base64url')}.sig`;
    expect(() => decodeJwtPayload(token)).toThrow(
      expect.objectContaining({ code: 'invalid-json' })
    );
  });

  it('round-trips a constructed token deterministically', () => {
    // Why: confirms `buildToken` (the helper the lifetime tests rely on)
    // produces tokens that the decoder accepts — otherwise lifetime tests
    // would be testing nothing useful.
    const built = buildToken({ type: 'community', exp: 999 });
    expect(decodeJwtPayload(built)).toEqual({ type: 'community', exp: 999 });
  });
});

describe('default lifetime band', () => {
  it('is 300 to 380 days', () => {
    // Why: the floor decides how long a framework-only release stays
    // publishable after the last core release (the core re-signs the key
    // for about 365 days on each publish). 300 leaves about 65 days.
    expect(DEFAULT_MIN_DAYS).toBe(300);
    expect(DEFAULT_MAX_DAYS).toBe(380);
  });

  it('accepts a key from a core release about 40 days old', () => {
    // Why: pins the real case that motivated the lower floor: a key signed
    // for 365 days, published 40 days ago, has about 325 days left and must
    // not block a framework-only release.
    const now = 1_700_000_000;
    const r = evaluateLifetime(
      { exp: now + 325.5 * 86_400 },
      { nowSec: now, minDays: DEFAULT_MIN_DAYS, maxDays: DEFAULT_MAX_DAYS }
    );
    expect(r.ok).toBe(true);
  });

  it('still blocks a key from a core release about 70 days old', () => {
    // Why: the floor must still stop a framework release from shipping a
    // key that is running out; lowering it is not removing it.
    const now = 1_700_000_000;
    const r = evaluateLifetime(
      { exp: now + 295 * 86_400 },
      { nowSec: now, minDays: DEFAULT_MIN_DAYS, maxDays: DEFAULT_MAX_DAYS }
    );
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'too-short' }));
  });
});

describe('evaluateLifetime — band logic', () => {
  const MIN = DEFAULT_MIN_DAYS;
  const MAX = DEFAULT_MAX_DAYS;
  const NOW = 1_700_000_000; // arbitrary fixed epoch seconds

  it('returns ok when the token sits exactly mid-band', () => {
    // Why: sanity baseline. If this fails the band math itself is wrong.
    const exp = NOW + 340 * 86_400;
    const r = evaluateLifetime({ exp }, { nowSec: NOW, minDays: MIN, maxDays: MAX });
    expect(r.ok).toBe(true);
    expect(r.exp).toBe(exp);
    expect(r.remainingDays).toBeCloseTo(340, 6);
  });

  it('returns ok at the lower boundary (remainingDays === minDays)', () => {
    // Why: the original implementation uses `< minDays`, so equality
    // must remain accepted. Locks the boundary to "inclusive at min".
    const exp = NOW + MIN * 86_400;
    const r = evaluateLifetime({ exp }, { nowSec: NOW, minDays: MIN, maxDays: MAX });
    expect(r.ok).toBe(true);
  });

  it('returns ok at the upper boundary (remainingDays === maxDays)', () => {
    // Why: mirror of the lower-boundary test; `> maxDays` keeps equality
    // valid. If someone tightens to `>=` this test fires.
    const exp = NOW + MAX * 86_400;
    const r = evaluateLifetime({ exp }, { nowSec: NOW, minDays: MIN, maxDays: MAX });
    expect(r.ok).toBe(true);
  });

  it('returns reason="too-short" just below the lower bound', () => {
    // Why: this is the production-relevant failure — a stale core that
    // needs a re-sign release. Must produce the actionable reason.
    const exp = NOW + (MIN - 1) * 86_400;
    const r = evaluateLifetime({ exp }, { nowSec: NOW, minDays: MIN, maxDays: MAX });
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'too-short', exp }));
  });

  it('returns reason="too-long" just above the upper bound', () => {
    // Why: catches an accidental over-extended `exp` (e.g. mis-signed for
    // 5 years), which is the inverse failure of the recurring re-sign job.
    const exp = NOW + (MAX + 1) * 86_400;
    const r = evaluateLifetime({ exp }, { nowSec: NOW, minDays: MIN, maxDays: MAX });
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'too-long', exp }));
  });

  it('returns reason="invalid-exp" when payload.exp is missing', () => {
    // Why: defensive — a payload without `exp` must not be silently
    // treated as "infinitely valid".
    const r = evaluateLifetime({}, { nowSec: NOW, minDays: MIN, maxDays: MAX });
    expect(r).toEqual({ ok: false, reason: 'invalid-exp', exp: undefined });
  });

  it('returns reason="invalid-exp" when payload.exp is a string', () => {
    // Why: defensive against a future spec change that emits the exp as
    // an ISO date string. We want to fail loudly, not coerce silently.
    const r = evaluateLifetime(
      { exp: '2027-05-02' },
      { nowSec: NOW, minDays: MIN, maxDays: MAX }
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid-exp');
  });

  it('returns reason="invalid-exp" when payload.exp is NaN', () => {
    // Why: `Number.isFinite(NaN)` is false; this test pins that the
    // helper rejects NaN rather than producing NaN remainingDays which
    // would bypass both `<` and `>` comparisons silently.
    const r = evaluateLifetime(
      { exp: Number.NaN },
      { nowSec: NOW, minDays: MIN, maxDays: MAX }
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid-exp');
  });
});

describe('end-to-end: extract → decode → evaluate', () => {
  it('treats the production gps-plus-slam-js@1.0.4 dist line as ok at the published exp date', () => {
    // Why: smoke-tests the whole pipeline against the real bundled
    // string from gps-plus-slam-js@1.0.4. If any layer (regex, base64,
    // JSON, band math) regresses, this single test catches it. We pin
    // `nowSec` to ~14 days before exp so the result lands inside any
    // sensible band the project might pick (default 300-380).
    const dist = `/*! gps-plus-slam-js | (c) 2026 cs-util-com | UNLICENSED — see EULA.md */
const e=\`${REAL_TOKEN}\`;export{e as COMMUNITY_LICENSE_KEY};`;
    const token = extractTokenLiteral(dist);
    expect(token).toBe(REAL_TOKEN);
    const payload = decodeJwtPayload(token);
    const nowSec = REAL_EXP_SEC - 355 * 86_400;
    const result = evaluateLifetime(payload, {
      nowSec,
      minDays: DEFAULT_MIN_DAYS,
      maxDays: DEFAULT_MAX_DAYS,
    });
    expect(result.ok).toBe(true);
    expect(result.remainingDays).toBeCloseTo(355, 6);
  });
});

describe('property-based: evaluateLifetime band invariants', () => {
  // Why: these properties pin the discriminated-result invariant
  // (exactly one of ok / too-short / too-long / invalid-exp) across
  // arbitrary inputs, so future refactors of the comparison logic
  // cannot silently introduce a "double-yes" or "double-no" state.

  it('classifies every finite-exp input as exactly one of ok / too-short / too-long', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: 0, max: 4_000_000_000 }),
        (minDays, band, expDelta, nowSec) => {
          const maxDays = minDays + band;
          const exp = nowSec + expDelta * 86_400;
          const r = evaluateLifetime({ exp }, { nowSec, minDays, maxDays });
          const remaining = (exp - nowSec) / 86_400;
          if (remaining < minDays) {
            expect(r).toEqual(
              expect.objectContaining({ ok: false, reason: 'too-short' })
            );
          } else if (remaining > maxDays) {
            expect(r).toEqual(
              expect.objectContaining({ ok: false, reason: 'too-long' })
            );
          } else {
            expect(r.ok).toBe(true);
          }
        }
      )
    );
  });

  it('rejects any non-finite-number exp as invalid-exp', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.string(),
          fc.boolean(),
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NEGATIVE_INFINITY)
        ),
        (badExp) => {
          const r = evaluateLifetime(
            { exp: badExp },
            { nowSec: 0, minDays: 1, maxDays: 2 }
          );
          expect(r).toEqual({ ok: false, reason: 'invalid-exp', exp: badExp });
        }
      )
    );
  });
});
