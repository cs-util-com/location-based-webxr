import { describe, it, expect } from 'vitest';
import { qrAnchorSummaryLines } from './qr-anchor-summary';
import type { QrAnchorOutcome } from './qr-level-zip-contributor';

function outcome(overrides: Partial<QrAnchorOutcome> = {}): QrAnchorOutcome {
  return {
    text: 'https://gps.csutil.com/?qr=tour',
    id: 'abcdef123456',
    written: true,
    detail: 'Placed from 3 visits.',
    sightingCount: 3,
    rotationSpreadDeg: 2.4,
    sizeM: 0.163,
    lat: 48.0,
    lon: 11.0,
    unweightedLat: 48.0,
    unweightedLon: 11.0,
    ...overrides,
  };
}

describe('qrAnchorSummaryLines', () => {
  it('hides the block entirely when no code was seen', () => {
    // Rather than a row saying nothing on a screen the author skims.
    expect(qrAnchorSummaryLines([])).toBeNull();
  });

  it('says a code was placed, with the numbers an author can act on', () => {
    const line = qrAnchorSummaryLines([outcome()]);
    expect(line).toMatch(/✓/);
    expect(line).toMatch(/3 visits/);
    expect(line).toMatch(/16\.3 cm/); // the tape-measure check
    expect(line).toMatch(/2\.4°/);
  });

  it('says OUT LOUD when a code was refused, and why', () => {
    // Why this test matters: in the zip, a declined code and a code that was
    // never seen look identical - no file. If the refusal is not said here,
    // the only feedback for "your poster moved" is silence, and the author
    // uploads a zip that cannot relocalize anything.
    const line = qrAnchorSummaryLines([
      outcome({
        written: false,
        detail:
          'This code turned by 31.2° between sightings, so it was probably moved.',
      }),
    ]);
    expect(line).toMatch(/✗/);
    expect(line).toMatch(/probably moved/);
  });

  it('names a foreign code as foreign rather than by an empty id', () => {
    const line = qrAnchorSummaryLines([
      outcome({
        id: '',
        written: false,
        detail: 'Not one of our printed codes.',
      }),
    ]);
    expect(line).toMatch(/Foreign code/);
    expect(line).not.toMatch(/Code {2}/);
  });

  it('mentions the recency weighting only when it actually moved the answer', () => {
    // The half-life is a guess until the field probe measures it. Saying when
    // it changed something is what makes the guess checkable on the phone.
    expect(qrAnchorSummaryLines([outcome()])).not.toMatch(/weighting/);
    const moved = qrAnchorSummaryLines([
      outcome({ unweightedLat: 48.0002 }), // ~22 m away
    ]);
    expect(moved).toMatch(/weighting moved it/);
  });

  it('handles a singular visit without saying "1 visits"', () => {
    expect(qrAnchorSummaryLines([outcome({ sightingCount: 1 })])).toMatch(
      /1 visit\b/
    );
  });

  it('never prints undefined for a partially-filled outcome', () => {
    const line = qrAnchorSummaryLines([
      {
        text: 'x',
        id: 'aaa',
        written: true,
        detail: '',
        sightingCount: 2,
      },
    ]);
    expect(line).not.toMatch(/undefined|NaN/);
  });

  // Why this test matters (owner decision D31): a code saved through an
  // alignment with under 10 m of GPS walk behind it is written, but its
  // heading is close to guesswork (13.8 degrees p50, 88 p90 on the extent
  // sweep). The summary is the only place the author learns that while
  // still on site, where walking a bit further and saving again fixes it.
  it('tells the author when a written code has an uncertain heading', () => {
    const line = qrAnchorSummaryLines([outcome({ headingUncertain: true })]);
    expect(line).toMatch(/✓/);
    expect(line).toMatch(
      /Heading uncertain: walk a bit further before saving for a reliable direction\./
    );
  });

  it('says nothing about the heading when it is not marked uncertain', () => {
    // Absent means unknown (an older mint) and false means checked: neither
    // is a reason to worry the author.
    expect(qrAnchorSummaryLines([outcome()])).not.toMatch(/Heading/);
    expect(
      qrAnchorSummaryLines([outcome({ headingUncertain: false })])
    ).not.toMatch(/Heading/);
  });

  it('never adds the heading note to a refused code', () => {
    // A refused code wrote no file, so there is no heading to doubt.
    const line = qrAnchorSummaryLines([
      outcome({ written: false, detail: 'Refused.', headingUncertain: true }),
    ]);
    expect(line).not.toMatch(/Heading/);
  });
});

// Added after an e2e caught it: the panel is drawn from data that crosses a
// module boundary, and a caller predating the field passed nothing at all.
describe('qrAnchorSummaryLines — a missing list', () => {
  it('is treated exactly like an empty one, not a crash', () => {
    expect(qrAnchorSummaryLines(undefined)).toBeNull();
  });
});
