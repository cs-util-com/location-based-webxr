import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Why this test matters (PR #363 review): `teardownArSessionState` was
 * IMPORTED into main.ts but never CALLED — the import satisfied every
 * reader (and knip) while an AR re-entry blended the dead session's
 * odometry↔GPS pairs into the new alignment solve, the exact DEC-H3
 * failure. main.ts is WebXR glue this package deliberately verifies
 * on-device (see its header), so no headless test can drive its real
 * `onSessionEnd`; this SOURCE-LEVEL guard is knowingly blunt — the same
 * trade the webxr repo-config guards document — and pins the one line
 * whose absence was the bug. The sibling apps carry behavioural versions:
 * AnchorStarter's placement-flow spec drives the captured callback, and
 * the TourViewer's ar-mode spec ends a real fake session.
 */
describe('minimal example session-end wiring', () => {
  it('onSessionEnd dispatches the shared DEC-H3 teardown', () => {
    const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const callback = /onSessionEnd:\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\},/.exec(
      source
    )?.[0];
    expect(callback, 'main.ts lost its onSessionEnd callback').toBeDefined();
    expect(callback).toContain('teardownArSessionState(store');
  });
});
