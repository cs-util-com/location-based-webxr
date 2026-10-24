// Test fixture: a stage that forks a silent grandchild, records its pid,
// then prints nothing and never ends, like a wedged test worker. With
// "stubborn" it also traps SIGINT and SIGTERM, recording each one it gets
// (one name per line in "<pidFile>.signals") without exiting, like a worker
// that ignores them: only a SIGKILL ends it then. Its own pid goes to
// "<pidFile>.stage".
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const [pidFile, mode] = process.argv.slice(2);
if (mode === 'stubborn' && pidFile) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => appendFileSync(`${pidFile}.signals`, `${signal}\n`));
  }
}
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
if (pidFile) {
  writeFileSync(`${pidFile}.stage`, String(process.pid));
  writeFileSync(pidFile, String(grandchild.pid));
}
setInterval(() => {}, 1000);
