/**
 * Thin wrapper around a ready `HTMLAudioElement`, spatialized (view layer).
 *
 * The component is fed an already-constructed audio element (the factory takes
 * ready resources, mirroring how component 8 will hand a Blob URL from the
 * asset-provider). This wrapper exposes the few imperative calls the
 * reconciler needs — play / pause / seek — and forwards the element's
 * `timeupdate` / `ended` events back out as plain callbacks so the pure
 * transport reducer stays the single source of truth.
 *
 * It also owns spatialization: the element's output is routed through a
 * `THREE.PositionalAudio` panner (`setMediaElementSource`) built from the shared
 * `AudioListener`. The billboard adds `spatialNode` to its group, so playback is
 * attenuated + HRTF-panned from the billboard's world position. The element
 * still owns transport (play/pause/seek/tick/ended); only the output path is
 * spatial — component 8 reuses this seam for world-anchored knight markers.
 *
 * Not unit-tested (it is glue over a DOM media element + WebAudio node); the
 * logic it drives lives in playback-transport.ts.
 */
import { PositionalAudio, type AudioListener } from 'three';

// Spatialization tuning (metres). Billboards sit ~2.6 m apart and the camera
// orbits ~6 m out, so a 1 m reference distance with a moderate rolloff gives a
// clear near/far loudness change and left/right pan without going inaudible.
const REF_DISTANCE_M = 1;
const ROLLOFF_FACTOR = 1.5;
const MAX_DISTANCE_M = 40;

export interface AudioPlayer {
  play(): void;
  pause(): void;
  /** Seek to an absolute time in seconds (clamped to the known duration). */
  seekToSeconds(seconds: number): void;
  readonly currentTime: number;
  readonly paused: boolean;
  /**
   * The spatialized audio node. Add it to the billboard's group so playback is
   * panned/attenuated from the billboard's world position.
   */
  readonly spatialNode: PositionalAudio;
  dispose(): void;
}

function knownDuration(element: HTMLAudioElement): number {
  return Number.isFinite(element.duration) ? element.duration : 0;
}

export function createAudioPlayer(
  element: HTMLAudioElement,
  listener: AudioListener,
  callbacks: {
    readonly onTick: (positionSec: number, durationSec: number) => void;
    readonly onEnded: () => void;
  }
): AudioPlayer {
  const handleTime = (): void => {
    callbacks.onTick(element.currentTime, knownDuration(element));
  };
  const handleEnded = (): void => {
    callbacks.onEnded();
  };

  element.addEventListener('timeupdate', handleTime);
  element.addEventListener('loadedmetadata', handleTime);
  element.addEventListener('ended', handleEnded);

  // Route the element through a positional panner. `setMediaElementSource`
  // hands playback control to the element (we never call `spatialNode.play()`);
  // the panner tracks the node's world position each frame via the scene graph.
  const spatialNode = new PositionalAudio(listener);
  spatialNode.setMediaElementSource(element);
  spatialNode.setDistanceModel('inverse');
  spatialNode.setRefDistance(REF_DISTANCE_M);
  spatialNode.setRolloffFactor(ROLLOFF_FACTOR);
  spatialNode.setMaxDistance(MAX_DISTANCE_M);

  return {
    spatialNode,
    play(): void {
      // A media-element source is silent while the context is suspended; the
      // click that triggers play is the gesture that lets us resume it.
      const { context } = listener;
      if (context.state === 'suspended') {
        void context.resume();
      }
      // Triggered from a click, so the autoplay policy is satisfied; a stray
      // rejection (e.g. element torn down mid-play) is benign here.
      void element.play().catch(() => undefined);
    },
    pause(): void {
      element.pause();
    },
    seekToSeconds(seconds: number): void {
      const duration = knownDuration(element);
      const upper = duration > 0 ? duration : seconds;
      element.currentTime = Math.max(0, Math.min(seconds, upper));
    },
    get currentTime(): number {
      return element.currentTime;
    },
    get paused(): boolean {
      return element.paused;
    },
    dispose(): void {
      element.removeEventListener('timeupdate', handleTime);
      element.removeEventListener('loadedmetadata', handleTime);
      element.removeEventListener('ended', handleEnded);
      spatialNode.disconnect();
      spatialNode.removeFromParent();
      element.pause();
      element.removeAttribute('src');
      element.load();
    },
  };
}
