/**
 * How a model's reference to another file (a glTF `uri`, later an OBJ
 * `mtllib` or an FBX texture path) is found among the files the creator
 * gave with it: a dropped folder, a zip, or several files chosen together.
 *
 * The reference is untrusted text, so the answer is always one of the
 * given paths or a reason in kind: a `data:` URI is handed back to be
 * decoded, every web scheme is refused (nothing is ever fetched), and a
 * relative path that climbs out of the given files with `..` is refused
 * rather than guessed. Real exporters write sloppy references, so after
 * the exact relative path a case-insensitive match is tried, then (when
 * the caller allows it) the basename alone when it names exactly one
 * file; this covers a path on the artist's own computer such as
 * `C:\Users\artist\tex\wood.png` or `file:///C:/tex/wood.png`. Every file
 * answer says which kind of match it was, so a caller can tell the
 * creator which file stood in for a name. Names are compared in Unicode
 * NFC, so a macOS file name (NFD) matches its percent-encoded NFC
 * spelling. Pure: no I/O, never throws; look-ups go through `Map`, so a
 * file named `__proto__` is a file like any other.
 *
 * @see bundle-paths.ts.md
 */

type Match =
  /** The path as written (after decoding and Unicode normalization). */
  | "exact"
  /** The path in another letter case: the only file that matches. */
  | "case"
  /** The file name alone, its folders ignored: the only file that matches. */
  | "basename";

export type Reference =
  /** One of the given paths, exactly as it was given. */
  | { readonly kind: "file"; readonly path: string; readonly match: Match }
  /** A `data:` URI, to be decoded by the caller. */
  | { readonly kind: "data"; readonly uri: string }
  /** A web or other scheme (`https:`, `blob:` ...): never read. */
  | { readonly kind: "scheme"; readonly scheme: string }
  /** A relative path that leaves the given files; `name` its basename. */
  | { readonly kind: "outside"; readonly name: string }
  /** A path on another computer (a drive letter, `//server`, `file:`)
   *  that no given file stands in for; `name` its basename. */
  | { readonly kind: "elsewhere"; readonly name: string }
  /** No given file matches; `name` the decoded basename, for the words. */
  | { readonly kind: "missing"; readonly name: string };

export interface ResolveOptions {
  /** Whether the file name alone may find a file when the path does not
   *  (default true). Off where a wrong file would go unnoticed, such as a
   *  model's binary data. */
  readonly byBasename?: boolean;
}

/** `path` with backslashes as `/`, without empty and `.` segments and with
 *  `..` folded, relative to the root (leading slashes dropped); null when
 *  it is empty or climbs above the root. */
export function normalizeBundlePath(path: string): string | null {
  if (typeof path !== "string") return null;
  const out: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.length === 0 ? null : out.join("/");
}

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

const basenameOf = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

const dirnameOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
};

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A given path normalized for comparing, or null. */
const comparable = (path: string): string | null =>
  normalizeBundlePath(path)?.normalize("NFC") ?? null;

/** The one given path whose comparable form, keyed by `key`, equals
 *  `wanted`; null for none or several. */
function uniqueMatch(
  files: readonly (readonly [string, string])[],
  key: (normalized: string) => string,
  wanted: string,
): string | null {
  let found: string | null = null;
  for (const [original, normalized] of files) {
    if (key(normalized) !== wanted) continue;
    if (found !== null) return null;
    found = original;
  }
  return found;
}

/** Where `uri`, written in the file at `from`, points among `files`. */
export function resolveReference(
  uri: string,
  from: string,
  files: readonly string[],
  options: ResolveOptions = {},
): Reference {
  const text = typeof uri === "string" ? uri : "";
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  if (scheme === "data") return { kind: "data", uri: text };
  // A one-letter "scheme" is a Windows drive (`C:\x`, `C:x`) and `file:` a
  // path on some computer: paths, not addresses to fetch.
  const onAnotherComputer =
    scheme === "file" || scheme?.length === 1 || /^[\\/]{2}/.test(text);
  if (scheme !== undefined && !onAnotherComputer) {
    return { kind: "scheme", scheme };
  }
  const path =
    scheme === undefined ? text : text.slice(scheme.length + ":".length);
  const name = decoded(path.replace(/[?#].*$/s, ""))
    .replace(/\\/g, "/")
    .normalize("NFC");
  const given: (readonly [string, string])[] = [];
  const exact = new Map<string, string>();
  for (const original of files) {
    const normalized = comparable(original);
    if (normalized === null) continue;
    given.push([original, normalized]);
    if (!exact.has(normalized)) exact.set(normalized, original);
  }
  const base = basenameOf(name);
  if (!onAnotherComputer) {
    const wanted = normalizeBundlePath(
      name.startsWith("/") ? name : dirnameOf(comparable(from) ?? "") + name,
    );
    if (wanted === null) return { kind: "outside", name: base };
    const hit = exact.get(wanted);
    if (hit !== undefined) return { kind: "file", path: hit, match: "exact" };
    const byCase = uniqueMatch(
      given,
      (n) => n.toLowerCase(),
      wanted.toLowerCase(),
    );
    if (byCase !== null) return { kind: "file", path: byCase, match: "case" };
  }
  const byBase =
    options.byBasename === false || base === ""
      ? null
      : uniqueMatch(
          given,
          (n) => basenameOf(n).toLowerCase(),
          base.toLowerCase(),
        );
  if (byBase !== null) return { kind: "file", path: byBase, match: "basename" };
  return { kind: onAnotherComputer ? "elsewhere" : "missing", name: base };
}
