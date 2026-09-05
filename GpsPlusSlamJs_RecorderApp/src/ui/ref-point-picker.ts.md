# ref-point-picker.ts

**Purpose:** the name prompt shown when a NEW reference point is marked. It asks for a display name and nothing else. Since the H3 migration the ref-point ID is the cell the user stands in, and a nearby re-observation never opens the prompt (`ref-point-handlers.ts` resolves it by proximity in one tap). Until 2026-09-04 this module also carried a suggestion list — search filter, unused/used partition, click to select — that its only caller bypassed with an empty list, so none of it could ever show; collapsed by owner decision (simplify loop, 2026-09-04 interview).

## Public API

- `showRefPointPicker(): Promise<RefPointPickerResult | null>` — shows the prompt; resolves with `{ id }` (the trimmed name) on confirm, `null` on cancel or an outside cancel. No parameters.
- `cancelRefPointPicker(): void` — cancel from outside (the browser back button, via `navigation.ts`); resolves the pending prompt with `null`.
- `isRefPointPickerVisible(): boolean` — the caller's single-instance guard.
- `createRefPointPickerHtml(): string` — the modal's content, injected once into `#ref-point-picker-modal` at startup (`main.ts`).
- `RefPointPickerResult` — `{ id: string }`. The former `isNew` flag is gone: every result is a new point's name.

## Invariants & assumptions

- **Single pending prompt.** A second `showRefPointPicker()` while one is pending resolves the earlier promise with `null` first (logged), so no promise is orphaned.
- **Confirm is disabled once resolved** (confirm, cancel or outside cancel) and re-enabled on the next show — a stale tap does nothing.
- **Empty names are rejected**: confirm with an empty or whitespace-only input keeps the prompt open. Input is trimmed.
- **Fresh state per prompt:** the input is cleared on show and the controls are cloned to drop the previous prompt's listeners.
- **Navigation integration:** show pushes a history entry (`pushModalState`); every resolution pops it (`popModalState`, a no-op if the back button already did).
- **DOM requirement:** `#ref-point-picker-modal` must exist (`index.html`); when it does not, the prompt logs and resolves `null`.

## Example

```ts
const result = await showRefPointPicker();
if (result) {
  markNewRefPoint(currentH3, result.id); // the name is display metadata only
}
```

## Tests

- `ref-point-picker.test.ts` — HTML structure, visibility, confirm/cancel resolution, empty-name rejection and trimming, the confirm-button disable/re-enable rules, the stale-resolver guard, the history push/pop and back-button cancel, and the 2026-03-08 no-leak-between-prompts cases.
- `playwright-tests/ref-point-picker.spec.js` — the real modal through `window.refPointPickerApi.showRefPointPicker()`.

## Related files

- [main.ts](../main.ts) — injects the HTML, wires the back-button cancel, exposes the window API for e2e.
- [navigation.ts](./navigation.ts) — the history-based back-button handling.
- [ref-point-handlers.ts](../ref-points/ref-point-handlers.ts) — the only caller.
