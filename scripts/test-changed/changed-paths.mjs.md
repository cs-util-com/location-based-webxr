# changed-paths.mjs - git's view of what changed

- Purpose: the changed paths of a work tree, for `test-changed.mjs` (the
  package selection) and `scripts/e2e/run-projects.mjs` (the Tour Viewer's
  e2e area selection), so both read the same set.
- Public API:
  - `trackedPaths(ref, cwd)`: `git diff --name-only --no-renames <ref>`,
    staged and unstaged, repo-relative; a moved file is listed under its old
    AND its new name, so the old path counts as a deletion.
  - `untrackedPaths(cwd)`: the `??` entries of `git status --porcelain`.
  - `changedPaths(ref, cwd)`: both, tracked first.
  - `changedFiles(ref, cwd)`: the tracked paths, then the untracked FILES
    (`git ls-files --others --exclude-standard`, never a collapsed new
    folder), for the impact graph and the changed-files stages.
  - All throw when git fails (an unknown ref, not a work tree): a failed
    lookup must never read as "nothing changed".
- Invariants & assumptions: paths are repo-relative whatever `cwd` inside
  the work tree is (git's own output); untracked files count as changes,
  because `git diff` never lists a brand-new file.
- Example: `changedPaths('HEAD', root)` ->
  `['GpsPlusSlamJs_TourViewer/src/editor/edit-main.ts', 'scripts/e2e/new.mjs']`.
- Tests: `changed-paths.test.mjs`, against a throwaway git repository.
