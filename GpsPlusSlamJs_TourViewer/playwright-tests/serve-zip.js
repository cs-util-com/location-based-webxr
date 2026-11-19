// @ts-check

/**
 * Serve `zip` on the page's own origin at `path`, as a host that honours
 * byte ranges does (the visitor reads an archive by ranges): a tour the
 * editor saved, opened by the visitor without a file server.
 * @param {import("@playwright/test").Page} page
 * @param {string} path
 * @param {Buffer} zip
 * @param {string} etag
 */
export async function serveZip(page, path, zip, etag) {
  await page.route(`**${path}`, async (route) => {
    const request = route.request();
    const headers = {
      "accept-ranges": "bytes",
      "content-type": "application/zip",
      etag: `"${etag}"`,
    };
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers().range ?? "");
    if (request.method() === "HEAD") {
      await route.fulfill({
        status: 200,
        headers: { ...headers, "content-length": String(zip.length) },
      });
    } else if (range !== null) {
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), zip.length - 1);
      await route.fulfill({
        status: 206,
        headers: {
          ...headers,
          "content-range": `bytes ${String(start)}-${String(end)}/${String(zip.length)}`,
        },
        body: zip.subarray(start, end + 1),
      });
    } else {
      await route.fulfill({ status: 200, headers, body: zip });
    }
  });
}
