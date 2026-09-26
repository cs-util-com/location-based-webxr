/**
 * Starts serve.mjs for a local tool on the aux port 5198
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

/** The aux port the design system's local tools and smokes use. */
export const AUX_PORT = 5198;

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
