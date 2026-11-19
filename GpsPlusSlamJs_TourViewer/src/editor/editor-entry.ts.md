# `editor-entry.ts` - what the editor does with the files it is given

## Purpose

The engine behind the open dialog's file input, "Choose…" and drop box:
given files already sorted (`classify-editor-file.ts`), it plans what to
do, and it runs "open a tour, then add a scan" as one busy state. The
order is forced: there is no add without a tour. Pure planning, and an
orchestrator over injected steps; the start card (`start-card.ts`
`sortTourPick`) plans with it, and `edit-main.ts` (`openTourWithScan`)
runs `openWithScan`. Which UI offers a new tour, or asks for a scan, is
not decided here.

## Public API

- `planEditorEntry(kinds, tourOpen) -> EditorEntryPlan`, pure:
  - `{ kind: "open", tour, scan, ignored }` - one tour (with at most one
    scan); with no tour and no scan, the first file sorted as neither
    for the open's own reasons (`NOT_A_ZIP`, `NOT_A_TOUR`), so the open
    refuses it in its own words;
  - `{ kind: "add-scan", scan, ignored }` - one scan, no tour given, a
    tour open;
  - `{ kind: "refuse", reason }` - several tours (`ONE_TOUR_AT_A_TIME`),
    several scans (`ONE_SCAN_AT_A_TIME`), a scan with no tour
    (`scanNeedsTourLine(name)`), no file (`NO_FILE`), or a lone file
    sorted as neither for a precise reason (a scan whose identity is
    broken, a damaged zip): "<name>: <reason>", since the open would only
    say it holds no tour.
  - `ignored` - the files sorted as neither that came along, with their
    reasons, for the page to name (`IgnoredFile`, exported for the start
    card).
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

## Invariants

- A scan is never what opens; an add never happens without a tour.
- The step is store state (`editor-view.ts` `entryStep`), so any view can
  show it; the held line is the page's DOM.

## Examples

```ts
const plan = planEditorEntry(await classifyEditorFiles(files), editor !== null);
if (plan.kind === "open") {
  await openWithScan(plan.tour, plan.scan, { open, addScan, step });
}
```

## Tests

- `editor-entry.test.ts` - every plan, a property (a scan never opens,
  no add without a tour), and both paths of the busy state: success,
  refused or throwing add with the tour kept, an open that fails before
  the scan is read (a thrown one's error carried out and put in words),
  an add under a changed tour said nothing of, and the step ending null
  on each.
- `playwright-tests/editor.spec.js` - a scan chosen with no tour (refused,
  named) and with a tour open (added, the status line saying so while it
  reads, dialog closed); a tour and a scan
  dropped together; an unusable file in the drop named and left out.
