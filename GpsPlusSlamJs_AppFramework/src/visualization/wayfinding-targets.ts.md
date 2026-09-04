# wayfinding-targets.ts

## Purpose

The pure half of the wayfinding HUD: turns one raw `getTargets()` result into the list of targets the HUD may show, hiding and logging (once, per offender) everything that would otherwise throw inside the frame loop. Split out of `createWayfindingHud` on 2026-09-04 (simplify loop) so the boundary rules can be tested without a THREE scene; the HUD keeps rendering, state sync and resource ownership.

## Public API

- `createTargetResolver({ distanceMin, distanceMax }): TargetResolver` — one resolver per HUD instance; it owns the one-shot log bookkeeping.
- `TargetResolver.resolve(raw: unknown): ResolvedTarget[]` — never throws. `raw` is whatever the consumer's getter returned.
- `ResolvedTarget` — `{ key, position, distanceMin, distanceMax, showArrowWhenInactive, showLabelWhenInactive }`, every optional field resolved (`key` is the id, or the index when the target has none).
- `WayfindingTarget` — the consumer-facing element type; re-exported unchanged by `wayfinding-hud.ts`.

## Invariants & assumptions

- **Never a per-frame throw.** A non-array result counts as an empty list (logged once for the resolver's lifetime). A plain `Vector3` (the pre-2026-07-20 API), an element without a `Vector3` position or with a non-string id, a duplicate id, and a deadband breaking `0 ≤ distanceMin ≤ distanceMax` (finite) each hide THAT target and log once.
- **Once means once per offender, until it heals.** Log keys are `<reason>:<index>` for shape issues and `<reason>:<id>` for duplicates and deadbands; a key is cleared when the target resolves cleanly (duplicates: when the id stops being duplicated), so a later regression logs again instead of staying silent.
- **Only the first occurrence of a duplicate id is shown.**
- Deadband defaults come from the HUD-level options; the rule is the same one `wayfinding-placement.ts` enforces per call.
- Pure apart from the logger; no THREE resources, no DOM.

## Example

```ts
const targets = createTargetResolver({ distanceMin: 2, distanceMax: 5 });
// every frame:
const resolved = targets.resolve(getTargets());
```

## Tests

- `wayfinding-targets.test.ts` — well-formed resolution and defaults, non-array getter, legacy and shapeless elements, duplicate ids (first shown, log once, re-log after healing), deadband violations (hide, log once, re-log after healing), non-finite and negative deadbands, non-string ids.
- `wayfinding-hud.test.ts` — the same rules observed through the HUD (indicators hidden, other targets unaffected).
