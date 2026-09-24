# Prototype comparison and reference decision

**Stages D–F only. Production TDD has not started. These prototypes must remain
throwaway reference material.**

Baseline: approved [PLAN.md](../../docs/real-data-adapter/PLAN.md) at
`1204ede318fb2d399513f182bdd3b84a424acfe8`.
Evaluation: 2026-09-15, Windows, Node 22.19.0, installed Vite 8.2.2,
Vitest 5.0.0, headless Edge 153.0.4234.32 through Playwright.
The repository declares Node >=26; this local prototype run used the available
Node 22.19.0 successfully. It is not a production toolchain certification.

## Recommendation

Use **A: command-oriented facade with immediate source selection and an atomic
paired-input method** as the reference for the later, separately TDD-built component.

The current problem needs independent overrides, one cached live fix and one
atomic replay operation. A makes those operations direct without requiring a
host to reconstruct unrelated source inputs. B and C passed the same correctness
checks; their additional configuration/draft or snapshot/wrapper concepts did not
provide a necessary replay advantage in these runs.

This recommends a design, not promotion of A's implementation. Write production
code and tests afresh from the approved contract. No production export, adapter,
component integration or final demo was created here.

## Executed evidence

Commands run from the repository root:

```powershell
node scratch/real-sun-data-adapter/run.mjs test
node scratch/real-sun-data-adapter/run.mjs check
node scratch/real-sun-data-adapter/run.mjs build
node scratch/real-sun-data-adapter/run.mjs browser
```

| Check | Result |
| --- | --- |
| Shared prototype behavior suite | 70 passed: 23 checks/cases per variant and one direct pure-resolver check |
| TypeScript no-emit check | Passed, including models, panel, test types and imported framework contracts |
| Browser bundle build | Passed; all three variant pages and the index emitted into local ignored dist |
| Real browser interaction scripts | A, B and C passed, with zero page exceptions |
| Visual inspection | Reviewed the generated full-page A/B/C screenshots; source labels, UTC input, status and fixture controls are visible |
| Source boundaries | Models have no navigator, GPS watcher, timer, Three.js or SunCalc imports/math; they use the existing core through a shared re-export |
| Repository scope | Changes confined to the throwaway folder; approved plan and production AppFramework files remain unchanged |

Reproducible sources: [comparison.test.ts](tests/comparison.test.ts) and
[browser.mjs](tests/browser.mjs). The browser runner regenerates screenshots and
machine-readable results in ignored `artifacts/`; this document preserves the
review conclusions without committing generated output.

The browser script used controlled browser geolocation callbacks and the actual
framework `startGpsWatch` mapping. This proves the framework input connection and
cleanup path, **not physical GPS accuracy or outdoor behavior**. No Task 1
recordings exist for this evaluation. A real GPS start/stop control is available
for a later device run. Usability conclusions come from scripted interaction and
visual inspection, not a study with independent human participants.

## Approved-plan success criteria

| Criterion | A | B | C | Evidence |
| --- | --- | --- | --- | --- |
| Live/real default; no fabricated location | Pass | Pass | Pass | Starts waiting, without clock/core call before a fix |
| All four independent combinations | Pass | Pass | Pass | Shared cases and browser selectors; B applies drafts explicitly |
| Background live updates preserved under fixed location | Pass | Pass | Pass | No fixed-state publication; switching back uses newer fix |
| Atomic recorded location/time pair | Pass | Pass | Pass | One calculation and publication per pair; forward/backward/repeated pairs |
| Fixed time independent of wall clock | Pass | Pass | Pass | Clock-throwing replay test and identical runs under different clocks |
| UTC absolute-instant semantics | Pass | Pass | Pass | Offset-equivalent Dates; browser +02:00 to UTC; slider anchored in UTC |
| Invalid input and recovery | Pass | Pass | Pass | No silent fallback; cache invalidation, error precedence and recovery |
| Mutation protection and lifecycle | Pass | Pass | Pass | Date/input snapshots, frozen output, listeners, disposal, multiple instances |
| Existing core reused without rendering coupling | Pass | Pass | Pass | Delegation spy and unmocked core comparison; source inspection |
| Runnable minimal controls | Pass | Pass | Pass | Build plus actual headless-browser interaction |
| Outdoor Task 1 replay e2e | Deferred | Deferred | Deferred | Requires actual Task 1 fixtures later; not a prototype blocker |

No candidate was disqualified by the tested criteria. Shared infrastructure means
shared test/utility bugs remain possible; agreement among these variants is not
independent validation of the Sun Position Core's astronomy.

## API, code quality and interaction tradeoffs

| Dimension | A: commands | B: configuration | C: snapshots |
| --- | --- | --- | --- |
| Single-source intent | Direct setter preserves other source | Host reads/composes full selection | Wrapper replaces composed selection |
| Paired replay | Explicit setInputs | configure is always atomic | Complete snapshot / replaceSelection |
| Model structure | Closure, one evaluation path | Event reducer plus evaluator | Pure resolver plus lifecycle wrapper |
| Extra host responsibility | GPS, timer and UI controls | Same plus draft/apply composition | Same plus explicit snapshot/clock coordination |
| Slider feedback | Immediate | Requires Apply | Immediate through wrapper |
| Intermediate edits | Can publish invalid state while typing | Invalid drafts stay separate until Apply | Same immediate-edit tradeoff as A |
| Replay without stateful facade | Not exposed | Not exposed | Direct pure resolver available |
| Maintenance cost observed | Few concepts; API has convenience methods | Smaller configuration API, more event/draft concepts | Pure seam useful, wrapper still needed; real-mode validation probe repeats work |

Model sizes at evaluation: A 70 lines, B 71, C 78, excluding shared infrastructure.
They are similarly small. These counts do not determine the recommendation;
the meaningful difference is what the host and future maintainers must understand.

### Concrete interaction observations

- All pages show selected sources separately from editable controls and identify
  synthetic fixtures/clock overrides explicitly. Output includes both location
  sample timestamp and the selected solar instant.
- In A/C, a source switch immediately updated output. In B, the scripted selection
  remained unchanged until an additional Apply click, with a visible unapplied
  draft message. The same slider movement therefore required one extra action.
- `2026-06-21T12:00:00` was rejected as ambiguous; the explicit-offset
  `2026-06-21T14:00:00+02:00` produced `12:00:00Z`. Slider minute 360 produced
  `06:00:00Z`. Advancing the synthetic real clock left fixed output unchanged;
  switching back to real selected the advanced clock.
- B coalesced separate location/time control changes into fewer publications.
  In the captured script before cleanup, A/C had 23 publications and B had 19.
  This is a consequence of that interaction sequence, not a performance benchmark.
- Previous/Next/Repeat bypassed draft editing and applied exactly one complete
  synthetic pair in every page. None needs a pure public resolver merely to
  support coherent replay updates.
- C's pure function is clean for direct fixture evaluation. Its wrapper needs a
  location/time availability probe to avoid reading real time too early, then
  resolves again with a clock value. Tests confirmed only one solar calculation;
  the extra validation path adds complexity without a current user benefit.
- A/B/C host disposal stopped the host refresh timer and the framework GPS watch;
  recreation returned to live/real waiting. The timer instrumentation explicitly
  excluded Vite's development heartbeat.

## Clarifications for later production work

These are reference recommendations, not implementation begun in this task:

1. Keep A's per-source methods plus a prominently documented atomic pair method.
   Replay hosts must use the pair operation, never two sequential source setters.
2. Keep draft text/form validation in the UI. Immediate mode switches and slider
   updates are useful; incomplete typed input may benefit from Apply-on-valid or
   explicit commit behavior without changing the adapter API.
3. Keep selected solar time separate from publication time and location sample
   time. Date inputs must be copied as milliseconds; no timezone arithmetic.
4. Use optional location sample metadata for recordings and null for manual
   coordinates. A UI edit that turns a recorded point into manual coordinates
   should explicitly clear that provenance (B currently does so on form Apply).
5. Do not expose C's internal numeric snapshot/error-cache structure as a second
   public API unless a real consumer needs stateless evaluation.

Remaining production questions from the plan: live fix freshness/accuracy policy,
final manual text validation/commit behavior, slider range/step and Task 1 schema
and timestamp conventions. Strict calendar-date validation, arbitrary malformed
runtime objects and reentrant subscriber mutation are prototype limitations, not
evidence that production can skip considering those cases.

## Stop point

Three runnable throwaway variants, common executed checks, browser interaction,
per-variant documentation and a reference decision are complete. Stop here.
Stages G–J (production TDD, production validation, standalone production demo and
recording-driven e2e) remain future work.
