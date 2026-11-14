/**
 * A free video's preview in the inspector (`video-panel.ts`): the clip
 * itself, its poster before it plays, its length and its file size, Play
 * and Pause, a scrub bar, and "Use current frame", which makes the frame
 * shown the video's poster. The clip is read from the tour by its path;
 * one that cannot be read says so. Made once per clip and kept across the
 * dock's draws (`KindPanelDraw.kept`), so playing and scrubbing survive
 * them; its buttons answer here, never through the shell's `data-act`.
 *
 * @see video-preview.ts.md
 */
import { clockText } from "../../read-along.js";
import { formatBytes } from "../asset-shelf/shelf-panel-model.js";
import { FAR_PAST_THE_END_S } from "../video-poster.js";

export interface VideoPreviewDeps {
  /** A tour file by its path. */
  readonly load: (path: string) => Promise<Blob>;
  /** Makes `image` the video's poster: true once written; false when the
   *  page refused it (and said why). */
  readonly usePoster: (image: Blob) => Promise<boolean>;
  /** The frame `video` shows now, as a JPEG; null when none can be taken.
   *  Default: drawn through a canvas. */
  readonly grab?: (video: HTMLVideoElement) => Promise<Blob | null>;
  readonly objectUrl?: {
    create(blob: Blob): string;
    revoke(url: string): void;
  };
}

export interface VideoPreview {
  readonly root: HTMLElement;
  /** Stops the clip and lets its files go. */
  dispose(): void;
}

const FRAME_WORDS = "Use current frame";
const FRAME_BUSY = "Saving the poster...";
/** The JPEG quality a grabbed frame is kept at. */
const FRAME_QUALITY = 0.85;

/** The frame `video` shows, drawn at its own size into a JPEG. */
function canvasGrab(video: HTMLVideoElement): Promise<Blob | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w <= 0 || h <= 0) return Promise.resolve(null);
  const canvas = video.ownerDocument.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return Promise.resolve(null);
  try {
    ctx.drawImage(video, 0, 0, w, h);
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", FRAME_QUALITY);
  });
}

/** The preview of the clip at `clipPath`, its poster at `posterPath`. */
export function videoPreview(
  doc: Document,
  clipPath: string,
  posterPath: string | null,
  deps: VideoPreviewDeps,
): VideoPreview {
  const urls = deps.objectUrl ?? {
    create: (blob: Blob) => URL.createObjectURL(blob),
    revoke: (url: string) => {
      URL.revokeObjectURL(url);
    },
  };
  const grab = deps.grab ?? canvasGrab;
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    parent?: HTMLElement,
  ): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag);
    el.className = className;
    parent?.append(el);
    return el;
  };
  const root = make("div", "isec vprev");
  root.dataset["testid"] = "video-preview";
  const video = make("video", "vprev-clip", root);
  video.playsInline = true;
  video.preload = "metadata";
  video.setAttribute("aria-label", "The clip");
  // The prototype's asset row: the clip as a thumbnail, its facts and
  // controls beside it.
  const meta = make("div", "vprev-meta", root);
  const facts = make("div", "note vprev-facts", meta);
  facts.textContent = "Loading the clip...";
  const row = make("div", "vprev-row", meta);
  const play = make("button", "chip vprev-play", row);
  play.type = "button";
  play.textContent = "Play";
  const scrub = make("input", "vprev-scrub", row);
  scrub.type = "range";
  scrub.min = "0";
  scrub.max = "0";
  scrub.step = "0.05";
  scrub.value = "0";
  scrub.setAttribute("aria-label", "Position in the clip");
  const frame = make("button", "chip vprev-frame", meta);
  frame.type = "button";
  frame.textContent = FRAME_WORDS;
  frame.disabled = true;
  const note = make("div", "note vprev-note", meta);
  note.setAttribute("aria-live", "polite");

  const made: string[] = [];
  let gone = false;
  let bytes: number | null = null;
  /** As the clip last said (`play` / `pause`). */
  let playing = false;
  /** True once the browser said it cannot play the clip: final. */
  let unplayable = false;
  const url = (blob: Blob) => {
    const u = urls.create(blob);
    made.push(u);
    return u;
  };
  const showFacts = () => {
    const length = video.duration;
    if (unplayable) return;
    if (!Number.isFinite(length) || length <= 0 || bytes === null) return;
    facts.textContent = `${clockText(length * 1000)} · ${formatBytes(bytes)}`;
  };

  deps.load(clipPath).then(
    (blob) => {
      if (gone) return;
      bytes = blob.size;
      video.src = url(blob);
      showFacts();
    },
    () => {
      if (!gone) facts.textContent = "The clip could not be read.";
    },
  );
  if (posterPath !== null) {
    deps.load(posterPath).then(
      (blob) => {
        if (!gone) video.poster = url(blob);
      },
      () => {
        // No poster: the clip's first frame shows instead.
      },
    );
  }

  /** True while the far seek reads a recorded clip's length. */
  let readingLength = false;
  const lengthKnown = () => {
    if (unplayable) return false;
    const length = video.duration;
    if (!Number.isFinite(length) || length <= 0) return false;
    scrub.max = String(length);
    frame.disabled = false;
    showFacts();
    return true;
  };
  video.addEventListener("loadedmetadata", () => {
    if (lengthKnown() || video.duration !== Number.POSITIVE_INFINITY) return;
    // A clip recorded in a browser states no length: a seek far past its
    // end makes the browser read it ("durationchange"); then back to 0.
    readingLength = true;
    video.currentTime = FAR_PAST_THE_END_S;
  });
  video.addEventListener("durationchange", () => {
    if (!readingLength || !lengthKnown()) return;
    readingLength = false;
    video.currentTime = 0;
  });
  // Read but not playable here (a codec this browser lacks, a broken
  // file): the media error is the only word the browser gives, so it is
  // the preview's final state, with nothing left to press.
  video.addEventListener("error", () => {
    if (gone) return;
    unplayable = true;
    readingLength = false;
    facts.textContent = "This clip cannot be played here.";
    play.disabled = true;
    scrub.disabled = true;
    frame.disabled = true;
  });
  video.addEventListener("timeupdate", () => {
    scrub.value = String(video.currentTime);
  });
  video.addEventListener("play", () => {
    playing = true;
    play.textContent = "Pause";
  });
  video.addEventListener("pause", () => {
    playing = false;
    play.textContent = "Play";
  });
  play.addEventListener("click", () => {
    if (!playing) {
      video.play().catch(() => {
        play.textContent = "Play";
      });
    } else {
      video.pause();
    }
  });
  scrub.addEventListener("input", () => {
    const at = Number(scrub.value);
    if (Number.isFinite(at)) video.currentTime = at;
  });
  frame.addEventListener("click", () => {
    frame.disabled = true;
    frame.textContent = FRAME_BUSY;
    note.textContent = "";
    void (async () => {
      const image = await grab(video).catch(() => null);
      const written =
        image === null ? null : await deps.usePoster(image).catch(() => false);
      if (gone) return;
      frame.disabled = unplayable;
      frame.textContent = FRAME_WORDS;
      if (image === null) note.textContent = "No frame could be taken here.";
      else if (written === true)
        note.textContent = "This frame is the poster now.";
    })();
  });

  return {
    root,
    dispose() {
      gone = true;
      if (playing) video.pause();
      video.removeAttribute("src");
      video.removeAttribute("poster");
      for (const u of made) urls.revoke(u);
      made.length = 0;
    },
  };
}
