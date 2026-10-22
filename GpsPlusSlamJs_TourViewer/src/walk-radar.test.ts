/**
 * Why these tests matter (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M3, §1.2, §1.3, §5): the radar redraws at most 15 times a second and
 * always draws the latest state (a trailing draw); a station just found
 * bursts once, and an old find never replays on the next AR entry; the
 * radar labels no station with a distance (the list does); reduced motion
 * stills the pulse and the wobble; and the chip, its look and the frozen
 * grey follow the store's kind. The canvas colours are the page's tokens.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createRadarBursts,
  createRedrawThrottle,
  drawWalkRadar,
  WALK_BURST_MS,
  WALK_RADAR_COLOURS,
  WALK_RADAR_HZ,
  sampleFrameTimes,
  walkRadarDebugLines,
  wireWalkRadar,
  type RadarCanvas,
  type WalkRadarDom,
  type WalkRadarFrame,
} from "./walk-radar";
import {
  walkRadarModel,
  type WalkRadarGeometry,
  type WalkRadarStation,
} from "./walk-radar-model";

/** A fake clock with timers (the throttle's and the view's). */
function clock() {
  let t = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  return {
    now: () => t,
    setTimer(fn: () => void, ms: number) {
      id += 1;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer(handle: unknown) {
      timers.delete(handle as number);
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, v]) => v.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
    pending: () => timers.size,
  };
}

/** A 2D context that records every call. */
function recordingCanvas() {
  const calls: { op: string; args: unknown[]; style?: unknown }[] = [];
  const gradient = {
    addColorStop: () => undefined,
  } as unknown as CanvasGradient;
  const g: RadarCanvas = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    globalAlpha: 1,
    setTransform: (...args) => void calls.push({ op: "setTransform", args }),
    clearRect: (...args) => void calls.push({ op: "clearRect", args }),
    beginPath: () => void calls.push({ op: "beginPath", args: [] }),
    arc: (...args) => void calls.push({ op: "arc", args }),
    moveTo: (...args) => void calls.push({ op: "moveTo", args }),
    lineTo: (...args) => void calls.push({ op: "lineTo", args }),
    closePath: () => undefined,
    fill: () => void calls.push({ op: "fill", args: [], style: g.fillStyle }),
    stroke: () =>
      void calls.push({ op: "stroke", args: [], style: g.strokeStyle }),
    setLineDash: (args) => void calls.push({ op: "dash", args }),
    fillText: (...args) => void calls.push({ op: "fillText", args }),
    createRadialGradient: () => gradient,
  };
  return { g, calls };
}

const STATIONS: WalkRadarStation[] = [
  { id: "gate", number: 1, state: "found" },
  { id: "well", number: 2, state: "next" },
  { id: "tower", number: 3, state: "left" },
  { id: "garden", number: 4, state: "skipped" },
  { id: "mill", number: 5, state: "later" },
];

const GEO: WalkRadarGeometry = {
  distances: new Map([
    ["gate", 12],
    ["well", 46],
    ["tower", 120],
    ["garden", 80],
    ["mill", 200],
  ]),
  bearings: new Map([
    ["gate", 180],
    ["well", 20],
    ["tower", 100],
    ["garden", 250],
    ["mill", 300],
  ]),
  headingDeg: 0,
};

function model(kind: WalkRadarFrame["kind"] = "gps") {
  return walkRadarModel({
    stations: STATIONS,
    order: "any",
    kind,
    accuracyM: 6,
    live: GEO,
    snapshot: GEO,
    fovDeg: 64,
    sizePx: 132,
  });
}

const DRAW = {
  nowMs: 700,
  sizePx: 132,
  dpr: 2,
  reduceMotion: false,
  burstOf: () => undefined,
};

describe("createRedrawThrottle (at most 15 a second, the last state drawn)", () => {
  it("draws at once, then once at the interval's end however often asked", () => {
    const c = clock();
    let draws = 0;
    let lastAt = Number.NaN;
    const t = createRedrawThrottle({
      intervalMs: 1000 / WALK_RADAR_HZ,
      ...c,
      draw: () => {
        draws += 1;
        lastAt = c.now();
      },
    });
    t.request();
    expect(draws).toBe(1);
    for (let i = 0; i < 3; i += 1) {
      c.advance(16);
      t.request();
    }
    expect(draws).toBe(1);
    expect(c.pending()).toBe(1);
    c.advance(30);
    expect(draws).toBe(2);
    expect(lastAt).toBeCloseTo(1000 / WALK_RADAR_HZ, 6);
  });

  it("a second of 60 Hz requests draws 15 times, never more", () => {
    const c = clock();
    const at: number[] = [];
    const t = createRedrawThrottle({
      intervalMs: 1000 / WALK_RADAR_HZ,
      ...c,
      draw: () => {
        at.push(c.now());
      },
    });
    for (let i = 0; i < 60; i += 1) {
      t.request();
      c.advance(1000 / 60);
    }
    expect(at.length).toBeGreaterThanOrEqual(WALK_RADAR_HZ);
    expect(at.length).toBeLessThanOrEqual(WALK_RADAR_HZ + 1);
    for (let i = 1; i < at.length; i += 1) {
      expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(1000 / 15 - 1e-6);
    }
  });

  it("cancel drops the trailing draw", () => {
    const c = clock();
    let draws = 0;
    const t = createRedrawThrottle({
      intervalMs: 100,
      ...c,
      draw: () => {
        draws += 1;
      },
    });
    t.request();
    t.request();
    t.cancel();
    c.advance(500);
    expect(draws).toBe(1);
  });
});

describe("createRadarBursts (the ring at a station just found)", () => {
  it("bursts on next/left turning found or here, for 1.6 s", () => {
    const b = createRadarBursts();
    b.note(STATIONS, 0);
    b.note(
      STATIONS.map((s) =>
        s.id === "well"
          ? { ...s, state: "here" as const }
          : s.id === "tower"
            ? { ...s, state: "found" as const }
            : s,
      ),
      1_000,
    );
    expect(b.progress("well", 1_000)).toBe(0);
    expect(b.progress("tower", 1_800)).toBeCloseTo(0.5, 9);
    expect(b.progress("gate", 1_000)).toBeUndefined();
    expect(b.progress("well", 1_000 + WALK_BURST_MS)).toBeUndefined();
  });

  it("the first render of a walk replays no old find; reset starts anew", () => {
    const b = createRadarBursts();
    b.note(STATIONS, 0);
    expect(b.progress("gate", 0)).toBeUndefined();
    b.reset();
    b.note(
      STATIONS.map((s) => ({ ...s, state: "found" as const })),
      10,
    );
    expect(b.progress("well", 10)).toBeUndefined();
  });

  it("a skip or a later is no find", () => {
    const b = createRadarBursts();
    b.note(STATIONS, 0);
    b.note(
      STATIONS.map((s) =>
        s.id === "well" ? { ...s, state: "skipped" as const } : s,
      ),
      5,
    );
    expect(b.progress("well", 5)).toBeUndefined();
  });
});

describe("drawWalkRadar", () => {
  it("labels no station with a distance: only the ring, N, and numbers", () => {
    const { g, calls } = recordingCanvas();
    drawWalkRadar(g, model(), DRAW);
    const texts = calls
      .filter((c) => c.op === "fillText")
      .map((c) => c.args[0] as string);
    // The outer ring's label, north, the focus's and the left station's
    // numbers; none for found, skipped or later.
    expect(texts).toEqual([expect.stringMatching(/^\d+ m$/), "N", "2", "3"]);
  });

  it("the frozen radar draws the '?' and greys, no orange", () => {
    const { g, calls } = recordingCanvas();
    drawWalkRadar(g, model("none"), DRAW);
    expect(
      calls.filter((c) => c.op === "fillText").map((c) => c.args[0]),
    ).toContain("?");
    const styles = calls.map((c) => c.style).filter((s) => s !== undefined);
    expect(styles).not.toContain(WALK_RADAR_COLOURS.accent);
    expect(styles).toContain("#b9c1c9");
  });

  it("reduced motion: no pulse ring at the focus and the dot sits still", () => {
    const arcs = (reduceMotion: boolean, nowMs: number) => {
      const { g, calls } = recordingCanvas();
      drawWalkRadar(g, model(), { ...DRAW, reduceMotion, nowMs });
      return calls.filter((c) => c.op === "arc").map((c) => c.args);
    };
    expect(arcs(true, 700).length).toBe(arcs(false, 700).length - 1);
    // The visitor's dot (r 4, drawn last) at the centre whatever the time.
    expect(arcs(true, 333).at(-1)!.slice(0, 3)).toEqual([66, 66, 4]);
    expect(arcs(false, 333).at(-1)!.slice(0, 2)).not.toEqual([66, 66]);
  });

  it("a burst draws one more ring, teal, around that station", () => {
    const { g, calls } = recordingCanvas();
    drawWalkRadar(g, model(), {
      ...DRAW,
      burstOf: (id) => (id === "gate" ? 0.25 : undefined),
    });
    expect(
      calls.some(
        (c) =>
          c.op === "stroke" &&
          typeof c.style === "string" &&
          c.style.startsWith("rgba(45,212,191,"),
      ),
    ).toBe(true);
  });
});

/** A structural DOM for the view. */
function dom(width = 132) {
  const listeners: (() => void)[] = [];
  const attributes = new Map<string, string>();
  const { g, calls } = recordingCanvas();
  /** The canvas's CSS width, and how often a draw read it (a layout
   *  read). */
  const size = { width, reads: 0 };
  return {
    calls,
    listeners,
    size,
    dom: {
      wrap: { hidden: true, dataset: {} as DOMStringMap },
      button: {
        addEventListener: (_: string, fn: () => void) => {
          listeners.push(fn);
        },
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => {
          attributes.set(name, value);
        },
      } as unknown as WalkRadarDom["button"],
      canvas: {
        get clientWidth() {
          size.reads += 1;
          return size.width;
        },
        width: 0,
        height: 0,
        getContext: () => g,
      },
      chip: { dataset: {} as DOMStringMap },
      chipText: { textContent: "" as string },
    },
  };
}

function frame(over: Partial<WalkRadarFrame> = {}): WalkRadarFrame {
  return {
    stations: STATIONS,
    order: "any",
    kind: "gps",
    accuracyM: 6,
    live: GEO,
    snapshot: GEO,
    listOpen: false,
    ...over,
  };
}

function view(width = 132) {
  const c = clock();
  const d = dom(width);
  let toggles = 0;
  /** The size observer's callback, once the view observed the canvas. */
  let resized: (() => void) | null = null;
  let observing = 0;
  const radar = wireWalkRadar({
    dom: d.dom,
    toggleList: () => {
      toggles += 1;
    },
    ...c,
    projection0: () => null,
    aspect: () => 0.5,
    devicePixelRatio: () => 3,
    reduceMotion: () => false,
    observeSize: (onChange) => {
      resized = onChange;
      observing += 1;
    },
  });
  return {
    c,
    d,
    radar,
    toggles: () => toggles,
    resize(width: number) {
      d.size.width = width;
      resized?.();
    },
    observing: () => observing,
  };
}

describe("wireWalkRadar", () => {
  it("writes the chip's words and look, and the frozen mode", () => {
    const v = view();
    v.radar.render(frame());
    expect(v.d.dom.wrap.hidden).toBe(false);
    expect(v.d.dom.chipText.textContent).toBe("GPS - about 6 m");
    expect(v.d.dom.chip.dataset["kind"]).toBe("gps");
    expect(v.d.dom.wrap.dataset["mode"]).toBe("live");
    v.radar.render(frame({ kind: "lost" }));
    expect(v.d.dom.chipText.textContent).toBe("Paused - tracking lost");
    expect(v.d.dom.wrap.dataset["mode"]).toBe("frozen");
    v.radar.render(null);
    expect(v.d.dom.wrap.hidden).toBe(true);
  });

  it("a tap on the radar toggles the list", () => {
    const v = view();
    for (const fn of v.d.listeners) fn();
    expect(v.toggles()).toBe(1);
  });

  // Why this test matters: the radar is a button that opens and closes
  // the list, as the grab is; a screen reader hears whether its list is
  // open only from `aria-expanded`.
  it("says on its button whether the list is open", () => {
    const v = view();
    v.radar.render(frame());
    expect(v.d.dom.button.getAttribute("aria-expanded")).toBe("false");
    v.radar.render(frame({ listOpen: true }));
    expect(v.d.dom.button.getAttribute("aria-expanded")).toBe("true");
  });

  // Why this test matters: reading the canvas's CSS size is a layout read,
  // and a draw follows the sheet's DOM writes of the same render, so a
  // read per draw forces a layout up to 15 times a second. The size is
  // read once and again only after the canvas was resized.
  it("reads the canvas's size once, and again only after it was resized", () => {
    const v = view();
    for (let i = 0; i < 4; i += 1) {
      v.radar.render(frame());
      v.c.advance(100);
    }
    expect(v.d.calls.filter((c) => c.op === "clearRect").length).toBe(4);
    expect(v.d.size.reads).toBe(1);
    v.resize(108);
    v.radar.render(frame());
    expect(v.d.size.reads).toBe(2);
    expect(v.d.dom.canvas.width).toBe(216);
    expect(v.observing()).toBe(1);
  });

  it("a canvas with no size yet (hidden) is read again on the next draw", () => {
    const v = view(0);
    v.radar.render(frame());
    v.d.size.width = 132;
    v.c.advance(100);
    v.radar.render(frame());
    expect(v.d.dom.canvas.width).toBe(264);
  });

  it("draws at the device's pixel ratio, capped at 2, throttled", () => {
    const v = view();
    v.radar.render(frame());
    expect(v.d.dom.canvas.width).toBe(264);
    const cleared = () => v.d.calls.filter((c) => c.op === "clearRect").length;
    v.radar.render(frame());
    v.radar.render(frame());
    expect(cleared()).toBe(1);
    v.c.advance(100);
    expect(cleared()).toBe(2);
    expect(v.radar.drawStats(v.c.now())).toMatchObject({ count: 2 });
  });

  it("no canvas size yet (hidden): nothing is drawn", () => {
    const v = view(0);
    v.radar.render(frame());
    expect(v.d.calls).toHaveLength(0);
  });

  it("the range follows the stations still to find, holds a small shrink, and starts anew on reset", () => {
    const scaled = (f: number) => ({
      ...GEO,
      distances: new Map([...GEO.distances].map(([k, d]) => [k, d * f])),
    });
    /** The outer ring label of the last draw. */
    const labelOf = (v: ReturnType<typeof view>) =>
      v.d.calls
        .filter((c) => c.op === "fillText")
        .map((c) => c.args[0] as string)
        .filter((t) => t.endsWith(" m"))
        .at(-1);
    // Without the later mill: two stations still to find set the range.
    const stations = STATIONS.filter((st) => st.id !== "mill");
    const after = (first: number, second: number, reset: boolean) => {
      const v = view();
      v.radar.render(frame({ stations, live: scaled(first) }));
      if (reset) v.radar.reset();
      v.c.advance(100);
      v.radar.render(frame({ stations, live: scaled(second) }));
      return labelOf(v);
    };
    const fresh = (f: number) => after(f, f, false);
    // Non-vacuous: the two ranges label different rings.
    expect(fresh(0.8)).not.toBe(fresh(1));
    // A shrink to 80 % holds the range shown (the adaptive hysteresis) ...
    expect(after(1, 0.8, false)).toBe(fresh(1));
    // ... and a reset (another tour, the next AR entry) forgets it.
    expect(after(1, 0.8, true)).toBe(fresh(0.8));
  });

  // Why this test matters (side by side with W4, a tour in order): there
  // only the next station is offered and the rest wait as "later" dots,
  // yet they are still to find; a range from the next one alone shrank
  // the radar to 30 m and pushed every later dot onto its rim.
  it("the range counts the later stations of a tour in order as still to find", () => {
    const ringLabel = (stations: WalkRadarStation[]) => {
      const v = view();
      v.radar.render(frame({ stations, order: "fixed" }));
      return v.d.calls
        .filter((c) => c.op === "fillText")
        .map((c) => c.args[0] as string)
        .filter((t) => t.endsWith(" m"))
        .at(-1);
    };
    const withState = (state: WalkRadarStation["state"]) =>
      STATIONS.map((st) =>
        st.id === "tower" || st.id === "mill" ? { ...st, state } : st,
      );
    expect(ringLabel(withState("later"))).toBe(ringLabel(withState("left")));
    // Non-vacuous: without them the range is another.
    expect(ringLabel(withState("found"))).not.toBe(
      ringLabel(withState("left")),
    );
  });
});

describe("the canvas colours are the page's tokens", () => {
  // Why: the chip's and the list's CSS and the radar's canvas must say the
  // same orange, teal, blue and amber; one changed alone splits the look.
  it("index.html defines every --walk-* colour the canvas uses", () => {
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    const token = (name: string) =>
      new RegExp(`--walk-${name}:\\s*([^;]+);`).exec(html)?.[1]?.trim();
    expect(token("gps")).toBe(WALK_RADAR_COLOURS.gps);
    expect(token("weak")).toBe(WALK_RADAR_COLOURS.weak);
    expect(token("accent")).toBe(WALK_RADAR_COLOURS.accent);
    expect(token("found")).toBe(WALK_RADAR_COLOURS.found);
  });

  // Why: the stylesheet's validator refuses `color-mix()`, so the walk's
  // CSS writes its tints (the chip's glow, a row's wash) as `rgb()`
  // literals; each must be one of the walk's own colour tokens (or a
  // neutral: black, white, the walk's two surfaces), else a token changed
  // alone leaves its tints behind in the old colour.
  it("every rgb() tint in the walk's CSS is a --walk-* colour or a neutral", () => {
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    const start = html.indexOf("/* ===== The visitor's walk in AR");
    const end = html.indexOf("/* ===== The creator's HUD in AR");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const css = html.slice(start, end);
    const hexTriple = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
    const tokens = new Set(
      [...css.matchAll(/--walk-[a-z0-9-]+:\s*(#[0-9a-f]{6});/gi)].map((m) =>
        hexTriple(m[1]!),
      ),
    );
    const neutrals = new Set(["0 0 0", "255 255 255", "10 14 19", "12 16 21"]);
    const literals = [...css.matchAll(/rgb\((\d+ \d+ \d+)/g)].map((m) => m[1]!);
    // Non-vacuous: the chip's blue and amber glows are among them.
    expect(literals).toContain(hexTriple(WALK_RADAR_COLOURS.gps));
    expect(literals).toContain(hexTriple(WALK_RADAR_COLOURS.weak));
    expect(literals.filter((t) => !tokens.has(t) && !neutrals.has(t))).toEqual(
      [],
    );
  });

  it("the canvas's tints are its colours' own", () => {
    const triple = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
    const strokes = (kind: WalkRadarFrame["kind"], accuracyM = 6) => {
      const { g, calls } = recordingCanvas();
      drawWalkRadar(
        g,
        walkRadarModel({
          stations: STATIONS,
          order: "fixed",
          kind,
          accuracyM,
          live: GEO,
          snapshot: GEO,
          fovDeg: 64,
          sizePx: 132,
        }),
        { ...DRAW, burstOf: (id) => (id === "gate" ? 0.5 : undefined) },
      );
      return calls
        .filter((c) => c.op === "stroke" && typeof c.style === "string")
        .map((c) => c.style as string);
    };
    const tinted = (styles: string[], hex: string) =>
      styles.some((s) => s.startsWith(`rgba(${triple(hex)},`));
    expect(tinted(strokes("pending"), WALK_RADAR_COLOURS.gps)).toBe(true);
    expect(tinted(strokes("gps"), WALK_RADAR_COLOURS.gps)).toBe(true);
    expect(tinted(strokes("weak", 40), WALK_RADAR_COLOURS.weak)).toBe(true);
    // The focus's pulse and the found station's burst.
    expect(tinted(strokes("gps"), WALK_RADAR_COLOURS.accent)).toBe(true);
    expect(tinted(strokes("gps"), WALK_RADAR_COLOURS.found)).toBe(true);
  });
});

describe("walkRadarDebugLines (the ?debug=1 readout)", () => {
  // Why: the phone test judges the radar by these two lines (DEC-PERF: no
  // frame over 50 ms): the ms each draw took and the frame time, each as a
  // rolling mean and worst over 2 s; nothing measured yet reads "-".
  it("says the draw and the frame time, mean and worst", () => {
    expect(
      walkRadarDebugLines(
        { mean: 0.4321, worst: 1.26, count: 30 },
        { mean: 16.66, worst: 49.95, count: 120 },
      ),
    ).toEqual([
      "radar draw: 0.43 ms mean, 1.26 ms worst (30 in 2 s)",
      "frame: 16.7 ms mean, 50.0 ms worst (120 in 2 s)",
    ]);
    expect(walkRadarDebugLines(null, null)).toEqual([
      "radar draw: -",
      "frame: -",
    ]);
  });
});

describe("sampleFrameTimes (the readout's frame line)", () => {
  // Why this test matters (DEC-PERF): the field check reads the frame time
  // from this sampler; the frame loop hands seconds and a zero dt on its
  // first frame, so a sampler that kept seconds or the zero would report a
  // frame budget nobody could read against 50 ms.
  it("feeds each frame's dt as ms at the clock's time, skipping no-time frames, until unregistered", () => {
    let callback: ((dt: number) => void) | null = null;
    let clock = 1000;
    const pushed: Array<[number, number]> = [];
    const unregister = sampleFrameTimes(
      (fn) => {
        callback = fn;
        return () => {
          callback = null;
        };
      },
      () => clock,
      { push: (at, ms) => pushed.push([at, ms]) },
    );
    const tick = (dt: number): void => {
      if (callback === null) throw new Error("not registered");
      callback(dt);
    };
    tick(0);
    tick(0.016);
    clock = 1040;
    tick(0.04);
    tick(Number.NaN);
    expect(pushed).toEqual([
      [1000, 16],
      [1040, 40],
    ]);
    unregister();
    expect(callback).toBeNull();
  });
});
