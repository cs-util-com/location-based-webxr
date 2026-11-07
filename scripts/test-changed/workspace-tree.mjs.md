# workspace-tree.mjs - the work tree as the impact graph sees it

- Purpose: the I/O shell of [impact-graph.mjs](impact-graph.mjs.md), shared by
  `test-changed.mjs` (which dependents run) and `related-unit.mjs` (which
  tests of a package run), so both walk one graph.
- Public API:
  - `workspacePackages(root)` -> `{ dir, name, deps, exports }[]` for every
    `pnpm-workspace.yaml` entry that has a `package.json`; `deps` joins the
    four dependency fields.
  - `existingFiles(root)` -> every tracked or untracked (not ignored) file
    that exists on disk, repo-relative.
  - `loadImpactGraph(root)` -> the built graph. Module texts skip `.d.ts`
    and files over 3 MB (generated data, not source with imports).
  - `changedFiles(root, ref)` -> `git diff --name-only --no-renames <ref>`
    (a rename lists both names) plus the untracked FILES.
- Invariants & assumptions: git errors propagate; both callers catch them and
  fall back to their full behaviour. Loading the whole tree takes about 1.6 s
  warm and 6 s cold on the development machine.
- Example: `impactOf(loadImpactGraph(root), changedFiles(root, 'origin2/main'))`.
- Tests: none of its own (it only reads git and files); the rules it feeds
  are tested in `impact-graph.test.mjs`, and the shell by real fast-gate
  runs.
