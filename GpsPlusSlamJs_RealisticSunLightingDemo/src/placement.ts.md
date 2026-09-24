# `src/placement.ts`

## Purpose

Pure tap-to-place view-model logic for GPS gating. Ensures GPS anchoring works correctly by requiring a GPS fix before allowing placement, following the same pattern as GpsPlusSlamJs_MinimalExample.

## Public API

### Types

- `PlacementDecision` - Union type representing tap outcome: `'place'`, `'waiting-for-gps'`, or `'no-surface'`
- `TapInput` - Input state for GPS gate: `hasGpsFix` and `reticleVisible` flags

### Functions

- `decideTapPlacement(input: TapInput): PlacementDecision` - Pure function that decides tap outcome based on GPS and surface detection state

## Invariants

- GPS gate takes precedence over surface check (pre-fix tap always returns `'waiting-for-gps'`)
- Placement only allowed when both GPS fix and surface are available
- No side effects or WebXR dependencies (pure, testable logic)

## Examples

```typescript
import { decideTapPlacement } from './placement.js';

// Waiting for GPS
const decision1 = decideTapPlacement({ hasGpsFix: false, reticleVisible: true });
// decision1.kind === 'waiting-for-gps'

// No surface detected
const decision2 = decideTapPlacement({ hasGpsFix: true, reticleVisible: false });
// decision2.kind === 'no-surface'

// Ready to place
const decision3 = decideTapPlacement({ hasGpsFix: true, reticleVisible: true });
// decision3.kind === 'place'
```

## Tests

Covered by `src/placement.test.ts`:
- GPS gate logic when no fix available
- GPS gate regardless of reticle visibility
- No-surface decision when GPS ready but no surface
- Place decision when both GPS and surface available
