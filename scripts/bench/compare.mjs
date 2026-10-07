// Compares two commits on the same scenarios, alternating runs so network and Gemma drift hit both alike.
// Usage: node scripts/bench/compare.mjs <before ref> <after ref> [server runs = 5] [browser runs = 3]
//        node scripts/bench/compare.mjs --summary   (print medians of the saved results only)
// Needs Ollama running, Google Chrome (or CHROME=<path>), and ports 8788, 8789, 5174, and 5175 free.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const resultsDir = join(repo, 'docs/benchmarks/results');
const SUITES = ['server', 'conditions', 'browser'];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const seconds = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

function load(suite) {
  const file = join(resultsDir, `${suite}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function summarize() {
  for (const suite of SUITES) {
    const runs = load(suite);
    if (runs.length === 0) continue;
    const scenarios = Object.keys(runs[0].results).filter((name) => name !== 'errors');
    const countOf = (label) => runs.filter((run) => run.label === label).length;
    console.log(`\n### ${suite} (median of ${countOf('before')} before / ${countOf('after')} after runs)\n`);
    console.log('| Scenario | Before | After | Upstream or network requests | Extra |');
    console.log('|---|---|---|---|---|');
    for (const name of scenarios) {
      const pick = (label) =>
        runs
          .filter((run) => run.label === label)
          .map((run) => run.results[name])
          .filter(Boolean);
      const [before, after] = [pick('before'), pick('after')];
      const of = (rows, read) => median(rows.map(read));
      const calls = (row) => row.upstream ?? row.net?.requests ?? 0;
      const extras = [];
      if (before[0]?.gemma !== undefined)
        extras.push(`Gemma ${of(before, (r) => r.gemma)} → ${of(after, (r) => r.gemma)}`);
      if (before[0]?.net) extras.push(`${of(before, (r) => r.net.kb)} KB → ${of(after, (r) => r.net.kb)} KB`);
      console.log(
        `| ${name} | ${seconds(of(before, (r) => r.ms))} | ${seconds(of(after, (r) => r.ms))} | ${of(before, calls)} → ${of(after, calls)} | ${extras.join(', ')} |`,
      );
    }
  }
}

function run(command, args, options) {
  const { stdout } = spawnSync(command, args, { encoding: 'utf8', ...options });
  const line = stdout.split('\n').find((text) => text.startsWith('RESULT '));
  return line ? JSON.parse(line.slice('RESULT '.length)) : null;
}

async function compare(beforeRef, afterRef, serverRuns, browserRuns) {
  const versions = [
    { label: 'before', ref: beforeRef, serverPort: 8788, webPort: 5174 },
    { label: 'after', ref: afterRef, serverPort: 8789, webPort: 5175 },
  ];
  mkdirSync(resultsDir, { recursive: true });
  for (const suite of SUITES) writeFileSync(join(resultsDir, `${suite}.jsonl`), '');
  const env = join(repo, 'apps/server/.env');
  try {
    for (const version of versions) {
      version.dir = join(tmpdir(), `touch-grass-bench-${version.label}`);
      execFileSync('git', ['worktree', 'add', '--force', '--detach', version.dir, version.ref], { cwd: repo });
      execFileSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: version.dir, stdio: 'ignore' });
      if (existsSync(env)) symlinkSync(env, join(version.dir, 'apps/server/.env'));
      const viteConfig = join(version.dir, 'apps/web/vite.config.ts');
      const config = readFileSync(viteConfig, 'utf8').replace('localhost:8787', `localhost:${version.serverPort}`);
      writeFileSync(viteConfig, config);
      version.web = spawn('npx', ['vite', '--port', String(version.webPort), '--strictPort'], {
        cwd: join(version.dir, 'apps/web'),
        stdio: 'ignore',
        detached: true,
      });
    }
    const record = (suite, label, results) =>
      results && appendFileSync(join(resultsDir, `${suite}.jsonl`), `${JSON.stringify({ label, results })}\n`);
    const tsx = (version, script) =>
      run('npx', ['tsx', '--env-file-if-exists=.env', join(repo, 'scripts/bench', script), version.dir], {
        cwd: join(version.dir, 'apps/server'),
      });
    for (let i = 1; i <= serverRuns; i++) {
      for (const version of versions) {
        record('server', version.label, tsx(version, 'server.mjs'));
        record('conditions', version.label, tsx(version, 'conditions.mjs'));
        console.log(`server run ${i} ${version.label} done`);
      }
    }
    for (let i = 1; i <= browserRuns; i++) {
      for (const version of versions) {
        const args = [join(repo, 'scripts/bench/browser.mjs'), version.dir, version.serverPort, version.webPort];
        record('browser', version.label, run('node', args.map(String)));
        console.log(`browser run ${i} ${version.label} done`);
      }
    }
  } finally {
    for (const version of versions) {
      if (version.web) process.kill(-version.web.pid);
      if (version.dir) spawnSync('git', ['worktree', 'remove', '--force', version.dir], { cwd: repo });
    }
  }
  summarize();
}

const [first, second, serverRuns = '5', browserRuns = '3'] = process.argv.slice(2);
if (first === '--summary') summarize();
else if (first && second) await compare(first, second, Number(serverRuns), Number(browserRuns));
else console.log('Usage: node scripts/bench/compare.mjs <before ref> <after ref> [server runs] [browser runs]');
