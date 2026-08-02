# Dev-server ports

**One table, and every `vite.config.ts` points here instead of listing its siblings.**

## Allocation

- **5173** — `GpsPlusSlamJs_RecorderApp` (config lives in `config/vite.config.ts`)
- **5180** — `GpsPlusSlamJs_MinimalExample`
- **5181** — `GpsPlusSlamJs_AnchorStarter`
- **5182** — `GpsPlusSlamJs_Landing`
- **5183** — `GpsPlusSlamJs_WayfindingHudDemo`
- **5184** — `GpsPlusSlamJs_PhysicsDemo`
- **5185** — `GpsPlusSlamJs_QrTrackingDemo`
- **5186** — `GpsPlusSlamJs_OsmDemo`

Next free: **5187**.

Each port appears in three places for its package — `vite.config.ts` (`server.port`) and
`playwright-tests/playwright.config.js` (`baseURL` and the `webServer` `command`/`url`).
`tests/repo-config/dev-server-ports.test.js` asserts the set is unique.

## Why this file exists

Three packages were configured for **5182** at the same time — the landing, the physics
demo and the QR-tracking demo — and **each one's config comment asserted the port was
distinct "so it can coexist with the others"**. Every comment was written in good faith
from local knowledge; two of them were wrong. A fourth comment, in the wayfinding demo,
described 5182 as "the physics demo", which was true when it was written and had since
become ambiguous between three packages.

That is the failure mode a per-file comment cannot avoid: it is a claim about every OTHER
package, made in a file that has no way to notice when one of them changes.

## Why a clash is worse than it sounds

Every Playwright config sets `reuseExistingServer: !process.env.CI`. So a second package
starting on an occupied port **does not fail to bind** — it attaches to the first
package's dev server and runs its whole e2e suite against the wrong application.

Observed before the split: five `GpsPlusSlamJs_QrTrackingDemo` tests failed with
`getByTestId('start-screen')` → "element(s) not found", and the captured page snapshot was
the landing page's "Story chapters" navigation. `curl http://127.0.0.1:5182/` returned the
landing's `<html lang="en" data-theme="dusk">` while the QR suite ran against it. Killing
the process on 5182 and re-running the identical tree gave 37 passed.

CI never sees it: it does not reuse servers, and it runs each package's gate in its own
job. Locally it only bites when one package's dev server outlives its stage — which a long
or interrupted root cascade produces — so it presents as an unrelated flaky package, and
re-running appears to fix it.

Full investigation:
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-02-0947-webxr-port-5182-collision-findings.md`.

## Adding a package

Take the next free port, add a row above, and point the new `vite.config.ts` comment at
this file rather than writing out the neighbours. The repo-config test will fail if the
port is already taken.
