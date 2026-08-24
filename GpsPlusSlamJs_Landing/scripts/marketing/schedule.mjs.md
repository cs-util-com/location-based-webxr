# `schedule.mjs`

**Purpose:** decide which approved items may be published right now. This is
the safety-critical half of the publishing pipeline.

## Public API

- `selectDue({ items, channels, history, now }): { due, withheld }`
  - `due`: `{ item, mode: 'auto' | 'manual' }[]` — `manual` means a human
    sends it.
  - `withheld`: `{ item, reason, nextEligibleAt? }[]` — every withheld item
    carries a reason.
  - **Throws** when a channel is configured without a finite `minIntervalMs` —
    `NaN` included (PR #337 review): `typeof NaN === "number"`, and every
    downstream comparison against `NaN` is false, so it read as "unlimited".

## Invariants & assumptions

- **Only `status === 'approved'` is ever released.** The review model rests on
  this single line; autonomy level cannot override it.
- **At most one item per channel per run.** Two posts to one channel in a
  single run would defeat the interval entirely.
- **A missing `minIntervalMs` is an error, never a default.** An unbounded
  posting rate is how an account gets banned, and a silent default would make
  the omission invisible.
- **Both an interval and a rolling-window cap are supported**, and they answer
  different questions: the interval spaces posts out, the cap (blog: 3 per 7
  days) prevents a burst that would look like scaled content on a young domain.
- **`due` + `withheld` partitions the input.** Nothing may silently vanish
  from the queue — asserted as a property.
- Pure: no clock, no I/O, no network. That is what makes "would this post to
  Reddit twice in a week?" a unit test.

## Examples

```js
const { due, withheld } = selectDue({
  items: queue,
  channels: CHANNELS,
  history,
  now: Date.now(),
});
```

## Tests

- `schedule.test.mjs` — approval, autonomy mode, interval, rolling cap,
  one-per-channel, unknown channel, missing-interval error.
- `schedule.property.test.mjs` — the four safety invariants under arbitrary
  queues, plus a guard that fails if the generators stop reaching both
  branches (the vacuity trap the blog parser's properties fell into).
