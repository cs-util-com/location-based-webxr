# wizard.ts

## Purpose

The creator's guided setup (guided-setup plan §2.7): the steps as
collapsible sections with one open at a time, advanced by the flow's events
(tour opened → print; code hung → measure), plus the starter zip download
(step 1) and the "open as a visitor" launch link (step 2, the tester's way
into the visitor path).

**FOUR steps since the flow rework** (second testing session, F10): the
download and the replace instructions were steps 5 and 6, and they are not
setup steps - they describe the end of step 4, which happens on the phone,
so they live inside it now and `creator-setup.ts` reveals them.

## Public API

- `wireWizard({ mode, dom, packStarter, download, setTimeout?, clearTimeout?, stepStore?, arSessionActive? }): Wizard`
  - `Wizard.openStep(step)` opens one step and collapses the others -
    EXCEPT while `arSessionActive()` is true, when it forces `measure` open
    and changes nothing else (see the invariants).
  - `Wizard.presentTour(url, { prefer? })` sets and shows the launch link
    (raw form) and, for a creator, opens a step: the one remembered for
    this tour, else `prefer` (step 4's own "paste the link" form asks for
    `measure`), else the print step.
  - `Wizard.presentLaunchUrl(launchUrl)` re-points the link at the PRINTED
    payload once a code is generated (`launchHrefFromPrintedUrl`: the
    printed URL's query on the viewer's origin), so the tester decodes what
    a scan decodes (M2 review #10).
  - Opening `measure` scrolls `dom.measureSection` into view; a step opened
    by hand (`toggle`) closes the others.
  - `dom` is structural: `steps` (collapsible nodes by name - `measure`
    among them since F4), `hangDone`, `starterButton`, `visitorLink`,
    `measureSection` (the same element as `steps.measure`, reached through
    a second field because scrolling and disclosing are different
    capabilities and each unit test fakes its own).
- `WIZARD_STEPS` (`host`, `print`, `hang`, `measure`), `type WizardStep`.
- `remapLegacyStep(raw)` - maps the retired `finish` / `replace` step names
  onto `measure`. Applied to the RAW stored string, BEFORE
  `parseWizardStep`, which rejects anything outside `WIZARD_STEPS`: a remap
  on the other side of the parse could never fire, and every creator who
  had reached step 5 would silently restart at step 2.
- `visitorLaunchHref(url)` → `?qr=<encoded url>`;
  `launchHrefFromPrintedUrl(launchUrl)` → the printed URL's `?qr=…&n=…`
  query, or null for a URL without `qr`.
- `STARTER_LABELS` - the starter button's idle/busy/done/cancelled/failed
  labels (async-UI rule).
- `wizardStepKey(url)`, `parseWizardStep(value)` - the step key and the
  tolerant parser (the last-url key is module-private); `WizardStepStore`
  is the `getItem`/`setItem` slice of `localStorage`;
  `Wizard.rememberedTourUrl()`.

## Invariants & assumptions

- At most one step is open at a time.
- **Step 4 is never collapsed while an AR session is live.** Its content is
  `#ar-root`, the DOM-overlay root, and a collapsed `<details>` renders
  nothing - so a collapse mid-session blanks the overlay on a phone, where
  nothing in CI can see it. `index.html` hides the summary during a session
  (which stops a tap and the keyboard); THIS module stops the rest, because
  `open` is assigned directly from the print panel's `beforeprint`, its
  print button and its `presentTour`, and from the size-error path in
  `creator-setup.ts` - a `Ctrl+P` was enough to reach one of them. Pinned
  as a property: no sequence of `openStep` calls closes it.
- Visitor mode opens nothing here and registers **no toggle listeners**:
  the visitor page opens step 4 itself (`visitor-screen.ts`), and a
  listener would turn that into `openStep("measure")`, whose scroll takes
  the consent copy off the top before the visitor has read it.
  `presentTour` still sets the link.
- The starter button is disabled while packing and downloading, shows the
  outcome (downloaded / not saved when the save picker was dismissed /
  failed), and reverts after 3 s; a re-click cancels a pending revert. Its
  idle label is applied when the wizard is wired, not only by the revert
  timer - renaming the constant alone used to leave the old words on screen
  until after the creator's first click.
- The reached step is remembered per hosted url in the injected `stepStore`
  (`localStorage`; key `tour-viewer.wizard.<url>`) and the last opened url
  under a module-private key; `presentTour` lands on the remembered step (a
  remembered step 5 or 6 resumes at step 4: the rebuilt zip does not
  survive a reload), `rememberedTourUrl()` is what `main.ts` prefills the
  link input with (M6). Every store access is guarded: blocked site data or
  a sandboxed context falls back to step 2 (a private window has a working
  session-scoped store). Only a creator writes. The memory is write-only
  and outlives the Storage section's cache on purpose: the cache is bytes,
  the step is where the creator got to; a wrong step is one tap away and
  needs no control.
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
  arSessionActive: () => arSessionLive(arController.getState().status),
  ...(stepStore === undefined ? {} : { stepStore }),
});
if (mode === "creator") linkInput.value ||= wizard.rememberedTourUrl() ?? "";
hooks.presentTourForPrint = (url, origin) => {
  print.presentTour(url);
  wizard.presentTour(
    url,
    origin === "measure-step" ? { prefer: "measure" } : {},
  );
};
```

## Tests

`wizard.test.ts` - creator/visitor boot state, the one-open-step property
over random step sequences, the two advances, the starter button's three
outcomes with an injected timer, the launch link round trip (property), the
AR-session rule (a property that no `openStep` sequence closes step 4, plus
a session that begins with another step open), the step-4 open preference
and a remembered step still beating it, and the remembered step (M6):
landing on it, a throwing store, the parser (property plus the real
inputs), per-url keying, a stored step 5 or 6 resuming at 4, a visitor
never writing and never registering a toggle listener, and the store probe
surviving a throwing getter. The e2e "the setup remembers the step" covers
the reload with the prefilled link, and "step 4 asks for the tour link"
covers the preference through the composed page.
