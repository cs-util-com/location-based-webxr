/**
 * The feature matching benchmark's output: the rows of the results table
 * and the plain-text log a tester copies into a chat.
 *
 * @see bench-report.ts.md
 */
import { formatBytes } from "./bench-net";
import { CORRECT_TOL_PX, type MethodResult } from "./bench-run";
import { formatMs } from "./bench-stats";

/** What the page learns about the device; null where the browser hides it. */
export interface DeviceInfo {
  readonly userAgent: string;
  readonly model: string | null;
  readonly platformVersion: string | null;
  readonly hardwareConcurrency: number | null;
  readonly deviceMemoryGb: number | null;
  readonly crossOriginIsolated: boolean;
  readonly jspi: boolean;
  readonly screen: string;
  /** "none", or the adapter's vendor, architecture, description and features. */
  readonly webgpu: string;
}

export interface ReportInput {
  readonly startedAt: string;
  readonly device: DeviceInfo;
  /** What was measured, with each frame's size and grey values, e.g. "camera A 549x1280, grey mean 107.3 sd 46.0 (0-255); B ...". */
  readonly input: string;
  readonly sizes: readonly number[];
  readonly runs: number;
  readonly results: readonly MethodResult[];
  /** Lines logged outside the loop (a page error, a camera failure). */
  readonly errors: readonly string[];
}

/** One row of the results table. */
export interface TableRow {
  readonly method: string;
  readonly backend: string;
  readonly size: string;
  readonly extract: string;
  readonly match: string;
  readonly keypoints: string;
  readonly descriptorBytes: string;
  readonly matches: string;
  readonly correct: string;
  readonly error: string;
}

const num = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? "-" : String(v);

/** The table: one row per method and size, one row for a method that failed to load. */
export function tableRows(results: readonly MethodResult[]): TableRow[] {
  const rows: TableRow[] = [];
  for (const r of results) {
    if (r.error !== null) {
      rows.push({
        method: r.label,
        backend: r.backend,
        size: "-",
        extract: "-",
        match: "-",
        keypoints: "-",
        descriptorBytes: "-",
        matches: "-",
        correct: "-",
        error: r.error,
      });
      continue;
    }
    for (const s of r.sizes) {
      rows.push({
        method: r.label,
        backend: r.backend,
        size: `${String(s.width)}x${String(s.height)}`,
        extract: `${formatMs(s.extract.median)} / ${formatMs(s.extract.p90)}`,
        match: `${formatMs(s.match.median)} / ${formatMs(s.match.p90)}`,
        keypoints: num(s.keypoints),
        descriptorBytes: formatBytes(
          Number.isFinite(s.descriptorBytes) ? s.descriptorBytes : null,
        ),
        matches: num(s.matches),
        correct: num(s.correct),
        error: s.error ?? "",
      });
    }
  }
  return rows;
}

function deviceLines(d: DeviceInfo): string[] {
  return [
    `user agent: ${d.userAgent}`,
    `model: ${d.model ?? "-"}, platform version: ${d.platformVersion ?? "-"}`,
    `cores: ${num(d.hardwareConcurrency)}, memory: ${d.deviceMemoryGb === null ? "-" : `${String(d.deviceMemoryGb)} GB`}, cross-origin isolated: ${d.crossOriginIsolated ? "yes" : "no"}, JSPI: ${d.jspi ? "yes" : "no"}`,
    `screen: ${d.screen}`,
    `webgpu: ${d.webgpu}`,
  ];
}

function methodLines(r: MethodResult): string[] {
  const lines = [`## ${r.label}`];
  if (r.error !== null) {
    lines.push(`ERROR ${r.error}`);
    return lines;
  }
  lines.push(`backend: ${r.backend}, init ${formatMs(r.initMs)} ms`);
  for (const d of r.downloads) {
    const cache = d.cached === null ? "" : d.cached ? " (cache)" : " (network)";
    const files = d.files > 1 ? ` in ${String(d.files)} files` : "";
    lines.push(
      `download ${d.label}: ${formatBytes(d.bytes)}${files}, ${formatMs(d.ms)} ms${cache}`,
    );
  }
  for (const n of r.notes) {
    lines.push(`note: ${n}`);
  }
  for (const s of r.sizes) {
    const head = `@${String(s.longEdge)} (${String(s.width)}x${String(s.height)})`;
    if (s.error !== null) {
      lines.push(`${head}: ERROR ${s.error}`);
      continue;
    }
    lines.push(
      `${head}: extract ${formatMs(s.extract.median)} / ${formatMs(s.extract.p90)} ms` +
        ` | match ${formatMs(s.match.median)} / ${formatMs(s.match.p90)} ms` +
        ` | kp ${num(s.keypoints)} | desc ${formatBytes(s.descriptorBytes)}/frame` +
        ` | matches ${num(s.matches)}` +
        (s.correct === null ? "" : ` | correct ${num(s.correct)}`),
    );
  }
  return lines;
}

/** The whole run as one plain-text block: device, settings, every number. */
export function formatReport(r: ReportInput): string {
  const lines = [
    "Feature matching benchmark",
    `started: ${r.startedAt}`,
    ...deviceLines(r.device),
    `input: ${r.input}`,
    `sizes (long edge): ${r.sizes.join(", ")}; runs: ${String(r.runs)} after 1 warm-up`,
    `times: median / p90 in ms; extract per frame, match per pair` +
      `; correct = within ${String(CORRECT_TOL_PX)} px of the known warp (synthetic only)`,
    ...r.errors.map((e) => `ERROR ${e}`),
  ];
  for (const m of r.results) {
    lines.push("", ...methodLines(m));
  }
  return `${lines.join("\n")}\n`;
}
