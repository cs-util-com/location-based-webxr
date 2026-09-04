# `placement-view.ts` — placement controls view-model

- **Purpose:** Pure mapping from the tested `SetupState` FSM to the placement
  UI: the "Place anchor" button, the status banner, the copy-link action, and
  the error line. Keeps the async-UX contract testable without a DOM. (The
  reload call-to-action this line used to name was removed with
  `reloadPrompt`; PR #411 review.)
- **Public API:**
  - `PlacementView { button, banner, copyLink, error }`
  - `toPlacementView(state: SetupState): PlacementView` — total/pure.
  - _Internal:_ `PlaceButtonView { visible, label, disabled, busy }` is not
    re-exported; reach it via `PlacementView['button']`.
- **Invariants & assumptions:**
  - Button is visible only in the cache-miss placement branch
    (`awaiting-tracking`, `ready-to-place`, `saving`, `saved`).
  - Soft gate (decision D2): the button is **enabled** while tracking warms up;
    only the banner copy nudges waiting.
  - Async-UX rule: `saving` → `{ label: 'Saving…', disabled, busy }` is the
    in-progress state; the durable end states are `saved`
    (`copyLink.visible: true`, the banner carrying the reload / copy
    instruction - DEC-L2-10) or a revert to a placeable
    phase carrying `error`.
  - `copyLink.visible` is true only in `saved`: under decision F1 the anchor is
    encoded into the page URL, so the saved state offers a "copy link" share
    affordance (the durable, shareable end state).
- **Examples:**
  - `toPlacementView(savingState).button` → `{ label: 'Saving…', busy: true }`.
  - `toPlacementView(savedState).copyLink.visible` → `true`.
- **Tests:** [placement-view.test.ts](placement-view.test.ts) — drives the real
  FSM and asserts the in-progress → final transition for the SUCCESS path and
  the revert-with-error for the FAILURE path (satisfies the repo async-UX test
  rule, [2026-04-29 ref-points feedback](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-29-ref-points-user-feedback.md)).
- **See also:** [setup-state-machine.ts.md](setup-state-machine.ts.md),
  [guidance-view.ts.md](guidance-view.ts.md).
