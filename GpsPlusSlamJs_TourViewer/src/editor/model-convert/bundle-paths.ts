/**
 * How a model's reference to another file (a glTF `uri`, later an OBJ
 * `mtllib` or an FBX texture path) is found among the files the creator
 * gave with it: a dropped folder, a zip, or several files chosen together.
 *
 * The reference is untrusted text, so the answer is always one of the
 * given paths or a reason in kind: a `data:` URI is handed back to be
 * decoded, every other scheme is refused (nothing is ever fetched), and a
 * relative path that climbs out of the given files with `..` is refused
 * rather than guessed. Real exporters write sloppy references, so after
 * the exact relative path a case-insensitive match is tried, then the
 * basename alone when it names exactly one file (this covers an artist's
 * absolute path such as `C:\Users\artist\tex\wood.png`). Pure: no I/O,
 * never throws; look-ups go through `Map`, so a file named `__proto__` is
 * a file like any other.
 *
 * @see bundle-paths.ts.md
 */

export type Reference =
  /** One of the given paths, exactly as it was given. */
  | { readonly kind: "file"; readonly path: string }
  /** A `data:` URI, to be decoded by the caller. */
  | { readonly kind: "data"; readonly uri: string }
  /** Any other scheme (`https:`, `file:`, `blob:` ...): never read. */
  | { readonly kind: "scheme"; readonly scheme: string }
  /** A relative path that leaves the given files; `name` its basename. */
  | { readonly kind: "outside"; readonly name: string }
  /** No given file matches; `name` the decoded basename, for the words. */
  | { readonly kind: "missing"; readonly name: string };

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
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

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

/** The one given path whose normalized form, lower-cased by `key`, equals
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
): Reference {
  const text = typeof uri === "string" ? uri : "";
  const scheme = SCHEME.exec(text)?.[1];
  const windows = WINDOWS_ABSOLUTE.test(text);
  if (scheme !== undefined && !windows) {
    return scheme.toLowerCase() === "data"
      ? { kind: "data", uri: text }
      : { kind: "scheme", scheme: scheme.toLowerCase() };
  }
  const name = decoded(text.replace(/[?#].*$/s, "")).replace(/\\/g, "/");
  const given: (readonly [string, string])[] = [];
  const exact = new Map<string, string>();
  for (const original of files) {
    const normalized = normalizeBundlePath(original);
    if (normalized === null) continue;
    given.push([original, normalized]);
    if (!exact.has(normalized)) exact.set(normalized, original);
  }
  const absolute = windows || name.startsWith("//");
  const wanted = absolute
    ? null
    : normalizeBundlePath(
        name.startsWith("/")
          ? name
          : dirnameOf(normalizeBundlePath(from) ?? "") + name,
      );
  const base = basenameOf(name);
  if (!absolute && wanted === null) {
    return { kind: "outside", name: base };
  }
  if (wanted !== null) {
    const hit =
      exact.get(wanted) ??
      uniqueMatch(given, (n) => n.toLowerCase(), wanted.toLowerCase());
    if (hit !== null && hit !== undefined) return { kind: "file", path: hit };
  }
  const byBase = uniqueMatch(
    given,
    (n) => basenameOf(n).toLowerCase(),
    base.toLowerCase(),
  );
  return byBase === null
    ? { kind: "missing", name: base }
    : { kind: "file", path: byBase };
}
