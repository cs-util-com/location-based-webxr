/**
 * The page camera on one video element: one start in flight at a time, a
 * stop that a start still waiting for its stream learns about, and a
 * stream that never outlives a stop. Shared by both views of the feature
 * matching page.
 *
 * @see camera-control.ts.md
 */

/** What a camera start came to: running, refused, or stopped meanwhile. */
type CameraStart = "on" | "failed" | "stopped";

export interface CameraDeps {
  readonly getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  readonly log: (line: string) => void;
  readonly fail: (where: string, e: unknown) => void;
  /** The stream went on (true) or off (false). */
  readonly changed: (on: boolean) => void;
}

export interface CameraControl {
  /** Starts the camera once; "on" when it is running. Never rejects. */
  readonly start: () => Promise<CameraStart>;
  /** Stops the camera; a start still pending stops its own stream. */
  readonly stop: () => void;
  readonly on: () => boolean;
}

const CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
  audio: false,
};

const stopTracks = (s: MediaStream): void => {
  for (const t of s.getTracks()) {
    t.stop();
  }
};

export function createCameraControl(
  video: HTMLVideoElement,
  deps: CameraDeps,
): CameraControl {
  let stream: MediaStream | null = null;
  /** The start in flight, so a second tap does not open a second stream. */
  let starting: Promise<CameraStart> | null = null;
  /** Raised by every stop, so a start still pending learns it was stopped. */
  let generation = 0;

  const stop = (): void => {
    generation++;
    if (!stream) {
      return;
    }
    stopTracks(stream);
    stream = null;
    video.srcObject = null;
    deps.log("camera off");
    deps.changed(false);
  };

  const open = async (): Promise<CameraStart> => {
    const mine = generation;
    const stoppedMeanwhile = () => mine !== generation;
    try {
      const s = await deps.getUserMedia(CONSTRAINTS);
      if (stoppedMeanwhile()) {
        stopTracks(s);
        return "stopped";
      }
      stream = s;
      video.srcObject = s;
      deps.changed(true);
      await video.play();
      if (stoppedMeanwhile()) {
        return "stopped";
      }
      deps.log("camera on");
      return "on";
    } catch (e) {
      if (stoppedMeanwhile()) {
        return "stopped";
      }
      deps.fail("camera", e);
      stop();
      return "failed";
    }
  };

  const start = (): Promise<CameraStart> => {
    if (stream) {
      return Promise.resolve("on");
    }
    // Forgotten once settled. The callback runs in a later microtask, after
    // the assignment, so a start that fails before awaiting anything (no
    // camera API at all) is forgotten too and the next tap tries again.
    starting ??= open().finally(() => {
      starting = null;
    });
    return starting;
  };

  return { start, stop, on: () => stream !== null };
}
