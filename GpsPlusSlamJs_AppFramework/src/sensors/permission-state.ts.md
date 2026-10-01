# permission-state.ts - the prompt-free permission query

- Purpose: the ONE place that asks `navigator.permissions` about a
  permission (DEC-H3, one implementation of shared behaviour). It never
  prompts and never rejects. `permission-checker.ts` builds its geolocation
  and camera rows on it; the design system's globe lab reads it at load
  (round-5 plan 2026-10-01-0945 §3.1: a position only where the permission
  is already granted, never a prompt at load).
- Why a module of its own: it has NO imports. The design system's no-build
  server serves the framework's TypeScript under `/fw/` by mapping `.js` to
  `.ts`, and resolves no extensionless import; `permission-checker.ts`
  imports its siblings without extensions (and pulls the logger and the
  WebXR probe), so a lab could not load it. Keep this file import-free.
- Public API:
  - `type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'`.
  - `queryPermissionState(name: PermissionName): Promise<PermissionState>`:
    the browser's state for `name`, passed through when it is one of the
    standard three.
  - `geolocationPermissionState(): Promise<PermissionState>`: the same for
    `'geolocation'`, `unknown` where there is no `navigator.geolocation`.
- Invariants and defensive measures:
  - `unknown` covers: no `navigator`, no `navigator.permissions.query`, a
    query that throws synchronously or rejects (unsupported names do
    either, by browser), and an answer that is not a standard state.
  - iOS Safari answers `prompt` for geolocation even where the page may
    ask; it stays `prompt`. Only `granted` means "may locate without a
    prompt".
- Example:

  ```ts
  if ((await geolocationPermissionState()) === 'granted') {
    // locate now; no prompt can appear
  }
  ```

- Tests: `permission-state.test.ts` (each standard state passed through;
  iOS's `prompt`; the `unknown` cases: no API, no navigator, no
  geolocation, a rejecting, throwing or odd query).
  `permission-checker.test.ts` still covers the checker's rows on top.
