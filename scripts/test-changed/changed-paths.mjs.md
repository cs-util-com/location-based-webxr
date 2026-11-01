# changed-paths.mjs - git's view of what changed

- Purpose: the changed paths of a work tree, for `test-changed.mjs` (the
  package selection) and `scripts/e2e/run-projects.mjs` (the Tour Viewer's
  e2e area selection), so both read the same set.
- Public API:
  - `trackedPaths(ref, cwd)`: `git diff --name-only <ref>`, staged and
    unstaged, repo-relative.
  - `untrackedPaths(cwd)`: the `??` entries of `git status --porcelain`.
  - `changedPaths(ref, cwd)`: both, tracked first.
  - All throw when git fails (an unknown ref, not a work tree): a failed
    lookup must never read as "nothing changed".
- Invariants & assumptions: paths are repo-relative whatever `cwd` inside
  the work tree is (git's own output); untracked files count as changes,
  because `git diff` never lists a brand-new file.
- Example: `changedPaths('HEAD', root)` ->
  `['GpsPlusSlamJs_TourViewer/src/editor/edit-main.ts', 'scripts/e2e/new.mjs']`.
- Tests: `changed-paths.test.mjs`, against a throwaway git repository.
