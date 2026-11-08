/**
 * A video's poster: its frame just after the start, as a JPEG, read once
 * when the video is brought into the tour (`readTourFile`'s `posterOf`).
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
}

/** The poster's longest side at most: a picture for a card, not a copy. */
const POSTER_MAX_SIDE = 1920;
/** Where the frame is taken: a first frame is often black. */
const POSTER_AT_S = 0.1;
const POSTER_TIMEOUT_MS = 10_000;

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
      const timer = setTimeout(() => {
        resolve(false);
      }, options.timeoutMs ?? POSTER_TIMEOUT_MS);
      const done = (ok: boolean): void => {
        clearTimeout(timer);
        resolve(ok);
      };
      video.addEventListener("error", () => {
        done(false);
      });
      video.addEventListener("seeked", () => {
        done(true);
      });
      video.addEventListener("loadedmetadata", () => {
        const half = Number.isFinite(video.duration) ? video.duration / 2 : 0;
        video.currentTime = Math.min(POSTER_AT_S, half);
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
