# serve.mjs — LAN static server for the phone round

- Purpose: serve `index.html` over plain HTTP on all interfaces so a
  phone on the same Wi-Fi can open the design system live. Chosen over
  a hosted deploy (owner decision 2026-08-27) because iteration speed
  matters more than HTTPS: edit, save, pull-to-refresh on the phone.
- Public API (CLI): `pnpm run serve` (env `PORT` overrides 4173).
  Prints the localhost URL and every non-internal IPv4 as a
  phone-ready URL. Ctrl+C stops it.
- Invariants & assumptions:
  - Dependency-free (`node:http` only) — this package's runtime stays
    at zero dependencies.
  - Paths are resolved inside the package dir only; `../` escapes are
    stripped and out-of-root resolutions get 403.
  - `cache-control: no-store` so a phone refresh always shows the
    latest save — caching is the enemy of a taste loop.
  - **Plain HTTP means Android blocks `getUserMedia`**: the `live`
    camera background fails with its normal error toast on the phone.
    Accepted when the LAN approach was picked; every other background
    works.
- Examples: `pnpm run serve` → open the printed `http://<lan-ip>:4173/`
  on the phone.
- Tests: none (tool, not production); exercised by every phone round.
