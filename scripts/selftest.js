// Runs Burrow's self-test and prints a short summary.
//   npm test                    everything
//   npm test -- phase8          just one part
//   npm test -- phase7 phase8   several parts
//   npm test -- --slow          also list the slowest checks (to find what to speed up)
// Parts: basics, phase3, phase4, phase5, welcome, phase6, phase7, phase8, phase9, phase10, phase11, phase12, phase13, phase14, v022, v030, v031, windows
// Screenshots and the full log go to .selftest/ in the project (ignored by Git).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const out = path.join(root, '.selftest');
fs.rmSync(out, { recursive: true, force: true });
const args = process.argv.slice(2);
const slow = args.includes('--slow'); // also list the 30 slowest checks
const only = args.filter((a) => a !== '--slow').join(',');
const t0 = Date.now();
const child = spawn(electron, ['.'], {
  cwd: root,
  env: { ...process.env, BURROW_SELFTEST: out, BURROW_SELFTEST_ONLY: only, ...(slow ? { BURROW_SELFTEST_SLOW: '1' } : {}) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  const lines = buf.split(/\r?\n/);
  buf = lines.pop();
  for (const line of lines) {
    const m = line.match(/^\[selftest\] (.*)$/);
    if (m && !m[1].startsWith('PASS')) console.log(m[1]); // sections, timings, failures
  }
});
child.stderr.resume();
child.on('exit', () => {
  let log = '';
  try { log = fs.readFileSync(path.join(out, 'log.txt'), 'utf8'); } catch { /* crashed before writing */ }
  const pass = (log.match(/^PASS/gm) || []).length;
  const fail = (log.match(/^(FAIL|ERROR)/gm) || []).length;
  console.log(`\n${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)}s). Screenshots + log: ${out}`);
  process.exit(fail || !log ? 1 : 0);
});
