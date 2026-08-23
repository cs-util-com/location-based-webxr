# `channels.mjs`

**Purpose:** the per-channel publishing rules, as data rather than code.

## Public API

- `CHANNELS` — the table: `autonomy`, `minIntervalMs`, optional
  `maxPerWindow`/`windowMs`, plus a `transport` and a `note` for humans.
- `validateChannels(channels): string[]` — problems, empty when usable.

## Invariants & assumptions

- **Every channel starts at `manual`** (D3). Graduating one to
  agent-published is a one-word edit here, which is the point: the autonomy
  level is versioned state, not a property of the scheduler.
- **Two channels can never graduate**, for reasons outside this repo: **X**
  (its rules sanction API posting and prohibit browser automation, and there
  is no free API tier for new developers) and **Medium** (stopped issuing API
  tokens to new integrations on 2025-01-01). **Hacker News** has no write API
  at all — structural, not a policy choice. **Reddit** is a policy choice made
  deliberately.
- **A cap without a window is rejected**, because it never fires while looking
  exactly like a limit that is being enforced.

## Tests

`channels.test.mjs` — the table validates, every channel starts manual, the
community intervals are weeks, the blog cap is 3/7 days, and the table is
accepted by the scheduler it is written for.
