// @ts-check
/**
 * trigger-deploy.mjs — asks Cloudflare to rebuild and redeploy the site.
 *
 * Why this exists at all (plan decision D19, found by the plan review):
 * Cloudflare's Git integration builds on pushes to the **main** repository,
 * but blog posts live in the **wiki** repository. Flipping a wiki page to
 * `status: published` therefore produces no push, no build and no deploy —
 * publication would appear to work and change nothing on gps.csutil.com.
 * A deploy hook is a plain POST to a secret URL that starts a build.
 *
 * The hook URL is a credential: anyone holding it can trigger deploys. It
 * lives in a gitignored local env file, never in either repository, and never
 * in an error message — local logs get pasted into chats and issues.
 *
 * Usage:
 *
 *     import { triggerDeploy } from './trigger-deploy.mjs';
 *     await triggerDeploy({ hookUrl: process.env.CLOUDFLARE_DEPLOY_HOOK_URL });
 */

/**
 * Remove the hook URL — and the bare secret path segment on its own — from a
 * message that is about to be logged.
 *
 * @param {string} message
 * @param {string} hookUrl
 * @returns {string}
 */
function redact(message, hookUrl) {
  const secret = hookUrl.split("/").filter(Boolean).at(-1);
  let out = message.split(hookUrl).join("<deploy hook URL>");
  if (secret && secret.length >= 3) {
    out = out.split(secret).join("<redacted>");
  }
  return out;
}

/**
 * @param {object} options
 * @param {string | undefined} options.hookUrl the secret Cloudflare hook URL
 * @param {typeof fetch} [options.fetchImpl] injected for tests
 * @returns {Promise<{ triggered: true }>}
 * @throws {Error} when unconfigured, when the request fails, or when
 *   Cloudflare answers with a non-2xx status. Never resolves on a failure:
 *   a silently skipped deploy is exactly the bug this module exists to fix.
 */
export async function triggerDeploy({ hookUrl, fetchImpl = fetch }) {
  if (!hookUrl) {
    throw new Error(
      "triggerDeploy: CLOUDFLARE_DEPLOY_HOOK_URL is not set. Publishing a " +
        "wiki post cannot reach the live site without it — the wiki repo is " +
        "not what Cloudflare watches.",
    );
  }

  let response;
  try {
    response = await fetchImpl(hookUrl, { method: "POST" });
  } catch (cause) {
    // REDACTED, not merely "not added". Node's fetch failures embed the URL
    // they were given (`connect ECONNREFUSED for https://…/deploy/<secret>`),
    // so passing the cause's message through verbatim leaks the credential
    // into exactly the logs that get pasted into issues.
    //
    // AND THE CAUSE IS A REDACTED CLONE, not the raw error (PR #332 review):
    // Node prints the whole cause chain — for an uncaught exception and for
    // `console.error(err)` — and this module's real call sites let the error
    // escape, so a raw `{ cause }` printed the unredacted message right under
    // the redacted one. The clone keeps the original stack (scrubbed) so a
    // debugger still sees where the failure came from; only the secret is
    // gone.
    const detail = cause instanceof Error ? cause.message : String(cause);
    const scrubbedCause = new Error(redact(detail, hookUrl));
    if (cause instanceof Error && cause.stack) {
      scrubbedCause.stack = redact(cause.stack, hookUrl);
    }
    // Deliberate rule break: the caught error's message and stack embed the
    // secret hook URL, so the cause is a scrubbed clone, not the original
    // (PR #332 review).
    /* eslint-disable preserve-caught-error */
    throw new Error(
      `triggerDeploy: deploy hook request failed: ${redact(detail, hookUrl)}`,
      { cause: scrubbedCause },
    );
    /* eslint-enable preserve-caught-error */
  }

  if (!response.ok) {
    throw new Error(
      `triggerDeploy: deploy hook returned ${response.status} ${response.statusText}`.trimEnd(),
    );
  }
  return { triggered: true };
}
