import { describe, expect, it } from 'vitest';

import { reconcilePlayer } from './transport-reconcile.js';
import { INITIAL, type TransportState } from './playback-transport.js';

/**
 * Why these tests matter: reconcile is where the model meets the real audio
 * element, and the element feeds its position *back* into the model as ticks.
 * Getting the seek epsilon wrong either makes every ~4 Hz tick re-seek the
 * element (stuttering playback fighting itself) or makes a deliberate bar seek
 * / click restart never reach the element. These cases pin both sides.
 */

const playing = (over: Partial<TransportState> = {}): TransportState => ({
  activeId: 'a',
  status: 'playing',
  positionSec: 5,
  durationSec: 10,
  ...over,
});

describe('reconcilePlayer — inactive billboard', () => {
  it('hides the panel and pauses a still-running element', () => {
    expect(
      reconcilePlayer(playing(), 'b', { currentTime: 3, paused: false })
    ).toEqual({ panelVisible: false, seekToSec: null, playback: 'pause' });
  });

  it('is a full no-op when the element is already paused', () => {
    expect(
      reconcilePlayer(INITIAL, 'a', { currentTime: 3, paused: true })
    ).toEqual({ panelVisible: false, seekToSec: null, playback: null });
  });
});

describe('reconcilePlayer — active billboard', () => {
  it('leaves a playing element alone when it is within the sync epsilon', () => {
    // Normal playback: the element is what produced positionSec via ticks, so
    // it is always within epsilon — no seek, no play/pause churn.
    expect(
      reconcilePlayer(playing(), 'a', { currentTime: 5.1, paused: false })
    ).toEqual({ panelVisible: true, seekToSec: null, playback: null });
  });

  it('seeks the element on a deliberate divergence (click restart)', () => {
    // Click reset the model to 0 while the element still sits at 5.
    const state = playing({ positionSec: 0 });
    expect(
      reconcilePlayer(state, 'a', { currentTime: 5, paused: false })
    ).toEqual({ panelVisible: true, seekToSec: 0, playback: null });
  });

  it('seeks the element on a bar seek while paused, without resuming', () => {
    const state = playing({ status: 'paused', positionSec: 8 });
    expect(
      reconcilePlayer(state, 'a', { currentTime: 2, paused: true })
    ).toEqual({ panelVisible: true, seekToSec: 8, playback: null });
  });

  it('issues play when the model plays but the element is paused', () => {
    expect(
      reconcilePlayer(playing(), 'a', { currentTime: 5, paused: true })
    ).toEqual({ panelVisible: true, seekToSec: null, playback: 'play' });
  });

  it('issues pause when the model paused but the element still plays', () => {
    const state = playing({ status: 'paused' });
    expect(
      reconcilePlayer(state, 'a', { currentTime: 5, paused: false })
    ).toEqual({ panelVisible: true, seekToSec: null, playback: 'pause' });
  });
});
