# bundle-paths.ts

**Purpose:** how a model's reference to another file (a glTF `uri`; later an OBJ `mtllib` or an FBX texture path) is found among the files the creator gave with it (a dropped folder, a zip, or several files chosen together). The reference is untrusted text: the answer is always one of the given paths, or a reason in kind.

## Public API

- `normalizeBundlePath(path): string | null`: backslashes become `/`, empty and `.` segments go, `..` folds; leading slashes are dropped (the path is relative to the bundle root). Null for an empty path or one that climbs above the root.
- `resolveReference(uri, from, files, options?): Reference`, `from` being the referring file's own path among `files`:
  - `{ kind: "data", uri }` for a `data:` URI (decoded by the caller, with the framework's `utils/data-uri`);
  - `{ kind: "scheme", scheme }` for a web or other scheme (`https:`, `http:`, `blob:`...): never read, never fetched;
  - `{ kind: "outside", name }` for a relative path whose `..` climbs out of the given files: refused, not guessed by basename;
  - `{ kind: "file", path, match }`, `path` exactly as given in `files`, `match` how it was found: `"exact"`, `"case"` (another letter case, the only such file) or `"basename"` (the file name alone, the only such file). A caller tells the creator about every match that is not exact;
  - `{ kind: "elsewhere", name }` for a path on another computer (a drive letter such as `C:\` or `C:x`, `//server/...`, a `file:` URI) that no given file stands in for;
  - `{ kind: "missing", name }`, `name` the decoded basename for the words.
- `ResolveOptions.byBasename` (default true): whether the file name alone may find a file. The glTF repack turns it off for buffers: a wrong `.bin` found by name would look like a broken model, with nothing to tell the creator why.

## Resolution order

1. `data:` is answered at once; any other scheme of two letters or more is refused, except `file:`, which (like a one-letter drive "scheme") is a path on some computer.
2. A query and a fragment are cut, the rest percent-decoded (`Box%20With%20Spaces.bin`; a `%` that is no escape keeps the name as written), backslashes become `/`, and the name is put into Unicode NFC, as every given path is, so a macOS name (NFD, `Cafe\u0301.bin`) matches `Caf%C3%A9.bin`.
3. A relative path is joined to `from`'s folder (or to the root for a leading `/`) and normalized: an exact match wins, then a case-insensitive match that names exactly one file. An encoded escape (`%2e%2e/`, `..%5c`) is decoded first, so it is refused like a plain `../`.
4. Otherwise, and for a path on another computer, the basename alone, case-insensitive, only when it names exactly one file and `byBasename` is not off.

## Invariants

- Never resolves to a path outside `files`; given paths that do not normalize (`../x`) can never be matched.
- Only `data:` among schemes is read; nothing is fetched.
- Without the basename fallback, every file found is in the folder the reference names (in some letter case).
- Total: never throws, on any string.
- Look-ups go through `Map`, so names such as `__proto__` or `constructor` are file names like any other.

## Tests

- `bundle-paths.test.ts`: normalization and its refusals; relative paths, percent-encoding, NFD against NFC both ways, a raw `%`, wrong case, the basename fallback for drive, drive-relative, `file:` and server paths, the strict mode (`elsewhere`, `missing`, case kept), an unmatched path on another computer, exact path over an ambiguous basename, the `../` escape refused plain, percent-encoded and with backslashes even when the basename exists, missing names decoded, web schemes refused with a `fetch` spy never called, query and fragment cut, prototype names; properties: never outside the set and total (with and without the fallback), never a basename match without it, only `data:` read and `file:` a path, exact path beats basename, normalization idempotent with no `.`, `..`, empty segment or backslash left.
