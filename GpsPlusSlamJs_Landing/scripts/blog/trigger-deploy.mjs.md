# `trigger-deploy.mjs`

**Purpose:** ask Cloudflare to rebuild and redeploy the site after a wiki
change (plan decision D19).

## Why it exists

Cloudflare's Git integration builds on pushes to the **main** repository, but
blog posts live in the **wiki** repository. Flipping a page to
`status: published` produces no push, no build and no deploy — publication
would appear to work and change nothing on `gps.csutil.com`. The plan review
found this before any code existed.

## Public API

- `triggerDeploy({ hookUrl, fetchImpl? }): Promise<{ triggered: true }>`
  - **Throws** when `hookUrl` is missing, when the request fails, and when
    Cloudflare answers non-2xx. It never resolves on failure: a silently
    skipped deploy is the exact bug this module exists to remove.
  - `fetchImpl` is an injected seam for tests; defaults to global `fetch`.

## Invariants & assumptions

- **The hook URL is a credential.** Anyone holding it can trigger deploys, so
  it lives in a gitignored local env file (`CLOUDFLARE_DEPLOY_HOOK_URL`), never
  in either repository, and **never in an error message** — local logs get
  pasted into chats and issues.
- Cloudflare deploy hooks take a bare `POST` with no body and no auth header.

## Examples

```js
await triggerDeploy({ hookUrl: process.env.CLOUDFLARE_DEPLOY_HOOK_URL });
```

## Tests

`trigger-deploy.test.mjs` — the POST itself, the unconfigured refusal, non-2xx
and network failures, and that the secret never appears in an error message.
