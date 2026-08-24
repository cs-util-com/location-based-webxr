# Where the osm-demo e2e drift came from — investigation

**Run:** 2026-08-17, at the owner's request, after the `test:e2e` wall-clock
ceiling blocked a comments-and-docs commit.
**Method:** the versioned `docs/test-timings.md` history, read back commit by
commit. **No re-runs** — the measurements already exist in git, and re-measuring
would have added ~13 min per data point to answer a question the history
answers.

## The headline, and it is not what the raise assumed

**There is no growth event. The drift is real but smaller than the suite's
own run-to-run noise, and it predates the branches first blamed for it.**

## What the history shows

- **2026-08-07** — ceiling introduced (`6e3d6b53`), derived as median + ~30 %.
  The history behind it: `468.5, 507.9, 507.6, 551.1, 572.8, 561.1, 614.6,
  535.2, 592.0, 573.7` → median ~567 s → **740 s**.
- **2026-08-08** — runs in the 506–646 s band; the day ends around 618–692.
- **2026-08-09** — 585–668 s.
- **2026-08-11** — `563, 565, 570, 570, 574, 583, 592, 601, 607, 631, 649,
  734, 815, 820`.
- **2026-08-14** (`8a53e080`) — `685.1, 678.4, 728.3, 712.5, 709.3, 704.9,
  684.1, 715.2, 707.6, 701.9`.
- **2026-08-17** — median **690.1 s**; the two runs that tripped the guard,
  769.3 s and 770.6 s, and 707.1 s for the same 56 tests two hours earlier.

## Two conclusions, both load-bearing

### 1. The attribution to r519–r525 was wrong

The first account of this drift — written in `projects.mjs`, its sidecar and the
PR #313 review report — said the suite "grew ~22 % across r519–r525". **The
history falsifies it.** By 2026-08-14, before those branches, the recorded runs
were already 678–728 s. The drift is spread across roughly 40 commits between
2026-08-07 and 2026-08-14 with **no step change attributable to any single one**,
which is precisely the accumulation shape `budget.mjs` describes: _"each run
looks normal against the one before it."_

The error came from reading the two endpoints (567 → 690) and naming the most
recent branches, without looking at what lay between. All three sites are
corrected.

### 2. The drift is smaller than the noise, which changes the prescription

**2026-08-11 spans 563–820 s — a 1.46× spread within one day**, on a suite whose
Playwright config already records a **21× inflation of identical work under
load**. The 567 → 690 median drift (~1.22×) is *smaller than the spread of a
single day's samples*.

That reframes the guard's own advice. `budget.mjs` says _"if the suite has
genuinely grown, the fix is to remove work rather than to raise the number"_ —
correct in general, but it presumes the signal is separable from the noise. Here
it is not:

- **No ceiling at +7 % above the median could have survived**, whatever the
  suite did. The old 740 s sat inside the ordinary day-to-day range, so it was
  going to fire on load sooner or later regardless of regrowth.
- **Removing work is still worth doing**, but as a *throughput* argument — a
  ~12 min stage on every gate run is expensive — not as a response to a
  regrowth alarm that turns out to be measuring the laptop.

## What would actually make this guard trustworthy

Recorded as options, not decided here.

- **Compare medians, not single runs.** The ceiling fires on one duration; a
  median-of-last-N would be robust to exactly the variance that tripped it. This
  is the change that most directly addresses what was found.
- **Reduce the variance at the source.** The 21× load inflation is the root
  cause of the spread. Serialising the stage, or pinning worker counts, would
  narrow the band and make any real regrowth visible again.
- **Leave it at 900 s and revisit if it fires again.** Cheapest; accepts that
  the guard is coarse.

**Recommendation: the median-of-N change**, because it is the only one that
restores the guard's ability to distinguish growth from load — which is the
property it was built for and the one it had quietly lost.

## Related

- [`scripts/test-timing/budget.mjs`](../../scripts/test-timing/budget.mjs) and
  its sidecar — the rule for deriving a ceiling, and the CI-skip reasoning that
  already documents this suite's load sensitivity.
- [`scripts/test-timing/projects.mjs`](../../scripts/test-timing/projects.mjs) —
  where the 900 s ceiling and its derivation live.
- `2026-08-07-simplify-loop-findings.md` (Areas 3–5b) — which levers for
  shrinking this suite are already spent.
