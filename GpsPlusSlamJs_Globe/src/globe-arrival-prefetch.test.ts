/**
 * The arrival prefetch, moved out of the globe lab's pin.
 *
 * Why this file matters: the prefetch is what the approach waits for. The
 * paced dive lands when the city's data is in (or at the pace's cap), and
 * the continuous flight's gate opens on its progress. A wrong rule here is
 * a flight that waits out its cap for a city that will never load, a dive
 * paced although `diveMs` was set by hand, a stopped flight whose load runs
 * on, or a late outcome of an old flight written over the new one's line.
 * The recording fakes pin the loads started, the aborts and the status
 * lines written, in order.
 */
import { describe, expect, it } from "vitest";

import { arrivalStatusText } from "./globe-arrival.js";
import { createArrivalPrefetch } from "./globe-arrival-prefetch.js";
import type { GlobeCityLoadHandle } from "./globe-city.js";

const BERN = { lat: 46.948, lng: 7.4474 };
const JOBS = (total: number, warm: number) => ({
  total,
  warm,
  fetched: 0,
  failed: 0,
});

/** A city load the test settles, recording its aborts. */
function fakeLoad(log: string[], name: string) {
  let settle!: (outcome: string) => void;
  let share = 0;
  const handle = {
    progress: () => share,
    done: false,
    finished: new Promise<{ outcome: string; counts: never }>((resolve) => {
      settle = (outcome) => resolve({ outcome, counts: undefined as never });
    }),
    stats: () => ({
      counts: { overpass: JOBS(4, 1), dem: JOBS(2, 2) },
      inFlight: 0,
      bytesStored: 0,
    }),
    abort: () => log.push(`abort ${name}`),
  };
  return {
    handle: handle as unknown as GlobeCityLoadHandle,
    settle: (o: string) => settle(o),
    setProgress: (p: number) => (share = p),
  };
}

function setup({
  manual = false,
  loads = [] as ReturnType<typeof fakeLoad>[],
}) {
  const log: string[] = [];
  const prefetch = createArrivalPrefetch({
    startCityLoad: (t) => {
      log.push(`load ${t.lat},${t.lng}`);
      return loads.shift()?.handle ?? null;
    },
    show: (text) => log.push(`show ${text}`),
    manualDive: () => manual,
  });
  return { prefetch, log };
}

const counts = { overpass: JOBS(4, 1), dem: JOBS(2, 2) };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createArrivalPrefetch", () => {
  it("has no state and no line before the first flight", () => {
    const { prefetch, log } = setup({});
    expect(prefetch.state()).toBeNull();
    expect(prefetch.progress()).toBe(0);
    prefetch.render();
    prefetch.stop();
    expect(log).toEqual([]);
  });

  it("starts the city's load, paces the dive on its progress, and shows the running line", async () => {
    const log0: string[] = [];
    const load = fakeLoad(log0, "a");
    const { prefetch, log } = setup({ loads: [load] });
    const clock = prefetch.start(BERN, { prefetch: 1, diveMs: 8000 });
    const running = arrivalStatusText({ outcome: null, counts });
    expect(log).toEqual([`load ${BERN.lat},${BERN.lng}`, `show ${running}`]);
    expect(prefetch.state()).toMatchObject({
      outcome: null,
      progress: 0,
      paced: true,
      line: running,
    });
    // Paced: no data yet, so the dive barely moves.
    const early = clock(1000);
    load.setProgress(1);
    expect(prefetch.progress()).toBe(1);
    expect(clock(1000)).toBeGreaterThanOrEqual(early);
    load.settle("settled");
    await flush();
    expect(prefetch.state()?.outcome).toBe("settled");
    expect(log.at(-1)).toBe(
      `show ${arrivalStatusText({ outcome: "settled", counts })}`,
    );
  });

  it("writes the line only when its text changes", () => {
    const load = fakeLoad([], "a");
    const { prefetch, log } = setup({ loads: [load] });
    prefetch.start(BERN, { prefetch: 1, diveMs: 8000 });
    prefetch.render();
    prefetch.render();
    expect(log.filter((l) => l.startsWith("show"))).toHaveLength(1);
  });

  it("keeps the fixed dive when diveMs was set by hand, still loading the city", () => {
    const load = fakeLoad([], "a");
    const { prefetch } = setup({ manual: true, loads: [load] });
    const clock = prefetch.start(BERN, { prefetch: 1, diveMs: 8000 });
    expect(clock(1234)).toBe(1234);
    expect(prefetch.state()?.paced).toBe(false);
    expect(prefetch.state()?.rate).toBe(1 / 8000);
  });

  it("is off with prefetch=0: nothing loaded, nothing shown, nothing waited for", () => {
    const { prefetch, log } = setup({});
    const clock = prefetch.start(BERN, { prefetch: 0, diveMs: 8000 });
    expect(log).toEqual([]);
    expect(clock(500)).toBe(500);
    expect(prefetch.progress()).toBe(1);
    expect(prefetch.state()?.outcome).toBe("off");
  });

  it("counts as done without a city to load", () => {
    const { prefetch, log } = setup({ loads: [] });
    prefetch.start(BERN, { prefetch: 1, diveMs: 8000 });
    expect(log).toEqual([`load ${BERN.lat},${BERN.lng}`]);
    expect(prefetch.progress()).toBe(1);
    expect(prefetch.state()?.outcome).toBe("off");
    expect(prefetch.state()?.line).toBe("");
  });

  it("aborts a running load when stopped, once, and shows it", () => {
    const log0: string[] = [];
    const load = fakeLoad(log0, "a");
    const { prefetch, log } = setup({ loads: [load] });
    prefetch.start(BERN, { prefetch: 1, diveMs: 8000 });
    prefetch.stop();
    prefetch.stop();
    expect(log0).toEqual(["abort a"]);
    expect(prefetch.state()?.outcome).toBe("aborted");
    expect(log.at(-1)).toBe(
      `show ${arrivalStatusText({ outcome: "aborted", counts })}`,
    );
  });

  it("does not abort a load that already ended", async () => {
    const log0: string[] = [];
    const load = fakeLoad(log0, "a");
    const { prefetch } = setup({ loads: [load] });
    prefetch.start(BERN, { prefetch: 1, diveMs: 8000 });
    load.settle("settled");
    await flush();
    prefetch.stop();
    expect(log0).toEqual([]);
    expect(prefetch.state()?.outcome).toBe("settled");
  });

  it("a new flight stops the last, and the old load's late outcome is not taken", async () => {
    const log0: string[] = [];
    const a = fakeLoad(log0, "a");
    const b = fakeLoad(log0, "b");
    const { prefetch } = setup({ loads: [a, b] });
    prefetch.start(BERN, { prefetch: 1, diveMs: 8000 });
    prefetch.start(BERN, { prefetch: 1, diveMs: 8000 });
    expect(log0).toEqual(["abort a"]);
    a.settle("settled");
    await flush();
    expect(prefetch.state()?.outcome).toBeNull();
    b.setProgress(0.5);
    expect(prefetch.progress()).toBe(0.5);
  });
});
