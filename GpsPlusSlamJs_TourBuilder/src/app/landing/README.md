# src/app/landing — root-URL entry screen

Mounted by `main.ts` whenever `resolveAppMode` resolves to Authoring (no
`?tour=`, contract D13) — the screen shown before that decision used to
jump straight into the onboarding gate. A real tour visitor almost never
sees this: they arrive already carrying `?tour=` from a shared link or QR,
which routes straight to Viewing mode. This screen is for whoever lands on
the bare root URL instead.

## `landing-screen.ts`

```ts
mountLandingScreen(root: HTMLElement, deps?: { navigate?(url: string): void }): { destroy(): void }
```

Heading is the app name ("TourBuilder") plus a one-line tagline. Three real entry points plus one dev escape hatch. The last two entry points share one "open an existing tour" card:

| Action                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create your own tour**     | The primary action (only reason to land here). Swaps into the existing `mountAuthoringApp` flow (onboarding gate → tools → export).                                                                                                                                                                                                                                                                                                                                    |
| **I have a tour link**       | Fallback for a `?tour=` link that reached someone as plain text (a screenshot, a printed sign) instead of a live hyperlink/QR — expands a paste field (a `<form>`: Enter or the keyboard's Go key submits; button reads "Open"). Accepts either a full share link (its own `?tour=`, followed unchanged) or a raw hosted `tour.zip` URL, wrapped via the same `prepareHostedZipUrl`/`buildTourUrl` pair the author's own share panel uses (`pack-and-share-panel.ts`). |
| **Try the demo tour**        | First row of the card: a plain link to the viewing-mode demo (`?tour=`), so a cold visitor can see a finished tour with no setup.                                                                                                                                                                                                                                                                                                                                      |
| **View separate components** | Dev/instructor-only, rendered only in dev or with `?dev` on the deployed build. Plain, visually quiet link to the root component gallery (`index.html`, one level above `src/app/`) that lists every component's own standalone demo. Never a visitor path.                                                                                                                                                                                                            |

`navigate` defaults to a real `location.href` assignment; injectable so
tests can assert on the computed URL instead of navigating jsdom.

## Tests

`landing-screen.test.ts` (`@vitest-environment jsdom`) — every rendered
entry point, the link form's reveal/collapse and both its accepted paste
shapes (full share link vs. raw hosted URL) plus its rejection path, and
the real swap into `mountAuthoringApp` (mocked framework permission
functions only, same as `authoring/authoring-app.test.ts`).
