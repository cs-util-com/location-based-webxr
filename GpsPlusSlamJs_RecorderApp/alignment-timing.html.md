# `alignment-timing.html` - on-device alignment timing

## Purpose

A dev-only page that replays a stored recording's GPS fixes through the
alignment path this device would run live, and reports how long one fix costs
as the stored history grows. It exists because the per-fix cost had only ever
been measured on a desktop, and the phone factor is the largest unknown in any
budget built on that figure.

It is **linked from nothing** - not from the recorder's `index.html`, not from
the landing page. It is reached by typing its URL, exactly like
`ar-hittest-test.html`.

## How to use it

1. Open `/alignment-timing.html` on the device. On a deployed branch preview
   that is `<branch>-gps-plus-slam.<host>/recorder/alignment-timing.html`.
2. Choose a recording zip with the file input (the device's own picker - the
   folder-handle flow the recorder uses for replay is not available on Android
   Chrome).
3. Optionally change the number of timed passes (3 / 5 / 9, default 5).
4. Press **Run timing**. The button stays disabled and shows progress per pass;
   a run is minutes long on a phone, so keep the screen on.
5. Read the table, then copy the JSON.

**Nothing is uploaded and nothing is stored.** The result exists only on the
screen until it is copied.

## What it prints

- **Per-fix cost**, one row per arm per ladder segment: the marginal
  milliseconds the next fix costs at that stored history (the segment's own
  elapsed time over its own fix count), as both a median and a minimum of the
  timed passes, with the segment's midpoint history beside it.
- **Whole replay**: each arm's total, and its ratio against the shipped arm.
- **Device**: user agent, `hardwareConcurrency`, and the app / library /
  framework / build identifiers.
- **JSON**: everything above plus every raw repeat and every warm-up total.

## Invariants and assumptions

- The page's elements are driven by id from `src/timing/alignment-timing-page.ts`,
  whose jsdom test reads THIS FILE rather than a fixture - a renamed id fails
  the suite instead of the trip.
- Its script is a bundler entry in `config/vite.config.ts`, so the page is built
  and deployable; it is otherwise unreferenced.
- All CSS is inline and local. No third-party host, no font fetch: a blocking
  asset from someone else's host is what once turned a whole e2e suite red.

## Tests

- `src/timing/alignment-timing-page.test.ts` - the behaviour, against this
  markup.
- `src/timing/alignment-timing-isolation.test.ts` - that nothing links to or
  imports the page, that the page can neither transmit nor persist, and that it
  is a bundler entry.
- `playwright-tests/alignment-timing.spec.js` - the built page boots, prints its
  parameters and device, and refuses to run with no recording chosen. It does
  not run a timing pass: there is no recording fixture, and a figure from a CI
  container would say nothing about a phone.
