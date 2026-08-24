# `drip.mjs`

**Purpose:** one publishing run — select what is due, then post it (graduated
channels) or emit a **post pack** for the owner to send by hand (everything
else, which today is everything).

## Public API

- `runDrip({ queue, history, now, origin?, channels?, transports?, post?, log? })`
  → `{ posted, packs, withheld }`
- `buildPack(item, { origin, now })` → `{ channel, instructions, payload? }`.
  `now` is epoch ms and is passed straight through to `blueskyRecord`, whose
  `createdAt` the lexicon requires; `syndicate.mjs` is deliberately clock-free,
  so this pipeline reads the clock exactly once, in `runDrip`'s caller.
- CLI: `node scripts/marketing/drip.mjs --queue q.json --history h.json [--post] [--packs-out packs.json]`

## Invariants & assumptions

- **Dry run is the default; posting is opt-in.** A publishing script that
  publishes by default is one bad invocation from a public accident.
- **Three independent conditions must all hold before anything is sent:**
  `--post`, the channel's autonomy is `auto`, and a transport function
  exists. Any one missing produces a pack instead — so a half-configured
  channel cannot post, and cannot look like it succeeded either.
- **Transports are injected**, so tests never touch a network.
- **Every held item is logged with its reason**; a silent hold is a post the
  owner will never know did not happen.
- Credentials are never read here — a transport is supplied by the caller, so
  this module has nothing to leak.
- **The per-channel rate limit is NOT one of the guarantees above.**
  `selectDue` enforces `minIntervalMs` and `maxPerWindow` entirely from the
  `history` argument, and `runDrip` never mutates, returns or persists it —
  there is no `--history-out`, so the file it reads is only ever updated by
  hand. Two `--post` runs against `reddit` (21-day interval) with no manual
  edit in between will both send. Stated here because the list above would
  otherwise read as if the interval guard were enforced; the fix (append the
  send time, return the updated history, persist it atomically, and decide how
  a mid-batch transport failure keeps the ids already sent) is filed, not done.
  - **The other half of that honesty (PR #338 review): a `--post` run now
    REQUIRES `--history`.** Omitting the flag handed `selectDue` the `{}`
    fallback, which reads as "never posted anything" — every rate limit
    passed at once, including the 21-day reddit/hackernews intervals, with
    only the per-run `served` set between a typo and simultaneous posts on
    every channel. `requireHistoryForPost` throws instead; a dry run stays
    allowed, since it sends nothing.

## Tests

`drip.test.mjs` — the safe default, posting when told, the autonomy override
outranking the flag, the missing-transport fallback, the unusable-table
refusal, held-item logging, and each channel's pack shape.
