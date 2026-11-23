/**
 * What the camera says about itself at a photo: the track's settings
 * (focus distance and mode, zoom, size, frame rate) and the focus and
 * zoom ranges of its capabilities, as a flat record for the shot's JSON
 * and one log line. Browsers differ in what they report, so every field
 * is optional and reading never throws.
 *
 * @see camera-report.ts.md
 */

/** The fields a report may hold; numbers except the two focus modes. */
const NUMBER_SETTINGS = [
  "focusDistance",
  "zoom",
  "width",
  "height",
  "frameRate",
] as const;
const RANGES = ["focusDistance", "zoom"] as const;
const BOUNDS = [
  ["min", "Min"],
  ["max", "Max"],
  ["step", "Step"],
] as const;
const STRING_KEYS: readonly string[] = ["focusMode", "focusModes"];
const NUMBER_KEYS: readonly string[] = [
  ...NUMBER_SETTINGS,
  ...RANGES.flatMap((r) => BOUNDS.map(([, s]) => `${r}${s}`)),
];

/** The camera's report at one photo; a field it did not give is absent. */
export type CameraReport = Readonly<Record<string, number | string>>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** `track[name]()` as an object; {} when it is missing, throws or is not one. */
function call(track: unknown, name: string): Record<string, unknown> {
  if (!isObj(track)) {
    return {};
  }
  try {
    const fn = track[name];
    const v: unknown = typeof fn === "function" ? fn.call(track) : undefined;
    return isObj(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * The report of a video track (a `MediaStreamTrack`, or anything else:
 * then empty). Only the fields above are kept, so no device id leaves the
 * phone.
 */
export function cameraReport(track: unknown): CameraReport {
  const out: Record<string, number | string> = {};
  const s = call(track, "getSettings");
  for (const k of NUMBER_SETTINGS) {
    const v = s[k];
    if (isNum(v)) {
      out[k] = v;
    }
  }
  if (typeof s.focusMode === "string" && s.focusMode !== "") {
    out.focusMode = s.focusMode;
  }
  const c = call(track, "getCapabilities");
  for (const k of RANGES) {
    const r = c[k];
    for (const [bound, suffix] of BOUNDS) {
      const v = isObj(r) ? r[bound] : undefined;
      if (isNum(v)) {
        out[`${k}${suffix}`] = v;
      }
    }
  }
  const modes = Array.isArray(c.focusMode)
    ? c.focusMode.filter((m): m is string => typeof m === "string" && m !== "")
    : [];
  if (modes.length > 0) {
    out.focusModes = modes.join(",");
  }
  return out;
}

/** A stored report: only the known fields, numbers finite, modes strings. */
export const isCameraReport = (v: unknown): v is CameraReport =>
  isObj(v) &&
  Object.entries(v).every(([k, x]) =>
    STRING_KEYS.includes(k)
      ? typeof x === "string"
      : NUMBER_KEYS.includes(k) && isNum(x),
  );

/** One value and its range or choices, or "" when the value is absent. */
function part(r: CameraReport, key: string, extra: string | undefined) {
  const v = r[key];
  if (v === undefined) {
    return "";
  }
  return `${key} ${String(v)}${extra ? ` (${extra})` : ""}`;
}

const range = (r: CameraReport, key: string): string | undefined => {
  const min = r[`${key}Min`];
  const max = r[`${key}Max`];
  return min === undefined || max === undefined
    ? undefined
    : `${String(min)}-${String(max)}`;
};

/** The report as one log line; "nothing reported" when it is empty. */
export function cameraReportText(r: CameraReport): string {
  const size =
    r.width !== undefined && r.height !== undefined
      ? `${String(r.width)}x${String(r.height)}${r.frameRate === undefined ? "" : ` at ${String(r.frameRate)} fps`}`
      : "";
  const parts = [
    part(r, "focusDistance", range(r, "focusDistance")),
    part(r, "focusMode", r.focusModes as string | undefined),
    part(r, "zoom", range(r, "zoom")),
    size,
  ].filter((p) => p !== "");
  return parts.length > 0 ? parts.join(", ") : "nothing reported";
}
