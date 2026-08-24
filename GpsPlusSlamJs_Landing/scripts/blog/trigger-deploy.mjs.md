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
  - Enforced by **redaction, not by care**. Node's fetch failures embed the URL
    they were handed (`connect ECONNREFUSED for https://…/deploy/<secret>`), so
    passing the cause's message through verbatim leaked the credential. Both
    the full URL and its final path segment are scrubbed from the rendered
    message **and from the attached cause** (PR #332 review): Node prints the
    whole cause chain for an uncaught error and for `console.error(err)`, so a
    raw `{ cause }` printed the unredacted message right under the redacted
    one. The cause is now a scrubbed clone that keeps the (scrubbed) original
    stack for a debugger. The test that proves the message half was itself
    broken first — see below.
- Cloudflare deploy hooks take a bare `POST` with no body and no auth header.

## Examples

```js
await triggerDeploy({ hookUrl: process.env.CLOUDFLARE_DEPLOY_HOOK_URL });
```

## Tests

`trigger-deploy.test.mjs` — the POST itself, the unconfigured refusal, non-2xx
and network failures, and that the secret never appears in an error message.

The last of those was **asserting nothing** until 2026-08-20: it used
`rejects.toThrow(expect.not.stringContaining(...))`, and `toThrow` hands an
asymmetric matcher the Error _object_, for which `stringContaining` is false —
so the negated form passed for every possible error, including one that
interpolated the URL. It now asserts on `err.message` directly, and the moment
it did, it failed on a real leak.
