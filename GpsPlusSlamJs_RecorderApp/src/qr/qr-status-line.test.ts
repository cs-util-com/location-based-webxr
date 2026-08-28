import { describe, it, expect } from 'vitest';
import { createQrSightingAccumulator } from 'gps-plus-slam-app-framework/ar/qr/qr-sighting-accumulator';
import { qrStatusLine } from './qr-status-line';
import type { Matrix4 } from 'gps-plus-slam-app-framework/core';

const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const TEXT = 'https://gps.csutil.com/?qr=tour';

function accumulatorWith(visits: number, sizeM = 0.16) {
  const acc = createQrSightingAccumulator();
  for (let visit = 0; visit < visits; visit += 1) {
    for (let i = 0; i < 5; i += 1) {
      acc.observe({
        text: TEXT,
        timestamp: visit * 60_000 + i * 125,
        odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        sizeM,
        alignmentMatrix: IDENTITY,
        zero: { lat: 48, lon: 11 },
        alignmentSampleCount: 5,
      });
    }
  }
  acc.flush();
  return acc;
}

describe('qrStatusLine', () => {
  it('shows no row at all when QR detection is off', () => {
    // Why this test matters: a row reading "QR: off" on every recording is
    // noise on a HUD that has to stay readable at arm's length outdoors.
    expect(
      qrStatusLine({
        enabled: false,
        latestText: null,
        accumulator: createQrSightingAccumulator(),
      })
    ).toBeNull();
  });

  it('says it is scanning before any code is seen', () => {
    // Why this test matters: this is the state the recorder used to show
    // NOTHING for. A session where the detector never fired looked exactly
    // like one where it did, and that was only discovered at analysis time.
    const line = qrStatusLine({
      enabled: true,
      latestText: null,
      accumulator: createQrSightingAccumulator(),
    });
    expect(line).toMatch(/scanning/i);
    expect(line).toMatch(/no code seen/i);
  });

  it('counts the visit in progress, without ending it', () => {
    // The burst being looked at right now is not closed yet. It must still be
    // counted - "0 visits" while staring at a code reads as a failure - but
    // counted by ASKING the accumulator, not by adding one and hoping. The
    // earlier "+1" was one too high after every crash-safety sync and after
    // every mint, which is the number an author uses to decide whether they
    // have walked enough loops.
    const acc = createQrSightingAccumulator();
    acc.observe({
      text: TEXT,
      timestamp: 0,
      odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      sizeM: 0.16,
      alignmentMatrix: IDENTITY,
      zero: { lat: 48, lon: 11 },
      alignmentSampleCount: 5,
    });
    expect(
      qrStatusLine({
        enabled: true,
        latestText: TEXT,
        latestId: 'abcdef123456',
        accumulator: acc,
      })
    ).toMatch(/visit 1/);

    // ...and after it closes, it is still ONE visit, not two.
    acc.flush();
    expect(
      qrStatusLine({
        enabled: true,
        latestText: TEXT,
        latestId: 'abcdef123456',
        accumulator: acc,
      })
    ).toMatch(/visit 1/);
  });

  it('reports the size the author checks against a tape measure', () => {
    const line = qrStatusLine({
      enabled: true,
      latestText: TEXT,
      latestId: 'abcdef123456',
      accumulator: accumulatorWith(1, 0.163),
    });
    expect(line).toMatch(/16\.3 cm/);
    expect(line).toMatch(/visit 1/); // one closed, none in progress
    // M-B asks for the size WITH its spread — the tape-measure check needs to
    // know how settled the estimate is, not just what it currently says.
    expect(line).toMatch(/±/);
  });

  it('reports the turn between visits only once there are visits to compare', () => {
    const one = qrStatusLine({
      enabled: true,
      latestText: TEXT,
      latestId: 'abcdef123456',
      accumulator: accumulatorWith(1),
    });
    expect(one).not.toMatch(/turn/);

    const several = qrStatusLine({
      enabled: true,
      latestText: TEXT,
      latestId: 'abcdef123456',
      accumulator: accumulatorWith(3),
    });
    // "between visits" - the CROSS-sighting statistic the fixedness gate
    // uses, not the last burst's own inlier-based spread, which would hide a
    // re-hung poster while sitting next to the word "turn".
    expect(several).toMatch(/turned .* between visits/);
  });

  it('warns in plain words when tracking restarted mid-session', () => {
    // Why this test matters: sightings either side of a tracking restart are
    // in different odometry frames and cannot be compared. Saying so on the
    // HUD lets the author restart the recording instead of finishing a walk
    // whose evidence will be declined.
    const acc = accumulatorWith(1);
    acc.noteFrameChange();
    acc.observe({
      text: TEXT,
      timestamp: 500_000,
      odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      sizeM: 0.16,
      alignmentMatrix: IDENTITY,
      zero: { lat: 48, lon: 11 },
      alignmentSampleCount: 5,
    });
    acc.flush();

    expect(
      qrStatusLine({
        enabled: true,
        latestText: TEXT,
        latestId: 'abcdef123456',
        accumulator: acc,
      })
    ).toMatch(/tracking restarted/i);
  });

  it('falls back to a neutral label when the id is not resolved yet', () => {
    // Deriving the id is async; the line must not print "undefined".
    const line = qrStatusLine({
      enabled: true,
      latestText: TEXT,
      latestId: null,
      accumulator: accumulatorWith(1),
    });
    expect(line).not.toMatch(/undefined|null/);
  });
});

// Added after the M-B…M-G review (finding 9): the level-lookup state existed
// but never reached the HUD, so a session using levels was silent for exactly
// the codes it could not use — the failure this row was added to end.
describe('qrStatusLine — what the level lookup did', () => {
  it('says nothing extra when the session is not using levels', () => {
    const line = qrStatusLine({
      enabled: true,
      latestText: TEXT,
      latestId: 'abcdef123456',
      accumulator: accumulatorWith(1),
    });
    expect(line).not.toMatch(/saved position|could not reach/);
  });

  it.each([
    ['level', /using its saved position/],
    ['absent', /no saved position/],
    ['not-ours', /not one of your codes/],
    ['failed', /could not reach/],
  ] as const)('reports the %s state in plain words', (kind, pattern) => {
    const line = qrStatusLine({
      enabled: true,
      latestText: TEXT,
      latestId: 'abcdef123456',
      accumulator: accumulatorWith(1),
      levelState: { kind } as never,
    });
    expect(line).toMatch(pattern);
  });
});
