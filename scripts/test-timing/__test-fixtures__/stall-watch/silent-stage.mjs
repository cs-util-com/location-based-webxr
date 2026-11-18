// Test fixture: a stage that forks a silent grandchild, records its pid,
// prints one line, then nothing and never ends, like a wedged test worker.
// The line comes after the pid is written, so the watch's silence starts
// there: on a loaded machine the stage's own start can outlast a tiny limit,
// and a stage killed before it wrote the pid left the test nothing to check.
// With "stubborn" it also traps SIGINT and SIGTERM, recording each one it gets
// (one name per line in "<pidFile>.signals") without exiting, like a worker
// that ignores them: only a SIGKILL ends it then. Its own pid goes to
// "<pidFile>.stage". With "reporter" it behaves like a Playwright run: a SIGINT
// makes it write "<pidFile>.report" and end, and a SIGTERM ends it with neither.
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const [pidFile, mode] = process.argv.slice(2);
if (mode === 'stubborn' && pidFile) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => appendFileSync(`${pidFile}.signals`, `${signal}\n`));
  }
}
if (mode === 'reporter' && pidFile) {
  process.on('SIGINT', () => {
    writeFileSync(`${pidFile}.report`, 'written');
    process.exit(130);
  });
}
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
if (pidFile) {
  writeFileSync(`${pidFile}.stage`, String(process.pid));
  writeFileSync(pidFile, String(grandchild.pid));
}
process.stdout.write('silent stage started\n');
setInterval(() => {}, 1000);
