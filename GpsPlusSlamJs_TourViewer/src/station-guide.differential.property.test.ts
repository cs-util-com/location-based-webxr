/**
 * THE GUIDE-LEVEL DIFFERENTIAL (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * §3 M1 and the cold review's blocker, §8 #1): the live station guide
 * against a frozen copy of the guide and its run from before the walk's
 * state moved into the page's store (`test-support/frozen-m1/`). Both are
 * driven by the same random tours (any, fixed and branch order, `next`
 * links with cycles, stations without steps, untitled ones), the same
 * random walks under every kind of position the guide distinguishes (good
 * GPS, GPS too weak, nothing to judge by, a code's hold, tracking not
 * ready, a dropped pose, no zero yet), the same taps (skip, its undo, a
 * story's end, a code lock), session ends and tour changes, and must show
 * and decide the same after every step: the line, the skip button, each
 * find, done, upcoming and story end, the prefetch's approach, the
 * figure's turn, the breadcrumbs, the HUD's targets, the present station
 * and the wait for a heading.
 *
 * Why it matters: the frozen parity golden is all order "any" and taps no
 * skip, and the page re-enters the guide through a store subscription
 * (`ar-entry.ts`: every dispatch ticks the guide), which a bare store never
 * shows. So the property runs twice: with no subscriber, comparing after
 * every single call, and with each guide's store ticking its guide on every
 * dispatch, as the page does, comparing after each step plus the next
 * frame's tick. Under the subscription the hints a guide gives on every
 * render (upcoming, approach, the figure's turn, the breadcrumbs' calls)
 * are compared as sets, since an extra tick at the same instant repeats
 * them; the events (found, done, a story's end) are compared exactly.
 */
import { configureStore } from "@reduxjs/toolkit";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";

import { wireStationGuide, type StationGuideDeps } from "./station-guide";
import { wireStationGuide as wireFrozenGuide } from "./test-support/frozen-m1/station-guide";
import { createTourViewerStore } from "./tour-viewer-session";
import {
  visitorGuideReducer,
  type VisitorGuideStore,
} from "./visitor-guide-slice";
import type { VisitorPosition } from "./visitor-position";

// The core's geodesy needs an activated store (the framework's factory).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ZERO = { lat: 47.5, lon: 8.7 };

/** How the visitor's position reads this step. */
type Mode =
  | "gps" // aligned, tracking ready, a ±4 m fix
  | "weak" // aligned, tracking ready, a ±40 m fix (too weak to guide by)
  | "none" // aligned, tracking ready, no fix states an accuracy
  | "code" // a code lined the alignment up, GPS ±40 m
  | "not-ready" // aligned but tracking not ready: the fresh fix stands in
  | "drop" // a code holds, the camera pose dropped: no position
  | "no-zero"; // no GPS zero yet: no distance

type Step =
  | {
      readonly kind: "move";
      readonly dtMs: number;
      readonly near: number;
      readonly offN: number;
      readonly offE: number;
      readonly mode: Mode;
    }
  | { readonly kind: "skip" }
  | { readonly kind: "story-end"; readonly station: number }
  | { readonly kind: "code-locked" }
  | { readonly kind: "end-session" }
  | { readonly kind: "tour"; readonly which: 0 | 1 | null }
  | { readonly kind: "placement"; readonly allowed: boolean };

interface Spec {
  readonly north: number;
  readonly east: number;
  readonly next: number | undefined;
  readonly steps: boolean;
  readonly titled: boolean;
  readonly foundRadiusM: number;
}

const specArb = (n: number): fc.Arbitrary<Spec> =>
  fc.record({
    north: fc.integer({ min: -60, max: 60 }),
    east: fc.integer({ min: -60, max: 60 }),
    next: fc.option(fc.integer({ min: 0, max: n - 1 }), { nil: undefined }),
    steps: mostly(4),
    titled: mostly(3),
    foundRadiusM: fc.constantFrom(3, 5, 10),
  });

const stepArb = (n: number): fc.Arbitrary<Step> =>
  fc.oneof(
    {
      weight: 10,
      arbitrary: fc.record({
        kind: fc.constant("move" as const),
        dtMs: fc.constantFrom(
          0,
          500,
          1_000,
          3_000,
          5_999,
          6_000,
          7_000,
          60_000,
          130_000,
          400_000,
        ),
        near: fc.integer({ min: -1, max: n - 1 }),
        offN: fc.integer({ min: -12, max: 12 }),
        offE: fc.integer({ min: -12, max: 12 }),
        mode: fc.constantFrom<Mode>(
          "gps",
          "gps",
          "gps",
          "gps",
          "gps",
          "weak",
          "none",
          "code",
          "not-ready",
          "drop",
          "no-zero",
        ),
      }),
    },
    { weight: 5, arbitrary: fc.constant({ kind: "skip" as const }) },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant("story-end" as const),
        station: fc.integer({ min: 0, max: n - 1 }),
      }),
    },
    { weight: 1, arbitrary: fc.constant({ kind: "code-locked" as const }) },
    { weight: 1, arbitrary: fc.constant({ kind: "end-session" as const }) },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant("tour" as const),
        which: fc.constantFrom<0 | 1 | null>(0, 1, null),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant("placement" as const),
        allowed: mostly(3),
      }),
    },
  );

const caseArb = fc.integer({ min: 1, max: 5 }).chain((n) =>
  fc.record({
    specs: fc.array(specArb(n), { minLength: n, maxLength: n }),
    order: fc.constantFrom<TourOrder>("fixed", "any", "branch"),
    steps: fc.array(stepArb(n), { minLength: 1, maxLength: 80, size: "max" }),
  }),
);

function stationsOf(specs: readonly Spec[], tag: string): TourStation[] {
  return specs.map((s, i) => {
    const geo = calcGpsCoords(ZERO, [s.north, 0, s.east]);
    return {
      id: `s${String(i)}`,
      title: s.titled ? `${tag}${String(i)}` : " ",
      geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
      items: [],
      activateRadiusM: s.foundRadiusM * 4,
      foundRadiusM: s.foundRadiusM,
      hint: "arrow",
      ...(s.next === undefined ? {} : { next: `s${String(s.next)}` }),
      steps: s.steps
        ? [
            {
              id: "t",
              block: { kind: "text", text: "Hi" },
              advance: { mode: "tap" },
            },
          ]
        : [],
    };
  });
}

/** The world both guides read: one object, so they read the same. */
interface World {
  now: number;
  visitor: VisitorPosition;
  zero: typeof ZERO | null;
  tracking: boolean;
  lined: boolean;
  tour: { stations: readonly TourStation[]; order: TourOrder } | null;
  allowed: boolean;
}

function visitorAt(
  north: number,
  east: number,
  mode: Mode,
  now: number,
): Pick<World, "visitor" | "tracking" | "lined" | "zero"> {
  const accuracy = mode === "weak" || mode === "code" ? 40 : 4;
  const points = mode === "none" ? [] : [{ latLongAccuracy: accuracy }];
  return {
    visitor: {
      nue: mode === "drop" ? null : [north, 401.5, east],
      gpsPoints: points,
      fixNue: [north + 1, 400, east - 1],
      aligned: true,
      fixAtMs: now,
      fixAccuracyM: mode === "none" ? null : accuracy,
    },
    tracking: mode !== "not-ready" && mode !== "drop",
    lined: mode === "code" || mode === "drop",
    zero: mode === "no-zero" ? null : ZERO,
  };
}

/** Everything one guide said and did since the last look. */
interface Log {
  found: string[];
  done: string[];
  ended: string[];
  upcoming: string[];
  approach: string[];
  visitor: string[];
  guide: string[];
  huds: { targets: () => WayfindingTarget[]; disposed: boolean }[];
}

function emptyLog(): Log {
  return {
    found: [],
    done: [],
    ended: [],
    upcoming: [],
    approach: [],
    visitor: [],
    guide: [],
    huds: [],
  };
}

const xyz = (v: readonly [number, number, number] | null): string =>
  v === null ? "-" : v.map((x) => x.toFixed(6)).join(",");

type Wire = (deps: StationGuideDeps) => {
  tick(): void;
  codeLocked(): void;
  storyEnded(id: string): void;
  skipTapped(): void;
  endSession(): void;
  figurePoseOf(id: string): unknown;
};

/** One guide over the shared world, with its own store and log. */
function rig(wire: Wire, world: World, store: GuideStore, reenter: boolean) {
  const log = emptyLog();
  const dom = {
    line: { textContent: "", hidden: true },
    skip: { textContent: "", hidden: true },
  };
  const guide = wire({
    dom,
    tour: () => world.tour,
    placementAllowed: () => world.allowed,
    zero: () => world.zero,
    visitor: () => world.visitor,
    codeLinedUp: () => world.lined,
    alignmentReady: () => world.tracking || world.lined,
    trackingReady: () => world.tracking,
    startHud: (targets) => {
      const hud = { targets, disposed: false };
      log.huds.push(hud);
      return { dispose: () => (hud.disposed = true) };
    },
    now: () => world.now,
    guideStore: store,
    onFound: (s) => log.found.push(s.id),
    onDone: (id) => log.done.push(id),
    onApproach: (s, d, activateM) =>
      log.approach.push(`${s.id}:${d.toFixed(6)}:${String(activateM)}`),
    onUpcoming: (s) => log.upcoming.push(s.id),
    // The story panel, as the page wires it: ending a story ends it.
    onEndStory: (id) => {
      log.ended.push(id);
      guide.storyEnded(id);
    },
    onVisitor: (nue) => log.visitor.push(xyz(nue)),
    onGuide: (from, target) =>
      log.guide.push(
        `${xyz(from)}>${target === null ? "-" : `${target.id}@${xyz(target.to)}/${String(target.stopM)}`}`,
      ),
  });
  if (reenter) store.subscribe(() => guide.tick());
  return { guide, dom, log, store };
}

/** A guide's store, with the subscription the page re-enters it by. */
interface GuideStore extends VisitorGuideStore {
  subscribe(listener: () => void): () => void;
}

/** True with odds `k` to 1. */
function mostly(k: number): fc.Arbitrary<boolean> {
  return fc.integer({ min: 0, max: k }).map((x) => x > 0);
}

/** What a look at one guide shows; `asSets` for the per-render hints. */
function look(r: ReturnType<typeof rig>, asSets: boolean, ids: string[]) {
  const set = (xs: string[]) => (asSets ? [...new Set(xs)].sort() : [...xs]);
  const hud = r.log.huds.at(-1);
  const out = {
    line: [r.dom.line.textContent, r.dom.line.hidden],
    skip: [r.dom.skip.textContent, r.dom.skip.hidden],
    found: [...r.log.found],
    done: [...r.log.done],
    ended: [...r.log.ended],
    upcoming: set(r.log.upcoming),
    approach: set(r.log.approach),
    visitor: set(r.log.visitor),
    guide: asSets ? set(r.log.guide) : [...r.log.guide],
    lastGuide: r.log.guide.at(-1) ?? null,
    hudsStarted: r.log.huds.length,
    hudLive: hud === undefined ? null : !hud.disposed,
    hud:
      hud === undefined || hud.disposed
        ? []
        : hud
            .targets()
            .map(
              (t) =>
                `${t.id ?? "?"}:${xyz([t.position.x, t.position.y, t.position.z])}:${String(t.distanceMin)}:${String(t.distanceMax)}`,
            ),
    present: r.store.getState().visitorGuide.presentStationId,
    pending: r.store.getState().visitorGuide.headingPending,
    figures: ids.map((id) => r.guide.figurePoseOf(id) !== null),
  };
  const cleared = emptyLog();
  r.log.found = cleared.found;
  r.log.done = cleared.done;
  r.log.ended = cleared.ended;
  r.log.upcoming = cleared.upcoming;
  r.log.approach = cleared.approach;
  r.log.visitor = cleared.visitor;
  r.log.guide = cleared.guide;
  return out;
}

function frozenStore(): GuideStore {
  return configureStore({ reducer: { visitorGuide: visitorGuideReducer } });
}

/** The page's own store, as `visitor-stations.ts` hands it to the guide. */
function liveStore(): GuideStore {
  return createTourViewerStore();
}

function wireLive(store: GuideStore): Wire {
  return (deps) => wireStationGuide({ ...deps, guideStore: store });
}

/** What the frozen guide was seen doing, over every run: each must be
 *  reached, or the comparison never covered it. */
const COVERAGE = {
  found: (w: Look) => w.found.length,
  done: (w: Look) => w.done.length,
  storyEnd: (w: Look) => w.ended.length,
  askSkip: (w: Look) => Number(w.skip[0] === "Can't get there?"),
  skipOffered: (w: Look) => Number(String(w.skip[0]).startsWith("Skip ")),
  undoOffered: (w: Look) => Number(String(w.skip[0]).startsWith("Undo: ")),
  endAsk: (w: Look) => Number(w.skip[0] === "End this story?"),
  skippedNote: (w: Look) => Number(String(w.line[0]).startsWith("Skipped ")),
  broughtBack: (w: Look) =>
    Number(String(w.line[0]).startsWith("Brought back ")),
  complete: (w: Look) => Number(String(w.line[0]).startsWith("Tour complete")),
  weakGps: (w: Look) => Number(String(w.line[0]).includes("GPS too weak")),
  askCode: (w: Look) =>
    Number(String(w.line[0]).includes("scan one of the tour's codes")),
  hud: (w: Look) => Number(w.hud.length > 0),
  upcoming: (w: Look) => Number(w.upcoming.length > 0),
} as const;
type Look = ReturnType<typeof look>;
type Coverage = Record<keyof typeof COVERAGE, number>;

function runCase(
  c: { specs: readonly Spec[]; order: TourOrder; steps: readonly Step[] },
  reenter: boolean,
  seen: Coverage,
): void {
  const tours = [
    { stations: stationsOf(c.specs, "A"), order: c.order },
    { stations: stationsOf(c.specs, "B"), order: c.order },
  ] as const;
  const world: World = {
    now: 1_000_000,
    ...visitorAt(500, 500, "gps", 1_000_000),
    tour: tours[0],
    allowed: true,
  };
  const ids = c.specs.map((_, i) => `s${String(i)}`);
  const fStore = frozenStore();
  const lStore = liveStore();
  const frozen = rig(wireFrozenGuide, world, fStore, reenter);
  const live = rig(wireLive(lStore), world, lStore, reenter);
  const both = (f: (g: ReturnType<typeof rig>["guide"]) => void) => {
    f(frozen.guide);
    f(live.guide);
  };
  c.steps.forEach((step, k) => {
    switch (step.kind) {
      case "move": {
        world.now += step.dtMs;
        const spec = c.specs[step.near];
        const [n, e] =
          spec === undefined ? [300, -300] : [spec.north, spec.east];
        Object.assign(
          world,
          visitorAt(n + step.offN / 4, e + step.offE / 4, step.mode, world.now),
        );
        both((g) => g.tick());
        break;
      }
      case "skip":
        both((g) => g.skipTapped());
        break;
      case "story-end":
        both((g) => g.storyEnded(ids[step.station]!));
        break;
      case "code-locked":
        both((g) => g.codeLocked());
        break;
      case "end-session":
        both((g) => g.endSession());
        break;
      case "tour":
        world.tour = step.which === null ? null : tours[step.which];
        break;
      case "placement":
        world.allowed = step.allowed;
        break;
    }
    // Under the page's subscription the next camera frame ticks too.
    if (reenter) both((g) => g.tick());
    const want = look(frozen, reenter, ids);
    const got = look(live, reenter, ids);
    for (const key of Object.keys(COVERAGE) as (keyof Coverage)[]) {
      seen[key] += COVERAGE[key](want);
    }
    expect(got, `step ${String(k)} ${JSON.stringify(step)}`).toEqual(want);
  });
}

describe("the station guide against its frozen copy (W4 M1's differential)", () => {
  for (const reenter of [false, true]) {
    it(`shows and decides the same after every step${reenter ? ", with the page's re-entering store subscription" : ""}`, () => {
      const seen = Object.fromEntries(
        Object.keys(COVERAGE).map((key) => [key, 0]),
      ) as Coverage;
      let runs = 0;
      fc.assert(
        fc.property(caseArb, (c) => {
          runCase(c, reenter, seen);
          runs += 1;
        }),
        { numRuns: 400 },
      );
      // Not vacuous: the walks find stations, and every label, note and
      // line the guide can show was shown and compared.
      expect(seen.found).toBeGreaterThan(runs);
      for (const [key, count] of Object.entries(seen)) {
        expect(count, key).toBeGreaterThan(0);
      }
    });
  }
});
