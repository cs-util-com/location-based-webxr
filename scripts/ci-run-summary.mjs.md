# ci-run-summary.mjs - one line about a dispatched CI run

- Purpose: reports the newest dispatched `ci.yml` run of a branch that has no
  pull request, so no checks page and no bot comment. The result of such a run
  is this line and the run's URL in it.
- Public API:
  - `summarizeRun(run)`: the line for one run, from `gh run view --json
url,headBranch,headSha,status,conclusion,jobs`. Throws `TypeError` when the
    jobs list is missing.
  - CLI: `pnpm run ci:summary <branch>`. Exit 0 only on a green run; 1 on a
    red or still running run, or when the branch has no dispatched run; 2
    without a branch name. `gh` must be logged in. `GH_REPO` names another
    repository.
- Invariants:
  - Anything but `success` counts as not green and is named, so a cancelled
    or skipped job never reads as green: the same reading as the `CI result`
    job.
  - A run still going says `N of M jobs done`, never a green count.
- Example:

  ```text
  gh workflow run ci.yml --ref r42 -f tier=pr
  pnpm run ci:summary r42
  r42 @ 01234567: failure, 10 of 11 jobs green, not green: tour-dom-2 (failure) - https://github.com/...
  ```

- Tests: `ci-run-summary.test.mjs` covers the line; the `gh` call is a plain
  pass-through and is not stubbed.
