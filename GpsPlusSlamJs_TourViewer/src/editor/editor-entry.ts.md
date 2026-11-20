# `editor-entry.ts` - opening a tour, then adding its scan

## Purpose

Runs "open a tour, then add a scan" as one busy state, for the start
card's "Open the editor". The order is forced: there is no add without a
tour. An orchestrator over injected steps, run by `edit-main.ts`
(`openTourWithScan`). Which files are held as the tour and the scan is
the start card's (`start-card.ts` `sortTourPick`); which UI offers a new
tour, or asks for a scan, is not decided here.

## Public API

- `openWithScan(tour, scan, { open, addScan, step }) ->
Promise<OpenWithScanOutcome>`, never rejects:
  - `step` goes `"opening"`, then `"adding-scan"`, then `null` on every
    path (only `null` for a tour without a scan: the open shows its own
    busy state);
  - `{ kind: "not-opened", error? }` - the open refused (it said why)
    or threw (`error` what it threw: it said nothing); the scan is never
    read;
  - `{ kind: "opened", scanAdded }`;
  - `{ kind: "scan-failed", line }` - the tour stays open; `line` is
    `scanFailedLine(name, reason)`: "The tour is open, but the scan <name>
    could not be added: <reason>". A throwing add is a failed add; an add
    that answers null (another tour opened meanwhile) is
    `{ kind: "opened", scanAdded: false }` and says nothing, since the
    scan was never that tour's.
- `notOpenedLine(outcome)` - for an open that threw, the error in words
  (`describeOpenError`), for the page's `#open-error`; null otherwise.
- `entryStepLine(step, tourName, scanName)` - the held line per step.
- `AddScanOutcome` - `{ kind: "added" }` or `{ kind: "refused", reason }`.
- `addScanSafely(add)` - runs one add; a throw becomes
  `{ kind: "refused", reason }` (its message), null passes through. Never
  rejects; every add of the page goes through it (`edit-main.ts` `addScan`).

## Invariants

- An add never happens without a tour: the scan is read only after the
  tour opened.
- The step is store state (`editor-view.ts` `entryStep`), so any view can
  show it; the held line is the page's DOM.

## Examples

```ts
const outcome = await openWithScan(heldTour, heldScan, {
  open,
  addScan,
  step,
});
if (outcome.kind === "scan-failed") say(outcome.line);
```

## Tests

- `editor-entry.test.ts` - `addScanSafely`, and both paths of the busy
  state: success,
  refused or throwing add with the tour kept, an open that fails before
  the scan is read (a thrown one's error carried out and put in words),
  an add under a changed tour said nothing of, and the step ending null
  on each.
- `playwright-tests/editor.spec.js` - a scan chosen with no tour (refused,
  named) and with a tour open (added, the status line saying so while it
  reads, dialog closed); a tour and a scan
  dropped together; an unusable file in the drop named and left out.
