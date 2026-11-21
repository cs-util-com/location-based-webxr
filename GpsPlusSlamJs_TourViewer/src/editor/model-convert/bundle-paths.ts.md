# bundle-paths.ts

**Purpose:** how a model's reference to another file (a glTF `uri`; later an OBJ `mtllib` or an FBX texture path) is found among the files the creator gave with it (a dropped folder, a zip, or several files chosen together). The reference is untrusted text: the answer is always one of the given paths, or a reason in kind.

## Public API

- `normalizeBundlePath(path): string | null`: backslashes become `/`, empty and `.` segments go, `..` folds; leading slashes are dropped (the path is relative to the bundle root). Null for an empty path or one that climbs above the root.
- `resolveReference(uri, from, files): Reference`, `from` being the referring file's own path among `files`:
  - `{ kind: "data", uri }` for a `data:` URI (decoded by the caller, `data-uri.ts`);
  - `{ kind: "scheme", scheme }` for any other scheme (`https:`, `http:`, `file:`, `blob:`...): never read, never fetched;
  - `{ kind: "outside", name }` for a relative path whose `..` climbs out of the given files: refused, not guessed by basename;
  - `{ kind: "file", path }`, `path` exactly as given in `files`;
  - `{ kind: "missing", name }`, `name` the decoded basename for the words.

## Resolution order

1. A scheme is answered at once (a Windows drive path such as `C:\x` is no scheme).
2. A query and a fragment are cut, the rest percent-decoded (`Box%20With%20Spaces.bin`; a `%` that is no escape keeps the name as written), backslashes become `/`.
3. The path relative to `from`'s folder (or to the root for a leading `/`), normalized: an exact match wins, then a case-insensitive match that names exactly one file.
4. Otherwise, and for an absolute path from the artist's disk (`C:\Users\artist\tex\wood.png`, `//server/x`), the basename alone, case-insensitive, only when it names exactly one file.

## Invariants

- Never resolves to a path outside `files`; given paths that do not normalize (`../x`) can never be matched.
- Only `data:` among schemes resolves.
- Total: never throws, on any string.
- Look-ups go through `Map`, so names such as `__proto__` or `constructor` are file names like any other.

## Tests

- `bundle-paths.test.ts`: normalization and its refusals; relative paths, percent-encoding, a raw `%`, wrong case, basename fallback with an absolute path, exact path over an ambiguous basename, the `../` escape refused even when the basename exists, missing names decoded, schemes refused with a `fetch` spy never called, query and fragment cut, prototype names; properties: never outside the set and total, only `data:` among schemes, exact path beats basename, normalization idempotent with no `.`, `..`, empty segment or backslash left.
