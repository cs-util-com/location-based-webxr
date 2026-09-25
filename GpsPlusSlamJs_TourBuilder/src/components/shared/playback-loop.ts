/**
 * A `requestAnimationFrame`-driven "replay a recorded index sequence at N
 * samples/sec, with play/pause/seek" loop — shared by every demo that
 * replays a precomputed walk (proximity's canvas demo, the map's Leaflet
 * demo) so the timing logic is defined once (jscpd) instead of copy-pasted
 * per demo page.
 *
 * Pure timing/index bookkeeping — no DOM. `now`/`raf` are injectable so the
 * loop is unit-testable without a real animation frame.
 */

export interface PlaybackLoopOptions {
  /** Number of indices in the sequence (valid range: `0..length-1`). */
  readonly length: number;
  readonly samplesPerSec: number;
  /** Called with the new index every time playback (or a seek) advances it. */
  readonly onSeek: (index: number) => void;
  /** Called whenever play/pause state changes (including auto-stop at the end). */
  readonly onPlayStateChange?: (playing: boolean) => void;
  /** Injectable clock, defaults to `performance.now`. */
  readonly now?: () => number;
  /** Injectable scheduler, defaults to `requestAnimationFrame`. */
  readonly raf?: (callback: (time: number) => void) => void;
}

export interface PlaybackLoop {
  play(): void;
  stop(): void;
  toggle(): void;
  /** Stop, jump to `index`, and fire `onSeek(index)` once. */
  seekTo(index: number): void;
  isPlaying(): boolean;
}

export function createPlaybackLoop(options: PlaybackLoopOptions): PlaybackLoop {
  const now = options.now ?? (() => performance.now());
  const raf =
    options.raf ?? ((cb: (time: number) => void) => requestAnimationFrame(cb));

  let current = 0;
  let playing = false;
  let lastT = 0;

  function stop(): void {
    if (!playing) return;
    playing = false;
    options.onPlayStateChange?.(false);
  }

  function tick(t: number): void {
    if (!playing) return;
    if (t - lastT >= 1000 / options.samplesPerSec) {
      lastT = t;
      if (current < options.length - 1) {
        current++;
        options.onSeek(current);
      } else {
        stop();
        return;
      }
    }
    raf(tick);
  }

  function play(): void {
    if (current >= options.length - 1) current = 0;
    playing = true;
    options.onPlayStateChange?.(true);
    lastT = now();
    raf(tick);
  }

  return {
    play,
    stop,
    toggle(): void {
      if (playing) stop();
      else play();
    },
    seekTo(index: number): void {
      stop();
      current = index;
      options.onSeek(current);
    },
    isPlaying: () => playing,
  };
}
