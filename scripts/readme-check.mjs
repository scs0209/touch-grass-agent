#!/usr/bin/env node
// Stop hook for Cursor, Claude Code, and Codex: if code or setup changed since the README was last
// checked, ask the agent to check it once. Usage: node scripts/readme-check.mjs <cursor|claude|codex>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const CHECKED_FILE = '.git/readme-checked';
const WATCHED = /^(apps\/|package\.json$|pnpm-workspace\.yaml$)/;
/** The README has the short version and docs/how-it-works.md the details; updating either counts as a check. */
const DOCS = ['README.md', 'docs/how-it-works.md'];
const agent = process.argv[2] ?? 'cursor';

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
  let base = git('log', '-1', '--format=%H', '--', ...DOCS);
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

// Cursor sends { status, loop_count } and reads followup_message.
// Claude Code and Codex send { stop_hook_active } and read { decision: "block", reason }.
function alreadyReminded(input) {
  if (agent === 'cursor') return input.status !== 'completed' || (input.loop_count ?? 0) > 0;
  return input.stop_hook_active === true;
}

function remind(message) {
  respond(agent === 'cursor' ? { followup_message: message } : { decision: 'block', reason: message });
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  if (alreadyReminded(input)) respond({});

  process.chdir(git('rev-parse', '--show-toplevel'));
  const changed = changedSinceCheck();
  const watched = changed.filter((file) => WATCHED.test(file));
  if (watched.length === 0 || DOCS.some((doc) => changed.includes(doc))) respond({});

  const files = watched.slice(0, 10).join(', ') + (watched.length > 10 ? ', …' : '');
  remind(
    `Code changed since the README was last checked (${files}). Following "Keep the README in sync" in AGENTS.md, ` +
      'compare README.md and docs/how-it-works.md with these changes. If they are out of date, update them (recapture screenshots if the UI changed), ' +
      `commit, and push. If they are still accurate, run \`git rev-parse HEAD > ${CHECKED_FILE}\` and say so in one sentence.`,
  );
} catch {
  respond({});
}
