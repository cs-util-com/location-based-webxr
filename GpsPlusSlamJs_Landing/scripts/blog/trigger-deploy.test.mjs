import { describe, expect, it, vi } from "vitest";

import { triggerDeploy } from "./trigger-deploy.mjs";

// Why this test matters: this call is the entire difference between "the
// owner flipped a wiki page to published" and "it is live". Cloudflare builds
// on pushes to the MAIN repo, and the blog lives in the WIKI repo — so
// without this hook, publishing succeeds everywhere and changes nothing on
// the site (plan decision D19). Every failure path therefore has to shout.

const HOOK = "https://api.cloudflare.com/client/v4/pages/webhooks/deploy/xyz";

describe("triggerDeploy", () => {
  it("posts to the configured hook", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));

    const result = await triggerDeploy({ hookUrl: HOOK, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(HOOK, { method: "POST" });
    expect(result.triggered).toBe(true);
  });

  it("refuses to pretend success when no hook is configured", async () => {
    await expect(
      triggerDeploy({ hookUrl: undefined, fetchImpl: vi.fn() }),
    ).rejects.toThrow(/CLOUDFLARE_DEPLOY_HOOK_URL/);
  });

  it("treats a non-2xx response as a failure, with the status in the message", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("nope", { status: 403, statusText: "Forbidden" }),
    );

    await expect(triggerDeploy({ hookUrl: HOOK, fetchImpl })).rejects.toThrow(
      /403/,
    );
  });

  it("surfaces a network failure rather than swallowing it", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });

    await expect(triggerDeploy({ hookUrl: HOOK, fetchImpl })).rejects.toThrow(
      /ENOTFOUND/,
    );
  });

  it("never puts the secret hook URL in an error message", async () => {
    // The URL is a deploy credential: anyone holding it can trigger builds.
    // Local logs get pasted into chats and issues, so it must not travel.
    //
    // ASSERTED ON `err.message`, NOT VIA `rejects.toThrow(matcher)`. The
    // earlier form passed an asymmetric string matcher to `toThrow`, which
    // hands it the Error OBJECT — `stringContaining` returns false for a
    // non-string, so the negated form passed for every possible error,
    // including one that interpolated the URL. A cold review measured it.
    const cases = [
      async () => new Response("", { status: 500 }),
      async () => {
        throw new Error(`connect ECONNREFUSED for ${HOOK}`);
      },
    ];

    for (const fetchImpl of cases) {
      const error = await triggerDeploy({ hookUrl: HOOK, fetchImpl }).catch(
        (err) => err,
      );
      expect(error).toBeInstanceOf(Error);
      expect(typeof error.message).toBe("string");
      expect(error.message).not.toContain("xyz");
      expect(error.message).not.toContain(HOOK);
    }
  });

  it("never puts the secret in the CAUSE chain either", async () => {
    // Node prints the WHOLE cause chain — for an uncaught exception and for
    // `console.error(err)` — and this module's real call sites (a CI or local
    // publish step) let the error escape. A raw `{ cause }` therefore printed
    // the unredacted message right under the redacted one, undoing the
    // redaction in exactly the scenario it was written for. Found by
    // claude[bot] review on PR #332.
    const fetchImpl = async () => {
      throw new Error(`connect ECONNREFUSED for ${HOOK}`);
    };

    const error = await triggerDeploy({ hookUrl: HOOK, fetchImpl }).catch(
      (err) => err,
    );
    expect(error).toBeInstanceOf(Error);
    let cause = error.cause;
    while (cause !== undefined) {
      const rendered =
        cause instanceof Error
          ? `${cause.message}\n${cause.stack}`
          : String(cause);
      expect(rendered).not.toContain("xyz");
      expect(rendered).not.toContain(HOOK);
      cause = cause instanceof Error ? cause.cause : undefined;
    }
  });
});
