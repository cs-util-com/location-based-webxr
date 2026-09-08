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
  - `Wizard.presentTour(url)` sets and shows the launch link (raw form)
    and, for a creator, opens the print step.
  - `Wizard.presentLaunchUrl(launchUrl)` re-points the link at the PRINTED
    payload once a code is generated (`launchHrefFromPrintedUrl`: the
    printed URL's query on the viewer's origin), so the tester decodes
    what a scan decodes (M2 review #10).
  - Opening `measure` scrolls `dom.measureSection` into view; a step
    opened by hand (`toggle`) closes the others.
  - `dom` is structural: `steps` (collapsible nodes by name; `measure` has
    none because it wraps `#ar-root`), `hangDone`, `starterButton`,
    `visitorLink`.
- `WIZARD_STEPS`, `type WizardStep`.
- `visitorLaunchHref(url)` → `?qr=<encoded url>`;
  `launchHrefFromPrintedUrl(launchUrl)` → the printed URL's `?qr=…&n=…`
  query, or null for a URL without `qr`.
- `STARTER_LABELS` - the starter button's idle/busy/done/cancelled/failed
  labels (async-UI rule).
- `wizardStepKey(url)`, `parseWizardStep(value)` - the step key and the
  tolerant parser (the last-url key is module-private); `WizardStepStore` is the
  `getItem`/`setItem` slice of `localStorage`; `Wizard.rememberedTourUrl()`.

## Invariants & assumptions

- At most one collapsible step is open; opening `measure` collapses all
  (the AR section is always rendered, in both modes, because it is the
  DOM-overlay root).
- Visitor mode opens nothing (the sections are hidden by
  `visitor-screen.ts`), but `presentTour` still sets the link.
- The starter button is disabled while packing and downloading, shows the
  outcome (downloaded / not saved when the save picker was dismissed /
  failed), and reverts after 3 s; a re-click cancels a pending revert.
- The reached step is remembered per hosted url in the injected
  `stepStore` (`localStorage`; key `tour-viewer.wizard.<url>`) and the
  last opened url under a module-private key; `presentTour` lands on the
  remembered step (a remembered step 5 resumes at step 4: the rebuilt zip
  does not survive a reload), `rememberedTourUrl()` is what `main.ts`
  prefills the link input with (M6). Every store access is guarded:
  blocked site data or a sandboxed context falls back to step 2 (a private
  window has a working session-scoped store). Only a creator writes.
  The memory is write-only and outlives the Storage section's cache on
  purpose: the cache is bytes, the step is where the creator got to; a
  wrong step is one tap away and needs no control.
- `stepStoreOrUndefined(read?)` - the browser's store behind a try/catch:
  `localStorage` is a getter that throws where site data is blocked, and
  `typeof` does not protect against that (M6 review #1).

## Examples

```ts
const stepStore = stepStoreOrUndefined(); // undefined where blocked
const wizard = wireWizard({
  mode,
  dom,
  packStarter: buildStarterZip,
  download: downloadZip,
  ...(stepStore === undefined ? {} : { stepStore }),
});
if (mode === "creator") linkInput.value ||= wizard.rememberedTourUrl() ?? "";
hooks.presentTourForPrint = (url) => {
  print.presentTour(url);
  wizard.presentTour(url);
};
```

## Tests

`wizard.test.ts` - creator/visitor boot state, the one-open-step property
over random step sequences, the two advances, the starter button's three
outcomes with an injected timer, the launch link round trip (property),
and the remembered step (M6): landing on it, a throwing store, the parser
(property plus the real inputs), per-url keying, step 5 resuming at 4, a
visitor never writing, and the store probe surviving a throwing getter.
The e2e "the setup remembers the step" covers the reload with the
prefilled link.
