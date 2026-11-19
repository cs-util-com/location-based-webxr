# `editor-entry.ts` - what the editor does with the files it is given

## Purpose

The engine behind the open dialog's file input, "Choose…" and drop box:
given files already sorted (`classify-editor-file.ts`), it plans what to
do, and it runs "open a tour, then add a scan" as one busy state. The
order is forced: there is no add without a tour. Pure planning, and an
orchestrator over injected steps; `edit-main.ts` (`enterFiles`) wires it.
Which UI offers a new tour, or asks for a scan, is not decided here.

## Public API

- `planEditorEntry(kinds, tourOpen) -> EditorEntryPlan`, pure:
  - `{ kind: "open", tour, scan, ignored }` - one tour (with at most one
    scan); with no tour and no scan, the first file sorted as neither,
    so the open refuses it in its own words;
  - `{ kind: "add-scan", scan, ignored }` - one scan, no tour given, a
    tour open;
  - `{ kind: "refuse", reason }` - several tours (`ONE_TOUR_AT_A_TIME`),
    several scans (`ONE_SCAN_AT_A_TIME`), a scan with no tour
    (`scanNeedsTourLine(name)`), or no file (`NO_FILE`).
  - `ignored` - the files sorted as neither that came along, with their
    reasons, for the page to name.
- `openWithScan(tour, scan, { open, addScan, step }) ->
Promise<OpenWithScanOutcome>`, never rejects:
  - `step` goes `"opening"`, then `"adding-scan"`, then `null` on every
    path (only `null` for a tour without a scan: the open shows its own
    busy state);
  - `{ kind: "not-opened" }` - the open refused or threw; the scan is
    never read;
  - `{ kind: "opened", scanAdded }`;
  - `{ kind: "scan-failed", line }` - the tour stays open; `line` is
    `scanFailedLine(name, reason)`: "The tour is open, but the scan <name>
    could not be added: <reason>". A throwing add is a failed add.
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
  the scan is read, and the step ending null on each.
- `playwright-tests/editor.spec.js` - a scan chosen with no tour (refused,
  named) and with a tour open (added, dialog closed); a tour and a scan
  dropped together; an unusable file in the drop named and left out.
