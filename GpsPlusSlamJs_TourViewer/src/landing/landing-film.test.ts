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
 *
 * A new scene is shown only once its shaders are compiled (`prepare`), so
 * the fake scene's `prepare` resolves at once and the tests that look at
 * the shown scene wait one turn (`flush`) after the view that built it.
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

/** Lets the film's pending promise callbacks run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeScene(
  prepare: () => Promise<void> = () => Promise.resolve(),
): FilmScene & {
  onLost: () => void;
  release: ReturnType<typeof vi.fn>;
} {
  const s = {
    canvas: document.createElement("canvas"),
    prepare: vi.fn(prepare),
    layout: vi.fn(),
    draw: vi.fn(() => true),
    anchors: vi.fn(() => ({
      pin: [50, 100] as const,
      ground: [50, 200] as const,
      next: [60, 260] as const,
    })),
    show: vi.fn(),
    release: vi.fn(),
    onLost: () => undefined,
  };
  return s;
}

function setup(
  o: {
    reducedMotion?: boolean;
    webgl?: boolean;
    sceneThrows?: boolean;
    prepare?: () => Promise<void>;
    size?: () => { w: number; h: number };
  } = {},
) {
  const host = document.createElement("div");
  host.innerHTML = '<p class="placeholder">A still of the film</p>';
  document.body.append(host);
  const frames = frameQueue();
  let shareCb: (v: number) => void = () => undefined;
  let sizeCb: () => void = () => undefined;
  const scenes: ReturnType<typeof fakeScene>[] = [];
  const env: Partial<FilmEnv> = {
    webgl: () => o.webgl ?? false,
    createScene: (_doc, _parts, _q, _opts, onContextLost) => {
      if (o.sceneThrows) throw new Error("no context");
      const s = fakeScene(o.prepare);
      s.onLost = onContextLost;
      scenes.push(s);
      return s;
    },
    observeView: (_el, cb) => {
      shareCb = cb;
      return () => undefined;
    },
    observeSize: (_el, cb) => {
      sizeCb = cb;
      return () => undefined;
    },
    size: o.size ?? (() => ({ w: 400, h: 500 })),
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
    resized: () => sizeCb(),
    ar: () => arStop?.(),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  delete document.body.dataset["arActive"];
  window.history.replaceState(null, "", "/");
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

  it("stops asking once it is paused, out of view, or finished", async () => {
    // a cheap renderer, so the whole film runs in a moment (once it is shown)
    const t = setup({ webgl: true });
    t.view(0.6);
    await flush();
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

  it("plays once: the end is the end until asked again", async () => {
    // the fake scene, shown, keeps the run cheap
    const t = setup({ webgl: true });
    t.view(1);
    await flush();
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

  // With the caption list the stage keeps the height it has with one
  // caption, measured with the list hidden. A measurement that reads
  // (almost) nothing, as one taken in the middle of a resize can, must
  // not leave the stage with no height: it was seen drawn 0 px tall in
  // about 1 of 8 full-page screenshots of a phone-sized window.
  it("keeps the stage's last good height when a measurement reads nothing", () => {
    let size = { w: 400, h: 500 };
    const t = setup({ reducedMotion: true, size: () => size });
    t.view(1);
    const stage = t.host.querySelector<HTMLElement>(".lf-stage")!;
    expect(stage.style.height).toBe("500px");
    size = { w: 0, h: 0 };
    t.resized();
    expect(stage.style.height).toBe("500px");
    size = { w: 400, h: 1.5 };
    t.resized();
    expect(stage.style.height).toBe("500px");
    size = { w: 400, h: 420 };
    t.resized();
    expect(stage.style.height).toBe("420px");
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

  it("builds the 3D scene on first view, not at mount", async () => {
    const t = setup({ webgl: true });
    expect(t.scenes).toHaveLength(0);
    t.view(0.05);
    expect(t.scenes).toHaveLength(1);
    expect(t.scenes[0]!.layout).toHaveBeenCalled();
    await flush();
    expect(t.host.querySelector(".lf-film")?.classList.contains("lf-3d")).toBe(
      true,
    );
    t.view(0.6);
    t.frames.step();
    t.frames.step();
    expect(t.scenes[0]!.draw).toHaveBeenCalled();
    expect(t.onFallback).not.toHaveBeenCalled();
  });

  it("hands the GPU to AR without calling it a loss, and rebuilds on the next view", async () => {
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
    // still in view after AR: it does not restart by itself, nor build a
    // renderer behind the session when the view changes (a layout shift)
    t.view(0.6);
    t.view(0.7);
    expect(t.frames.requestFrame.mock.calls.length).toBe(asked);
    expect(t.scenes).toHaveLength(1);
    t.view(0);
    t.view(0.6);
    expect(t.scenes).toHaveLength(2);
    await flush();
    expect(t.film.renderer()).toBe("3d");
    expect(t.film.snapshot().status).toBe("playing");
    expect(t.onFallback).not.toHaveBeenCalled();
  });

  // "AR has the GPU" must hold for every film on the page, also one that
  // enters the view again during the session or is mounted afresh then
  // (a reduced-motion change remounts it): the page's live-session mark
  // is what it checks, not only its own handoff.
  it("builds no renderer while the page says an AR session is live", () => {
    document.body.dataset["arActive"] = "true";
    const t = setup({ webgl: true });
    t.view(0.6);
    t.view(0);
    t.view(0.6);
    t.host.querySelector<HTMLElement>(".lf-stage")!.click();
    t.film.jumpTo(2);
    expect(t.scenes).toHaveLength(0);
    expect(t.onFallback).not.toHaveBeenCalled();
    document.body.dataset["arActive"] = "false";
    t.view(0);
    t.view(0.6);
    expect(t.scenes).toHaveLength(1);
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

  // The first draw of a new scene compiles every shader on the main
  // thread: measured in a production build at a 4x slowed CPU, about 400
  // of the film's 550 ms longest task. The scene compiles them in parallel
  // first (`prepare`) while the drawing stays, which halved that task.
  // A scene released, lost or destroyed while it compiles must still be
  // freed and never shown, or AR would start beside a second live renderer.
  it("keeps the drawing while the scene compiles, then shows the scene", async () => {
    const gate = deferred();
    const t = setup({ webgl: true, prepare: () => gate.promise });
    t.view(0.6);
    expect(t.scenes).toHaveLength(1);
    expect(t.scenes[0]!.prepare).toHaveBeenCalledTimes(1);
    expect(t.film.renderer()).toBe("floor");
    t.frames.step();
    expect(t.scenes[0]!.show).not.toHaveBeenCalled();
    expect(t.scenes[0]!.draw).not.toHaveBeenCalled();
    expect(
      t.host.querySelector(".lf-floor")?.getAttribute("viewBox"),
    ).toBeTruthy();
    gate.resolve();
    await flush();
    expect(t.film.renderer()).toBe("3d");
    expect(t.scenes[0]!.show).toHaveBeenCalledTimes(1);
    expect(t.scenes[0]!.draw).toHaveBeenCalled();
    expect(t.host.querySelector(".lf-film")?.classList.contains("lf-3d")).toBe(
      true,
    );
  });

  it("shows the scene when compiling ahead fails (its first draw compiles)", async () => {
    const t = setup({
      webgl: true,
      prepare: () => Promise.reject(new Error("no parallel compile")),
    });
    t.view(0.6);
    await flush();
    expect(t.film.renderer()).toBe("3d");
    expect(t.onFallback).not.toHaveBeenCalled();
  });

  /** A scene still compiling, ended by `end`; then the compile finishes. */
  async function endWhileCompiling(end: (t: ReturnType<typeof setup>) => void) {
    const gate = deferred();
    const t = setup({ webgl: true, prepare: () => gate.promise });
    t.view(0.6);
    end(t);
    gate.resolve();
    await flush();
    expect(t.scenes[0]!.release).toHaveBeenCalledTimes(1);
    expect(t.scenes[0]!.show).not.toHaveBeenCalled();
    expect(t.film.renderer()).toBe("floor");
    return t;
  }

  it("frees and never shows a scene handed to AR while it compiles, and builds again", async () => {
    const t = await endWhileCompiling((x) => x.ar());
    // AR's release is no loss: the next view builds again
    t.view(0);
    t.view(0.6);
    expect(t.scenes).toHaveLength(2);
    expect(t.onFallback).not.toHaveBeenCalled();
  });

  it("frees and never shows a scene that loses its context while it compiles", async () => {
    const t = await endWhileCompiling((x) => x.scenes[0]!.onLost());
    expect(t.onFallback.mock.calls).toEqual([["context-lost"]]);
  });

  it("frees and never shows a scene whose film is destroyed while it compiles", async () => {
    const t = await endWhileCompiling((x) => x.film.destroy());
    expect(t.host.querySelector(".lf-film")).toBeNull();
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
  it("says on the host whether it plays, for the cards", async () => {
    // the fake scene: running the whole film out stays cheap (once it is shown)
    const t = setup({ webgl: true });
    expect(t.host.dataset.playing).toBe("false");
    t.view(0.6);
    await flush();
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

  // One moving thing at a time means the film MOVING, not merely in its
  // playing state: it plays on down to a tenth in view, and a film mostly
  // scrolled away must not keep the cards below it frozen.
  it("holds the cards still only while it plays with its start share in view", () => {
    const t = setup();
    t.view(0.6);
    expect(t.host.dataset.playing).toBe("true");
    t.view(0.3);
    expect(t.film.snapshot().status).toBe("playing");
    expect(t.host.dataset.playing).toBe("false");
    t.view(0.6);
    expect(t.host.dataset.playing).toBe("true");
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

describe("landing film: the debug readout", () => {
  // The quality knobs exist to compare settings on one phone; without
  // `?debug=1` they must change nothing, or a shared link with a knob in
  // it would quietly give every reader a lower-quality film.
  it("takes the address's quality knobs only with ?debug=1", () => {
    const built: unknown[] = [];
    const mount = () => {
      const host = document.createElement("div");
      document.body.append(host);
      let shareCb: (v: number) => void = () => undefined;
      const film = createLandingFilm(
        host,
        { reducedMotion: false, onArStarting: () => () => undefined },
        DEFAULT_TUNING,
        {
          webgl: () => true,
          createScene: (_doc, _parts, quality) => {
            built.push(quality);
            return fakeScene();
          },
          observeView: (_el, cb) => {
            shareCb = cb;
            return () => undefined;
          },
          observeSize: () => () => undefined,
          size: () => ({ w: 400, h: 500 }),
          viewport: () => ({ w: 390, h: 844, dpr: 2 }),
        },
      );
      shareCb(0.6);
      const hidden = host.querySelector(".lf-debug")?.hasAttribute("hidden");
      film.destroy();
      return hidden;
    };
    window.history.replaceState(null, "", "/?film-shadows=0&film-dpr=1");
    expect(mount()).toBe(true);
    window.history.replaceState(
      null,
      "",
      "/?debug=1&film-shadows=0&film-dpr=1",
    );
    expect(mount()).toBe(false);
    expect(built).toEqual([
      DEFAULT_TUNING.quality,
      { ...DEFAULT_TUNING.quality, shadows: false, pixelRatioCap: 1 },
    ]);
  });

  // `?debug=1` is how the frame budget is checked on a phone: the readout
  // must show the whole run's slow frames and the settings the scene was
  // really built with, and the address's quality knobs must reach the
  // scene (film-debug.test.ts pins the text and the knobs themselves).
  it("shows the renderer, its settings and the run's slow frames, built with the knobs' quality", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const frames = frameQueue();
    let shareCb: (v: number) => void = () => undefined;
    const built: { quality: unknown; dpr: number }[] = [];
    const film = createLandingFilm(
      host,
      {
        reducedMotion: false,
        onArStarting: () => () => undefined,
        requestFrame: frames.requestFrame,
      },
      DEFAULT_TUNING,
      {
        webgl: () => true,
        createScene: (_doc, _parts, quality, opts) => {
          built.push({ quality, dpr: opts.devicePixelRatio });
          return fakeScene();
        },
        observeView: (_el, cb) => {
          shareCb = cb;
          return () => undefined;
        },
        observeSize: () => () => undefined,
        size: () => ({ w: 400, h: 500 }),
        viewport: () => ({ w: 390, h: 844, dpr: 3 }),
        now: () => 0,
        debug: true,
        quality: (base) => ({ ...base, shadows: false, pixelRatioCap: 1.5 }),
      },
    );
    shareCb(0.6);
    await flush();
    frames.step(16);
    frames.step(16);
    frames.step(70);
    frames.step(120);
    expect(built).toEqual([
      {
        quality: {
          ...DEFAULT_TUNING.quality,
          shadows: false,
          pixelRatioCap: 1.5,
        },
        dpr: 3,
      },
    ]);
    const readout = host.querySelector(".lf-debug");
    expect(readout?.hasAttribute("hidden")).toBe(false);
    const lines = (readout?.textContent ?? "").split("\n");
    expect(lines[0]).toBe("3d, dpr 1.5, eye aa");
    expect(lines.at(-1)).toBe("3 frames: 2 over 33 ms, 2 over 50, 1 over 100");
    film.destroy();
  });
});
