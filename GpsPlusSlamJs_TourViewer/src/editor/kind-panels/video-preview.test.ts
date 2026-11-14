// @vitest-environment jsdom
/**
 * Why these tests matter: the creator picks a video's poster by pausing
 * on a frame in the inspector, so the preview must show the clip with its
 * length and size, play, pause and scrub it, and "Use current frame" must
 * hand exactly the grabbed picture to the edit - showing that it works
 * while it does, and putting the button back whether the edit was written
 * or refused. A clip that cannot be read says so instead of a dead player,
 * and a disposed preview lets its object URLs go.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { videoPreview, type VideoPreviewDeps } from "./video-preview.js";

const CLIP = new Blob([new Uint8Array(2_500_000)]);
const FRAME = new Blob(["jpeg"]);

function deps(over: Partial<VideoPreviewDeps> = {}) {
  const made: string[] = [];
  const revoked: string[] = [];
  const d = {
    load: vi.fn((path: string) =>
      /\.(mp4|webm)$/.test(path)
        ? Promise.resolve(CLIP)
        : Promise.resolve(FRAME),
    ),
    usePoster: vi.fn((_image: Blob) => Promise.resolve(true)),
    grab: vi.fn(() => Promise.resolve<Blob | null>(FRAME)),
    objectUrl: {
      create: (_b: Blob) => {
        const url = `blob:${String(made.length)}`;
        made.push(url);
        return url;
      },
      revoke: (url: string) => {
        revoked.push(url);
      },
    },
    ...over,
  };
  return { d, made, revoked };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function parts(root: HTMLElement) {
  const q = <T extends Element>(s: string) => root.querySelector<T>(s);
  return {
    video: q<HTMLVideoElement>("video") as HTMLVideoElement,
    facts: q<HTMLElement>(".vprev-facts") as HTMLElement,
    play: q<HTMLButtonElement>(".vprev-play") as HTMLButtonElement,
    scrub: q<HTMLInputElement>(".vprev-scrub") as HTMLInputElement,
    frame: q<HTMLButtonElement>(".vprev-frame") as HTMLButtonElement,
    note: q<HTMLElement>(".vprev-note") as HTMLElement,
  };
}

/** The clip's length known, as the browser says it at `loadedmetadata`. */
function metadata(video: HTMLVideoElement, durationS: number): void {
  Object.defineProperty(video, "duration", {
    configurable: true,
    value: durationS,
  });
  video.dispatchEvent(new Event("loadedmetadata"));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the inspector's video preview", () => {
  it("shows the clip with its poster, its length and its size", async () => {
    const { d } = deps();
    const p = videoPreview(document, "content/v.mp4", "content/p.jpg", d);
    const el = parts(p.root);
    expect(el.facts.textContent).toBe("Loading the clip...");
    expect(el.frame.disabled).toBe(true);
    await settle();
    expect(el.video.getAttribute("src")).toBe("blob:0");
    expect(el.video.getAttribute("poster")).toBe("blob:1");
    metadata(el.video, 42);
    expect(el.facts.textContent).toBe("0:42 · 2.4 MB");
    expect(el.scrub.max).toBe("42");
    expect(el.frame.disabled).toBe(false);
  });

  it("plays, pauses and scrubs the clip", async () => {
    const { d } = deps();
    const p = videoPreview(document, "content/v.mp4", null, d);
    const el = parts(p.root);
    await settle();
    metadata(el.video, 10);
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    Object.assign(el.video, { play, pause });
    expect(el.play.textContent).toBe("Play");
    el.play.click();
    expect(play).toHaveBeenCalledOnce();
    el.video.dispatchEvent(new Event("play"));
    expect(el.play.textContent).toBe("Pause");
    el.play.click();
    expect(pause).toHaveBeenCalledOnce();
    el.video.dispatchEvent(new Event("pause"));
    expect(el.play.textContent).toBe("Play");
    el.scrub.value = "4.5";
    el.scrub.dispatchEvent(new Event("input", { bubbles: true }));
    expect(el.video.currentTime).toBe(4.5);
  });

  // Why: a clip recorded in a browser states no length (Infinity) until
  // the browser is made to read it, so without the far seek its preview
  // would never show a length or offer "Use current frame".
  it("reads a recorded clip's unknown length, then goes back to its start", async () => {
    const { d } = deps();
    const p = videoPreview(document, "content/v.webm", null, d);
    const el = parts(p.root);
    await settle();
    metadata(el.video, Number.POSITIVE_INFINITY);
    expect(el.frame.disabled).toBe(true);
    expect(el.video.currentTime).toBeGreaterThan(1e6);
    Object.defineProperty(el.video, "duration", {
      configurable: true,
      value: 7,
    });
    el.video.dispatchEvent(new Event("durationchange"));
    expect(el.video.currentTime).toBe(0);
    expect(el.scrub.max).toBe("7");
    expect(el.frame.disabled).toBe(false);
    expect(el.facts.textContent).toBe("0:07 · 2.4 MB");
  });

  it("makes the frame shown the poster, busy while it works, back after", async () => {
    let finish: (written: boolean) => void = () => undefined;
    const { d } = deps({
      usePoster: vi.fn(
        () =>
          new Promise<boolean>((r) => {
            finish = r;
          }),
      ),
    });
    const p = videoPreview(document, "content/v.mp4", null, d);
    const el = parts(p.root);
    await settle();
    metadata(el.video, 10);
    el.frame.click();
    expect(el.frame.disabled).toBe(true);
    expect(el.frame.textContent).toBe("Saving the poster...");
    await settle();
    expect(d.grab).toHaveBeenCalledWith(el.video);
    expect(d.usePoster).toHaveBeenCalledWith(FRAME);
    finish(true);
    await settle();
    expect(el.frame.disabled).toBe(false);
    expect(el.frame.textContent).toBe("Use current frame");
    expect(el.note.textContent).toBe("This frame is the poster now.");
  });

  it("puts the button back and says so when no frame could be taken or the edit was refused", async () => {
    const { d } = deps({ grab: vi.fn(() => Promise.resolve(null)) });
    const p = videoPreview(document, "content/v.mp4", null, d);
    const el = parts(p.root);
    await settle();
    metadata(el.video, 10);
    el.frame.click();
    await settle();
    await settle();
    expect(d.usePoster).not.toHaveBeenCalled();
    expect(el.frame.disabled).toBe(false);
    expect(el.note.textContent).toBe("No frame could be taken here.");
    // A refused edit: the page has said why; the button comes back.
    d.grab = vi.fn(() => Promise.resolve<Blob | null>(FRAME));
    const refused = deps({ usePoster: vi.fn(() => Promise.resolve(false)) });
    const q = videoPreview(document, "content/v.mp4", null, refused.d);
    const el2 = parts(q.root);
    await settle();
    metadata(el2.video, 10);
    el2.frame.click();
    await settle();
    await settle();
    expect(el2.frame.disabled).toBe(false);
    expect(el2.note.textContent).toBe("");
  });

  it("says a clip it cannot read, and lets its files go when disposed", async () => {
    const broken = deps({ load: vi.fn(() => Promise.reject(new Error("x"))) });
    const p = videoPreview(document, "content/v.mp4", null, broken.d);
    await settle();
    expect(parts(p.root).facts.textContent).toBe("The clip could not be read.");
    expect(parts(p.root).frame.disabled).toBe(true);
    const { d, made, revoked } = deps();
    const q = videoPreview(document, "content/v.mp4", "content/p.jpg", d);
    await settle();
    q.dispose();
    expect(revoked).toEqual(made);
    expect(made).toHaveLength(2);
  });

  // Why: a clip that was read but cannot be decoded here (a codec this
  // browser lacks, a broken file) fires the media 'error' event and
  // nothing else; without its own final state the preview would say
  // "Loading the clip..." for ever and offer a frame it cannot take.
  it("says a clip it cannot play, and offers no frame of it", async () => {
    const { d } = deps();
    const p = videoPreview(document, "content/v.mp4", null, d);
    const el = parts(p.root);
    await settle();
    el.video.dispatchEvent(new Event("error"));
    expect(el.facts.textContent).toBe("This clip cannot be played here.");
    expect(el.frame.disabled).toBe(true);
    expect(el.play.disabled).toBe(true);
    expect(el.scrub.disabled).toBe(true);
    // Metadata that arrives after the error never offers the frame again.
    metadata(el.video, 12);
    expect(el.frame.disabled).toBe(true);
    expect(el.facts.textContent).toBe("This clip cannot be played here.");
  });

  it("turns the frame button off again when the clip fails after its length was known", async () => {
    const { d } = deps();
    const p = videoPreview(document, "content/v.mp4", null, d);
    const el = parts(p.root);
    await settle();
    metadata(el.video, 12);
    expect(el.frame.disabled).toBe(false);
    el.video.dispatchEvent(new Event("error"));
    expect(el.frame.disabled).toBe(true);
    expect(el.facts.textContent).toBe("This clip cannot be played here.");
  });
});
