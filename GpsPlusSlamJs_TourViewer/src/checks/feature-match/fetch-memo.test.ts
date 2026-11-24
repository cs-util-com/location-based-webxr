import { describe, expect, it } from "vitest";

import { memoFetch } from "./fetch-memo";

function counting(answers: Record<string, () => Promise<Response>>) {
  const calls: string[] = [];
  const fetch = (url: string): Promise<Response> => {
    calls.push(url);
    const answer = answers[url];
    return answer ? answer() : Promise.reject(new TypeError("offline"));
  };
  return { calls, fetch };
}

const ok = (text: string) => () =>
  Promise.resolve(new Response(text, { status: 200 }));

// Why these tests matter: the worker measures pair after pair, and each
// pair builds its methods again; without the memo every pair would fetch
// (or read from the HTTP cache) the 60 MB of models once more. A failed
// fetch must not be kept, or one network hiccup would fail every pair.
describe("memoFetch", () => {
  it("fetches a URL once and gives each caller its own readable body", async () => {
    const { calls, fetch } = counting({ "https://m/a.onnx": ok("model") });
    const f = memoFetch(fetch);
    const [r1, r2] = await Promise.all([
      f("https://m/a.onnx"),
      f("https://m/a.onnx"),
    ]);
    expect(await r1.text()).toBe("model");
    expect(await r2.text()).toBe("model");
    expect(await (await f("https://m/a.onnx")).text()).toBe("model");
    expect(calls).toEqual(["https://m/a.onnx"]);
  });

  // Why: the memo hands its kept bytes to each new Response without a
  // copy of its own (the Response takes one), so a caller that writes into
  // the body it read must still not change what the next caller reads.
  it("keeps its bytes intact when a caller writes into the body it read", async () => {
    const { fetch } = counting({ "https://m/c.onnx": ok("abc") });
    const f = memoFetch(fetch);
    const first = new Uint8Array(
      await (await f("https://m/c.onnx")).arrayBuffer(),
    );
    first.fill(0);
    expect(await (await f("https://m/c.onnx")).text()).toBe("abc");
  });

  it("keeps no failed fetch and no error status", async () => {
    let up = false;
    const { calls, fetch } = counting({
      "https://m/b.onnx": () =>
        up
          ? Promise.resolve(new Response("b", { status: 200 }))
          : Promise.reject(new TypeError("offline")),
      "https://m/404": () => Promise.resolve(new Response("", { status: 404 })),
    });
    const f = memoFetch(fetch);
    await expect(f("https://m/b.onnx")).rejects.toThrow("offline");
    up = true;
    expect(await (await f("https://m/b.onnx")).text()).toBe("b");
    expect((await f("https://m/404")).status).toBe(404);
    expect((await f("https://m/404")).status).toBe(404);
    expect(calls).toEqual([
      "https://m/b.onnx",
      "https://m/b.onnx",
      "https://m/404",
      "https://m/404",
    ]);
  });
});
