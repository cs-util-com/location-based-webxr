/**
 * The speed test of the feature matching page: every arm loaded (download,
 * start-up), one first run each, then N rounds interleaved, so a phone
 * warming up or throttling slows every arm alike and a ratio to the
 * reference arm stays meaningful. Also its plain-text report.
 *
 * @see bench-timing.ts.md
 */
import { formatBytes, errorText, type DownloadRecord } from "./bench-net";
import { deviceLines, type DeviceInfo } from "./bench-report";
import {
  CORRECT_TOL_PX,
  type BenchInput,
  type BenchMethod,
  type MethodRunner,
} from "./bench-run";
import { formatMs, summarize, type Summary } from "./bench-stats";
import { countCorrect } from "./bench-synthetic";

/** One timed part of a step (one frame's extraction, a match, a forward pass). */
interface TimingPhase {
  readonly name: string;
  readonly ms: number;
}

/** One run of an arm: its phases and a short sanity text. */
export interface TimingStep {
  readonly phases: readonly TimingPhase[];
  /** e.g. "kp 512/498, matches 301, correct 297" or "cosine A-B 0.912". */
  readonly note: string;
}

/** An arm loaded and ready to time. */
export interface LoadedTimingArm {
  /** The backend in use, as the runtime reports it. */
  readonly backend: string;
  readonly downloads: readonly DownloadRecord[];
  /** Session start-up (model compile / session creation), downloads excluded. */
  readonly startupMs: number;
  readonly notes: readonly string[];
  step(): Promise<TimingStep>;
  dispose(): void;
}

/** An arm of the speed test. */
export interface TimingArm {
  readonly id: string;
  readonly label: string;
  /** Arms are compared within a group (the requested backend). */
  readonly group: string;
  /** The arm the others in its group are divided by. */
  readonly reference: boolean;
  load(): Promise<LoadedTimingArm>;
}

interface PhaseTiming {
  readonly name: string;
  /** The first run's time; NaN when there was none. */
  readonly first: number;
  /** The N runs after the first. */
  readonly steady: Summary;
}

export interface ArmTiming {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly reference: boolean;
  readonly backend: string;
  readonly downloads: readonly DownloadRecord[];
  /** The whole load as the harness saw it: downloads, checks and start-up. */
  readonly loadMs: number;
  readonly startupMs: number;
  readonly notes: readonly string[];
  readonly phases: readonly PhaseTiming[];
  /** Sum of the phases per run. */
  readonly total: PhaseTiming;
  /** The last run's sanity text. */
  readonly note: string;
  readonly error: string | null;
}

export interface TimingHooks {
  readonly now: () => number;
  /** Lets the page paint between runs. */
  readonly yieldToUi: () => Promise<void>;
  readonly log: (line: string) => void;
}

/** The runs field of the speed test: a whole number 1 to 50, else 10. */
export function parseTimingRuns(value: string): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 10;
}

/**
 * The backends to time: the ticked ones, WebGPU first; WebGPU without an
 * adapter becomes WASM, and the note says so.
 */
export function timingBackends(
  ticked: readonly ("webgpu" | "wasm")[],
  webgpuAvailable: boolean,
): { backends: ("webgpu" | "wasm")[]; note: string | null } {
  const wantGpu = ticked.includes("webgpu");
  const out: ("webgpu" | "wasm")[] = [];
  if (wantGpu && webgpuAvailable) {
    out.push("webgpu");
  }
  if (ticked.includes("wasm") || (wantGpu && !webgpuAvailable)) {
    out.push("wasm");
  }
  return {
    backends: out,
    note:
      wantGpu && !webgpuAvailable
        ? "no WebGPU on this device: WASM instead"
        : null,
  };
}

/**
 * The arm order of a round, from a balanced (Williams) design: row
 * 0, 1, n-1, 2, n-2, ... shifted by the round, and for an odd count the
 * mirrored rows in the second half of a cycle of 2n rounds. Over a cycle
 * (n rounds, 2n for odd n) every arm leads equally often and follows every
 * other arm equally often, so no arm always runs right after the heaviest.
 */
export function roundOrder(count: number, round: number): number[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`count must be a whole number, got ${String(count)}`);
  }
  if (count === 0) {
    return [];
  }
  const cycle = count % 2 === 0 ? count : 2 * count;
  const r = ((round % cycle) + cycle) % cycle;
  const shift = r % count;
  const row = Array.from({ length: count }, (_, k) => {
    const base = k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : count - k / 2;
    return (base + shift) % count;
  });
  return r >= count ? row.reverse() : row;
}

/**
 * runTiming once per backend group, one group after another in the order
 * the groups first appear, so the sessions of one backend are released
 * before the next backend loads; the results keep the arm order within a
 * group, groups in that order.
 */
export async function runTimingByGroup(
  arms: readonly TimingArm[],
  options: { readonly runs: number },
  hooks: TimingHooks,
): Promise<ArmTiming[]> {
  const groups: string[] = [];
  for (const a of arms) {
    if (!groups.includes(a.group)) {
      groups.push(a.group);
    }
  }
  const results: ArmTiming[] = [];
  for (const g of groups) {
    const of = arms.filter((a) => a.group === g);
    hooks.log(
      `backend ${g}: ${String(of.length)} arm${of.length === 1 ? "" : "s"}`,
    );
    results.push(...(await runTiming(of, options, hooks)));
  }
  return results;
}

/** Collected samples of one arm while the rounds run. */
interface Tally {
  first: TimingStep | null;
  steady: TimingStep[];
  error: string | null;
}

function phaseTimings(t: Tally): { phases: PhaseTiming[]; total: PhaseTiming } {
  const names: string[] = [];
  for (const s of [t.first, ...t.steady]) {
    for (const p of s?.phases ?? []) {
      if (!names.includes(p.name)) {
        names.push(p.name);
      }
    }
  }
  const pick = (s: TimingStep, name: string) =>
    s.phases.filter((p) => p.name === name).reduce((sum, p) => sum + p.ms, 0);
  const sum = (s: TimingStep) => s.phases.reduce((acc, p) => acc + p.ms, 0);
  return {
    phases: names.map((name) => ({
      name,
      first: t.first ? pick(t.first, name) : NaN,
      steady: summarize(t.steady.map((s) => pick(s, name))),
    })),
    total: {
      name: "total",
      first: t.first ? sum(t.first) : NaN,
      steady: summarize(t.steady.map(sum)),
    },
  };
}

/**
 * Loads every arm in order (a failed load is kept as an error and the rest
 * go on), runs each loaded arm once (the first run), then `runs` rounds in
 * `roundOrder`. An arm whose run throws stops there with its error; the
 * others go on. Every loaded arm is disposed.
 */
export async function runTiming(
  arms: readonly TimingArm[],
  options: { readonly runs: number },
  hooks: TimingHooks,
): Promise<ArmTiming[]> {
  const runs = Math.max(1, Math.floor(options.runs));
  const loaded: (LoadedTimingArm | null)[] = [];
  const loadMs: number[] = [];
  const tallies: Tally[] = arms.map(() => ({
    first: null,
    steady: [],
    error: null,
  }));
  try {
    for (const [i, arm] of arms.entries()) {
      hooks.log(`${arm.label}: loading`);
      const t0 = hooks.now();
      try {
        const l = await arm.load();
        loaded.push(l);
        loadMs.push(hooks.now() - t0);
        hooks.log(
          `${arm.label}: ready on ${l.backend}, start-up ${formatMs(l.startupMs)} ms`,
        );
      } catch (e) {
        loaded.push(null);
        loadMs.push(hooks.now() - t0);
        tallies[i]!.error = `load: ${errorText(e)}`;
        hooks.log(`ERROR ${arm.label}: ${tallies[i]!.error}`);
      }
      await hooks.yieldToUi();
    }
    const runOne = async (i: number, steady: boolean): Promise<void> => {
      const l = loaded[i];
      const t = tallies[i]!;
      if (!l || t.error !== null) {
        return;
      }
      try {
        const s = await l.step();
        if (steady) {
          t.steady.push(s);
        } else {
          t.first = s;
        }
      } catch (e) {
        t.error = `${steady ? `run ${String(t.steady.length + 1)}` : "first run"}: ${errorText(e)}`;
        hooks.log(`ERROR ${arms[i]!.label}: ${t.error}`);
      }
      await hooks.yieldToUi();
    };
    for (let i = 0; i < arms.length; i++) {
      await runOne(i, false);
    }
    hooks.log("first runs done");
    for (let r = 0; r < runs; r++) {
      for (const i of roundOrder(arms.length, r)) {
        await runOne(i, true);
      }
      hooks.log(`round ${String(r + 1)} of ${String(runs)} done`);
    }
  } finally {
    for (const l of loaded) {
      l?.dispose();
    }
  }
  return arms.map((arm, i) => {
    const l = loaded[i];
    const t = tallies[i]!;
    const last = t.steady.at(-1) ?? t.first;
    return {
      id: arm.id,
      label: arm.label,
      group: arm.group,
      reference: arm.reference,
      backend: l?.backend ?? "-",
      downloads: l?.downloads ?? [],
      loadMs: loadMs[i] ?? NaN,
      startupMs: l?.startupMs ?? NaN,
      notes: l?.notes ?? [],
      ...phaseTimings(t),
      note: last?.note ?? "",
      error: t.error,
    };
  });
}

/**
 * The arm's steady median total over its group's reference arm's, or null
 * when either is missing (no reference in the group, a failed arm, or the
 * arm is the reference).
 */
export function referenceRatio(
  arm: ArmTiming,
  all: readonly ArmTiming[],
): { label: string; ratio: number } | null {
  if (arm.reference) {
    return null;
  }
  const ref = all.find(
    (a) => a.reference && a.group === arm.group && a.error === null,
  );
  const num = arm.total.steady.median;
  const den = ref?.total.steady.median;
  if (!ref || !Number.isFinite(num) || !Number.isFinite(den) || !den) {
    return null;
  }
  return { label: ref.label, ratio: num / den };
}

/**
 * A loaded bench method as a timing arm: a run is extract A, extract B and
 * the match, each timed; its note counts keypoints, matches and, on a pair
 * with a known warp, the matches within the bench's tolerance.
 */
export function methodTimingArm(
  method: BenchMethod,
  input: BenchInput,
  opts: { readonly group: string; readonly reference: boolean },
  now: () => number,
): TimingArm {
  return {
    id: method.id,
    label: method.label,
    group: opts.group,
    reference: opts.reference,
    async load(): Promise<LoadedTimingArm> {
      const runner: MethodRunner = await method.init();
      return {
        backend: runner.backend,
        downloads: runner.downloads,
        startupMs: runner.initMs,
        notes: runner.notes,
        async step(): Promise<TimingStep> {
          const t0 = now();
          const ea = await runner.extract(input.a);
          const t1 = now();
          const eb = await runner.extract(input.b);
          const t2 = now();
          const pairs = await runner.match(ea, eb);
          const t3 = now();
          const correct = input.warp
            ? `, correct ${String(countCorrect(pairs, ea, eb, input.warp, input.a.width, input.a.height, CORRECT_TOL_PX))}`
            : "";
          return {
            phases: [
              { name: "extract A", ms: t1 - t0 },
              { name: "extract B", ms: t2 - t1 },
              { name: "match", ms: t3 - t2 },
            ],
            note: `kp ${String(ea.count)}/${String(eb.count)}, matches ${String(pairs.length / 2)}${correct}`,
          };
        },
        dispose: () => runner.dispose(),
      };
    },
  };
}

export interface TimingReportInput {
  readonly startedAt: string;
  readonly device: DeviceInfo;
  /** The pair, its size and grey values. */
  readonly input: string;
  /** Long edge, keypoint cap, backends: what every number rests on. */
  readonly settings: string;
  readonly runs: number;
  readonly results: readonly ArmTiming[];
  readonly errors: readonly string[];
}

const ms = (v: number): string => `${formatMs(v)}`;

function armLines(a: ArmTiming, all: readonly ArmTiming[]): string[] {
  const lines = [`## ${a.label}${a.reference ? " (reference)" : ""}`];
  if (a.backend !== "-") {
    lines.push(
      `backend: ${a.backend} | load ${ms(a.loadMs)} ms (start-up ${ms(a.startupMs)} ms)`,
    );
  }
  for (const d of a.downloads) {
    const cache = d.cached === null ? "" : d.cached ? " (cache)" : " (network)";
    const files = d.files > 1 ? ` in ${String(d.files)} files` : "";
    lines.push(
      `download ${d.label}: ${formatBytes(d.bytes)}${files}, ${ms(d.ms)} ms${cache}`,
    );
  }
  for (const n of a.notes) {
    lines.push(`note: ${n}`);
  }
  if (a.phases.length > 0) {
    const first = [...a.phases, a.total]
      .map((p) => `${p.name} ${ms(p.first)}`)
      .join(" | ");
    lines.push(`first run ms: ${first}`);
    const steady = [...a.phases, a.total]
      .map((p) => `${p.name} ${ms(p.steady.median)} / ${ms(p.steady.p90)}`)
      .join(" | ");
    lines.push(
      `steady ms (median / p90, n=${String(a.total.steady.n)}): ${steady}`,
    );
  }
  const ratio = referenceRatio(a, all);
  if (ratio) {
    lines.push(
      `ratio to ${ratio.label} (median total): ${ratio.ratio.toFixed(2)}x`,
    );
  }
  if (a.note !== "") {
    lines.push(`last run: ${a.note}`);
  }
  if (a.error !== null) {
    lines.push(`ERROR ${a.error}`);
  }
  return lines;
}

/** The whole speed test as one plain-text block for the copy-log output. */
export function formatTimingReport(r: TimingReportInput): string {
  const lines = [
    "Feature matching speed test",
    `started: ${r.startedAt}`,
    ...deviceLines(r.device),
    `input: ${r.input}`,
    `settings: ${r.settings}`,
    `runs: 1 first run per arm, then ${String(r.runs)} interleaved rounds (order rotated each round); steady = those ${String(r.runs)}`,
    `load = download + checks + start-up, start-up = session creation (download excluded); times in ms`,
    ...r.errors.map((e) => `ERROR ${e}`),
  ];
  for (const a of r.results) {
    lines.push("", ...armLines(a, r.results));
  }
  return `${lines.join("\n")}\n`;
}
