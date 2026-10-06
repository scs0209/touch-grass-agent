#!/usr/bin/env node
// Stop hook: if code or setup changed since the README was last checked, ask the agent to check it once.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const CHECKED_FILE = '.git/readme-checked';
const WATCHED = /^(apps\/|package\.json$|pnpm-workspace\.yaml$)/;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const isAncestor = (older, newer) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', older, newer]);
    return true;
  } catch {
    return false;
  }
};

function changedSinceCheck() {
  let base = git('log', '-1', '--format=%H', '--', 'README.md');
  if (!base) return [];
  const checked = existsSync(CHECKED_FILE) ? readFileSync(CHECKED_FILE, 'utf8').trim() : '';
  if (checked && isAncestor(base, checked) && isAncestor(checked, 'HEAD')) base = checked;

  const tracked = git('diff', '--name-only', base).split('\n');
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n');
  return [...new Set([...tracked, ...untracked])].filter(Boolean);
}

function respond(output) {
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
if (input.status !== 'completed' || (input.loop_count ?? 0) > 0) respond({});

try {
  const changed = changedSinceCheck();
  const watched = changed.filter((file) => WATCHED.test(file));
  if (watched.length === 0 || changed.includes('README.md')) respond({});

  const files = watched.slice(0, 10).join(', ') + (watched.length > 10 ? ', …' : '');
  respond({
    followup_message:
      `Code changed since the README was last checked (${files}). Following .cursor/rules/readme-sync.mdc, ` +
      'compare README.md with these changes. If it is out of date, update it (recapture screenshots if the UI changed), ' +
      `commit, and push. If it is still accurate, run \`git rev-parse HEAD > ${CHECKED_FILE}\` and say so in one sentence.`,
  });
} catch {
  respond({});
}
