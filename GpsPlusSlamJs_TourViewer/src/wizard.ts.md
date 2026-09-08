# wizard.ts

## Purpose

The creator's guided setup (guided-setup plan §2.7): the steps as
collapsible sections with one open at a time, advanced by the flow's events
(tour opened → print; code hung → measure; later, zip rebuilt → finish →
replace), plus the starter zip download (step 1) and the "open as a
visitor" launch link (step 2, the tester's way into the visitor path).

## Public API

- `wireWizard({ mode, dom, packStarter, download, setTimeout? }): Wizard`
  - `Wizard.openStep(step)` opens one step and collapses the others.
  - `Wizard.presentTour(url)` sets and shows the launch link and, for a
    creator, opens the print step.
  - `dom` is structural: `steps` (collapsible nodes by name; `measure` has
    none because it wraps `#ar-root`), `hangDone`, `starterButton`,
    `visitorLink`.
- `WIZARD_STEPS`, `type WizardStep`.
- `visitorLaunchHref(url)` → `?qr=<encoded url>`.
- `STARTER_LABELS` - the starter button's idle/busy/done/cancelled/failed
  labels (async-UI rule).

## Invariants & assumptions

- At most one collapsible step is open; opening `measure` collapses all
  (the AR section is always rendered, in both modes, because it is the
  DOM-overlay root).
- Visitor mode opens nothing (the sections are hidden by
  `visitor-screen.ts`), but `presentTour` still sets the link.
- The starter button is disabled while packing and downloading, shows the
  outcome (downloaded / not saved when the save picker was dismissed /
  failed), and reverts after 3 s.
- Step persistence across reloads is M6 of the plan (not here yet).

## Examples

```ts
const wizard = wireWizard({
  mode,
  dom,
  packStarter: buildStarterZip,
  download: downloadZip,
});
hooks.presentTourForPrint = (url) => {
  print.presentTour(url);
  wizard.presentTour(url);
};
```

## Tests

`wizard.test.ts` - creator/visitor boot state, the one-open-step property
over random step sequences, the two advances, the starter button's three
outcomes with an injected timer, and the launch link round trip (property).
