# Throwaway Real Data Adapter prototypes

**Disposable comparison only. Do not promote or copy these files into production.**
No AppFramework implementation, production exports, workspace manifests or lockfile
are changed. No disc, altitude lighting, shadow rig or combined demo is included.

Approved baseline: commit `1204ede318fb2d399513f182bdd3b84a424acfe8`,
[Real Data Adapter PLAN.md](../../docs/real-data-adapter/PLAN.md), stages D–F.
All three variants were independently authored in this session against that same
contract and fixture set. They do not import or copy sibling model implementations.
They are alternative designs, not claims of independent reviewer/LLM consensus.

## Run from the repository root

Prerequisite: the existing workspace dependencies are installed. The runner reuses
the SunPositionDemo's Vite, root Vitest, framework TypeScript and RecorderApp's
Playwright. It does not install packages or rebuild the framework. The prototypes
import the existing Sun Position Core source directly so the current implementation
is exercised without a potentially stale dist build. Source files are read only.

```powershell
node scratch/real-sun-data-adapter/run.mjs dev
```

Open the localhost URL printed by Vite, then choose A, B or C. The default port is
OS-assigned, avoiding permanent port allocations for this disposable experiment.
An optional explicit port is supported (e.g. `dev 5192`); occupied ports fail
instead of silently switching. Stop the server with Ctrl+C.

```powershell
node scratch/real-sun-data-adapter/run.mjs test
node scratch/real-sun-data-adapter/run.mjs check
node scratch/real-sun-data-adapter/run.mjs build
node scratch/real-sun-data-adapter/run.mjs browser
```

The browser command starts/stops its own random-port server. On this Windows
machine it uses installed Edge in headless mode; otherwise it uses installed
Playwright Chromium. `PROTOTYPE_BROWSER_CHANNEL` can select an installed channel.
Screenshots and browser run details are written to ignored `artifacts/`. Build
output and Vite caches are also confined to ignored folders here.

## Variants

| Prototype | Native API | Interaction |
| --- | --- | --- |
| [A: commands](a-commands/README.md) | Per-source commands plus atomic `setInputs` | Immediate selectors, edits and slider |
| [B: configuration](b-configuration/README.md) | Atomic `configure` plus GPS/refresh events | Explicit draft/apply |
| [C: snapshots](c-snapshot/README.md) | Pure `resolveSnapshot` plus host wrapper | Immediate selection and atomic fixture stepping |

Each has its own model and page. Shared comparison infrastructure provides types,
boundary predicates, immutable publication, the existing isolated registry,
fixtures and a consistent panel. `shared/drivers.ts` adapts the three native APIs
to the same tests/panel; it is **not** a fourth adapter or production proposal.
The shared panel loads the comparison models, so keep this small folder together.
This is self-contained within the existing repository toolchain, not a standalone
published package.

## Exercise the same scenario in every page

1. Start in live/real waiting. Click **Deliver synthetic live-feed fix**. The
   harness clearly labels this input synthetic; it is not an outdoor GPS result.
2. Select all four location/time combinations. In B, click **Apply both drafts**.
   Watch selected sources and effective output separately from controls.
3. Select fixed location, deliver another synthetic fix, then return to live.
   Background fixes change the live cache but do not publish fixed-location state.
4. Edit latitude to 999, then recover to 0. Enter an ISO time without an offset
   (invalid), then `2026-06-21T14:00:00+02:00` (12:00 UTC). Scrub the UTC slider.
5. Use the synthetic real clock and advance it. Fixed time stays fixed. Returning
   to real mode uses the advanced clock. Recreate to restore the device clock.
6. Step **Next**, **Previous**, **Repeat** synthetic pairs. Each publishes exactly
   one fixed/fixed sample, including location sample metadata and solar instant.
7. Clear the live cache and return to live; observe waiting. Dispose/recreate.
8. Optionally click **Start real framework GPS** in a supported localhost browser.
   This calls existing framework `startGpsWatch` in the host; the models never
   access geolocation. Stop/dispose clears that host-owned watch.

The host owns a 30-second real-mode refresh and resume refresh. Fixed mode has no
interval. GPS errors remain host feedback, distinct from adapter input validity.

## Limits

- No physical GPS/device run or Task 1 recordings are claimed. Automated browser
  tests emulate the browser geolocation boundary while using the real framework
  mapping function. Real GPS permission/acquisition is an optional manual check.
- The panels are small experiment controls, not polished production UI. ISO input
  requires an offset but uses JavaScript Date parsing; strict rejection of every
  impossible calendar date is not implemented (Date can normalize some inputs).
- Core equations are reused unchanged. Shared predicates guard expected input
  errors; these experiments are not hardened against arbitrary malformed objects
  outside their TypeScript interfaces or reentrant subscriber mutations.
- Timestamps are epoch milliseconds; GPS sample time never implicitly selects
  solar time. Real clock injection is a harness facility; fixed time is a separate
  public mode. Task 1 schema loading, ordering and interpolation remain host work.
- Shared host/notification conveniences reduce repetition for comparison. The
  production implementation must start separately with new RED → GREEN tests.

See [COMPARISON.md](COMPARISON.md) for executed evidence and the reference-only
recommendation. Production TDD is intentionally not started.
