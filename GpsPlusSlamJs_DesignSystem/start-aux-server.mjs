/**
 * Starts serve.mjs for a local tool on the aux port (5198 by default)
 * (docs/dev-server-ports.md), bound to 127.0.0.1, and resolves once it is
 * listening. Used by shoot-3d.mjs and measure-globe.mjs, which never reuse a
 * server left running for a phone round.
 *
 * @see start-aux-server.mjs.md
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The aux port the design system's local tools and smokes use: 5198, or a
 * second checkout's `DS_E2E_PORT` (see 3d/playwright.config.mjs), so two
 * worktrees' tools never share a server. The same rule as the smoke config:
 * a port without a leading zero, so the URL a tool opens is the one served.
 */
export const AUX_PORT = (() => {
  const raw = process.env.DS_E2E_PORT ?? "5198";
  if (!/^[1-9]\d{3,4}$/.test(raw)) {
    throw new Error(`DS_E2E_PORT must be a port number, got "${raw}"`);
  }
  return Number(raw);
})();

/** Resolves with the child once serve.mjs prints that it is listening. */
export function startAuxServer(port = AUX_PORT) {
  const child = spawn(process.execPath, [join(here, "serve.mjs")], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("design system served")) resolve(child);
    });
    child.on("exit", (code) => reject(new Error(`serve.mjs exited ${code}`)));
  });
}
