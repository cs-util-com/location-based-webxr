/**
 * A video's poster: its frame just after the start, as a JPEG, read once
 * when the video is brought into the tour (`readTourFile`'s `posterOf`);
 * a recorded clip's unknown length is read first.
 * The browser's own decoder reads it; a video it refuses, one that does
 * not load within the time allowed, or one with no picture gives none.
 *
 * @see video-poster.ts.md
 */

/** The parts of a video element the poster is read through. */
export interface PosterVideo {
  muted: boolean;
  preload: string;
  playsInline: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly duration: number;
  currentTime: number;
  set src(url: string);
  addEventListener(type: string, listener: () => void): void;
  removeAttribute(name: string): void;
  load(): void;
}

export interface VideoPosterOptions {
  readonly createVideo?: () => PosterVideo;
  /** The frame now showing in `video`, drawn at `width` x `height`. */
  readonly draw?: (
    video: PosterVideo,
    width: number,
    height: number,
  ) => Promise<Blob | null>;
  readonly objectUrl?: {
    create(blob: Blob): string;
    revoke(url: string): void;
  };
  readonly timeoutMs?: number;
  /** How long a recorded clip's unknown length (Infinity) is waited for
   *  before its first frame is taken instead. */
  readonly lengthTimeoutMs?: number;
}

/** The poster's longest side at most: a picture for a card, not a copy. */
const POSTER_MAX_SIDE = 1920;
/** Where the frame is taken: a first frame is often black. */
const POSTER_AT_S = 0.1;
const POSTER_TIMEOUT_MS = 10_000;
const LENGTH_TIMEOUT_MS = 2_000;
/** A seek far past any clip's end: the browser reads a recorded clip's
 *  length to clamp it, and says so in "durationchange". */
const FAR_PAST_THE_END_S = 1e9;

function drawOnCanvas(
  video: PosterVideo,
  width: number,
  height: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return Promise.resolve(null);
  context.drawImage(video as unknown as HTMLVideoElement, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.85);
  });
}

/** `blob`'s poster, or null when none could be read. Never rejects. */
export async function videoPosterOf(
  blob: Blob,
  options: VideoPosterOptions = {},
): Promise<Blob | null> {
  const urls = options.objectUrl ?? {
    create: (b: Blob) => URL.createObjectURL(b),
    revoke: (u: string) => {
      URL.revokeObjectURL(u);
    },
  };
  const video: PosterVideo =
    options.createVideo?.() ?? document.createElement("video");
  const url = urls.create(blob);
  try {
    const seeked = await new Promise<boolean>((resolve) => {
      let lengthTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        clearTimeout(lengthTimer);
        resolve(false);
      }, options.timeoutMs ?? POSTER_TIMEOUT_MS);
      const done = (ok: boolean): void => {
        clearTimeout(timer);
        clearTimeout(lengthTimer);
        resolve(ok);
      };
      // "length": a recorded clip's length is being read; "frame": the
      // seek to the poster's frame is under way.
      let phase: "length" | "frame" | null = null;
      const seekTo = (at: number): void => {
        phase = "frame";
        // At the frame already: no "seeked" will come.
        if (video.currentTime === at) done(true);
        else video.currentTime = at;
      };
      const lengthKnown = (): boolean =>
        Number.isFinite(video.duration) && video.duration > 0;
      video.addEventListener("error", () => {
        done(false);
      });
      video.addEventListener("seeked", () => {
        if (phase === "frame") done(true);
        else if (phase === "length" && lengthKnown()) atFrame();
      });
      const atFrame = (): void => {
        clearTimeout(lengthTimer);
        seekTo(Math.min(POSTER_AT_S, video.duration / 2));
      };
      // A recorded clip's length (Infinity, MediaRecorder) is read by a
      // seek far past its end, then the frame just after the start is
      // taken; a length that never comes leaves the first frame.
      video.addEventListener("durationchange", () => {
        if (phase === "length" && lengthKnown()) atFrame();
      });
      // A length the browser does not know at all (0, NaN) leaves only the
      // start to seek to, and a seek to where the video already is fires
      // no "seeked": its first frame is drawn once it is loaded instead.
      let atStart = false;
      video.addEventListener("loadedmetadata", () => {
        const length = video.duration;
        if (length === Number.POSITIVE_INFINITY) {
          phase = "length";
          const wait = options.lengthTimeoutMs ?? LENGTH_TIMEOUT_MS;
          // No length: back to the start, and the frame showing is taken
          // once as long again has passed, whether or not that seek
          // answers (a clip may take the far seek and then go quiet).
          lengthTimer = setTimeout(() => {
            // Set before the seek: a seek that answers at once clears it.
            lengthTimer = setTimeout(() => {
              done(true);
            }, wait);
            seekTo(0);
          }, wait);
          video.currentTime = FAR_PAST_THE_END_S;
          return;
        }
        if (!(Number.isFinite(length) && length > 0)) {
          atStart = true;
          return;
        }
        seekTo(Math.min(POSTER_AT_S, length / 2));
      });
      video.addEventListener("loadeddata", () => {
        if (atStart) done(true);
      });
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = url;
    });
    const { videoWidth: w, videoHeight: h } = video;
    if (!seeked || !(w > 0 && h > 0)) return null;
    const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(w, h));
    const draw = options.draw ?? drawOnCanvas;
    return await draw(
      video,
      Math.max(1, Math.round(w * scale)),
      Math.max(1, Math.round(h * scale)),
    );
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    urls.revoke(url);
  }
}
