/**
 * The writer's mirror, as runs: the body cut into stretches that each
 * carry the looks the mirror gives them (a dimmed mark, a heading's
 * words, bold, italic, a link's words, a picture's line, a part shown as
 * typed, the part the callout is about). The marks are found by a light
 * line reader that only decides looks; whether a part is shown as typed
 * comes from the framework reader (`typed-parts.ts`), never from here.
 *
 * @see mirror-marks.ts.md
 */

/** A look of the mirror; each maps to an `m-<look>` class. */
type MirrorLook =
  "mk" | "hd" | "b" | "i" | "ln" | "pic" | "iss" | "kept" | "cur";

/** A stretch `[from, to)` of the body with its looks. */
export interface MirrorRun {
  readonly from: number;
  readonly to: number;
  readonly looks: readonly MirrorLook[];
  /** The index of the part shown as typed it lies in, or -1. */
  readonly part: number;
}

/** A stretch with one look. */
interface Deco {
  readonly from: number;
  readonly to: number;
  readonly look: MirrorLook;
}

const ORDER: readonly MirrorLook[] = [
  "mk",
  "hd",
  "b",
  "i",
  "ln",
  "pic",
  "iss",
  "kept",
  "cur",
];

const HEADING = /^(#{2,3})(\s+)/;
const LIST = /^(\s*)([-*]|\d{1,3}\.)\s/;
const QUOTE = /^(\s*>\s?)/;
const PICTURE_LINE = /^\s*!\[[^\]\n]*\]\([^)\s]*\)\s*$/;
const INLINE =
  /(\[([^\]\n]+)\]\(([^)\s]+)\))|(\*\*(?=\S)([^*\n]+?)\*\*)|(\*(?=[^\s*])([^*\n]+?)\*)/g;

/** The looks the marks of one line give, its start at `base`. */
function lineDecos(line: string, base: number, out: Deco[]): void {
  if (PICTURE_LINE.test(line)) {
    out.push({ from: base, to: base + line.length, look: "pic" });
    return;
  }
  let rest = 0;
  const h = HEADING.exec(line);
  if (h !== null) {
    const mk = (h[1] ?? "").length + (h[2] ?? "").length;
    out.push({ from: base, to: base + mk, look: "mk" });
    out.push({ from: base + mk, to: base + line.length, look: "hd" });
    rest = mk;
  } else {
    const q = QUOTE.exec(line);
    if (q !== null) {
      const len = (q[1] ?? "").length;
      out.push({ from: base, to: base + len, look: "mk" });
      rest = len;
    }
    const l = LIST.exec(line.slice(rest));
    if (l !== null) {
      const at = rest + (l[1] ?? "").length;
      const mark = (l[2] ?? "").length;
      out.push({ from: base + at, to: base + at + mark, look: "mk" });
      rest = at + mark;
    }
  }
  const text = line.slice(rest);
  const re = new RegExp(INLINE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const a = base + rest + m.index;
    const e = a + m[0].length;
    if (m[1] !== undefined) {
      const words = (m[2] ?? "").length;
      out.push({ from: a, to: a + 1, look: "mk" });
      out.push({ from: a + 1, to: a + 1 + words, look: "ln" });
      out.push({ from: a + 1 + words, to: e, look: "mk" });
    } else {
      const n = m[4] !== undefined ? 2 : 1;
      const look: MirrorLook = n === 2 ? "b" : "i";
      out.push({ from: a, to: a + n, look: "mk" });
      out.push({ from: a + n, to: e - n, look });
      out.push({ from: e - n, to: e, look: "mk" });
    }
  }
}

/**
 * The mirror's runs for `body`: its marks' looks, the parts shown as
 * typed (`parts`, ordered, kept ones looking `kept`) and the callout's
 * part (`current`, an index of `parts`, or -1). Runs cover the body in
 * order, without gaps.
 */
export function mirrorRuns(
  body: string,
  parts: readonly {
    readonly from: number;
    readonly to: number;
    readonly kept: boolean;
  }[],
  current = -1,
): MirrorRun[] {
  const n = body.length;
  if (n === 0) return [];
  const decos: Deco[] = [];
  let base = 0;
  let inFence = false;
  for (const line of body.split("\n")) {
    const fence = /^\s*(?:`{3,}|~{3,})/.test(line);
    if (fence) inFence = !inFence;
    else if (!inFence) lineDecos(line, base, decos);
    base += line.length + 1;
  }
  const bits = new Uint16Array(n);
  const partAt = new Int32Array(n).fill(-1);
  for (const d of decos) {
    const bit = 1 << ORDER.indexOf(d.look);
    for (let k = Math.max(0, d.from); k < Math.min(n, d.to); k++) {
      bits[k] = (bits[k] ?? 0) | bit;
    }
  }
  parts.forEach((p, idx) => {
    const look = 1 << ORDER.indexOf(p.kept ? "kept" : "iss");
    const cur = idx === current ? 1 << ORDER.indexOf("cur") : 0;
    for (let k = Math.max(0, p.from); k < Math.min(n, p.to); k++) {
      bits[k] = (bits[k] ?? 0) | look | cur;
      partAt[k] = idx;
    }
  });
  const runs: MirrorRun[] = [];
  let k = 0;
  while (k < n) {
    let j = k + 1;
    while (j < n && bits[j] === bits[k] && partAt[j] === partAt[k]) j++;
    const b = bits[k] ?? 0;
    runs.push({
      from: k,
      to: j,
      looks: ORDER.filter((_, i) => (b & (1 << i)) !== 0),
      part: partAt[k] ?? -1,
    });
    k = j;
  }
  return runs;
}
