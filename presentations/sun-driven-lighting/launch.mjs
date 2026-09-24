// Presentation-only supervisor. Reuses each package's dev script, including its build.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { server } from './serve.mjs';
import { demos, presentationPort, localUrl } from './runtime-config.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const children = [];
let stopping = false;
let cleanupFailed = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping presentation and owned demo processes...');
  server.close(); server.closeAllConnections();
  await Promise.all(children.map(({ child }) => new Promise(resolve => {
    if (!child.pid) return resolve();
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      killer.stdout.on('data', data => { output += data; });
      killer.stderr.on('data', data => { output += data; });
      killer.once('error', error => { cleanupFailed = true; console.error(`Could not stop demo tree ${child.pid}: ${error.message}`); resolve(); });
      killer.once('exit', result => {
        if (result !== 0 && child.exitCode === null) { cleanupFailed = true; console.error(`Could not stop demo tree ${child.pid}: ${output}`); }
        resolve();
      });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} resolve(); }, 1500);
    }
  })));
  process.exit(cleanupFailed ? 1 : code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
// The runtime check uses IPC for the same cleanup path as Ctrl+C.
process.on('message', message => { if (message === 'stop') void stop(); });
async function freePort(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', error => reject(new Error(`Port ${port} unavailable (${error.code}). Stop its existing server before launching.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
async function startDemo(demo) {
  console.log(`Starting ${demo.label} on ${demo.port} (framework build first)...`);
  const args = ['--dir', demo.directory, 'run', 'dev', '--host', '127.0.0.1', '--port', String(demo.port), '--strictPort'];
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', `pnpm.cmd ${args.join(' ')}`], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('pnpm', args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { child, log: '', failure: null };
  children.push(state);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { state.log = (state.log + data).slice(-12000); });
  child.once('error', error => { state.failure = error; });
  child.once('exit', code => {
    state.failure = new Error(`${demo.label} exited (${code}).\n${state.log}`);
    if (!stopping) { console.error(state.failure.message); void stop(1); }
  });
  const deadline = Date.now() + 180000;
  while (!stopping && Date.now() < deadline) {
    if (state.failure) throw state.failure;
    try {
      const response = await fetch(localUrl(demo.port), { signal: AbortSignal.timeout(1500) });
      const html = await response.text();
      if (response.ok && html.includes(demo.title)) { console.log(`Ready: ${demo.label} ${localUrl(demo.port)}`); return; }
    } catch {}
    await sleep(300);
  }
  if (!stopping) throw new Error(`${demo.label} did not become ready within 180 seconds.\n${state.log}`);
}
try {
  for (const port of [presentationPort, ...demos.map(d => d.port)]) await freePort(port);
  // Sequential startup avoids concurrent writes to shared framework/dist.
  for (const demo of demos) { if (stopping) break; await startDemo(demo); }
  if (!stopping) {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(presentationPort, '127.0.0.1', resolve); });
    console.log(`\nPresentation ready: ${localUrl(presentationPort)}`);
    for (const demo of demos) console.log(`${demo.label}: ${localUrl(demo.port)}`);
    console.log('Open the presentation URL. F: fullscreen | S: speaker notes | Ctrl+C: stop all servers.');
    process.send?.('ready');
  }
} catch (error) { console.error(error.message); await stop(1); }
