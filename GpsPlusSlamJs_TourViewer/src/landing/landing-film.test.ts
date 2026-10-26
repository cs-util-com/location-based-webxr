// @vitest-environment jsdom
/**
 * Why these tests matter: the film is mounted on the page every creator
 * opens, on phones that also run AR. Four promises are made to that page
 * and each is pinned here through the film's seams (frames, view, WebGL),
 * with no browser:
 *  - it asks for an animation frame ONLY while it plays: before it is in
 *    view, paused, finished or handed to AR it costs nothing;
 *  - AR gets the GPU: `stop` frees the renderer, is NOT reported as a
 *    fallback, and a new renderer is built the next time the film is in
 *    view (a deliberate release mistaken for a loss would leave every
 *    creator who tried AR with the flat drawing for good);
 *  - without WebGL, after a real context loss, or when the renderer will
 *    not start, it draws the park flat and says why, once;
 *  - with reduced motion it never starts by itself and shows its last
 *    picture with every caption as a list.
 * The page also reads the host's data attributes and one change event to
 * coordinate the cards around the film; those are pinned too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FilmScene } from "./film-scene.js";
import { BEAT_CAPTIONS } from "./film-story.js";
import {
  createLandingFilm,
  DEFAULT_TUNING,
  mountLandingFilm,
  type FilmEnv,
} from "./landing-film.js";

function frameQueue() {
  let next = 1;
  const pending = new Map<number, FrameRequestCallback>();
  let now = 0;
  return {
    requestFrame: vi.fn((cb: FrameRequestCallback) => {
      const id = next++;
      pending.set(id, cb);
      return id;
    }),
    pending: () => pending.size,
    /** Runs the frames that are pending now, `ms` apart. */
    step(ms = 16) {
      now += ms;
      const due = [...pending.entries()];
      pending.clear();
      for (const [, cb] of due) cb(now);
    },
    /** Runs frames until none are pending (or `max`). */
    runOut(max = 20000) {
      let n = 0;
      while (pending.size > 0 && n++ < max) this.step(100);
      return n;
    },
  };
}

function fakeScene(): FilmScene & {
  onLost: () => void;
  release: ReturnType<typeof vi.fn>;
} {
  const s = {
    canvas: document.createElement("canvas"),
    layout: vi.fn(),
    draw: vi.fn(() => true),
    anchors: vi.fn(() => ({
      pin: [50, 100] as const,
      ground: [50, 200] as const,
      next: [60, 260] as const,
    })),
    show: vi.fn(),
    release: vi.fn(),
    bench: vi.fn(() => 1),
    info: vi.fn(() => ({ renderer: "fake", calls: 0, triangles: 0, dpr: 1 })),
    onLost: () => undefined,
  };
  return s;
}

function setup(
  o: { reducedMotion?: boolean; webgl?: boolean; sceneThrows?: boolean } = {},
) {
  const host = document.createElement("div");
  host.innerHTML = '<p class="placeholder">A still of the film</p>';
  document.body.append(host);
  const frames = frameQueue();
  let shareCb: (v: number) => void = () => undefined;
  const scenes: ReturnType<typeof fakeScene>[] = [];
  const env: Partial<FilmEnv> = {
    webgl: () => o.webgl ?? false,
    createScene: (_doc, _parts, _q, _opts, onContextLost) => {
      if (o.sceneThrows) throw new Error("no context");
      const s = fakeScene();
      s.onLost = onContextLost;
      scenes.push(s);
      return s;
    },
    observeView: (_el, cb) => {
      shareCb = cb;
      return () => undefined;
    },
    observeSize: () => () => undefined,
    size: () => ({ w: 400, h: 500 }),
    viewport: () => ({ w: 390, h: 844, dpr: 2 }),
    now: () => 0,
    debug: false,
  };
  let arStop: (() => void) | null = null;
  const unregister = vi.fn();
  const onFallback = vi.fn();
  const film = createLandingFilm(
    host,
    {
      reducedMotion: o.reducedMotion ?? false,
      onArStarting: (stop) => {
        arStop = stop;
        return unregister;
      },
      requestFrame: frames.requestFrame,
      onFallback,
    },
    DEFAULT_TUNING,
    env,
  );
  return {
    host,
    film,
    frames,
    scenes,
    onFallback,
    unregister,
    view: (v: number) => shareCb(v),
    ar: () => arStop?.(),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("landing film: frames", () => {
  it("asks for no frame until enough of it is in view, then plays", () => {
    const t = setup();
    expect(t.frames.requestFrame).not.toHaveBeenCalled();
    t.view(0.25);
    expect(t.frames.requestFrame).not.toHaveBeenCalled();
    t.view(0.6);
    expect(t.frames.pending()).toBe(1);
    t.frames.step();
    t.frames.step();
    expect(t.film.snapshot().status).toBe("playing");
    expect(t.film.snapshot().t).toBeGreaterThan(0);
  });

  it("stops asking once it is paused, out of view, or finished", () => {
    // a cheap renderer, so the whole film runs in a moment
    const t = setup({ webgl: true });
    t.view(0.6);
    t.frames.step();
    t.host.querySelector<HTMLElement>(".lf-stage")!.click();
    expect(t.film.snapshot().pausedBy).toBe("user");
    const asked = t.frames.requestFrame.mock.calls.length;
    t.frames.runOut();
    expect(t.frames.requestFrame.mock.calls.length).toBe(asked);

    t.host.querySelector<HTMLElement>(".lf-stage")!.click();
    t.view(0);
    expect(t.film.snapshot().pausedBy).toBe("view");
    t.frames.runOut();
    expect(t.frames.pending()).toBe(0);

    t.view(0.6);
    t.frames.runOut();
    expect(t.film.snapshot().status).toBe("finished");
    const done = t.frames.requestFrame.mock.calls.length;
    t.view(1);
    t.view(0.6);
    expect(t.frames.requestFrame.mock.calls.length).toBe(done);
  });

  it("plays once: the end is the end until asked again", () => {
    const t = setup({ webgl: true });
    t.view(1);
    t.frames.runOut();
    expect(t.film.snapshot().t).toBeCloseTo(t.film.totalS, 6);
    expect(t.host.querySelector(".lf-play")?.getAttribute("aria-label")).toBe(
      "Play again",
    );
    t.host.querySelector<HTMLButtonElement>(".lf-play")!.click();
    expect(t.film.snapshot().status).toBe("playing");
    expect(t.film.snapshot().t).toBe(0);
  });
});

describe("landing film: reduced motion", () => {
  it("never starts by itself and shows the last picture with every caption", () => {
    const t = setup({ reducedMotion: true });
    t.view(1);
    expect(t.frames.requestFrame).not.toHaveBeenCalled();
    expect(t.film.snapshot()).toMatchObject({
      status: "finished",
      opening: true,
    });
    const list = t.host.querySelector<HTMLOListElement>(".lf-captions")!;
    expect(list.hidden).toBe(false);
    expect(
      [...list.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(BEAT_CAPTIONS);
    expect(t.host.querySelector<HTMLElement>(".lf-caption")!.hidden).toBe(true);
    expect(t.host.querySelector(".lf-play")?.getAttribute("aria-label")).toBe(
      "Play the film",
    );
  });

  it("plays when asked, and the list gives way to the caption", () => {
    const t = setup({ reducedMotion: true });
    t.view(1);
    t.host.querySelector<HTMLButtonElement>(".lf-play")!.click();
    expect(t.film.snapshot().status).toBe("playing");
    expect(t.host.querySelector<HTMLOListElement>(".lf-captions")!.hidden).toBe(
      true,
    );
    expect(t.host.querySelector(".lf-caption")?.textContent).toBe(
      BEAT_CAPTIONS[0],
    );
  });
});

describe("landing film: renderer and fallback", () => {
  it("draws the park flat without WebGL, and says so once", () => {
    const t = setup({ webgl: false });
    expect(t.onFallback.mock.calls).toEqual([["no-webgl"]]);
    t.view(1);
    t.frames.step();
    expect(t.film.renderer()).toBe("floor");
    expect(t.scenes).toHaveLength(0);
    const floor = t.host.querySelector(".lf-floor")!;
    expect(floor.getAttribute("viewBox")).toMatch(
      /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/,
    );
    expect(floor.innerHTML.length).toBeGreaterThan(1000);
    expect(t.host.querySelector(".lf-film")?.classList.contains("lf-3d")).toBe(
      false,
    );
    expect(t.onFallback).toHaveBeenCalledTimes(1);
  });

  it("builds the 3D scene on first view, not at mount", () => {
    const t = setup({ webgl: true });
    expect(t.scenes).toHaveLength(0);
    t.view(0.05);
    expect(t.scenes).toHaveLength(1);
    expect(t.scenes[0]!.layout).toHaveBeenCalled();
    expect(t.host.querySelector(".lf-film")?.classList.contains("lf-3d")).toBe(
      true,
    );
    t.view(0.6);
    t.frames.step();
    t.frames.step();
    expect(t.scenes[0]!.draw).toHaveBeenCalled();
    expect(t.onFallback).not.toHaveBeenCalled();
  });

  it("hands the GPU to AR without calling it a loss, and rebuilds on the next view", () => {
    const t = setup({ webgl: true });
    t.view(0.6);
    t.frames.step();
    t.ar();
    expect(t.scenes[0]!.release).toHaveBeenCalledTimes(1);
    expect(t.film.renderer()).toBe("floor");
    expect(t.film.snapshot()).toMatchObject({
      status: "paused",
      pausedBy: "release",
    });
    // the frame asked for before the handoff runs once and asks for no other
    const asked = t.frames.requestFrame.mock.calls.length;
    t.frames.runOut();
    expect(t.frames.requestFrame.mock.calls.length).toBe(asked);
    // the released scene's late lost-context event is not a loss
    t.scenes[0]!.onLost();
    expect(t.onFallback).not.toHaveBeenCalled();
    // still in view after AR: it does not restart by itself
    t.view(0.6);
    expect(t.frames.requestFrame.mock.calls.length).toBe(asked);
    t.view(0);
    t.view(0.6);
    expect(t.scenes).toHaveLength(2);
    expect(t.film.renderer()).toBe("3d");
    expect(t.film.snapshot().status).toBe("playing");
    expect(t.onFallback).not.toHaveBeenCalled();
  });

  it("rebuilds on a tap after AR, even with no change of view", () => {
    const t = setup({ webgl: true });
    t.view(0.6);
    t.ar();
    t.host.querySelector<HTMLElement>(".lf-stage")!.click();
    expect(t.scenes).toHaveLength(2);
    expect(t.film.snapshot().status).toBe("playing");
  });

  it("falls back to the drawing on a real context loss, says so, and never rebuilds", () => {
    const t = setup({ webgl: true });
    t.view(0.6);
    t.scenes[0]!.onLost();
    expect(t.onFallback.mock.calls).toEqual([["context-lost"]]);
    expect(t.film.renderer()).toBe("floor");
    expect(
      t.host.querySelector(".lf-floor")?.getAttribute("viewBox"),
    ).toBeTruthy();
    t.view(0);
    t.view(0.6);
    expect(t.scenes).toHaveLength(1);
    expect(t.film.snapshot().status).toBe("playing");
  });

  it("falls back when the renderer will not start", () => {
    const t = setup({ webgl: true, sceneThrows: true });
    t.view(0.6);
    expect(t.onFallback.mock.calls).toEqual([["no-webgl"]]);
    expect(t.film.renderer()).toBe("floor");
    t.view(0);
    t.view(0.6);
    expect(t.onFallback).toHaveBeenCalledTimes(1);
  });
});

describe("landing film: the page's side", () => {
  it("states its state on the host and tells the page when it changes", () => {
    const t = setup();
    const seen: { status: string; beat: number; moving: boolean }[] = [];
    t.host.addEventListener("landing-film-change", (e) => {
      seen.push(
        (e as CustomEvent<{ status: string; beat: number; moving: boolean }>)
          .detail,
      );
    });
    expect(t.host.dataset.filmState).toBe("waiting");
    t.view(0.6);
    expect(t.host.dataset).toMatchObject({
      filmState: "playing",
      filmBeat: "0",
      filmMoving: "true",
    });
    t.frames.step();
    t.frames.step();
    // a frame that changes nothing the page reads sends no event
    expect(seen).toHaveLength(1);
    t.film.jumpTo(5);
    expect(t.host.dataset.filmBeat).toBe("5");
    expect(seen.at(-1)).toMatchObject({ status: "playing", beat: 5 });
  });

  // The cards below hold still while the host says the film plays (they
  // read `data-playing`): two things moving at once split the reader's
  // eye. It must turn false whenever the film stops moving for any reason,
  // or the cards would stay frozen under a paused or finished film.
  it("says on the host whether it plays, for the cards", () => {
    // the fake scene: running the whole film out stays cheap
    const t = setup({ webgl: true });
    expect(t.host.dataset.playing).toBe("false");
    t.view(0.6);
    expect(t.host.dataset.playing).toBe("true");
    t.film.toggle();
    expect(t.host.dataset.playing).toBe("false");
    t.film.toggle();
    expect(t.host.dataset.playing).toBe("true");
    t.view(0);
    expect(t.host.dataset.playing).toBe("false");
    t.view(0.6);
    t.frames.runOut();
    expect(t.host.dataset.filmState).toBe("finished");
    expect(t.host.dataset.playing).toBe("false");
    t.film.destroy();
    expect(t.host.dataset.playing).toBeUndefined();
  });

  it("gives the host back as it was, and unregisters from AR", () => {
    const t = setup({ webgl: true });
    t.view(0.6);
    t.film.destroy();
    expect(t.host.innerHTML).toBe(
      '<p class="placeholder">A still of the film</p>',
    );
    expect(t.unregister).toHaveBeenCalledTimes(1);
    expect(t.scenes[0]!.release).toHaveBeenCalledTimes(1);
    expect(t.host.dataset.filmState).toBeUndefined();
    t.frames.runOut();
    expect(t.frames.pending()).toBe(0);
  });

  it("refuses a host that is not an element", () => {
    expect(() =>
      mountLandingFilm(null as unknown as HTMLElement, {
        reducedMotion: false,
        onArStarting: () => () => undefined,
      }),
    ).toThrow(TypeError);
  });

  it("names its bar and keeps exactly one part current", () => {
    const t = setup();
    t.view(0.6);
    t.film.jumpTo(3);
    const current = t.host.querySelectorAll('.lf-seg[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("aria-label")).toBe(
      "Part 4 of 8: Walk there",
    );
  });
});
