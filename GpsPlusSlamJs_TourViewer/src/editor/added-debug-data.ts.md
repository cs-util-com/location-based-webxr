# `added-debug-data.ts` - the words of "Add debug data…"

## Purpose

The tour file leaves the debug data out by default (debug-captures plan
`GpsPlusSlamJs_Docs/docs/2026-10-20-1159-debug-captures-and-codes-in-store-plan.md`,
M2, decision E2), so the desktop editor lets the creator add it back
beside the tour (M2 step 5): a debug bundle (`../debug-bundle.ts`) or a
plain Recorder zip, shown on the debug layer and never saved. Nothing on
the map says whose captures they are, so the line ahead of the layer's
says it. Pure; `edit-main.ts` opens the file and runs the layer.

## Public API

- `ADD_DEBUG_LABELS` - the button's idle ("Add debug data…") and
  in-progress ("Adding the debug data…") labels.
- `addedDebugLine({ fileName, match, identity, tourCarriesWalk })` - the
  line while an added file is shown:
  - always "Added from <file>, not saved with the tour.";
  - `match: "other-tour"` (`bundleMatchesTour`): "It was saved from
    another tour (\"<title>\", <file>), not this one." - naming what the
    identity knows, or neither;
  - `match: "recording"`: "It is a recording, not saved from this tour.";
  - `tourCarriesWalk`: "It is shown in place of the tour's own walk."
- `notAddedLine(reason)` - "Not added: <reason>" for a refused file.
- `createAddDebugButton(button) -> { run(work), busy() }` - the button
  through one add (the async-UI rule, r901 review #3): `run` disables it
  with the in-progress label, runs `work`, and gives it back idle and
  enabled however `work` settles (a file shown, refused, or a read that
  threw - the throw passes on). A `run` while one is running starts
  nothing and resolves null. The button is structural
  (`{ disabled, textContent }`), so the tests run in node.

## Invariants & assumptions

- Plan Q-C: a bundle from another tour is shown, never refused; the line
  must never call another tour's walk this tour's.
- Pure text apart from `createAddDebugButton`, which touches only the
  button it is given: no DOM lookups, no I/O. Names come from the user's file and the
  bundle's identity, and the page sets them as text, never as markup.

## Examples

```ts
addedDebugLine({
  fileName: "castle-debug.zip",
  match: "this-tour",
  identity: { tour: "Castle", file: "castle.zip" },
  tourCarriesWalk: true,
});
// "Added from castle-debug.zip, not saved with the tour. It is shown in
//  place of the tour's own walk."
```

## Tests

- `added-debug-data.test.ts` - each line, an identity naming nothing,
  the refusal and the labels; the button's adding state and its return
  to idle and enabled after a file shown, refused or unreadable, and a
  second add refused while one runs.
- `playwright-tests/editor.spec.js` - "adds the debug data back...",
  "says whose added debug data is...", "shows debug data dropped on its
  panel...": the button and the drop, the lines on the page, no save
  carrying it, a reload forgetting it.
